-- =============================================
-- FILAO v3.2: Migration 024 — Network Improvements
-- Unifies and enables bidirectional network relationships
-- =============================================

-- 1. DROP EXISTING POLICIES (Cleaning the old "strict origin-only" policies)
DROP POLICY IF EXISTS "Lecture reseau" ON reseau_entreprises;
DROP POLICY IF EXISTS "Ajout reseau" ON reseau_entreprises;
DROP POLICY IF EXISTS "Modif reseau" ON reseau_entreprises;
DROP POLICY IF EXISTS "Suppr reseau" ON reseau_entreprises;
DROP POLICY IF EXISTS "Lecture reseau cible" ON reseau_entreprises; -- Just in case it was partially applied
DROP POLICY IF EXISTS "Suppr reseau cible" ON reseau_entreprises; -- Just in case it was partially applied

-- 2. CREATE NEW UNIFIED BIDIRECTIONAL POLICIES

-- Policy: Lecture (Voir mon réseau ou mes invitations entrantes)
CREATE POLICY "Lecture reseau" ON reseau_entreprises
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id IN (entreprise_origine_id, entreprise_cible_id)
    )
  );

-- Policy: Ajout (S'ajouter en tant qu'origine)
CREATE POLICY "Ajout reseau" ON reseau_entreprises
  FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id = entreprise_origine_id
    )
  );

-- Policy: Modification (Accepter une invitation ou bloquer)
-- A user can update if they are the ORIGIN (blocking) OR the TARGET (accepting invitation)
CREATE POLICY "Modif reseau" ON reseau_entreprises
  FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id IN (entreprise_origine_id, entreprise_cible_id)
    )
  );

-- Policy: Suppression (Retirer du réseau)
-- A user can sever a connection from either side
CREATE POLICY "Suppr reseau" ON reseau_entreprises
  FOR DELETE
  USING (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id IN (entreprise_origine_id, entreprise_cible_id)
    )
  );

-- 3. INDEXES for performance
CREATE INDEX IF NOT EXISTS idx_reseau_cible ON reseau_entreprises(entreprise_cible_id);
CREATE INDEX IF NOT EXISTS idx_reseau_origine ON reseau_entreprises(entreprise_origine_id);
