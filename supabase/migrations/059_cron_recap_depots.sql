-- =============================================
-- FILAO: Migration 059 — Cron du récapitulatif de dépôts (18h)
-- =============================================
--
-- Planifie `recap-depots` à 18h00 Europe/Paris : agrège les dépôts du jour et
-- enfile un email récapitulatif par destinataire. L'envoi effectif est fait par
-- `consommer-emails` (déjà planifié) au run suivant, ou par un appel dédié.
--
-- ⚠️ Heure en UTC (pg_cron ne gère pas les fuseaux). 18h Paris = 16h UTC (été) /
--    17h UTC (hiver). Réglé ici sur l'heure d'été (16h UTC) — à ajuster comme
--    les autres crons emails (cf. migration 057).
--
-- ⚠️ Comme `recap-depots` enfile mais n'envoie pas, prévoir que
--    `consommer-emails` tourne APRÈS 18h pour que le récap parte le jour même.
--    Ajout ici d'une consommation à 18h10.
--
-- ⚠️ Remplacer <SUPABASE_URL> et <SERVICE_ROLE_KEY> avant exécution.

SELECT cron.unschedule('emails-recap-depots')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-recap-depots');
SELECT cron.unschedule('emails-consommation-soir')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-consommation-soir');

-- 18h00 Paris (heure d'été = 16h UTC) — calcul du récap.
SELECT cron.schedule(
  'emails-recap-depots',
  '0 16 * * *',
  $$
  SELECT net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/recap-depots',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>')
  )
  $$
);

-- 18h10 Paris — consommation, pour que le récap parte le soir même.
SELECT cron.schedule(
  'emails-consommation-soir',
  '10 16 * * *',
  $$
  SELECT net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/consommer-emails',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>')
  )
  $$
);

-- Vérification :
--   select jobname, schedule from cron.job where jobname like 'emails-%';
