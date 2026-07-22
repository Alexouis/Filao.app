-- =============================================
-- FILAO v3.1: Migration 002 — Modifier entreprises
-- =============================================

ALTER TABLE entreprises
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS zone_intervention TEXT[],
  ADD COLUMN IF NOT EXISTS site_web TEXT,
  ADD COLUMN IF NOT EXISTS referent_id UUID REFERENCES utilisateurs(id);

-- Populer referent_id avec le premier utilisateur de chaque entreprise
UPDATE entreprises e SET referent_id = (
  SELECT u.id FROM utilisateurs u
  WHERE u.entreprise_id = e.id ORDER BY u.created_at ASC LIMIT 1
) WHERE referent_id IS NULL;

-- Contrainte NOT NULL (après population)
ALTER TABLE entreprises ALTER COLUMN referent_id SET NOT NULL;
