-- =============================================
-- FILAO: Migration 042 — Jetons d'invitation hachés
-- =============================================
--
-- CONTEXTE
-- La conception de la page d'invitation impose : « stockage haché en SHA-256 —
-- la base ne contient jamais le token en clair ».
--
-- Aujourd'hui `invitations.token` contient la valeur brute. Toute personne
-- lisant cette colonne — une sauvegarde, un export, un accès en lecture à la
-- table — peut se faire passer pour n'importe quel invité, consulter le dossier
-- et y déposer des fichiers. Le jeton est un secret d'authentification : il se
-- traite comme un mot de passe.
--
-- PRINCIPE
-- Le jeton en clair n'existe qu'à deux moments : sa génération, où il part dans
-- le lien du courriel, et chaque requête où l'invité le présente. La base ne
-- garde que son empreinte.
--
-- Pas de sel ni de bcrypt ici, contrairement à un mot de passe : un jeton de
-- 32 octets aléatoires n'est pas attaquable par dictionnaire, et la vérification
-- doit rester rapide — elle intervient à chaque requête de l'invité.
--
-- ⚠️ Les liens en circulation restent valides : les empreintes sont calculées
--    à partir des jetons existants avant leur suppression.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------
-- 1. Colonne d'empreinte
-- ---------------------------------------------------------------
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- Reprise des jetons existants. Une fois cette étape passée, les liens déjà
-- envoyés continuent de fonctionner sans que la valeur brute subsiste.
UPDATE invitations
   SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
 WHERE token IS NOT NULL AND token_hash IS NULL;

-- Recherche par empreinte à chaque requête d'un invité : sans index, chaque
-- appel provoquerait un parcours complet de la table.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_unique
    ON invitations (token_hash) WHERE token_hash IS NOT NULL;

COMMENT ON COLUMN invitations.token_hash IS
  'Empreinte SHA-256 du jeton d''invitation. La valeur en clair n''est jamais stockée : elle ne circule que dans le lien envoyé à l''invité.';

-- ---------------------------------------------------------------
-- 2. Suppression du jeton en clair
-- ---------------------------------------------------------------
-- L'ordre compte : la reprise ci-dessus doit être faite avant.
ALTER TABLE invitations DROP COLUMN IF EXISTS token;

-- ---------------------------------------------------------------
-- 3. Fonctions de lecture et de réponse
-- ---------------------------------------------------------------
-- Elles reçoivent toujours le jeton en clair — c'est ce que présente l'invité —
-- et le hachent pour la comparaison. Le calcul est fait côté base : l'appelant
-- n'a pas à connaître l'algorithme, et un client qui enverrait déjà une
-- empreinte ne pourrait pas s'authentifier avec une valeur volée en base.

CREATE OR REPLACE FUNCTION empreinte_jeton(p_token TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = extensions, pg_temp
AS $$
    SELECT CASE
        WHEN p_token IS NULL OR length(p_token) < 16 THEN NULL
        ELSE encode(digest(p_token, 'sha256'), 'hex')
    END;
$$;

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
      AND i.token_hash = empreinte_jeton(p_token);
$$;

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
       AND (expires_at IS NULL OR expires_at > now());

    GET DIAGNOSTICS v_maj = ROW_COUNT;
    RETURN v_maj > 0;
END;
$$;

-- ---------------------------------------------------------------
-- 4. Résolution d'une invitation pour les edge functions
-- ---------------------------------------------------------------
-- `guest-files` et `upload-document` interrogeaient `invitations` par jeton en
-- clair. Elles passent par cette fonction plutôt que de reproduire le hachage
-- chacune de leur côté — un algorithme dupliqué finit par diverger.

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
       AND i.token_hash = empreinte_jeton(p_token);
$$;

-- ---------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION empreinte_jeton(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resoudre_invitation_par_jeton(TEXT) FROM PUBLIC;
-- Réservée au service : elle ne vérifie aucun secret supplémentaire et sert
-- aux edge functions, jamais au navigateur.
GRANT EXECUTE ON FUNCTION resoudre_invitation_par_jeton(TEXT) TO service_role;

REVOKE ALL ON FUNCTION get_invitation_by_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION respond_to_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invitation_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION respond_to_invitation(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 6. Vérification
-- ---------------------------------------------------------------
--   select column_name from information_schema.columns
--    where table_name = 'invitations' and column_name in ('token', 'token_hash');
--   → `token_hash` seul.
--
--   select count(*) filter (where token_hash is null) as sans_empreinte,
--          count(*) as total from invitations;
--   → `sans_empreinte` doit valoir 0.
--
-- ⚠️ `send-invitation` doit être déployée AVANT cette migration : elle écrit
--    encore la colonne `token`, dont la disparition ferait échouer l'insert.