-- =============================================
-- FILAO: Migration 055 — Planification du rappel d'échéance (J-7)
-- =============================================
--
-- Planifie l'appel quotidien de la fonction `send-deadline-reminders`, sur le
-- même modèle que le cron des rappels de jalons (cf. commentaire de
-- send-milestone-reminders et migration 044 pour la purge quota).
--
-- ⚠️ À ADAPTER avant exécution :
--   • <SUPABASE_URL>       : l'URL du projet (https://<ref>.supabase.co)
--   • <SERVICE_ROLE_KEY>   : la clé service_role (idéalement lue depuis le Vault
--                            plutôt qu'en clair, cf. pratique du projet).
--
-- Exécution à 7 h (heure serveur) chaque jour. Idempotent : on retire d'abord
-- une éventuelle planification existante du même nom.

-- Nécessite les extensions pg_cron et pg_net (déjà utilisées par le projet).
SELECT cron.unschedule('rappels-echeance-j7')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rappels-echeance-j7');

SELECT cron.schedule(
  'rappels-echeance-j7',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/send-deadline-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    )
  )
  $$
);

-- Vérification :
--   select jobname, schedule from cron.job where jobname = 'rappels-echeance-j7';
--   -- Déclenchement manuel pour test :
--   -- select net.http_post(url := '<SUPABASE_URL>/functions/v1/send-deadline-reminders',
--   --   headers := jsonb_build_object('Authorization','Bearer <SERVICE_ROLE_KEY>'));