-- =============================================
-- FILAO: Migration 075 — Correctif : lecture des profils des collaborateurs
-- =============================================
--
-- RÉGRESSION CORRIGÉE
-- La migration 070 a restreint `utilisateurs` à `id = auth.uid()`, en reportant
-- la lecture des profils d'autrui sur la vue `utilisateurs_publics`.
--
-- Le recensement qui a précédé cette décision était incomplet : j'avais compté
-- les appels directs (`from('utilisateurs')`) et repointé les deux qui lisaient
-- d'autres profils, mais j'ai omis les JOINTURES IMBRIQUÉES, qui sont en réalité
-- le principal canal de lecture des profils dans l'application :
--
--     from('groupements').select('entreprise:entreprises(membres:utilisateurs(...))')
--
-- Neuf requêtes de ce type existent (écran Équipe, Mes AO, Tableau de bord,
-- messagerie, commentaires). Toutes renvoient désormais un tableau vide pour les
-- entreprises autres que la sienne. Conséquences observées :
--   - l'écran Équipe affiche « () » à la place du nom et de l'e-mail des autres
--     membres ;
--   - la déduplication entre invitations et groupements, qui repose sur
--     l'e-mail, ne fonctionne plus : un membre accepté apparaît en double.
--
-- POURQUOI LA VUE NE PEUT PAS RÉSOUDRE CE CAS
-- Une vue ne porte pas de contrainte de clé étrangère : PostgREST ne peut donc
-- pas l'utiliser comme ressource imbriquée. Repointer ces neuf requêtes
-- supposerait de charger les membres séparément et de les fusionner côté client
-- — un chantier applicatif à part entière, pas un correctif.
--
-- APPROCHE RETENUE
-- Le RLS filtre des LIGNES, pas des colonnes. Plutôt que de restreindre les
-- colonnes par une vue, on restreint les lignes visibles : chacun lit son propre
-- profil, celui de ses collègues, et celui des personnes avec qui il partage un
-- dossier. Les jointures imbriquées fonctionnent alors normalement.
--
-- CE QU'ON GAGNE PAR RAPPORT À L'ÉTAT INITIAL
-- Avant la migration 070, la policy portait `true` : tout utilisateur
-- authentifié lisait l'intégralité de l'annuaire des inscrits. Désormais il ne
-- voit que les personnes avec lesquelles il a un lien réel. Un concurrent
-- inconnu n'est plus lisible.
--
-- CE QU'ON N'OBTIENT PAS ENCORE
-- Les collaborateurs voient toutes les colonnes du profil, téléphone et date de
-- naissance compris. La restriction PAR COLONNE reste souhaitable, mais elle
-- suppose de migrer les neuf requêtes vers la vue. À planifier comme un lot
-- dédié — la note en fin de fichier détaille le chemin.
--
-- ⚠️ DÉPEND des migrations 067 et 070.

-- ---------------------------------------------------------------
-- 1. Élargir le partage au périmètre « convié »
-- ---------------------------------------------------------------
-- Un mandataire doit voir le profil d'un partenaire qu'il vient d'inviter, avant
-- même que celui-ci ait accepté : sans cela, l'écran Équipe afficherait une
-- ligne anonyme. On aligne donc `partage_dossier` sur `app.est_convie` : les
-- statuts « accepte » ET « invite » créent le lien, « refuse » non.
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
  miens AS (
    SELECT r.id FROM public.reponses_ao r WHERE r.createur_id = auth.uid()
    UNION
    SELECT g.projet_id FROM public.groupements g
     WHERE g.entreprise_id = app.entreprise_courante()
       AND g.statut IN ('accepte', 'invite')
  )
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id IN (SELECT id FROM miens) AND r.createur_id = p_utilisateur
    UNION ALL
    SELECT 1 FROM public.groupements g
     WHERE g.projet_id IN (SELECT id FROM miens)
       AND g.entreprise_id = (SELECT entreprise_id FROM cible)
       AND g.statut IN ('accepte', 'invite')
  );
$$;

-- ---------------------------------------------------------------
-- 2. Lecture des profils : soi, ses collègues, ses partenaires
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "utilisateurs_select_soi" ON utilisateurs;

CREATE POLICY "utilisateurs_select_lie"
  ON utilisateurs FOR SELECT TO authenticated
  USING (
    -- Son propre profil.
    id = auth.uid()
    -- Ses collègues : même entreprise. La condition sur NULL évite qu'un
    -- utilisateur sans entreprise voie tous les autres comptes orphelins.
    OR (
      entreprise_id IS NOT NULL
      AND entreprise_id = app.entreprise_courante()
    )
    -- Les personnes avec qui un dossier est partagé.
    OR app.partage_dossier(id)
  );

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- En tant que MANDATAIRE d'un dossier avec un cotraitant :
--   select count(*) from utilisateurs;
--   -- attendu : soi + collègues + partenaires, PAS tous les inscrits
--
--   -- l'écran Équipe doit afficher le nom et l'e-mail de chaque membre,
--   -- et chaque membre ne doit apparaître qu'une fois.
--
-- En tant qu'utilisateur SANS LIEN avec une personne :
--   select * from utilisateurs where id = '<un inconnu>';
--   -- attendu : 0 ligne

-- ---------------------------------------------------------------
-- SUITE À PLANIFIER — restriction par colonne
-- ---------------------------------------------------------------
-- Pour que les collaborateurs ne voient plus téléphone et date de naissance, il
-- faudra migrer les lectures de profils d'autrui vers `utilisateurs_publics`.
-- Comme une vue ne peut pas être une ressource imbriquée PostgREST, chacune des
-- requêtes concernées doit charger les membres séparément :
--
--     const { data: membres } = await supabase
--       .from('utilisateurs_publics')
--       .select('id, email, nom, prenom, photo_url, entreprise_id')
--       .in('entreprise_id', companyIds);
--
-- puis fusionner côté client. Sites concernés : TenderWizard (équipe),
-- Tenders (2 requêtes), Dashboard, CommentsView, ChatWindow (3), ChatCenter.
-- Une fois ces requêtes migrées, la policy ci-dessus pourra être resserrée à
-- `id = auth.uid()`.
