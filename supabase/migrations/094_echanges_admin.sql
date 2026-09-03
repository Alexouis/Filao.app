-- =============================================
-- FILAO: Migration 094 — Les échanges d'un dossier, ouverts à l'administrateur
-- =============================================
--
-- RÈGLE RETENUE
-- L'administrateur de l'entreprise porteuse lit les échanges de ses dossiers :
-- commentaires, messagerie, et composition du groupement. Un membre ordinaire
-- de la même entreprise — la secrétaire qui suit le pipeline — continue de ne
-- voir que l'existence du dossier (migration 092).
--
-- La 093 lui avait donné l'écriture du dossier sans la lecture des échanges : il
-- modifiait un dossier sans voir la négociation qui l'avait produit. C'est cette
-- incohérence qu'on lève.
--
-- Le périmètre est exactement celui de `app.peut_ecrire_dossier` (093) : qui
-- écrit le dossier en lit les échanges. Une seule notion à tenir, et le jour où
-- vous changerez la règle d'écriture, la lecture suivra sans divergence.
--
-- LE GROUPEMENT EST INCLUS — INFÉRENCE DE MA PART
-- Vous avez demandé « les échanges ». J'y ajoute la composition du groupement,
-- car sans elle l'administrateur lirait des messages émanant d'entreprises
-- qu'il ne peut pas identifier. Si vous préférez l'en exclure, supprimez la
-- section 3 : le reste tient sans elle.
--
-- CE QUI RESTE FERMÉ
-- L'ÉCRITURE des échanges. L'administrateur lit la messagerie, il n'y écrit pas.
-- Prendre la parole face à un cotraitant sous l'identité de l'entreprise
-- mandataire est un acte de négociation, pas de supervision — et personne ne l'a
-- demandé. À rouvrir si l'usage le réclame, en ajoutant `peut_ecrire_dossier`
-- aux policies INSERT de `comments` et `chat_messages`.
--
-- ⚠️ DÉPEND des migrations 069, 074, 092 et 093.

-- ---------------------------------------------------------------
-- 1. Commentaires
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "comments_select_membre" ON comments;
DROP POLICY IF EXISTS "comments_select_membre_ou_admin" ON comments;
CREATE POLICY "comments_select_membre_ou_admin"
  ON comments FOR SELECT TO authenticated
  USING (app.est_membre(tender_id) OR app.peut_ecrire_dossier(tender_id));

-- ---------------------------------------------------------------
-- 2. Messagerie
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "chat_messages_select_membre" ON chat_messages;
DROP POLICY IF EXISTS "chat_messages_select_membre_ou_admin" ON chat_messages;
CREATE POLICY "chat_messages_select_membre_ou_admin"
  ON chat_messages FOR SELECT TO authenticated
  USING (app.est_membre(tender_id) OR app.peut_ecrire_dossier(tender_id));

-- ---------------------------------------------------------------
-- 3. Composition du groupement  (voir « INFÉRENCE DE MA PART » ci-dessus)
-- ---------------------------------------------------------------
-- `est_convie` est conservé : un invité qui n'a pas encore répondu doit voir
-- avec qui on lui propose de candidater (migration 074).
DROP POLICY IF EXISTS "groupements_select_convie" ON groupements;
DROP POLICY IF EXISTS "groupements_select_convie_ou_admin" ON groupements;
CREATE POLICY "groupements_select_convie_ou_admin"
  ON groupements FOR SELECT TO authenticated
  USING (app.est_convie(projet_id) OR app.peut_ecrire_dossier(projet_id));

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- ADMINISTRATEUR de l'entreprise porteuse, non créateur :
--   select count(*) from chat_messages where tender_id = '<dossier collègue>';  -- >0
--   select count(*) from comments      where tender_id = '<dossier collègue>';  -- >0
--   select count(*) from groupements   where projet_id = '<dossier collègue>';  -- >0
--   insert into chat_messages (tender_id, ...) values ('<dossier>', ...);       -- refusé
--
-- MEMBRE ordinaire de la même entreprise (la secrétaire) : 0 partout, seul le
-- dossier lui-même reste visible.
--
-- Administrateur d'une AUTRE entreprise, non conviée : 0 partout.
