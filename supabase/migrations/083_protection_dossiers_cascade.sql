-- =============================================
-- FILAO: Migration 083 — Protéger les dossiers de la suppression en cascade
-- =============================================
--
-- PROBLÈME
-- `reponses_ao_createur_id_fkey` est déclarée ON DELETE CASCADE
-- (`confdeltype = 'c'`). Supprimer un utilisateur DÉTRUIT donc tous les dossiers
-- qu'il a créés — et avec eux les groupements, les pièces déposées et les
-- échanges de ses cotraitants, qui n'ont rien demandé et ne sont jamais
-- prévenus.
--
-- Le risque n'est pas théorique : la policy « Self delete utilisateur » autorise
-- chacun à supprimer sa propre ligne directement via l'API. Un clic sur
-- « Supprimer mon compte » pouvait ainsi effacer le travail de plusieurs
-- entreprises, sans trace et sans erreur.
--
-- CORRECTIF
-- La contrainte passe en ON DELETE RESTRICT : la base refuse désormais de
-- supprimer un utilisateur qui porte des dossiers.
--
-- POURQUOI RESTRICT PLUTÔT QUE SET NULL
-- `SET NULL` laisserait les dossiers sans porteur : `app.est_mandataire()`
-- renverrait faux pour tout le monde, plus personne ne pourrait les modifier ni
-- les finaliser, et ils resteraient visibles sans être pilotables. Un refus
-- explicite vaut mieux qu'un dossier orphelin.
--
-- CONSÉQUENCE ASSUMÉE
-- La suppression de compte d'un porteur de dossiers échouera désormais côté
-- base. C'est voulu : `delete-account` ANONYMISE le profil au lieu de le
-- supprimer (voir la fonction), ce qui préserve l'intégrité des dossiers tout en
-- effaçant les données personnelles. Une erreur bruyante vaut mieux qu'une
-- destruction silencieuse.

ALTER TABLE reponses_ao
  DROP CONSTRAINT IF EXISTS reponses_ao_createur_id_fkey;

ALTER TABLE reponses_ao
  ADD CONSTRAINT reponses_ao_createur_id_fkey
  FOREIGN KEY (createur_id) REFERENCES utilisateurs(id)
  ON DELETE RESTRICT;

-- ---------------------------------------------------------------
-- Trace de l'anonymisation
-- ---------------------------------------------------------------
-- Permet de distinguer un compte anonymisé d'un compte actif — nécessaire pour
-- l'affichage (« Compte supprimé » au lieu d'un nom vide) et pour les purges
-- ultérieures, une fois les durées de conservation écoulées.
ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS compte_supprime_le TIMESTAMPTZ;

COMMENT ON COLUMN utilisateurs.compte_supprime_le IS
  'Horodatage de l''anonymisation. Non NULL = compte supprimé par son titulaire, ligne conservée pour l''intégrité des dossiers.';

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select conname, confdeltype from pg_constraint
--    where conrelid = 'reponses_ao'::regclass and conname like '%createur%';
--   -- attendu : confdeltype = 'r' (RESTRICT), plus 'c' (CASCADE)
--
-- Vérifier également les autres liens vers `utilisateurs`, susceptibles de
-- porter le même défaut :
--   select c.conname, c.confdeltype, c.conrelid::regclass AS table_source
--     from pg_constraint c
--    where c.confrelid = 'utilisateurs'::regclass
--      and c.confdeltype = 'c';
--   -- Chaque ligne renvoyée signale une table dont les données disparaissent
--   -- avec l'utilisateur. Légitime pour ses données personnelles
--   -- (connexions, chat_last_viewed), à questionner pour tout ce qui est
--   -- partagé avec d'autres entreprises.
