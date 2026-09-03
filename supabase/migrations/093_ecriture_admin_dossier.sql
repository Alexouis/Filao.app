-- =============================================
-- FILAO: Migration 093 — Écriture du dossier : porteur ET administrateur
-- =============================================
--
-- PROBLÈME
-- La migration 092 a cloisonné les dossiers au sein de l'entreprise. Elle a
-- resserré `app.est_membre`, dont dépendait `depots_pieces_insert_membre`. Effet
-- de bord : l'administrateur de l'entreprise porteuse LIT les pièces déposées —
-- `dossiers_de_mon_entreprise()` (migration 061) le lui accorde depuis
-- longtemps — mais ne peut plus en DÉPOSER. Il voit tout et ne peut rien
-- ajouter.
--
-- Par ailleurs l'écriture du dossier restait au seul créateur
-- (`reponses_ao_update_mandataire`, migration 068). Un dossier dont le porteur
-- est absent, malade ou parti n'était donc plus modifiable par personne.
--
-- RÈGLE RETENUE
-- Écrivent sur un dossier : celui qui l'a créé, et l'administrateur de
-- l'entreprise qui le porte. Personne d'autre — un membre ordinaire continue de
-- ne voir que l'existence du dossier (092).
--
-- L'entreprise porteuse est lue sur `reponses_ao.entreprise_id`, la colonne
-- figée par la 092. C'est délibéré : passer par l'entreprise ACTUELLE du
-- créateur ferait disparaître le droit de l'administrateur au moment précis où
-- il en a besoin, c'est-à-dire quand le porteur a quitté l'entreprise.
--
-- CE QUI N'EST PAS OUVERT ICI
--   - La SUPPRESSION du dossier reste au créateur. Détruire n'est pas écrire, et
--     l'opération est irréversible.
--   - La composition du groupement (inviter, retirer un cotraitant) reste au
--     mandataire : elle engage des tiers.
--   - Les échanges (`comments`, `chat_messages`) restent fermés à
--     l'administrateur, conformément à la 092.
--   Ces trois points sont des décisions, pas des oublis : à rouvrir si vous
--   tranchez autrement.
--
-- ⚠️ DÉPEND des migrations 061, 068, 069 et 092.

-- ---------------------------------------------------------------
-- 1. Qui peut écrire sur un dossier
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.peut_ecrire_dossier(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.reponses_ao r
     WHERE r.id = p_ao
       AND (
         -- Le porteur, quel que soit son rôle dans l'entreprise.
         r.createur_id = auth.uid()
         OR (
           -- L'administrateur de l'entreprise QUI PORTE le dossier.
           -- `entreprise_id IS NOT NULL` est nécessaire : sans lui, un dossier
           -- ancien dont la reprise 092 a échoué serait ouvert à tout
           -- administrateur dont l'entreprise est elle aussi NULL.
           r.entreprise_id IS NOT NULL
           AND r.entreprise_id = app.entreprise_courante()
           AND public.est_admin_entreprise()
         )
       )
  );
$$;

COMMENT ON FUNCTION app.peut_ecrire_dossier(UUID) IS
  'Vrai pour le créateur du dossier et pour l''administrateur de l''entreprise porteuse. N''ouvre ni la suppression, ni le groupement, ni les échanges.';

GRANT EXECUTE ON FUNCTION app.peut_ecrire_dossier(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION app.peut_ecrire_dossier(UUID) FROM anon, public;

-- ---------------------------------------------------------------
-- 2. Modification du dossier
-- ---------------------------------------------------------------
-- `NOT verrouille_par_quota` est CONSERVÉ des deux côtés : un dépassement de
-- forfait gèle les dossiers (migration 050), et cette règle ne doit pas sauter
-- au passage. L'administrateur n'est pas au-dessus du quota — il est même le
-- seul à pouvoir le relever, en changeant de forfait.
DROP POLICY IF EXISTS "reponses_ao_update_mandataire" ON reponses_ao;
DROP POLICY IF EXISTS "reponses_ao_update_porteur_ou_admin" ON reponses_ao;
CREATE POLICY "reponses_ao_update_porteur_ou_admin"
  ON reponses_ao FOR UPDATE TO authenticated
  USING      (app.peut_ecrire_dossier(id) AND NOT verrouille_par_quota)
  WITH CHECK (app.peut_ecrire_dossier(id) AND NOT verrouille_par_quota);

-- Rappel : le trigger `trg_fixer_entreprise_dossier` (092) rend
-- `reponses_ao.entreprise_id` immuable. Un administrateur ne peut donc pas
-- déplacer un dossier vers une autre entreprise par un UPDATE, ni s'en attribuer
-- un en modifiant cette colonne.

-- ---------------------------------------------------------------
-- 3. Dépôt de pièces
-- ---------------------------------------------------------------
-- On ajoute l'administrateur SANS retirer les membres du groupement : un
-- cotraitant doit continuer à déposer ses propres attestations, c'est l'objet
-- même de la table.
DROP POLICY IF EXISTS "depots_pieces_insert_membre" ON depots_pieces;
DROP POLICY IF EXISTS "depots_pieces_insert_membre_ou_admin" ON depots_pieces;
CREATE POLICY "depots_pieces_insert_membre_ou_admin"
  ON depots_pieces FOR INSERT TO authenticated
  WITH CHECK (
    (app.est_membre(tender_id) OR app.peut_ecrire_dossier(tender_id))
    AND (auteur_id = auth.uid() OR auteur_id IS NULL)
  );

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Avec un ADMINISTRATEUR de l'entreprise porteuse, non créateur du dossier :
--   update reponses_ao set titre = 'X' where id = '<dossier d''un collègue>';  -- 1
--   insert into depots_pieces (tender_id, auteur_id) values ('<dossier>', auth.uid());  -- ok
--   delete from reponses_ao where id = '<dossier>';   -- 0 : réservé au créateur
--   select count(*) from chat_messages where tender_id = '<dossier>';  -- 0 : fermé
--
-- Avec un MEMBRE ordinaire de la même entreprise :
--   update reponses_ao set titre = 'X' where id = '<dossier d''un collègue>';  -- 0
--
-- Avec un administrateur d'une AUTRE entreprise : 0 partout.
--
-- Quota : sur un dossier `verrouille_par_quota`, l'UPDATE doit échouer même pour
-- l'administrateur.
