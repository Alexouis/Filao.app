-- ============================================================================
-- DIAGNOSTIC — Pourquoi les e-mails de notification ne partent pas
-- ============================================================================
-- À exécuter dans le SQL Editor de Supabase, dans l'ordre.
-- Chaque bloc répond à UNE question ; le commentaire indique comment lire le
-- résultat, pour qu'un résultat vide ne soit pas ambigu.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- 1. Les tâches planifiées existent-elles ?
-- ─────────────────────────────────────────────────────────────────────────
-- C'est l'hypothèse principale : la file se remplit mais personne ne la vide.
--
-- LECTURE : on doit voir au moins `consommer-emails`. Idéalement aussi
-- `calculer-emails` et `recap-depots`. Un résultat VIDE = aucun cron planifié,
-- donc aucun e-mail de la file ne partira jamais.
-- (Si l'extension pg_cron n'est pas activée, la requête échoue : c'est déjà
-- une réponse — la planification se fait alors ailleurs, via Supabase
-- Scheduled Functions, à vérifier dans le tableau de bord.)

SELECT jobid,
       jobname,
       schedule,
       active,
       command
  FROM cron.job
 ORDER BY jobname;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. Ces tâches s'exécutent-elles réellement, et réussissent-elles ?
-- ─────────────────────────────────────────────────────────────────────────
-- Une tâche peut être planifiée mais échouer à chaque passage.
--
-- LECTURE : `status` doit être 'succeeded'. Des 'failed' répétés pointent un
-- problème d'appel (URL, clé, permissions) et `return_message` en donne la
-- raison. Un résultat vide = la tâche n'a jamais tourné.

SELECT j.jobname,
       d.status,
       d.start_time,
       d.end_time,
       left(coalesce(d.return_message, ''), 200) AS message
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
 WHERE d.start_time > now() - interval '7 days'
 ORDER BY d.start_time DESC
 LIMIT 50;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. La file contient-elle des e-mails en attente ?
-- ─────────────────────────────────────────────────────────────────────────
-- C'est le test décisif : il sépare un problème de PRODUCTION d'un problème
-- de CONSOMMATION.
--
-- LECTURE :
--   - des lignes 'en_attente' qui s'accumulent → les producteurs marchent,
--     c'est `consommer-emails` qui ne tourne pas (ou échoue) ;
--   - AUCUNE ligne du tout → ce sont les producteurs qui ne tournent pas
--     (`calculer-emails`, `recap-depots`), ou rien n'était à envoyer ;
--   - des 'echoue' → l'envoi Brevo est refusé, voir la colonne erreur au 4.

SELECT statut,
       type_email,
       count(*)          AS nombre,
       min(created_at)   AS plus_ancien,
       max(created_at)   AS plus_recent
  FROM emails_a_envoyer
 GROUP BY statut, type_email
 ORDER BY statut, nombre DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. Détail des échecs, s'il y en a
-- ─────────────────────────────────────────────────────────────────────────
-- LECTURE : `derniere_erreur` donne le motif exact du refus (clé Brevo
-- absente, expéditeur non validé, quota dépassé, adresse invalide…).
-- `tentatives` élevé sans succès = échec systématique, pas un incident isolé.

SELECT id,
       type_email,
       destinataire,
       statut,
       tentatives,
       left(coalesce(derniere_erreur, ''), 300) AS erreur,
       created_at,
       updated_at
  FROM emails_a_envoyer
 WHERE statut IN ('echoue', 'en_cours')
    OR tentatives > 0
 ORDER BY updated_at DESC
 LIMIT 30;


-- ─────────────────────────────────────────────────────────────────────────
-- 5. Un e-mail est-il déjà parti, un jour ?
-- ─────────────────────────────────────────────────────────────────────────
-- Le journal tranche entre « ça n'a jamais fonctionné » et « ça a cessé de
-- fonctionner », ce qui n'appelle pas le même correctif.
--
-- LECTURE : les types d'invitation (envoyés en direct par `send-invitation`)
-- devraient apparaître. Si SEULS ceux-là apparaissent, cela confirme que la
-- file n'a jamais rien livré.

SELECT type_email,
       statut,
       count(*)         AS nombre,
       max(horodatage)  AS dernier_envoi
  FROM emails_envoyes
 GROUP BY type_email, statut
 ORDER BY dernier_envoi DESC NULLS LAST;


-- ─────────────────────────────────────────────────────────────────────────
-- 6. Les destinataires ont-ils seulement autorisé les e-mails ?
-- ─────────────────────────────────────────────────────────────────────────
-- `consommer-emails` applique les préférences avant d'envoyer. Si personne
-- n'a activé l'e-mail pour une famille, la file peut se vider en « annulé »
-- sans qu'aucun message ne parte — et ce serait le comportement ATTENDU.
--
-- LECTURE : compte des utilisateurs ayant l'e-mail activé, par famille.
-- Des zéros partout expliqueraient l'absence d'e-mails sans aucun bug.

SELECT count(*) FILTER (WHERE notification_preferences->'nouveau_document'->>'email' = 'true') AS doc_email_actif,
       count(*) FILTER (WHERE notification_preferences->'rappels'->>'email'          = 'true') AS rappels_email_actif,
       count(*) FILTER (WHERE notification_preferences->'messages_feed'->>'email'    = 'true') AS messages_email_actif,
       count(*) FILTER (WHERE notification_preferences->'communications'->>'email'   = 'true') AS communications_email_actif,
       count(*)                                                                                AS total_utilisateurs
  FROM utilisateurs;


-- ─────────────────────────────────────────────────────────────────────────
-- 7. Y a-t-il seulement de la matière à envoyer ?
-- ─────────────────────────────────────────────────────────────────────────
-- `recap-depots` n'enfile que s'il y a eu des dépôts DANS LA JOURNÉE. En
-- préproduction peu active, une file vide peut être parfaitement normale.
--
-- LECTURE : s'il n'y a eu aucun dépôt hier, l'absence de récapitulatif n'est
-- pas un bug. Refaire un dépôt, puis relancer la requête 3.

SELECT date_trunc('day', created_at) AS jour,
       count(*)                      AS depots
  FROM depots_pieces
 WHERE created_at > now() - interval '7 days'
 GROUP BY 1
 ORDER BY 1 DESC;
