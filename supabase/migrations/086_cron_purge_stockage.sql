-- =============================================
-- FILAO: Migration 086 — Purge périodique du stockage orphelin
-- =============================================
--
-- CONTEXTE
-- Le coffre-fort d'une entreprise dont plus aucun compte ne porte les données
-- (migration 084) reste en place : ses pièces peuvent servir à des cotraitants,
-- et l'entreprise peut être reprise par clé (migration 085). Mais si personne ne
-- la reprend, ces fichiers occupent du stockage indéfiniment sans que quiconque
-- puisse y accéder.
--
-- Cette planification appelle `purge-stockage-orphelin` une fois par mois. La
-- fonction ne retire que le coffre-fort administratif des entreprises orphelines
-- depuis plus de douze mois — jamais les pièces de marché, partagées avec les
-- cotraitants et soumises à la prescription de dix ans.
--
-- ⚠️ REMPLACER avant exécution :
--      <SUPABASE_URL>     par l'URL du projet
--      (aucune clé de service à saisir : la fonction lit SUPABASE_SERVICE_ROLE_KEY
--       depuis ses propres variables d'environnement, injectées par Supabase)
--      <PURGE_SECRET>     par le secret configuré sur la fonction
--    Ne pas commiter ce fichier une fois les valeurs renseignées.
--
-- ⚠️ Exécuter d'abord en simulation (`dryRun`) pour vérifier le périmètre :
--      select net.http_post(
--        url     := '<SUPABASE_URL>/functions/v1/purge-stockage-orphelin',
--        headers := jsonb_build_object('Content-Type','application/json',
--                                      'x-purge-secret','<PURGE_SECRET>'),
--        body    := '{"dryRun": true}'::jsonb
--      );

-- Idempotence : retirer la planification précédente avant de la recréer.
SELECT cron.unschedule('purge-stockage-orphelin')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-stockage-orphelin');

SELECT cron.schedule(
  'purge-stockage-orphelin',
  -- Le 1er de chaque mois à 3 h : hors des heures d'usage, une purge pouvant
  -- porter sur de nombreux fichiers.
  '0 3 1 * *',
  $$
  SELECT net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/purge-stockage-orphelin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-secret', '<PURGE_SECRET>'
    ),
    body    := '{"dryRun": false}'::jsonb
  )
  $$
);

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select jobname, schedule, active from cron.job
--    where jobname = 'purge-stockage-orphelin';
--
--   -- Entreprises qui seront concernées au prochain passage :
--   select id, nom, sans_membre_depuis from entreprises
--    where sans_membre_depuis < now() - interval '12 months';
--
--   -- Historique des exécutions :
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'purge-stockage-orphelin')
--    order by start_time desc limit 5;
