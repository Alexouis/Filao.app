-- =============================================
-- FILAO: Migration 063 — Suppression de la table `notifications` orpheline
-- =============================================
--
-- La table `notifications` (created_at, id, message, objet, sujet) n'est
-- utilisée NULLE PART dans le code : les notifications applicatives vivent dans
-- la colonne `utilisateurs.notifications` (jsonb). Aucune migration du dépôt ne
-- l'a créée — c'est un vestige créé hors migrations, probablement une approche
-- abandonnée. Vérifié : aucun `.from('notifications')` dans le code.
--
-- ⚠️ Suppression IRRÉVERSIBLE. Par prudence :
--   1. Vérifier que la table est vide (ou que son contenu est sans valeur) AVANT
--      de lancer le DROP. Requête de contrôle :
--        SELECT count(*) FROM notifications;
--   2. Si elle contient des lignes inattendues, faire une copie avant :
--        CREATE TABLE notifications_backup AS TABLE notifications;
--      puis décider en connaissance de cause.
--
-- Le DROP ci-dessous est volontairement commenté : à DÉ-commenter seulement
-- après avoir fait la vérification 1 ci-dessus. On ne supprime pas une table à
-- l'aveugle depuis une migration.

-- Étape de contrôle (ne supprime rien) : combien de lignes ?
DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    EXECUTE 'SELECT count(*) FROM notifications' INTO n;
    RAISE NOTICE 'Table notifications : % ligne(s). Vérifier avant de dé-commenter le DROP.', n;
  ELSE
    RAISE NOTICE 'Table notifications déjà absente : rien à faire.';
  END IF;
END $$;

-- ⬇️ DÉ-COMMENTER pour supprimer, une fois la vérification faite :
-- DROP TABLE IF EXISTS notifications;
