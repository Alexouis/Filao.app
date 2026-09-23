-- =============================================
-- FILAO: Migration 106 — Accès invité par code : révocation et réponse
-- =============================================
--
-- PROBLÈME 1 — un code révoqué ouvrait toujours le dossier
-- La 043 a introduit `invitations.revoked_at` et l'a appliqué au parcours par
-- JETON (`get_invitation_by_token`, `resoudre_invitation_par_jeton`,
-- `respond_to_invitation`). `get_invitation_by_code` (041) n'a jamais été
-- repris : un partenaire retiré du dossier, qui conserve l'e-mail
-- d'invitation, pouvait encore s'y connecter avec son code. C'est pourtant le
-- parcours du lien envoyé par e-mail (`/collaborator-access?tenderId=…`, sans
-- jeton).
--
-- PROBLÈME 2 — `respond_to_invitation_by_code` absente des migrations
-- L'écran invité l'appelle pour accepter ou refuser en mode code, mais aucune
-- migration ne la définit. Si elle n'existe pas en base, l'acceptation échoue
-- (« Erreur lors de la mise à jour du statut ») ; si elle a été créée à la
-- main, sa définition n'est ni versionnée ni alignée sur la 047. On la
-- (re)crée ici, calquée sur `respond_to_invitation` (047).

-- ---------------------------------------------------------------
-- 1. Lecture par code : révocation prise en compte
-- ---------------------------------------------------------------
-- L'expiration reste renvoyée (`expires_at`) et contrôlée par l'écran, comme en
-- mode jeton (043) : elle permet un message explicite plutôt qu'un refus muet.
CREATE OR REPLACE FUNCTION get_invitation_by_code(
    p_tender_id UUID,
    p_email     TEXT,
    p_code      TEXT
)
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
    WHERE p_code IS NOT NULL
      AND length(btrim(p_code)) >= 6
      AND i.tender_id = p_tender_id
      AND lower(i.email) = lower(btrim(p_email))
      AND upper(i.access_code) = upper(btrim(p_code))
      AND i.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION get_invitation_by_code(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invitation_by_code(UUID, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 2. Réponse par code
-- ---------------------------------------------------------------
-- DROP préalable : une version créée à la main pourrait avoir un autre type de
-- retour, que CREATE OR REPLACE refuserait de changer.
DROP FUNCTION IF EXISTS respond_to_invitation_by_code(UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION respond_to_invitation_by_code(
    p_tender_id UUID,
    p_email     TEXT,
    p_code      TEXT,
    p_status    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_maj INT;
    v_entreprise_invitee UUID;
    v_entreprise_porteuse UUID;
BEGIN
    IF p_status NOT IN ('accepted', 'refused') THEN
        RAISE EXCEPTION 'Statut invalide: %', p_status;
    END IF;
    IF p_code IS NULL OR length(btrim(p_code)) < 6 THEN
        RETURN FALSE;
    END IF;

    UPDATE invitations
       SET status      = p_status,
           accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END,
           refused_at  = CASE WHEN p_status = 'refused'  THEN now() ELSE refused_at  END
     WHERE tender_id = p_tender_id
       AND lower(email) = lower(btrim(p_email))
       AND upper(access_code) = upper(btrim(p_code))
       AND status = 'pending'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now());

    GET DIAGNOSTICS v_maj = ROW_COUNT;
    IF v_maj = 0 THEN
        RETURN FALSE;
    END IF;

    -- Mise en relation sur acceptation, comme la 047. Un invité anonyme n'a
    -- pas d'entreprise connue : la liaison se fera à sa première connexion.
    IF p_status = 'accepted' THEN
        SELECT entreprise_id INTO v_entreprise_invitee
          FROM utilisateurs WHERE id = auth.uid();
        SELECT u.entreprise_id INTO v_entreprise_porteuse
          FROM reponses_ao r JOIN utilisateurs u ON u.id = r.createur_id
         WHERE r.id = p_tender_id;
        PERFORM relier_entreprises(v_entreprise_invitee, v_entreprise_porteuse);
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION respond_to_invitation_by_code(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION respond_to_invitation_by_code(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Invitation révoquée : plus aucune ligne.
--   update invitations set revoked_at = now() where id = '<invitation de test>';
--   select count(*) from get_invitation_by_code('<dossier>', '<email>', '<code>');  -- 0
