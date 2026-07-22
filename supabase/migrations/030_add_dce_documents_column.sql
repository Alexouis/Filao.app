-- =============================================
-- FILAO v3.2: Migration 030 — Add dce_documents and jalons columns
-- =============================================

ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS dce_documents JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS jalons JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]'::jsonb;

-- Update RLS if necessary (usually JSONB columns are covered by existing table-level policies, 
-- but ensure the owner can update it)
COMMENT ON COLUMN reponses_ao.dce_documents IS 'List of documents associated with the DCE (post-creation)';
COMMENT ON COLUMN reponses_ao.jalons IS 'List of milestones associated with the response';
