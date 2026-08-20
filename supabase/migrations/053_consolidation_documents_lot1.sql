-- =============================================
-- FILAO: Migration 053 — Consolidation des documents (Lot 1 : socle base)
-- =============================================
--
-- CONTEXTE
-- Le projet a deux tables concurrentes, par entreprise, pour les mêmes pièces
-- de candidature :
--   • `documents_candidature` — vivante, alimentée et câblée (CompanyTab,
--     TenderWizard), avec `label` / `statut` / `categorie`.
--   • `documents_entreprise` — morte : plus aucune écriture applicative depuis
--     la migration 005, remplacée de fait par le modèle ci-dessus.
-- En parallèle, les 4 documents administratifs standard (Kbis, attestations,
-- statuts) sont restés sur `utilisateurs.*_url` + un blob JSON
-- `document_statuses`, donc « par utilisateur » alors que ce sont des documents
-- d'entreprise.
--
-- CIBLE RETENUE
-- `documents_candidature` devient la source unique. Elle est déjà par entreprise
-- et déjà utilisée ; il lui manque seulement la gestion d'expiration. Ce lot 1
-- installe le socle base SANS toucher à l'UI ni supprimer quoi que ce soit :
-- il est déployable seul et réversible.
--
-- EXPIRATION — MODÈLE HYBRIDE
-- Tous les documents n'expirent pas de la même façon :
--   • Attestation d'assurance : porte une date d'échéance réelle → saisie.
--   • Kbis, attestation sur l'honneur : pas d'expiration légale mais une
--     FRAÎCHEUR conventionnelle exigée par les acheteurs (Kbis < 3 mois,
--     attestations sur l'honneur ~6 mois) → calculée depuis la date d'émission,
--     pas de saisie.
--   • Statuts : n'expirent pas.
-- Les durées conventionnelles vivent dans une table de référence
-- (`ref_durees_validite_document`) pour être ajustables sans redéploiement.
-- Ces durées sont des USAGES COURANTS, pas une règle contractuelle : un
-- règlement de consultation peut exiger autre chose. L'indicateur reste une
-- alerte de fraîcheur, pas une vérité juridique.

-- ---------------------------------------------------------------
-- 1. Colonnes d'expiration sur documents_candidature
-- ---------------------------------------------------------------
-- `date_emission` : date portée par le document (ou, à défaut, date de dépôt).
--   Sert de point de départ au calcul conventionnel.
-- `date_expiration` : date d'échéance SAISIE, uniquement quand elle figure sur
--   le document (assurance). Laissée NULL pour les documents à durée
--   conventionnelle — l'échéance est alors dérivée, pas stockée.
ALTER TABLE documents_candidature
  ADD COLUMN IF NOT EXISTS date_emission DATE,
  ADD COLUMN IF NOT EXISTS date_expiration DATE;

COMMENT ON COLUMN documents_candidature.date_emission IS
  'Date d''émission du document (ou date de dépôt à défaut). Point de départ du calcul de fraîcheur conventionnelle.';
COMMENT ON COLUMN documents_candidature.date_expiration IS
  'Échéance SAISIE, seulement quand elle figure sur le document (ex. assurance). NULL pour les documents à durée conventionnelle : l''échéance est dérivée via ref_durees_validite_document.';

-- ---------------------------------------------------------------
-- 1b. RLS sur documents_candidature (rattrapage de sécurité)
-- ---------------------------------------------------------------
-- Cette table a été créée hors-migration (aucun CREATE TABLE dans le dossier
-- migrations) et n'avait AUCUNE politique RLS : accessible en lecture/écriture
-- par toute clé authenticated, tous tenants confondus. On corrige ici, sur le
-- modèle des autres tables par entreprise (cf. documents_entreprise dans 009).
--
-- Le cloisonnement se fait par entreprise : un utilisateur ne voit et n'écrit
-- que les documents de SON entreprise. Contrairement à documents_entreprise, la
-- suppression n'est pas réservée aux admins : ces pièces sont contribuées par
-- les membres, qui doivent pouvoir retirer ce qu'ils ont déposé. Si tu veux un
-- modèle admin-only pour delete, calque la policy sur "docs_delete" de la 009.
ALTER TABLE documents_candidature ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_candidature_select" ON documents_candidature;
CREATE POLICY "documents_candidature_select"
  ON documents_candidature FOR SELECT TO authenticated
  USING (entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

DROP POLICY IF EXISTS "documents_candidature_insert" ON documents_candidature;
CREATE POLICY "documents_candidature_insert"
  ON documents_candidature FOR INSERT TO authenticated
  WITH CHECK (entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

DROP POLICY IF EXISTS "documents_candidature_update" ON documents_candidature;
CREATE POLICY "documents_candidature_update"
  ON documents_candidature FOR UPDATE TO authenticated
  USING (entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()))
  WITH CHECK (entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

DROP POLICY IF EXISTS "documents_candidature_delete" ON documents_candidature;
CREATE POLICY "documents_candidature_delete"
  ON documents_candidature FOR DELETE TO authenticated
  USING (entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

-- ---------------------------------------------------------------
-- 2. Table de référence des durées conventionnelles
-- ---------------------------------------------------------------
-- `type_document` correspond au type normalisé (voir config.ts : kbis,
-- attestation_assurance, attestation_honneur, presentation_societe, …).
-- `duree_validite_mois` NULL a deux lectures possibles distinguées par
-- `sans_expiration` :
--   • sans_expiration = TRUE  → le document n'expire jamais (Statuts).
--   • sans_expiration = FALSE → l'échéance est portée par le document lui-même
--     et doit être saisie (Assurance) ; aucune durée conventionnelle.
CREATE TABLE IF NOT EXISTS ref_durees_validite_document (
  type_document       TEXT PRIMARY KEY,
  libelle             TEXT NOT NULL,
  duree_validite_mois INTEGER
    CHECK (duree_validite_mois IS NULL OR duree_validite_mois > 0),
  sans_expiration     BOOLEAN NOT NULL DEFAULT FALSE,
  saisie_manuelle     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ref_durees_validite_document IS
  'Durées de validité conventionnelles par type de document. Ajustable sans redéploiement. Valeurs indicatives (usages marchés publics), pas contractuelles.';

-- Seed initial. Modifiable ensuite librement en base.
--   kbis                  : Kbis de moins de 3 mois usuellement exigé.
--   attestation_honneur   : refaite ~tous les 6 mois par convention.
--   attestation_assurance : échéance réelle sur le document → saisie manuelle.
--   presentation_societe  : les statuts n'expirent pas.
INSERT INTO ref_durees_validite_document
  (type_document, libelle, duree_validite_mois, sans_expiration, saisie_manuelle)
VALUES
  ('kbis',                  'Kbis / Extrait D1',        3,    FALSE, FALSE),
  ('attestation_honneur',   'Attestation sur l''honneur', 6,  FALSE, FALSE),
  ('attestation_assurance', 'Attestation Assurance',    NULL, FALSE, TRUE),
  ('presentation_societe',  'Statuts',                  NULL, TRUE,  FALSE)
ON CONFLICT (type_document) DO NOTHING;

-- Lecture seule pour les utilisateurs authentifiés ; l'écriture reste réservée
-- à l'administration (service_role), ces valeurs étant du paramétrage.
ALTER TABLE ref_durees_validite_document ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ref_durees_select" ON ref_durees_validite_document;
CREATE POLICY "ref_durees_select"
  ON ref_durees_validite_document FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------
-- 3. Vue avec statut effectif (fraîcheur incluse)
-- ---------------------------------------------------------------
-- `date_expiration_effective` :
--   • date saisie si présente (assurance) ;
--   • sinon, si une durée conventionnelle existe : date_emission + durée ;
--   • sinon NULL (document sans expiration, ou émission inconnue).
-- `statut_effectif` : bascule à 'expire' dès que l'échéance effective est
-- dépassée, sinon reflète le statut stocké. Aligne la sémantique sur l'ancienne
-- `documents_entreprise_view`, mais sur la source vivante.
CREATE OR REPLACE VIEW documents_candidature_view
  WITH (security_invoker = true)
AS
SELECT
  d.*,
  r.duree_validite_mois,
  r.sans_expiration,
  CASE
    WHEN d.date_expiration IS NOT NULL
      THEN d.date_expiration
    WHEN r.sans_expiration THEN NULL
    WHEN r.duree_validite_mois IS NOT NULL AND d.date_emission IS NOT NULL
      THEN (d.date_emission + make_interval(months => r.duree_validite_mois))::date
    ELSE NULL
  END AS date_expiration_effective,
  CASE
    WHEN (
      CASE
        WHEN d.date_expiration IS NOT NULL THEN d.date_expiration
        WHEN r.sans_expiration THEN NULL
        WHEN r.duree_validite_mois IS NOT NULL AND d.date_emission IS NOT NULL
          THEN (d.date_emission + make_interval(months => r.duree_validite_mois))::date
        ELSE NULL
      END
    ) < CURRENT_DATE THEN 'expire'
    ELSE d.statut
  END AS statut_effectif
FROM documents_candidature d
LEFT JOIN ref_durees_validite_document r
  ON r.type_document = d.categorie;

-- ---------------------------------------------------------------
-- 4. Backfill des 4 documents standard (utilisateurs → documents_candidature)
-- ---------------------------------------------------------------
-- Les documents standard vivent aujourd'hui sur `utilisateurs.*_url` (un jeu
-- PAR MEMBRE) + le statut dans `document_statuses` (JSON). On les recopie vers
-- `documents_candidature`, UNE ligne par (entreprise, type). En cas de
-- plusieurs membres portant le même type, on garde le plus pertinent :
-- 'valide' d'abord, puis le plus récemment inscrit.
--
-- `categorie` reçoit le type normalisé (kbis, …) : c'est la clé de jointure
-- avec ref_durees_validite_document. `date_emission` = date de dépôt connue
-- (document_statuses.uploaded_at) à défaut de date portée sur le document ;
-- `date_expiration` reste NULL (aucune fausse date n'est fabriquée).
--
-- Idempotent : on n'insère pas si une ligne (entreprise, categorie standard)
-- existe déjà, pour que la migration soit rejouable sans doublon.

WITH source AS (
  SELECT
    u.entreprise_id,
    u.id AS uploaded_by,
    u.created_at,
    cols.type_document,
    v.url,
    v.uploaded_at,
    COALESCE(v.statut, 'en_attente') AS statut,
    ROW_NUMBER() OVER (
      PARTITION BY u.entreprise_id, cols.type_document
      ORDER BY (COALESCE(v.statut, '') = 'valide') DESC, u.created_at DESC
    ) AS rang
  FROM utilisateurs u
  CROSS JOIN LATERAL (
    VALUES
      ('kbis',                  u.kbis_url),
      ('attestation_honneur',   u.attestation_honneur_url),
      ('attestation_assurance', u.attestation_assurance_url),
      ('presentation_societe',  u.presentation_societe_url)
  ) AS cols(type_document, url)
  CROSS JOIN LATERAL (
    SELECT
      cols.url AS url,
      NULLIF(u.document_statuses -> (cols.type_document || '_url') ->> 'status', '') AS statut,
      NULLIF(u.document_statuses -> (cols.type_document || '_url') ->> 'uploaded_at', '') AS uploaded_at
  ) AS v
  WHERE u.entreprise_id IS NOT NULL
    AND cols.url IS NOT NULL
    AND cols.url <> ''
)
INSERT INTO documents_candidature
  (entreprise_id, uploaded_by, label, url, statut, categorie, date_emission, created_at, updated_at)
SELECT
  s.entreprise_id,
  s.uploaded_by,
  r.libelle,
  s.url,
  CASE WHEN s.statut IN ('valide','expire','en_attente') THEN s.statut ELSE 'en_attente' END,
  s.type_document,
  s.uploaded_at::date,   -- date_emission : dépôt connu, sinon NULL
  now(),
  now()
FROM source s
JOIN ref_durees_validite_document r ON r.type_document = s.type_document
WHERE s.rang = 1
  AND NOT EXISTS (
    SELECT 1 FROM documents_candidature dc
    WHERE dc.entreprise_id = s.entreprise_id
      AND dc.categorie = s.type_document
  );

-- ---------------------------------------------------------------
-- 5. Vérification
-- ---------------------------------------------------------------
--   select categorie, count(*) from documents_candidature
--    where categorie in ('kbis','attestation_honneur','attestation_assurance','presentation_societe')
--    group by categorie;
--
--   select label, statut, statut_effectif, date_emission, date_expiration_effective
--     from documents_candidature_view
--    where entreprise_id = '<id>';
--
-- ⚠️ Ce lot NE supprime rien : `documents_entreprise`, les colonnes
--    `utilisateurs.*_url` et `document_statuses` restent en place. Leur
--    suppression est traitée au Lot 3, une fois les écritures (Lot 2) et les
--    lectures repointées et validées en production.