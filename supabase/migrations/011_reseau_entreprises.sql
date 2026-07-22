-- =============================================
-- FILAO v3.1: Migration 011 — Réseau Entreprises
-- =============================================

CREATE TABLE IF NOT EXISTS reseau_entreprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_origine_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  entreprise_cible_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'bloque', 'en_attente')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entreprise_origine_id, entreprise_cible_id)
);

-- RLS
ALTER TABLE reseau_entreprises ENABLE ROW LEVEL SECURITY;

-- Policy: Lecture (Voir mon réseau)
CREATE POLICY "Lecture reseau" ON reseau_entreprises
  FOR SELECT
  USING (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id = reseau_entreprises.entreprise_origine_id
    )
  );

-- Policy: Ajout (Ajouter au réseau)
CREATE POLICY "Ajout reseau" ON reseau_entreprises
  FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id = reseau_entreprises.entreprise_origine_id
    )
  );

-- Policy: Modification (Bloquer/Débloquer)
CREATE POLICY "Modif reseau" ON reseau_entreprises
  FOR UPDATE
  USING (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id = reseau_entreprises.entreprise_origine_id
    )
  );

-- Policy: Suppression (Retirer du réseau)
CREATE POLICY "Suppr reseau" ON reseau_entreprises
  FOR DELETE
  USING (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id = reseau_entreprises.entreprise_origine_id
    )
  );
