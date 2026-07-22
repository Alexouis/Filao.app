-- =============================================
-- FILAO v3.2: Migration 021 — Fix Groupements RLS Visibility for Team Members
-- =============================================

-- Drop the old policy
DROP POLICY IF EXISTS "Lecture groupements" ON groupements;

-- Create new policy that allows:
-- 1. Project creator to see everyone
-- 2. Any member of the team to see everyone on the same project
CREATE POLICY "Lecture groupements" ON groupements
  FOR SELECT
  USING (
    -- Case 1: I am the mandataire of the tender
    (projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid()))
    OR
    -- Case 2: I invited this specific member
    (invite_par = auth.uid())
    OR
    -- Case 3: I am part of the groupement for this project
    (projet_id IN (
      SELECT projet_id FROM groupements 
      WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    ))
  );

-- Also ensure collaborators can see invitations for the same project
DROP POLICY IF EXISTS "Lecture invitations" ON invitations;
CREATE POLICY "Lecture invitations" ON invitations
  FOR SELECT
  USING (
    -- Case 1: I am the mandataire
    (tender_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid()))
    OR
    -- Case 2: I am a member of the project groupement
    (tender_id IN (
      SELECT projet_id FROM groupements 
      WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    ))
    OR
    -- Case 3: Only the people invited by me or for me
    (email IN (SELECT email FROM utilisateurs WHERE id = auth.uid()))
    OR
    (created_by = auth.uid())
  );
