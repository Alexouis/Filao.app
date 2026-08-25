-- =============================================
-- FILAO: Migration 074 — Correctif : accès de l'invité en attente
-- =============================================
--
-- RÉGRESSION CORRIGÉE
-- La migration 068 a remplacé les policies de lecture de `reponses_ao` et
-- `groupements` par un appel à `app.est_membre()`, qui exige le statut
-- « accepte ». Conséquence non anticipée : une entreprise INVITÉE (statut
-- « invite ») ne pouvait plus lire ni le dossier ni sa propre ligne de
-- groupement. Le dossier disparaissait de sa liste, et l'ouvrir depuis la
-- notification affichait un écran vide.
--
-- ERREUR DE RAISONNEMENT À L'ORIGINE
-- J'avais posé que « le statut invite n'ouvre aucun accès », en pensant protéger
-- les montants d'un prospect. Mais le parcours produit exige l'inverse : un
-- invité doit voir le dossier POUR POUVOIR DÉCIDER de l'accepter. Le bandeau
-- « Invitation à collaborer » et la liste des invitations en attente lisent tous
-- deux ces lignes.
--
-- DISTINCTION RETENUE
--   app.est_convie(ao)  — invité OU accepté : peut VOIR le dossier et l'équipe,
--                          c'est le préalable à toute décision.
--   app.est_membre(ao)  — accepté uniquement : participe réellement, donc accède
--                          aux échanges, dépose des pièces, etc.
--
-- Les échanges (commentaires, messagerie) et les dépôts restent réservés aux
-- membres : un invité qui n'a pas répondu ne lit pas les discussions. Cette
-- partie de la migration 069 n'est PAS modifiée.
--
-- ⚠️ DÉPEND des migrations 067, 068 et 069.

-- ---------------------------------------------------------------
-- 1. Nouvelle fonction : périmètre « convié »
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.est_convie(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao AND r.createur_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.groupements g
     WHERE g.projet_id = p_ao
       AND g.entreprise_id = app.entreprise_courante()
       -- « refuse » est volontairement exclu : une invitation déclinée ne
       -- redonne pas accès au dossier.
       AND g.statut IN ('accepte', 'invite')
  );
$$;

COMMENT ON FUNCTION app.est_convie(UUID) IS
  'Vrai si l''utilisateur porte le dossier, y participe, ou y est invité et n''a pas encore répondu. Conditionne la LECTURE du dossier et de l''équipe.';

GRANT EXECUTE ON FUNCTION app.est_convie(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION app.est_convie(UUID) FROM anon, public;

-- ---------------------------------------------------------------
-- 2. Lecture du dossier et de l'équipe : périmètre « convié »
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "reponses_ao_select_membre" ON reponses_ao;
CREATE POLICY "reponses_ao_select_convie"
  ON reponses_ao FOR SELECT TO authenticated
  USING (app.est_convie(id));

DROP POLICY IF EXISTS "groupements_select_membre" ON groupements;
CREATE POLICY "groupements_select_convie"
  ON groupements FOR SELECT TO authenticated
  USING (app.est_convie(projet_id));

-- ---------------------------------------------------------------
-- 3. Compétences attendues : périmètre « convié » également
-- ---------------------------------------------------------------
-- Un invité doit pouvoir constater ce qu'on attend de lui avant d'accepter.
DROP POLICY IF EXISTS "reponses_ao_specialties_select_membre" ON reponses_ao_specialties;
CREATE POLICY "reponses_ao_specialties_select_convie"
  ON reponses_ao_specialties FOR SELECT TO authenticated
  USING (app.est_convie(reponse_ao_id));

-- ---------------------------------------------------------------
-- INCHANGÉ — réservé aux membres ayant accepté
-- ---------------------------------------------------------------
--   comments_select_membre / comments_insert_membre
--   chat_messages_select_membre / chat_messages_insert_membre
--   depots_pieces_insert_membre
--   toutes les policies d'écriture (…_mandataire)
--
-- Un invité voit le dossier et l'équipe, mais ne lit pas les échanges et ne
-- dépose rien tant qu'il n'a pas accepté.

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Avec un compte INVITÉ (groupements.statut = 'invite') :
--   select id, titre from reponses_ao where id = '<le dossier>';
--   -- attendu : 1 ligne (le dossier est visible)
--
--   select count(*) from groupements where projet_id = '<le dossier>';
--   -- attendu : l'équipe est visible
--
--   select count(*) from chat_messages where tender_id = '<le dossier>';
--   -- attendu : 0 (les échanges restent fermés avant acceptation)
--
-- Avec un compte SANS AUCUN LIEN au dossier :
--   select id from reponses_ao where id = '<le dossier>';
--   -- attendu : 0 ligne
