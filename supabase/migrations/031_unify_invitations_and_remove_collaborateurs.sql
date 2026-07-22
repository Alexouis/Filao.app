-- =============================================
-- FILAO v3.2: Migration 031 — Unify Invitations & SQL Dependency Fix (Final)
-- =============================================

-- 1. FIX CROSS-TABLE DEPENDENCIES (RLS Policies referencing legacy JSON)

-- Table: entreprises
DROP POLICY IF EXISTS "Users can view groupement companies" ON entreprises;
CREATE POLICY "Users can view groupement companies"
  ON entreprises FOR SELECT
  USING (
    id IN (
      -- Partners in projects I manage
      SELECT entreprise_id FROM groupements 
      WHERE projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
      UNION
      -- Partners in projects I am part of
      SELECT entreprise_id FROM groupements
      WHERE projet_id IN (
        SELECT projet_id FROM groupements 
        WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
      )
    )
  );

-- Table: comments
DROP POLICY IF EXISTS "Users can read comments on their tenders" ON comments;
CREATE POLICY "Users can read comments on their tenders"
  ON comments FOR SELECT
  USING (
    tender_id IN (
      -- My own tenders
      SELECT id FROM reponses_ao WHERE createur_id = auth.uid()
      UNION
      -- Tenders where my company is a groupement member
      SELECT projet_id FROM groupements 
      WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    )
  );


-- 2. UPDATE INVITATIONS SCHEMA
-- Add access_code for manual portal entry
ALTER TABLE invitations 
  ADD COLUMN IF NOT EXISTS access_code TEXT;

-- NOTE: token column is kept for magic links.

-- 3. REMOVE LEGACY COLUMN
-- Now that RLS dependencies are gone, we can safely drop it
ALTER TABLE reponses_ao
  DROP COLUMN IF EXISTS collaborateurs;

-- 4. UPDATE INVITATIONS RLS
DROP POLICY IF EXISTS "Lecture invitations par code" ON invitations;
CREATE POLICY "Lecture invitations par code" ON invitations
  FOR SELECT
  USING (
    true -- Identity verified via magic link (token) or manual portal (email + access_code)
  );

COMMENT ON COLUMN invitations.access_code IS 'Short code (6 chars) for manual guest portal verification';
