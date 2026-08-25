-- =============================================
-- FILAO: Migration 068 — Une policy par table et par verbe (dossiers)
-- =============================================
--
-- PÉRIMÈTRE
-- Cette migration traite les deux tables au cœur du risque inter-entreprises :
-- `reponses_ao` (le dossier, qui porte les montants) et `groupements` (la
-- composition de l'équipe). Les autres tables sont volontairement laissées en
-- l'état et documentées en fin de fichier : leur cas relève d'un arbitrage
-- produit, pas d'une correction technique.
--
-- CE QUE CORRIGE CETTE MIGRATION
--
-- 1. `reponses_ao` porte aujourd'hui TROIS policies de lecture qui s'additionnent
--    en OR :
--      - reponses_ao_select_own        : createur_id = auth.uid()
--      - reponses_ao_select_groupement : groupement avec statut IN (accepte, invite)
--      - reponses_ao_select            : createur OR groupement (tous statuts)
--                                        OR invitations.email = mon email
--    Conséquences réelles :
--      a) une entreprise SEULEMENT INVITÉE (statut 'invite', invitation non
--         acceptée) lit déjà l'intégralité du dossier, montants compris ;
--      b) toute personne dont l'adresse figure dans `invitations` lit le dossier
--         entier, alors que la conception prévoit qu'un invité ne voie que
--         l'intitulé, l'acheteur, la date limite, le mandataire, le rôle proposé
--         et les pièces demandées.
--    La policy unique ci-dessous s'appuie sur `app.est_membre()`, qui exige le
--    statut 'accepte'. L'accès de l'invité sans compte passe par les Edge
--    Functions dédiées, pas par une policy.
--
-- 2. `groupements` autorise en écriture `entreprise_id = get_my_entreprise_id()`,
--    c'est-à-dire qu'un cotraitant peut modifier ou supprimer sa propre ligne de
--    groupement. La matrice réserve la composition de l'équipe au mandataire.
--
-- ⚠️ RELECTURE OBLIGATOIRE par une seconde personne avant application, et
--    application en préproduction d'abord : une erreur sur une policy RLS ouvre
--    un accès au lieu de le fermer.
--
-- ⚠️ DÉPEND de la migration 067 (schéma `app` et fonctions).

-- ---------------------------------------------------------------
-- reponses_ao — lecture : tout membre du groupement
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "reponses_ao_select"            ON reponses_ao;
DROP POLICY IF EXISTS "reponses_ao_select_own"        ON reponses_ao;
DROP POLICY IF EXISTS "reponses_ao_select_groupement" ON reponses_ao;

CREATE POLICY "reponses_ao_select_membre"
  ON reponses_ao FOR SELECT TO authenticated
  USING (app.est_membre(id));

-- ---------------------------------------------------------------
-- reponses_ao — écriture : mandataire uniquement
-- ---------------------------------------------------------------
-- La condition de quota est conservée telle quelle : un dossier verrouillé
-- faute de quota reste consultable mais non modifiable (dépassement doux).
DROP POLICY IF EXISTS "reponses_ao_update_own" ON reponses_ao;

CREATE POLICY "reponses_ao_update_mandataire"
  ON reponses_ao FOR UPDATE TO authenticated
  USING (app.est_mandataire(id) AND NOT verrouille_par_quota)
  WITH CHECK (app.est_mandataire(id) AND NOT verrouille_par_quota);

DROP POLICY IF EXISTS "Users can delete their tenders" ON reponses_ao;

CREATE POLICY "reponses_ao_delete_mandataire"
  ON reponses_ao FOR DELETE TO authenticated
  USING (app.est_mandataire(id));

-- La création reste ouverte à tout utilisateur authentifié, mais le dossier créé
-- doit lui appartenir : sans WITH CHECK, on pourrait insérer un dossier au nom
-- d'un tiers.
DROP POLICY IF EXISTS "reponses_ao_insert_policy" ON reponses_ao;

CREATE POLICY "reponses_ao_insert_utilisateur"
  ON reponses_ao FOR INSERT TO authenticated
  WITH CHECK (createur_id = auth.uid());

-- ---------------------------------------------------------------
-- groupements — lecture : tout membre du dossier
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "groupements_select_v2" ON groupements;

CREATE POLICY "groupements_select_membre"
  ON groupements FOR SELECT TO authenticated
  USING (app.est_membre(projet_id));

-- ---------------------------------------------------------------
-- groupements — écriture : mandataire uniquement
-- ---------------------------------------------------------------
-- ⚠️ POINT D'ATTENTION FONCTIONNEL
-- Si un cotraitant met à jour lui-même sa ligne (par exemple pour accepter une
-- invitation ou renseigner ses informations), cette restriction le bloquera.
-- Ce parcours doit alors passer par une Edge Function en service_role — c'est
-- déjà le cas de `accept-invitation`. À VÉRIFIER EN PRÉPRODUCTION avant
-- application en production.
DROP POLICY IF EXISTS "Ajout groupements" ON groupements;
DROP POLICY IF EXISTS "Modif groupements" ON groupements;
DROP POLICY IF EXISTS "Suppr groupements" ON groupements;

CREATE POLICY "groupements_insert_mandataire"
  ON groupements FOR INSERT TO authenticated
  WITH CHECK (app.est_mandataire(projet_id));

CREATE POLICY "groupements_update_mandataire"
  ON groupements FOR UPDATE TO authenticated
  USING (app.est_mandataire(projet_id))
  WITH CHECK (app.est_mandataire(projet_id));

CREATE POLICY "groupements_delete_mandataire"
  ON groupements FOR DELETE TO authenticated
  USING (app.est_mandataire(projet_id));

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select tablename, policyname, cmd, qual, with_check
--     from pg_policies
--    where tablename in ('reponses_ao','groupements')
--    order by tablename, cmd;
--
-- Attendu : une seule ligne par couple (table, verbe), chaque condition
-- appelant app.est_membre() ou app.est_mandataire().

-- ---------------------------------------------------------------
-- NON TRAITÉ ICI — arbitrages à rendre avant toute modification
-- ---------------------------------------------------------------
-- Les policies suivantes sont larges, mais les restreindre changerait le
-- comportement fonctionnel de l'application. Elles demandent une décision, pas
-- un correctif technique :
--
--   utilisateurs / "Authenticated users can read basic profiles" (qual: true)
--     Tout utilisateur authentifié lit TOUS les profils, e-mail et téléphone
--     compris. C'est le point le plus sensible de l'export. Mais l'annuaire et
--     l'affichage des membres d'un groupement s'appuient dessus : restreindre à
--     `id = auth.uid()` casserait ces écrans. Il faut d'abord décider quelles
--     colonnes sont publiques (nom, prénom, photo ?) et lesquelles ne le sont
--     pas (e-mail, téléphone), puis exposer une vue restreinte.
--
--   entreprises / "Lecture entreprises" (qual: true)
--     Toutes les entreprises sont lisibles. Probablement voulu (annuaire issu de
--     l'open data), mais à confirmer explicitement — et à documenter dans la
--     matrice si c'est le cas.
--
--   company_natures / company_domains / company_specialties /
--   company_expertise_tags / company_geo_zones
--     La policy "View network company ..." porte la condition
--     `entreprise_id IN (SELECT id FROM entreprises)`, qui est vraie pour toute
--     entreprise existante : elle équivaut à `true` et rend redondante la policy
--     "Manage own company ...". À aligner sur la décision prise pour
--     `entreprises`.
--
--   plan_limits
--     Deux policies de lecture : `actif` et `true`. La seconde l'emporte, donc
--     les forfaits inactifs sont exposés. Suppression sans risque une fois
--     confirmé qu'aucun écran ne lit un forfait inactif.
--
--   avis_partenaires / "Public read ratings" (qual: true) et roles / "Public can
--   view roles" (qual: true)
--     Lecture universelle. Sans doute assumée, à inscrire dans la matrice.
