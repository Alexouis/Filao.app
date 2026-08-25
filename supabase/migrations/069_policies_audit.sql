-- =============================================
-- FILAO: Migration 069 — Corrections issues de l'audit pg_policies
-- =============================================
--
-- CONTEXTE
-- L'export complet des policies (avec cmd, roles et with_check) a révélé des
-- points que la seule colonne `qual` masquait. Les migrations 067 et 068 ayant
-- assaini `reponses_ao` et `groupements`, cette migration traite le reste.
--
-- RAPPEL SUR LE RÔLE `public`
-- Dans Postgres, `public` désigne TOUS les rôles, `anon` compris. Une policy
-- accordée à `public` avec une condition `true` est donc lisible SANS COMPTE,
-- par simple appel REST avec la clé anonyme. La plupart des policies concernées
-- portent une condition sur `auth.uid()`, nulle pour un anonyme, ce qui les rend
-- inoffensives ; celles dont la condition est `true` ne le sont pas.
--
-- ⚠️ RELECTURE OBLIGATOIRE et application en préproduction d'abord.
-- ⚠️ DÉPEND des migrations 067 (fonctions `app.*`) et 068.

-- ---------------------------------------------------------------
-- 1. depots_pieces — écriture non cloisonnée (le point le plus grave)
-- ---------------------------------------------------------------
-- La policy d'insertion vérifiait uniquement l'auteur :
--     with_check: (auteur_id = auth.uid()) OR (auteur_id IS NULL)
-- Aucune condition sur `tender_id`. Tout utilisateur authentifié pouvait donc
-- insérer une ligne de dépôt sur N'IMPORTE QUEL dossier, y compris celui d'une
-- entreprise concurrente, simplement en laissant `auteur_id` à NULL — la
-- branche NULL désactivant même la vérification d'identité.
--
-- On conserve la possibilité d'un auteur NULL (un dépôt peut émaner d'un invité
-- sans compte, dont l'identité est portée par `auteur_libelle`), mais on exige
-- désormais que le dossier visé soit un dossier dont on est membre.
DROP POLICY IF EXISTS "depots_pieces_insert" ON depots_pieces;

CREATE POLICY "depots_pieces_insert_membre"
  ON depots_pieces FOR INSERT TO authenticated
  WITH CHECK (
    app.est_membre(tender_id)
    AND (auteur_id = auth.uid() OR auteur_id IS NULL)
  );

-- ---------------------------------------------------------------
-- 2. comments — lecture ouverte aux invités non acceptés
-- ---------------------------------------------------------------
-- La condition joignait `groupements` sans filtrer le statut : une entreprise
-- seulement INVITÉE lisait les échanges du dossier. C'est le même défaut que
-- celui corrigé sur `reponses_ao` en migration 068 ; on l'aligne sur
-- `app.est_membre()`, qui exige le statut 'accepte'.
DROP POLICY IF EXISTS "Users can read comments on their tenders" ON comments;

CREATE POLICY "comments_select_membre"
  ON comments FOR SELECT TO authenticated
  USING (app.est_membre(tender_id));

-- L'écriture reste personnelle, mais on ajoute la condition d'appartenance :
-- rien ne vérifiait qu'on commente un dossier auquel on participe.
DROP POLICY IF EXISTS "Users can create comments" ON comments;

CREATE POLICY "comments_insert_membre"
  ON comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND app.est_membre(tender_id));

DROP POLICY IF EXISTS "Users can update own comments" ON comments;
CREATE POLICY "comments_update_auteur"
  ON comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own comments" ON comments;
CREATE POLICY "comments_delete_auteur"
  ON comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 3. chat_messages — alignement sur app.est_membre()
-- ---------------------------------------------------------------
-- La condition était déjà correcte (statut 'accepte' exigé), mais dupliquait la
-- logique en SQL inline et s'adressait à `public`. On la remplace par l'appel
-- de fonction, pour que toute évolution de la règle d'appartenance se fasse en
-- un seul endroit.
DROP POLICY IF EXISTS "Lecture chat_messages" ON chat_messages;
CREATE POLICY "chat_messages_select_membre"
  ON chat_messages FOR SELECT TO authenticated
  USING (app.est_membre(tender_id));

DROP POLICY IF EXISTS "Insertion chat_messages" ON chat_messages;
CREATE POLICY "chat_messages_insert_membre"
  ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (app.est_membre(tender_id));

-- ---------------------------------------------------------------
-- 4. plan_limits — policy redondante qui neutralise la restriction
-- ---------------------------------------------------------------
-- Deux policies de lecture coexistaient : `actif` et `true`. Combinées en OR,
-- la seconde l'emporte : les forfaits inactifs (offres retirées, tarifs en
-- préparation) étaient exposés, y compris aux anonymes.
DROP POLICY IF EXISTS "plan_limits_read_all" ON plan_limits;
-- « Lecture des forfaits » (qual: actif) est conservée telle quelle.

-- ---------------------------------------------------------------
-- 5. entreprises / avis_partenaires — lecture ouverte aux ANONYMES
-- ---------------------------------------------------------------
-- `qual: true` accordé à `public` : l'annuaire complet des entreprises (SIRET,
-- adresses) et l'ensemble des évaluations étaient lisibles sans compte, par
-- appel REST direct avec la clé anonyme.
--
-- La lecture reste large — l'annuaire est un usage légitime du produit — mais
-- elle est désormais réservée aux utilisateurs authentifiés.
--
-- ⚠️ VÉRIFIER EN PRÉPRODUCTION : les pages publiques (landing, invitation) ne
--    doivent pas lire ces tables directement. Vérification faite côté code —
--    `InvitationLanding` passe par des RPC — mais à reconfirmer après
--    toute évolution.
DROP POLICY IF EXISTS "Lecture entreprises" ON entreprises;
CREATE POLICY "entreprises_select_authentifie"
  ON entreprises FOR SELECT TO authenticated
  USING (true);

-- Devenue redondante : la policy ci-dessus couvre déjà ce périmètre.
DROP POLICY IF EXISTS "Users can view groupement companies" ON entreprises;

DROP POLICY IF EXISTS "Public read ratings" ON avis_partenaires;
CREATE POLICY "avis_partenaires_select_authentifie"
  ON avis_partenaires FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------
-- 6. company_* — condition toujours vraie, et ouverte aux anonymes
-- ---------------------------------------------------------------
-- La condition `entreprise_id IN (SELECT id FROM entreprises)` est vraie pour
-- toute entreprise existante : elle équivaut à `true`. Elle rendait par ailleurs
-- redondante la policy « Manage own company ... ».
--
-- On garde la lecture large (ces attributs alimentent l'annuaire et la
-- recherche de partenaires) mais on l'énonce clairement et on la réserve aux
-- utilisateurs authentifiés. L'écriture reste limitée à sa propre entreprise.
DROP POLICY IF EXISTS "View network company natures"        ON company_natures;
DROP POLICY IF EXISTS "View network company domains"        ON company_domains;
DROP POLICY IF EXISTS "View network company specialties"    ON company_specialties;
DROP POLICY IF EXISTS "View network company expertise tags" ON company_expertise_tags;
DROP POLICY IF EXISTS "View network company geo zones"      ON company_geo_zones;

CREATE POLICY "company_natures_select_authentifie"
  ON company_natures FOR SELECT TO authenticated USING (true);
CREATE POLICY "company_domains_select_authentifie"
  ON company_domains FOR SELECT TO authenticated USING (true);
CREATE POLICY "company_specialties_select_authentifie"
  ON company_specialties FOR SELECT TO authenticated USING (true);
CREATE POLICY "company_expertise_tags_select_authentifie"
  ON company_expertise_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "company_geo_zones_select_authentifie"
  ON company_geo_zones FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select tablename, policyname, cmd, roles, qual, with_check
--     from pg_policies
--    where schemaname = 'public'
--    order by tablename, cmd;
--
-- Attendu : plus aucune policy avec qual = 'true' accordée au rôle `public`,
-- hormis les tables de référentiel (ref_*, roles) assumées comme publiques.

-- ---------------------------------------------------------------
-- NON TRAITÉ — décision produit requise
-- ---------------------------------------------------------------
--   utilisateurs / "Authenticated users can read basic profiles" (qual: true)
--     Tout utilisateur authentifié lit TOUS les profils : nom, prénom, mais
--     aussi e-mail, téléphone et date de naissance. C'est le point le plus
--     sensible restant.
--
--     Il ne peut pas être corrigé par une simple restriction : l'annuaire,
--     l'affichage des membres d'un groupement et la messagerie s'appuient sur
--     cette lecture. Restreindre à `id = auth.uid()` casserait ces écrans.
--
--     La correction demande de séparer les colonnes publiques des colonnes
--     personnelles — typiquement une vue `utilisateurs_publics` exposant
--     (id, prenom, nom, photo_url, entreprise_id), la table restant limitée à
--     son propre profil. C'est un chantier applicatif : il faut repointer les
--     requêtes du front vers la vue. À planifier comme un lot dédié.
--
--   reponses_ao_specialties / "Manage reponses_ao skills" (cmd ALL, createur)
--     Restrictif et non fuyant, mais possiblement trop : un cotraitant accepté
--     ne peut pas lire les compétences attendues du dossier qu'il a rejoint.
--     À vérifier fonctionnellement — si les écrans en ont besoin, la lecture
--     devrait passer à app.est_membre() tandis que l'écriture resterait au
--     mandataire.
