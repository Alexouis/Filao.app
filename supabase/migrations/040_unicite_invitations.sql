-- =============================================
-- FILAO: Migration 040 — Unicité (tender_id, email) sur invitations
-- =============================================
--
-- SYMPTÔME
--   Error upserting invitation: 42P10
--   « there is no unique or exclusion constraint matching the ON CONFLICT
--     specification »
--
-- CAUSE
-- `send-invitation` écrit ainsi :
--
--   .upsert({ … }, { onConflict: 'tender_id, email' })
--
-- PostgreSQL exige, pour une clause ON CONFLICT, une contrainte d'unicité
-- portant exactement sur les colonnes citées. Elle n'existe pas : l'invitation
-- ne peut donc jamais être enregistrée, et le parcours échoue entièrement.
--
-- Au-delà de l'erreur, cette contrainte manquait sur le fond : rien
-- n'empêchait deux invitations concurrentes pour la même personne sur le même
-- appel d'offres, chacune avec son propre jeton et son propre code d'accès.

-- ---------------------------------------------------------------
-- 1. Dédoublonnage préalable
-- ---------------------------------------------------------------
-- La création de l'index échouerait sur des doublons existants. On conserve la
-- ligne la plus pertinente : une réponse déjà donnée prime sur une invitation
-- en attente, et à statut égal, la plus récente.

WITH classees AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tender_id, email
           ORDER BY
             CASE status WHEN 'accepted' THEN 0 WHEN 'refused' THEN 1 ELSE 2 END,
             created_at DESC
         ) AS rang
    FROM invitations
)
DELETE FROM invitations
 WHERE id IN (SELECT id FROM classees WHERE rang > 1);

-- ---------------------------------------------------------------
-- 2. Contrainte d'unicité
-- ---------------------------------------------------------------
-- Index sur les colonnes brutes, sans `lower(email)` : la clause ON CONFLICT
-- doit correspondre exactement aux colonnes indexées, et le code cite
-- `tender_id, email`. La normalisation de casse relève donc de l'application :
-- `send-invitation` écrivait l'e-mail tel que saisi, elle le passe désormais en
-- minuscules avant écriture.

CREATE UNIQUE INDEX IF NOT EXISTS invitations_tender_email_unique
    ON invitations (tender_id, email);

COMMENT ON INDEX invitations_tender_email_unique IS
  'Requis par le ON CONFLICT de send-invitation, et garantit une seule invitation par personne et par appel d''offres.';

-- ---------------------------------------------------------------
-- 3. Vérification
-- ---------------------------------------------------------------
--   select indexname from pg_indexes
--    where tablename = 'invitations' and indexname = 'invitations_tender_email_unique';
--
-- Doublons restants (doit être vide) :
--   select tender_id, email, count(*) from invitations
--    group by 1, 2 having count(*) > 1;
--
-- ⚠️ L'unicité porte sur l'e-mail exact. « Alex@x.fr » et « alex@x.fr »
--    resteraient deux lignes distinctes. Le sujet dépasse cette migration :
--    c'est la normalisation des e-mails en base, déjà identifiée à propos des
--    comparaisons `.eq` sensibles à la casse dans les edge functions.