-- =============================================
-- FILAO: Migration 070 — Cloisonnement des profils utilisateurs
-- =============================================
--
-- PROBLÈME
-- La policy « Authenticated users can read basic profiles » porte la condition
-- `true` : tout utilisateur authentifié lit l'INTÉGRALITÉ de la table
-- `utilisateurs` — nom et prénom, mais aussi e-mail, téléphone et date de
-- naissance de toutes les personnes inscrites, y compris celles d'entreprises
-- concurrentes avec lesquelles il n'a jamais collaboré.
--
-- POURQUOI ON NE PEUT PAS SIMPLEMENT RESTREINDRE
-- L'application a un besoin légitime de lire certaines informations d'autrui :
-- afficher les membres d'un groupement, attribuer un commentaire à son auteur,
-- montrer une photo dans l'annuaire. Restreindre la table à `id = auth.uid()`
-- casserait ces écrans.
--
-- SOLUTION
-- Séparer les colonnes d'IDENTIFICATION (nom, prénom, photo, entreprise), qui
-- peuvent être partagées, des colonnes de CONTACT et de données personnelles
-- (téléphone, date de naissance), qui ne le peuvent pas.
--
--   - La TABLE `utilisateurs` redevient strictement personnelle : chacun ne lit
--     que sa propre ligne.
--   - Une VUE `utilisateurs_publics` expose les colonnes d'identification.
--   - L'E-MAIL est un cas intermédiaire : nécessaire entre partenaires d'un même
--     dossier (l'application le lit pour composer l'équipe et rattacher les
--     invitations), mais qui n'a pas à circuler au-delà. Il n'est donc exposé
--     que si l'on partage effectivement un dossier avec la personne — sinon la
--     colonne vaut NULL.
--
-- ⚠️ DÉPEND des migrations 067 (schéma `app`) et 068.
-- ⚠️ S'ACCOMPAGNE de modifications du front (TenderWizard, CommentsView) qui
--    repointent leurs deux requêtes inter-utilisateurs vers la vue. Appliquer
--    les deux ensemble.

-- ---------------------------------------------------------------
-- 1. app.partage_dossier(utilisateur) — collaboration effective
-- ---------------------------------------------------------------
-- Vrai si l'appelant et la personne visée participent tous deux à un même
-- dossier : soit l'un le porte et l'autre y est accepté, soit les deux
-- entreprises y sont acceptées.
--
-- La notion d'appartenance reste celle de `app.est_membre()` : une invitation
-- non acceptée ne crée aucun lien et n'ouvre donc pas l'accès à l'e-mail.
CREATE OR REPLACE FUNCTION app.partage_dossier(p_utilisateur UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cible AS (
    SELECT entreprise_id FROM public.utilisateurs WHERE id = p_utilisateur
  ),
  -- Dossiers auxquels l'APPELANT participe.
  miens AS (
    SELECT r.id FROM public.reponses_ao r WHERE r.createur_id = auth.uid()
    UNION
    SELECT g.projet_id FROM public.groupements g
     WHERE g.entreprise_id = app.entreprise_courante() AND g.statut = 'accepte'
  )
  SELECT EXISTS (
    -- La personne visée porte l'un de mes dossiers…
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id IN (SELECT id FROM miens) AND r.createur_id = p_utilisateur
    UNION ALL
    -- … ou son entreprise y est acceptée.
    SELECT 1 FROM public.groupements g
     WHERE g.projet_id IN (SELECT id FROM miens)
       AND g.entreprise_id = (SELECT entreprise_id FROM cible)
       AND g.statut = 'accepte'
  );
$$;

COMMENT ON FUNCTION app.partage_dossier(UUID) IS
  'Vrai si l''appelant collabore effectivement avec la personne visée sur au moins un dossier. Conditionne l''exposition de l''e-mail.';

GRANT EXECUTE ON FUNCTION app.partage_dossier(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION app.partage_dossier(UUID) FROM anon, public;

-- ---------------------------------------------------------------
-- 2. Vue utilisateurs_publics
-- ---------------------------------------------------------------
-- Aucune colonne sensible n'y figure : ni téléphone, ni date de naissance, ni
-- TVA, ni préférences. Seules les données nécessaires pour identifier une
-- personne à l'écran.
--
-- La vue s'exécute avec les droits de son propriétaire (comportement par défaut
-- de Postgres), ce qui lui permet de lire la table malgré la policy restrictive
-- posée plus bas. C'est précisément l'effet recherché : la vue devient l'unique
-- canal d'accès aux profils d'autrui, et son contenu est décidé ici.
DROP VIEW IF EXISTS public.utilisateurs_publics;

CREATE VIEW public.utilisateurs_publics AS
SELECT
  u.id,
  u.prenom,
  u.nom,
  u.photo_url,
  u.entreprise_id,
  -- E-mail exposé uniquement à soi-même et aux partenaires d'un dossier commun.
  CASE
    WHEN u.id = auth.uid() OR app.partage_dossier(u.id) THEN u.email
    ELSE NULL
  END AS email
FROM public.utilisateurs u;

COMMENT ON VIEW public.utilisateurs_publics IS
  'Profils réduits aux colonnes d''identification. Unique canal de lecture des profils d''autrui. L''e-mail n''est visible qu''entre partenaires d''un même dossier.';

GRANT SELECT ON public.utilisateurs_publics TO authenticated;
REVOKE ALL ON public.utilisateurs_publics FROM anon;

-- ---------------------------------------------------------------
-- 3. La table redevient strictement personnelle
-- ---------------------------------------------------------------
-- C'est le cœur du correctif : sans cette suppression, la vue ne servirait à
-- rien puisque la table resterait lisible en entier.
DROP POLICY IF EXISTS "Authenticated users can read basic profiles" ON utilisateurs;

-- « Users can read own profile » (qual: auth.uid() = id) est conservée et
-- devient la seule voie d'accès à la table. On la renomme pour suivre la
-- convention <table>_<verbe>_<acteur>.
DROP POLICY IF EXISTS "Users can read own profile" ON utilisateurs;
CREATE POLICY "utilisateurs_select_soi"
  ON utilisateurs FOR SELECT TO authenticated
  USING (id = auth.uid());

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- En tant qu'utilisateur authentifié (pas service_role) :
--
--   select count(*) from utilisateurs;
--   -- attendu : 1 (soi-même uniquement)
--
--   select count(*) from utilisateurs_publics;
--   -- attendu : le nombre total d'inscrits (identification partagée)
--
--   select id, email from utilisateurs_publics where email is not null;
--   -- attendu : soi-même et les seuls partenaires d'un dossier commun
--
--   select * from utilisateurs_publics limit 1;
--   -- attendu : aucune colonne telephone / date_naissance / tva
