-- =============================================
-- FILAO v3.2: Migration 013 — Fix Groupements Schema & Migrate Data
-- =============================================

-- 1. Drop the legacy/incorrect table
DROP TABLE IF EXISTS groupements CASCADE;

-- 2. Recreate table with correct schema (from 006_groupements.sql)
CREATE TABLE groupements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id UUID NOT NULL REFERENCES reponses_ao(id) ON DELETE CASCADE,
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  role_groupement TEXT NOT NULL CHECK (role_groupement IN ('Mandataire','Co-traitant','Sous-traitant')),
  statut TEXT DEFAULT 'invite' CHECK (statut IN ('invite','accepte','refuse','retire')),
  date_invitation TIMESTAMPTZ DEFAULT now(),
  date_reponse TIMESTAMPTZ,
  invite_par UUID REFERENCES utilisateurs(id),
  UNIQUE(projet_id, entreprise_id)
);

-- RLS
ALTER TABLE groupements ENABLE ROW LEVEL SECURITY;

-- Note: We need policies to see data.
-- 1. View: If I am the creator of the project OR if my company is in the groupement
CREATE POLICY "Lecture groupements" ON groupements
  FOR SELECT
  USING (
    (auth.uid() = invite_par) -- Creator (who invited)
    OR 
    (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())) -- My company is target
    OR
    -- Also allow if I am the project creator (even if I didn't invite this specific one, though logic implies creators invite)
    (projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid()))
  );

-- 2. Insert: If I am the project creator
CREATE POLICY "Ajout groupements" ON groupements
  FOR INSERT
  WITH CHECK (
    projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
  );

-- 3. Update: If I am creator (can change status/role) OR if I am the target company (can accept/refuse)
CREATE POLICY "Modif groupements" ON groupements
  FOR UPDATE
  USING (
    (projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid()))
    OR
    (entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid()))
  );

-- 4. Delete: Only project creator can remove
CREATE POLICY "Suppr groupements" ON groupements
  FOR DELETE
  USING (
    projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
  );

-- 3. Migrate Data from reponses_ao
DO $$
DECLARE
    r RECORD;
    collab JSONB;
    user_record RECORD;
    company_id UUID;
    mapped_status TEXT;
    c_role TEXT;
BEGIN
    FOR r IN SELECT id, createur_id, collaborateurs FROM reponses_ao WHERE collaborateurs IS NOT NULL AND jsonb_array_length(collaborateurs) > 0
    LOOP
        FOR collab IN SELECT * FROM jsonb_array_elements(r.collaborateurs)
        LOOP
            -- 1. Try to find user by email (case insensitive)
            -- Trim whitespace just in case
            SELECT id, entreprise_id INTO user_record FROM utilisateurs WHERE email ILIKE trim(both '"' from (collab->>'email'));
            
            IF user_record.entreprise_id IS NOT NULL THEN
                company_id := user_record.entreprise_id;
                
                -- Map role
                c_role := COALESCE(collab->>'role', 'Sous-traitant');
                
                -- Map status
                IF c_role = 'Mandataire' OR collab->>'status' = 'approved' OR collab->>'status' = 'accepte' THEN
                    mapped_status := 'accepte';
                ELSIF collab->>'status' = 'pending' THEN
                    mapped_status := 'invite';
                ELSE
                    mapped_status := 'invite'; -- Default
                END IF;

                -- Insert into groupements
                BEGIN
                    INSERT INTO groupements (projet_id, entreprise_id, role_groupement, statut, invite_par)
                    VALUES (r.id, company_id, c_role, mapped_status, r.createur_id)
                    ON CONFLICT (projet_id, entreprise_id) 
                    DO UPDATE SET 
                        statut = EXCLUDED.statut,
                        role_groupement = EXCLUDED.role_groupement;
                EXCEPTION WHEN OTHERS THEN
                    -- Ignore errors (e.g. invalid statuses if check constraint fails)
                    NULL; 
                END;
            END IF;
        END LOOP;
    END LOOP;
END $$;
