-- =============================================
-- FILAO: Migration 110 — Une seule source de rappels d'échéance
-- =============================================
--
-- Deux mécanismes émettaient les rappels « date limite proche » :
--   - `send-deadline-reminders` (Edge Function, tâche `rappels-echeance-j7`,
--     7 h) — versionnée ;
--   - `send_deadline_reminders()` (fonction SQL, tâche
--     `filao-deadline-reminders`, 8 h) — créée à la main, jamais versionnée.
--
-- Conséquences : rappel en double à J-7 ; préférence « Rappels » ignorée par
-- la seconde ; et surtout, la fonction SQL notifiait TOUS les comptes de
-- TOUTES les entreprises du groupement, y compris les collègues du porteur,
-- qui ne sont pas censés suivre le contenu du dossier (migration 092). Elle
-- calculait aussi les jours en UTC.
--
-- Ses seuils (J-7, J-3, J-1, J-0) sont repris dans l'Edge Function, qui
-- reconnaît les rappels déjà émis par l'ancienne fonction : la transition ne
-- produit pas de doublon.

SELECT cron.unschedule('filao-deadline-reminders')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filao-deadline-reminders');

DROP FUNCTION IF EXISTS public.send_deadline_reminders();

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select jobname from cron.job where jobname like '%deadline%' or jobname like '%echeance%';
--   -- attendu : rappels-echeance-j7 seulement
