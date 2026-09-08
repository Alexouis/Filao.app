-- ============================================================================
-- Planification des nouvelles fonctions
-- ============================================================================
-- À exécuter dans le SQL Editor de Supabase.
--
-- ⚠️ REMPLACER LES DEUX SECRETS avant exécution :
--   <SERVICE_ROLE_JWT>  le même jeton que les crons existants (emails-*)
--   <PURGE_SECRET>      celui du cron `purge-stockage-orphelin`
--
-- On les retrouve sur les tâches déjà en place :
--   select jobname, command from cron.job where jobname like 'emails-%';
--
-- Ces jetons sont des SECRETS : `cron.job` est lisible par quiconque a accès à
-- la base. C'est déjà le cas des tâches existantes — à revoir globalement un
-- jour, en passant par Vault, mais pas au coup par coup.
-- ============================================================================


-- ---------------------------------------------------------------
-- 1. Récapitulatif quotidien des messages non lus
-- ---------------------------------------------------------------
-- 16:05 UTC (18:05 à Paris) : APRÈS `emails-recap-depots` (16:00) et AVANT
-- `emails-consommation-soir` (16:10). Les deux récapitulatifs sont ainsi
-- enfilés puis expédiés dans la même vague — un destinataire concerné par les
-- deux reçoit ses e-mails ensemble, plutôt qu'à cinq minutes d'écart.
--
-- Rejouable : `cron.unschedule` d'abord, sinon un second `cron.schedule` du
-- même nom échoue.
SELECT cron.unschedule('emails-recap-messages')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'emails-recap-messages');

SELECT cron.schedule(
  'emails-recap-messages',
  '5 16 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://jgswgldqhrbismujkeue.supabase.co/functions/v1/recap-messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_JWT>'
    )
  )
  $$
);


-- ---------------------------------------------------------------
-- 2. Purge des pièces de dossier orphelines
-- ---------------------------------------------------------------
-- Mensuel, le 1er à 3h30 UTC — décalé d'une demi-heure par rapport à
-- `purge-stockage-orphelin` (3h00) pour que les deux purges ne se disputent
-- pas le stockage, et que leurs journaux restent lisibles séparément.
--
-- ⚠️ NE PAS PLANIFIER AVANT D'AVOIR LANCÉ UNE SIMULATION.
-- Le corps ci-dessous porte `"dryRun": false` : il SUPPRIME réellement.
-- Exécuter d'abord, à la main, la version `"dryRun": true` (bloc 3) et relire
-- la liste `detail` renvoyée.
SELECT cron.unschedule('purge-pieces-orphelines')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-pieces-orphelines');

SELECT cron.schedule(
  'purge-pieces-orphelines',
  '30 3 1 * *',
  $$
  SELECT net.http_post(
    url     := 'https://jgswgldqhrbismujkeue.supabase.co/functions/v1/purge-pieces-orphelines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- La passerelle des Edge Functions exige un `Authorization` valide dès
      -- lors que la vérification JWT est active sur la fonction (le réglage
      -- par défaut). Sans lui : 401 UNAUTHORIZED_NO_AUTH_HEADER, refusé AVANT
      -- d'atteindre le code — le `x-purge-secret` n'est même pas lu.
      --
      -- On garde les DEUX : le JWT ouvre la porte, le secret autorise l'action.
      -- `purge-stockage-orphelin` fonctionne sans, parce que sa vérification
      -- JWT a été désactivée dans le tableau de bord ; on ne reproduit pas ce
      -- réglage, deux barrières valent mieux qu'une.
      'Authorization', 'Bearer <SERVICE_ROLE_JWT>',
      'x-purge-secret', '<PURGE_SECRET>'
    ),
    body    := '{"dryRun": false}'::jsonb
  )
  $$
);


-- ---------------------------------------------------------------
-- 3. Simulation de purge — à lancer AVANT de planifier le bloc 2
-- ---------------------------------------------------------------
-- Ne supprime rien. La réponse contient `fichiersSupprimes`, `octetsLiberes`
-- et surtout `detail` : la liste exacte des fichiers candidats, avec leur
-- déposant et leur dossier. À relire avant de passer en réel.
--
-- La réponse arrive de façon asynchrone : voir le bloc 5 pour la lire.
SELECT net.http_post(
  url     := 'https://jgswgldqhrbismujkeue.supabase.co/functions/v1/purge-pieces-orphelines',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    -- Voir la note du bloc 2 : sans `Authorization`, la passerelle répond 401
    -- avant que la fonction ne soit appelée.
    'Authorization', 'Bearer <SERVICE_ROLE_JWT>',
    'x-purge-secret', '<PURGE_SECRET>'
  ),
  body    := '{"dryRun": true}'::jsonb
);


-- ---------------------------------------------------------------
-- 4. Contrôle
-- ---------------------------------------------------------------
SELECT jobid, jobname, schedule, active
  FROM cron.job
 ORDER BY jobname;

-- Exécutions des dernières 24 h : `status` doit valoir 'succeeded'.
SELECT j.jobname, d.status, d.start_time, left(coalesce(d.return_message,''), 120) AS message
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
 WHERE d.start_time > now() - interval '24 hours'
 ORDER BY d.start_time DESC;


-- ---------------------------------------------------------------
-- 5. Lire la réponse d'un appel `net.http_post`
-- ---------------------------------------------------------------
-- `net.http_post` rend la main immédiatement : le corps de la réponse arrive
-- dans cette table quelques secondes plus tard. C'est là qu'on lit le `detail`
-- de la simulation.
SELECT id, status_code, left(content, 4000) AS reponse, created
  FROM net._http_response
 ORDER BY created DESC
 LIMIT 5;