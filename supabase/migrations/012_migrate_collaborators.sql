-- =============================================
-- FILAO v3.1: Migration 012 — Migrate Collaborators to Groupements
-- =============================================

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
            -- 1. Try to find user by email
            SELECT id, entreprise_id INTO user_record FROM utilisateurs WHERE email = (collab->>'email');
            
            IF user_record.entreprise_id IS NOT NULL THEN
                company_id := user_record.entreprise_id;
                
                -- Map role
                c_role := COALESCE(collab->>'role', 'Sous-traitant');
                
                -- Map status
                IF c_role = 'Mandataire' OR collab->>'status' = 'approved' THEN
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
                    RAISE NOTICE 'Error inserting groupement for project % and company %: %', r.id, company_id, SQLERRM;
                END;
            END IF;
        END LOOP;
    END LOOP;
END $$;
