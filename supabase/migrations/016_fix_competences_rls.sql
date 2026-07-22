-- ==============================================
-- FILAO: Fix entreprises_competences RLS
-- Allow reading skills for companies with visible_reseau = true
-- ==============================================

-- Allow reading skills for all visible network companies
CREATE POLICY "Users can view public network company competences"
  ON entreprises_competences FOR SELECT
  USING (
    entreprise_id IN (
      SELECT id FROM entreprises WHERE visible_reseau = true
    )
  );
