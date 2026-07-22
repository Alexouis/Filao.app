-- Create avis_partenaires table
CREATE TABLE IF NOT EXISTS avis_partenaires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id UUID NOT NULL REFERENCES reponses_ao(id) ON DELETE CASCADE,
  evaluateur_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE, -- Company GIVING the rating
  evalue_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,     -- Company BEING rated
  note INTEGER NOT NULL CHECK (note BETWEEN 1 AND 5),
  commentaire TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(projet_id, evaluateur_id, evalue_id) -- One rating per pair per project
);

-- Enable RLS
ALTER TABLE avis_partenaires ENABLE ROW LEVEL SECURITY;

-- Policies

-- 1. Everyone can read ratings (or restrict to network if preferred, but public is requested for "Trust")
CREATE POLICY "Public read ratings" ON avis_partenaires
  FOR SELECT USING (true);

-- 2. Participants can insert ratings
-- A user can rate if they are the "Referent" of the "evaluateur_id" company
CREATE POLICY "Companies can rate partners" ON avis_partenaires
  FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT id FROM utilisateurs WHERE entreprise_id = evaluateur_id
    )
  );
