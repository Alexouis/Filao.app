-- =============================================
-- FILAO v3.1: Migration 004 — Créer documents_entreprise
-- =============================================

CREATE TABLE IF NOT EXISTS documents_entreprise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  type_document TEXT NOT NULL,
  nom_fichier TEXT,
  url TEXT,
  date_emission DATE,
  date_expiration DATE,
  statut TEXT DEFAULT 'en_attente'
    CHECK (statut IN ('valide','expire','en_attente','manquant')),
  tags TEXT[] DEFAULT '{}',
  uploaded_by UUID REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
