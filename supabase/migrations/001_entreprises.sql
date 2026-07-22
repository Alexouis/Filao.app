-- =============================================
-- FILAO: Migration - Entreprises & Compétences
-- =============================================
-- Run this in the Supabase SQL Editor
-- =============================================

-- 1. Create entreprises table
CREATE TABLE IF NOT EXISTS entreprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL,
  siret TEXT UNIQUE,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  secteur_activite TEXT,
  taille TEXT, -- 'TPE', 'PME', 'ETI', 'GE'
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- 2. Create entreprises_competences junction table
CREATE TABLE IF NOT EXISTS entreprises_competences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  competence TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entreprise_id, competence)
);

-- 3. Add entreprise_id FK to utilisateurs
ALTER TABLE utilisateurs 
  ADD COLUMN IF NOT EXISTS entreprise_id UUID REFERENCES entreprises(id);

-- 4. Enable RLS
ALTER TABLE entreprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE entreprises_competences ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for entreprises

-- SELECT: users can view their own company + companies in their groupements
CREATE POLICY "Users can view own company"
  ON entreprises FOR SELECT
  USING (
    id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  );

CREATE POLICY "Users can view groupement companies"
  ON entreprises FOR SELECT
  USING (
    id IN (
      SELECT DISTINCT (c->>'entreprise_id')::uuid
      FROM reponses_ao,
           jsonb_array_elements(
             CASE 
               WHEN jsonb_typeof(collaborateurs::jsonb) = 'array' THEN collaborateurs::jsonb
               ELSE '[]'::jsonb
             END
           ) AS c
      WHERE createur_id = auth.uid()
        AND c->>'entreprise_id' IS NOT NULL
    )
  );

-- INSERT: authenticated users can create a company
CREATE POLICY "Authenticated users can create company"
  ON entreprises FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE: users can update their own company
CREATE POLICY "Users can update own company"
  ON entreprises FOR UPDATE
  USING (id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()));

-- 6. RLS Policies for entreprises_competences

-- SELECT: users can see competences of their own company
CREATE POLICY "Users can view own company competences"
  ON entreprises_competences FOR SELECT
  USING (
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  );

-- SELECT: users can see competences of companies in their groupements
CREATE POLICY "Users can view groupement company competences"
  ON entreprises_competences FOR SELECT
  USING (
    entreprise_id IN (
      SELECT DISTINCT (c->>'entreprise_id')::uuid
      FROM reponses_ao,
           jsonb_array_elements(
             CASE 
               WHEN jsonb_typeof(collaborateurs::jsonb) = 'array' THEN collaborateurs::jsonb
               ELSE '[]'::jsonb
             END
           ) AS c
      WHERE createur_id = auth.uid()
        AND c->>'entreprise_id' IS NOT NULL
    )
  );

-- INSERT/UPDATE/DELETE: users can manage their own company competences
CREATE POLICY "Users can insert own company competences"
  ON entreprises_competences FOR INSERT
  WITH CHECK (
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own company competences"
  ON entreprises_competences FOR UPDATE
  USING (
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  );

CREATE POLICY "Users can delete own company competences"
  ON entreprises_competences FOR DELETE
  USING (
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  );

-- =============================================
-- 7. MIGRATION: Convert existing data
-- =============================================
-- Create entreprises from existing text values in utilisateurs
-- Each unique (entreprise, user_id) becomes a new entreprise row
-- The user who has the text value becomes the creator

DO $$
DECLARE
  r RECORD;
  new_entreprise_id UUID;
BEGIN
  FOR r IN 
    SELECT DISTINCT ON (id) id AS user_id, entreprise AS nom_entreprise
    FROM utilisateurs
    WHERE entreprise IS NOT NULL AND entreprise != ''
    AND entreprise_id IS NULL
  LOOP
    -- Check if this company name already exists for this user
    SELECT e.id INTO new_entreprise_id
    FROM entreprises e
    WHERE e.nom = r.nom_entreprise AND e.created_by = r.user_id;
    
    IF new_entreprise_id IS NULL THEN
      INSERT INTO entreprises (nom, created_by)
      VALUES (r.nom_entreprise, r.user_id)
      RETURNING id INTO new_entreprise_id;
    END IF;
    
    UPDATE utilisateurs
    SET entreprise_id = new_entreprise_id
    WHERE id = r.user_id;
  END LOOP;
END $$;
