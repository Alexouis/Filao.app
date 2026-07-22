-- 1. Add the new array column to 'entreprises'
ALTER TABLE entreprises 
ADD COLUMN IF NOT EXISTS competences TEXT[] DEFAULT '{}';

-- 2. Migrate existing data from 'entreprises_competences' junction table
-- (Aggregates skills into an array grouped by entreprise_id)
UPDATE entreprises e
SET competences = sub.skill_array
FROM (
    select entreprise_id, array_agg(nom_competence) as skill_array
    from entreprises_competences
    group by entreprise_id
) AS sub
WHERE e.id = sub.entreprise_id;

-- 3. Add a GIN index to the 'competences' column for efficient skill-based filtering
CREATE INDEX IF NOT EXISTS idx_entreprises_competences_array ON entreprises USING GIN (competences);

-- 4. Add comment for documentation
COMMENT ON COLUMN entreprises.competences IS 'List of company skills/expertise as an array of strings';

-- NOTE: We are NOT dropping 'entreprises_competences' yet to ensure zero data loss during the transition.
-- You can drop it manually after verifying the migration:
-- DROP TABLE entreprises_competences;
