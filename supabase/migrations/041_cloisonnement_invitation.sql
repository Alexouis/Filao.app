-- =============================================
-- FILAO: Migration 041 — Cloisonnement de l'accès invité
-- =============================================
--
-- CONTEXTE
-- La fiche « Page invitation à collaborer » pose comme critère d'acceptation :
-- « la réponse de invitation-view ne contient aucun montant ». Or les fonctions
-- de la migration 034a renvoient `montant_estime`, et l'espace partenaire
-- l'affiche sous l'intitulé « Montant Estimé ».
--
-- Une invitation ne doit pas permettre de connaître le budget d'un marché sur
-- lequel on est co-traitant : c'est une information de négociation. Le fait
-- qu'elle figure aussi dans l'avis public ne change rien — l'invité ne sait pas
-- forcément de quel avis il s'agit, et l'application n'a pas à faire le
-- rapprochement pour lui.
--
-- Le type composite est recréé : PostgreSQL ne permet pas de retirer un attribut
-- d'un type utilisé par des fonctions. Elles sont donc supprimées puis
-- redéfinies à l'identique, montant en moins.
--
-- ⚠️ Déployer le front AVANT cette migration : `CollaboratorSubmission` lit
--    `row.montant_estime`, qui deviendra absent. La valeur passera à undefined,
--    sans erreur, mais autant éviter l'affichage transitoire d'un montant vide.

-- ---------------------------------------------------------------
-- 1. Suppression des fonctions dépendantes
-- ---------------------------------------------------------------
DROP FUNCTION IF EXISTS get_invitation_by_token(TEXT);
DROP FUNCTION IF EXISTS get_invitation_by_code(UUID, TEXT, TEXT);
DROP TYPE IF EXISTS invitation_invite;

-- ---------------------------------------------------------------
-- 2. Type de retour, sans le montant
-- ---------------------------------------------------------------
CREATE TYPE invitation_invite AS (
    invitation_id       UUID,
    email               TEXT,
    role                TEXT,
    status              TEXT,
    message             TEXT,
    expires_at          TIMESTAMPTZ,
    tender_id           UUID,
    titre               TEXT,
    organisme_acheteur  TEXT,
    date_limite         TIMESTAMP,
    date_publication    TIMESTAMP,
    date_depot_souhaitee TIMESTAMP,
    -- `montant_estime` retiré : voir l'en-tête.
    lieu_execution      TEXT[],
    secteur_activite    TEXT,
    type_marche         TEXT[],
    type_groupement     TEXT,
    mode_passation      TEXT,
    description         TEXT,
    lien_telechargement TEXT,
    statut              TEXT,
    createur_id         UUID,
    createur_nom        TEXT,
    createur_prenom     TEXT,
    createur_entreprise TEXT
);

-- ---------------------------------------------------------------
-- 3. Lecture par jeton
-- ---------------------------------------------------------------
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
    WHERE p_token IS NOT NULL
      AND length(p_token) >= 16
      AND i.token = p_token;
$$;

-- ---------------------------------------------------------------
-- 4. Lecture par code d'accès
-- ---------------------------------------------------------------
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
      AND upper(i.access_code) = upper(btrim(p_code));
$$;

-- ---------------------------------------------------------------
-- 5. Droits
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION get_invitation_by_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_invitation_by_code(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_invitation_by_token(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_invitation_by_code(UUID, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 6. Vérification
-- ---------------------------------------------------------------
-- Aucune colonne de montant ne doit apparaître :
--   select attname from pg_attribute
--    where attrelid = 'invitation_invite'::regtype and attnum > 0;
--
-- ⚠️ Ce cloisonnement reste partiel au regard de la fiche. Restent exposés :
--    description du marché, mode de passation, secteur, type de marché. Ils ne
--    figurent pas dans la charge utile décrite par la conception, qui se limite
--    à l'intitulé, l'acheteur, la date limite et la référence. Les retirer
--    demande d'adapter l'écran partenaire, qui les affiche aujourd'hui.