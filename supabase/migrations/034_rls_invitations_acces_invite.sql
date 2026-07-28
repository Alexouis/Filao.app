-- =============================================
-- FILAO: Migration 034b — Suppression des policies permissives
-- =============================================
--
-- Partie 2/2. À jouer APRÈS 034a ET après le déploiement du front, qui doit
-- déjà passer par les fonctions RPC.
--
-- CONTEXTE
-- Trois policies laissaient passer n'importe quel appelant, `anon` compris (la
-- clé anonyme est embarquée dans le bundle JS, donc publique) :
--
--   invitations  "Lecture invitations par code"        USING (true)
--   invitations  "Public can update invitation status" USING (token IS NOT NULL)
--   reponses_ao  "Acces public lecture dossier ..."    EXISTS(SELECT 1 FROM invitations ...)
--
-- La troisième ne référence jamais auth.uid() : vraie pour tout AO ayant au
-- moins une invitation, elle neutralisait les trois autres policies de
-- reponses_ao — les policies SELECT se combinant en OU.
--
-- ⚠️ DROP POLICY exige un AccessExclusiveLock, incompatible avec les lectures
--    en cours. Un premier essai groupé a produit un deadlock avec les
--    connexions actives de l'application. D'où le découpage, le lock_timeout
--    et une instruction par transaction.
--
-- Si une instruction échoue sur « lock timeout », la rejouer : soit à un moment
-- creux, soit après avoir mis l'application en pause.

-- Échouer vite plutôt que de bloquer les requêtes applicatives derrière nous.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------
-- 6. Suppression des policies permissives
-- ---------------------------------------------------------------
-- À ne jouer qu'une fois les trois écrans passés en .rpc() : sans cela,
-- InvitationLanding et CollaboratorSubmission cessent de fonctionner.

DROP POLICY IF EXISTS "Lecture invitations par code" ON invitations;
DROP POLICY IF EXISTS "Public can update invitation status" ON invitations;
DROP POLICY IF EXISTS "Acces public lecture dossier via invitation" ON reponses_ao;

-- `OR (auth.uid() IS NOT NULL)` en fin de condition rendait tout le reste
-- décoratif : n'importe quel compte lisait toutes les lignes. Les policies
-- `*_select_v2`, qui couvrent les mêmes cas correctement, prennent le relais.
DROP POLICY IF EXISTS "Lecture invitations" ON invitations;
DROP POLICY IF EXISTS "Lecture groupements" ON groupements;

-- Reliquat : la table collaborateurs est supprimée par la migration 031, ses
-- policies n'ont plus d'objet.
DROP POLICY IF EXISTS "Users can insert collaborateur records" ON collaborateurs;
DROP POLICY IF EXISTS "Users can read own collaborateur records" ON collaborateurs;
DROP POLICY IF EXISTS "Users can update own collaborateur records" ON collaborateurs;