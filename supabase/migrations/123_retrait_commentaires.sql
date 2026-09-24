-- =============================================
-- FILAO: Migration 123 — Retrait de l'ancien fil de commentaires
-- =============================================
--
-- Le fil de commentaires par dossier (composant `CommentsView`) n'était plus
-- affiché nulle part : les échanges passent par la messagerie. Le code a été
-- retiré ; restaient en base la table, sa vue et la fonction « j'aime », encore
-- appelables par l'API. On les supprime.
--
-- ⚠️ IRRÉVERSIBLE : les commentaires enregistrés sont perdus. Pour les
-- conserver, les exporter AVANT (SQL Editor, puis « Download CSV ») :
--   select * from comments order by created_at;

DROP VIEW IF EXISTS comments_with_user;

-- Toutes les surcharges de la fonction, quelle que soit leur signature.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'toggle_comment_like' AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', f.signature);
  END LOOP;
END $$;

-- CASCADE : les policies, contraintes (dont celle de la 121) et index de la
-- table partent avec elle.
DROP TABLE IF EXISTS comments CASCADE;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select to_regclass('public.comments'), to_regclass('public.comments_with_user');  -- NULL, NULL
--   select count(*) from pg_proc where proname = 'toggle_comment_like';             -- 0
