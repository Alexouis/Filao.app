-- Add site_web and zone_intervention columns to entreprises
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS site_web text;
ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS zone_intervention text[];
