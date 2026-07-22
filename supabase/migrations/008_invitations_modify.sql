-- =============================================
-- FILAO v3.1: Migration 008 — Modifier invitations
-- =============================================
-- ⚠️ DÉPLOIEMENT ATOMIQUE : RENAME tender_id → projet_id casse le front.
-- Déployer cette migration + le code frontend ensemble.

ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS entreprise_nom TEXT,
  ADD COLUMN IF NOT EXISTS entreprise_id UUID REFERENCES entreprises(id),
  ADD COLUMN IF NOT EXISTS role_groupement TEXT DEFAULT 'Sous-traitant',
  ADD COLUMN IF NOT EXISTS repondu_at TIMESTAMPTZ;

ALTER TABLE invitations RENAME COLUMN tender_id TO projet_id;
ALTER TABLE invitations RENAME COLUMN created_by TO invite_par;
