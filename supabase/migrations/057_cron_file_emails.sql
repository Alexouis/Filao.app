-- =============================================
-- FILAO: Migration 057 — Ordonnancement de la file emails (Lot 2)
-- =============================================
--
-- Planifie les deux étapes quotidiennes de la file d'emails :
--   • 07h00 Europe/Paris — `calculer-emails` remplit la file.
--   • 07h05 Europe/Paris — `consommer-emails` vide la file (envoi + journal).
--
-- Le décalage de 5 min laisse le calcul se terminer avant la consommation.
-- La consommation peut aussi être rappelée plus tard dans la journée si la file
-- est volumineuse (elle traite par lots bornés).
--
-- ⚠️ Les heures cron sont en UTC. 07h00 Europe/Paris = 05h00 UTC en été (CEST),
--    06h00 UTC en hiver (CET). pg_cron ne gère pas les fuseaux : on planifie en
--    UTC pour l'HIVER (06h05/06h10 UTC) OU on ajuste selon la saison. Ici on
--    prend l'heure d'été (05h00 UTC) — À AJUSTER si besoin d'exactitude toute
--    l'année, ou déclencher les fonctions elles-mêmes qui vérifient l'heure de
--    Paris. Alternative robuste : cron toutes les heures + garde interne.
--
-- ⚠️ Remplacer <SUPABASE_URL> et <SERVICE_ROLE_KEY> avant exécution.

-- Nettoyage idempotent d'éventuelles planifications existantes.
SELECT cron.unschedule('emails-calcul-quotidien')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-calcul-quotidien');
SELECT cron.unschedule('emails-consommation-quotidienne')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-consommation-quotidienne');

-- 07h00 Europe/Paris (heure d'été = 05h00 UTC) — calcul.
SELECT cron.schedule(
  'emails-calcul-quotidien',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/calculer-emails',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>')
  )
  $$
);

-- 07h05 Europe/Paris — consommation.
SELECT cron.schedule(
  'emails-consommation-quotidienne',
  '5 5 * * *',
  $$
  SELECT net.http_post(
    url     := '<SUPABASE_URL>/functions/v1/consommer-emails',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <SERVICE_ROLE_KEY>')
  )
  $$
);

-- Vérification :
--   select jobname, schedule from cron.job where jobname like 'emails-%';
