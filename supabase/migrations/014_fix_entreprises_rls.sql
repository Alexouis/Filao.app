-- =============================================
-- FILAO v3.3: Migration 014 — Fix Entreprises Visibility RLS
-- =============================================

-- Problem: Previous RLS on `entreprises` only allowed users to see their OWN company.
-- Solution: Allow users to see:
-- 1. Their own company (status quo)
-- 2. Companies in their network (via `reseau_entreprises` or `groupements`)
-- 3. Publicly visible companies (`visible_reseau = true`)

-- Drop existing SELECT policy (assuming name 'Users can view own company')
DROP POLICY IF EXISTS "Users can view own company" ON entreprises;

-- Create comprehensive SELECT policy
CREATE POLICY "Lecture entreprises" ON entreprises
  FOR SELECT
  USING (
    -- 1. My own company
    id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    OR
    -- 2. Publicly visible companies
    visible_reseau = true
    OR
    -- 3. Companies I am connected to via Groupements (Collaborations)
    id IN (
        SELECT entreprise_id FROM groupements 
        WHERE projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid()) -- I created project
        UNION
        SELECT entreprise_id FROM groupements
        WHERE projet_id IN (SELECT projet_id FROM groupements WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())) -- Shared project
    )
    OR
    -- 4. Companies I am connected to via reseau_entreprises (Manual Network)
    id IN (
        SELECT entreprise_target_id FROM (
            SELECT entreprise_cible_id as entreprise_target_id FROM reseau_entreprises 
            WHERE entreprise_origine_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
            UNION
            SELECT entreprise_origine_id as entreprise_target_id FROM reseau_entreprises
            WHERE entreprise_cible_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
        ) as network_connections
    )
  );

-- Also need to check if `groupements` RLS is fully correct, but `entreprises` was the main blocker.
