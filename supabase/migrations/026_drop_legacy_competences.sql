-- Migration: Drop legacy competences, secteur_activite, and zone_intervention columns from entreprises
-- This column is replaced by the hierarchical skills taxonomy (domains, specialties),
-- transversal expertise tags and geographic zones.

ALTER TABLE entreprises DROP COLUMN IF EXISTS kompetences; -- Typo in previous thought? No, I'll use correctly:
ALTER TABLE entreprises DROP COLUMN IF EXISTS competences;
ALTER TABLE entreprises DROP COLUMN IF EXISTS secteur_activite;
ALTER TABLE entreprises DROP COLUMN IF EXISTS zone_intervention;

COMMENT ON TABLE entreprises IS 'Table des entreprises. Les colonnes competences, secteur_activite et zone_intervention ont été supprimées au profit du nouveau système de taxonomie hiérarchique et géographique.';
