-- =============================================
-- FILAO v3.1: Migration 003 — Créer entreprises_certifications
-- =============================================

CREATE TABLE IF NOT EXISTS entreprises_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  numero TEXT,
  date_obtention DATE,
  date_expiration DATE,
  justificatif_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entreprise_id, nom)
);
