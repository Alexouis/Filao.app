-- Add columns for individual experts and workforce metrics
ALTER TABLE entreprises 
ADD COLUMN IF NOT EXISTS prenom TEXT,
ADD COLUMN IF NOT EXISTS nom_famille TEXT,
ADD COLUMN IF NOT EXISTS effectif INTEGER DEFAULT 1;

-- Comment for clarity
COMMENT ON COLUMN entreprises.prenom IS 'First name of the sole proprietor / expert';
COMMENT ON COLUMN entreprises.nom_famille IS 'Last name of the sole proprietor / expert';
COMMENT ON COLUMN entreprises.effectif IS 'Number of employees';
