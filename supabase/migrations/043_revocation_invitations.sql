-- =============================================
-- FILAO: Migration 043 — Révocation et expiration des invitations
-- =============================================
--
-- CONTEXTE
-- La conception demande trois comportements distincts, dont deux doivent être
-- indiscernables de l'extérieur :
--
--   jeton expiré  → « Cette invitation a expiré » + demande d'un nouveau lien
--   jeton révoqué → message neutre
--   jeton inconnu → message neutre, IDENTIQUE au précédent
--
-- Ce dernier point n'est pas cosmétique : si un jeton révoqué produisait un
-- message différent d'un jeton inexistant, on pourrait déterminer par essais
-- successifs quels jetons ont existé. Peu exploitable ici, mais c'est la même
-- règle qui interdit de répondre « ce compte n'existe pas » à une connexion.
--
-- L'expiration, elle, doit rester visible : c'est une situation légitime pour
-- laquelle l'invité a une action à entreprendre.

-- ---------------------------------------------------------------
-- 1. Colonne de révocation
-- ---------------------------------------------------------------
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_by UUID;

COMMENT ON COLUMN invitations.revoked_at IS
  'Retrait de l''accès par le mandataire. Une invitation révoquée devient indiscernable d''une invitation inexistante.';

-- ---------------------------------------------------------------
-- 2. Lecture : révoquée = inexistante, expirée = visible
-- ---------------------------------------------------------------
-- La ligne expirée est renvoyée pour que l'écran puisse afficher le bon
-- message. C'est `expires_at`, déjà dans la charge utile, qui permet à
-- l'interface de trancher.

CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token TEXT)
RETURNS SETOF invitation_invite
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT
        i.id, i.email, i.role::TEXT, i.status::TEXT, i.message, i.expires_at,
        r.id, r.titre, r.organisme_acheteur, r.date_limite, r.date_publication,
        r.date_depot_souhaitee, r.lieu_execution,
        r.secteur_activite::TEXT, r.type_marche, r.type_groupement,
        r.mode_passation::TEXT, r.description, r.lien_telechargement, r.statut::TEXT,
        r.createur_id, u.nom, u.prenom, u.entreprise
    FROM invitations i
    JOIN reponses_ao r ON r.id = i.tender_id
    LEFT JOIN utilisateurs u ON u.id = i.created_by
    WHERE empreinte_jeton(p_token) IS NOT NULL
      AND i.token_hash = empreinte_jeton(p_token)
      -- Révoquée : on ne renvoie rien, exactement comme pour un jeton inconnu.
      AND i.revoked_at IS NULL;
$$;

-- ---------------------------------------------------------------
-- 3. Écritures : ni révoquée, ni expirée
-- ---------------------------------------------------------------
-- Consulter une invitation expirée reste possible — c'est ce qui permet
-- d'afficher le message —, mais plus y répondre ni y déposer quoi que ce soit.

CREATE OR REPLACE FUNCTION respond_to_invitation(p_token TEXT, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_maj INT;
    v_empreinte TEXT := empreinte_jeton(p_token);
BEGIN
    IF p_status NOT IN ('accepted', 'refused') THEN
        RAISE EXCEPTION 'Statut invalide: %', p_status;
    END IF;
    IF v_empreinte IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE invitations
       SET status      = p_status,
           accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END,
           refused_at  = CASE WHEN p_status = 'refused'  THEN now() ELSE refused_at  END
     WHERE token_hash = v_empreinte
       AND status = 'pending'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now());

    GET DIAGNOSTICS v_maj = ROW_COUNT;
    RETURN v_maj > 0;
END;
$$;

-- Résolution pour les edge functions : une invitation révoquée ou expirée ne
-- doit plus autoriser ni lecture de fichiers, ni dépôt.
CREATE OR REPLACE FUNCTION resoudre_invitation_par_jeton(p_token TEXT)
RETURNS TABLE (email TEXT, tender_id UUID, status TEXT, expires_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT i.email, i.tender_id, i.status::TEXT, i.expires_at
      FROM invitations i
     WHERE empreinte_jeton(p_token) IS NOT NULL
       AND i.token_hash = empreinte_jeton(p_token)
       AND i.revoked_at IS NULL
       AND (i.expires_at IS NULL OR i.expires_at > now());
$$;

-- ---------------------------------------------------------------
-- 4. Révocation par le mandataire
-- ---------------------------------------------------------------
-- Passe par une fonction plutôt que par un UPDATE direct : la policy
-- `Creators can update own invitations` couvre le cas, mais une fonction
-- garantit qu'on ne peut pas révoquer autre chose que ce que l'on a créé, et
-- que la traçabilité est renseignée.

CREATE OR REPLACE FUNCTION revoquer_invitation(p_invitation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_maj INT;
BEGIN
    UPDATE invitations i
       SET revoked_at = now(),
           revoked_by = auth.uid()
     WHERE i.id = p_invitation_id
       AND i.revoked_at IS NULL
       -- Seul le créateur de l'appel d'offres retire un accès.
       AND EXISTS (
           SELECT 1 FROM reponses_ao r
            WHERE r.id = i.tender_id AND r.createur_id = auth.uid()
       );

    GET DIAGNOSTICS v_maj = ROW_COUNT;
    RETURN v_maj > 0;
END;
$$;

REVOKE ALL ON FUNCTION revoquer_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoquer_invitation(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 5. Demande d'un nouveau lien
-- ---------------------------------------------------------------
-- Porte de sortie pour l'invité arrivé après expiration. Sans elle, il n'a
-- aucun recours : il ne connaît pas nécessairement l'adresse du mandataire, et
-- l'invitation ne la lui donne pas.
--
-- La demande se contente d'horodater : c'est le mandataire qui décide de
-- renvoyer un lien. Régénérer automatiquement reviendrait à laisser un jeton
-- expiré prolonger indéfiniment sa propre validité.

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS relance_demandee_le TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION demander_nouveau_lien(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_maj INT;
    v_empreinte TEXT := empreinte_jeton(p_token);
BEGIN
    IF v_empreinte IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Une seule demande par heure : le bouton est à portée d'un invité anonyme.
    UPDATE invitations
       SET relance_demandee_le = now()
     WHERE token_hash = v_empreinte
       AND revoked_at IS NULL
       AND (relance_demandee_le IS NULL OR relance_demandee_le < now() - interval '1 hour');

    GET DIAGNOSTICS v_maj = ROW_COUNT;

    -- Notification in-app du mandataire. Sans elle, la demande dormirait dans
    -- une colonne que rien ne lit, et le message affiché à l'invité —
    -- « votre interlocuteur vous fera parvenir un nouveau lien » — serait faux.
    IF v_maj > 0 THEN
        UPDATE utilisateurs u
           SET notifications = ARRAY[jsonb_build_object(
                 'id', gen_random_uuid(),
                 'type', 'invitation_relance',
                 'titre', 'Demande de nouveau lien',
                 'message', format('%s demande un nouveau lien d''invitation pour', i.email),
                 'related_tender_id', i.tender_id,
                 'related_tender_titre', r.titre,
                 'date', now(),
                 'read', false
               )] || COALESCE(u.notifications, ARRAY[]::jsonb[])
          FROM invitations i
          JOIN reponses_ao r ON r.id = i.tender_id
         WHERE i.token_hash = v_empreinte
           AND u.id = r.createur_id;
    END IF;

    RETURN v_maj > 0;
END;
$$;

REVOKE ALL ON FUNCTION demander_nouveau_lien(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demander_nouveau_lien(TEXT) TO anon, authenticated;

COMMENT ON COLUMN invitations.relance_demandee_le IS
  'Horodatage de la dernière demande de nouveau lien par l''invité. À faire remonter au mandataire dans l''écran Équipe.';

-- ---------------------------------------------------------------
-- 6. Vérification
-- ---------------------------------------------------------------
--   select revoquer_invitation('<id>');            -- true si révoquée
--   select * from get_invitation_by_token('<jeton>');  -- 0 ligne après révocation
--
-- Un jeton inconnu renvoie également 0 ligne : les deux cas sont bien
-- indiscernables côté client.