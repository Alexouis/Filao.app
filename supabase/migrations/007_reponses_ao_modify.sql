-- =============================================
-- FILAO v3.1: Migration 007 — Modifier reponses_ao
-- =============================================

-- Ajouter type_groupement (nullable pour les AO existants, obligatoire côté front pour les nouveaux)
ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS type_groupement TEXT
    CHECK (type_groupement IN ('solidaire','conjoint'));

-- Supprimer anciennes colonnes (données migrées en 006b)
ALTER TABLE reponses_ao
  DROP COLUMN IF EXISTS collaborateurs,
  DROP COLUMN IF EXISTS nb_collaborateurs;
