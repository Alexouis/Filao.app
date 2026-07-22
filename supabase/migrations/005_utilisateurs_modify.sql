-- =============================================
-- FILAO v3.1: Migration 005 — Modifier utilisateurs
-- =============================================

-- 1. Ajout champs (DEFAULT 'admin' pour les existants)
ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS fonction TEXT,
  ADD COLUMN IF NOT EXISTS role_entreprise TEXT DEFAULT 'admin'
    CHECK (role_entreprise IN ('admin','membre'));

-- 2. Changer le DEFAULT pour les futurs utilisateurs
ALTER TABLE utilisateurs ALTER COLUMN role_entreprise SET DEFAULT 'membre';

-- 3. Migrer docs vers documents_entreprise (DISTINCT ON = 1 jeu par entreprise)

-- kbis
INSERT INTO documents_entreprise (entreprise_id, type_document, url, uploaded_by, statut)
SELECT DISTINCT ON (u.entreprise_id)
  u.entreprise_id, 'kbis', u.kbis_url, u.id,
  COALESCE((u.document_statuses->>'kbis_url'), 'en_attente')
FROM utilisateurs u
WHERE u.kbis_url IS NOT NULL AND u.entreprise_id IS NOT NULL
ORDER BY u.entreprise_id, u.created_at ASC;

-- attestation_assurance
INSERT INTO documents_entreprise (entreprise_id, type_document, url, uploaded_by, statut)
SELECT DISTINCT ON (u.entreprise_id)
  u.entreprise_id, 'attestation_assurance', u.attestation_assurance_url, u.id,
  COALESCE((u.document_statuses->>'attestation_assurance_url'), 'en_attente')
FROM utilisateurs u
WHERE u.attestation_assurance_url IS NOT NULL AND u.entreprise_id IS NOT NULL
ORDER BY u.entreprise_id, u.created_at ASC;

-- attestation_honneur
INSERT INTO documents_entreprise (entreprise_id, type_document, url, uploaded_by, statut)
SELECT DISTINCT ON (u.entreprise_id)
  u.entreprise_id, 'attestation_honneur', u.attestation_honneur_url, u.id,
  COALESCE((u.document_statuses->>'attestation_honneur_url'), 'en_attente')
FROM utilisateurs u
WHERE u.attestation_honneur_url IS NOT NULL AND u.entreprise_id IS NOT NULL
ORDER BY u.entreprise_id, u.created_at ASC;

-- presentation_societe
INSERT INTO documents_entreprise (entreprise_id, type_document, url, uploaded_by, statut)
SELECT DISTINCT ON (u.entreprise_id)
  u.entreprise_id, 'presentation_societe', u.presentation_societe_url, u.id,
  COALESCE((u.document_statuses->>'presentation_societe_url'), 'en_attente')
FROM utilisateurs u
WHERE u.presentation_societe_url IS NOT NULL AND u.entreprise_id IS NOT NULL
ORDER BY u.entreprise_id, u.created_at ASC;

-- 4. DROP anciennes colonnes
ALTER TABLE utilisateurs
  DROP COLUMN IF EXISTS kbis_url,
  DROP COLUMN IF EXISTS attestation_assurance_url,
  DROP COLUMN IF EXISTS attestation_honneur_url,
  DROP COLUMN IF EXISTS presentation_societe_url,
  DROP COLUMN IF EXISTS document_statuses;
