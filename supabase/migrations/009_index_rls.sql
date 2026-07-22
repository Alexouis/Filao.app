-- =============================================
-- FILAO v3.1: Migration 009 — Index + RLS avec policies complètes
-- =============================================
-- AUDIT NOTES:
-- 1. Les policies existantes sur entreprises (migration 001) référencent
--    collaborateurs JSONB → cassent quand colonne supprimée → réécrites ici
-- 2. Aucun RLS sur reponses_ao actuellement → ajouté ici
-- 3. groupements INSERT/UPDATE/DELETE: créateur AO + admin entreprise
-- 4. Le flux d'acceptation d'invitation passe par service_role → bypass RLS

-- === INDEX ===
CREATE INDEX IF NOT EXISTS idx_groupements_projet ON groupements(projet_id);
CREATE INDEX IF NOT EXISTS idx_groupements_entreprise ON groupements(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_docs_entreprise ON documents_entreprise(entreprise_id);
CREATE INDEX IF NOT EXISTS idx_docs_tags ON documents_entreprise USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_certifs_entreprise ON entreprises_certifications(entreprise_id);

-- =============================================
-- RÉÉCRIRE les policies existantes sur entreprises
-- (les anciennes référencent collaborateurs JSONB qui n'existe plus)
-- =============================================

DROP POLICY IF EXISTS "Users can view groupement companies" ON entreprises;
CREATE POLICY "Users can view groupement companies" ON entreprises FOR SELECT
  USING (id IN (
    SELECT g.entreprise_id FROM groupements g
    JOIN reponses_ao r ON g.projet_id = r.id
    WHERE r.createur_id = auth.uid()
       OR g.entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  ));

DROP POLICY IF EXISTS "Users can view groupement company competences" ON entreprises_competences;
CREATE POLICY "Users can view groupement company competences" ON entreprises_competences FOR SELECT
  USING (entreprise_id IN (
    SELECT g.entreprise_id FROM groupements g
    JOIN reponses_ao r ON g.projet_id = r.id
    WHERE r.createur_id = auth.uid()
       OR g.entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  ));

-- =============================================
-- RLS pour groupements
-- =============================================
ALTER TABLE groupements ENABLE ROW LEVEL SECURITY;

-- SELECT: mon entreprise participe OU je suis le créateur de l'AO
CREATE POLICY "groupements_select" ON groupements FOR SELECT USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  OR projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
);

-- INSERT: 2 cas autorisés :
--   (a) Admin de mon entreprise insère pour mon entreprise (accepter invitation)
--   (b) Créateur de l'AO insère pour N'IMPORTE quelle entreprise (composer le groupement)
CREATE POLICY "groupements_insert" ON groupements FOR INSERT WITH CHECK (
  (
    -- Cas (a): admin accepte pour son entreprise
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise = 'admin')
  )
  OR
  (
    -- Cas (b): créateur de l'AO compose le groupement
    projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
  )
);

-- UPDATE: admin de mon entreprise OU créateur de l'AO
CREATE POLICY "groupements_update" ON groupements FOR UPDATE USING (
  (
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise = 'admin')
  )
  OR
  projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
);

-- DELETE: admin de mon entreprise OU créateur de l'AO
CREATE POLICY "groupements_delete" ON groupements FOR DELETE USING (
  (
    entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise = 'admin')
  )
  OR
  projet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
);

-- =============================================
-- RLS pour documents_entreprise
-- =============================================
ALTER TABLE documents_entreprise ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs_select" ON documents_entreprise FOR SELECT USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
);
CREATE POLICY "docs_insert" ON documents_entreprise FOR INSERT WITH CHECK (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
);
CREATE POLICY "docs_update" ON documents_entreprise FOR UPDATE USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
);
CREATE POLICY "docs_delete" ON documents_entreprise FOR DELETE USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise = 'admin')
);

-- =============================================
-- RLS pour entreprises_certifications
-- =============================================
ALTER TABLE entreprises_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "certifs_select" ON entreprises_certifications FOR SELECT USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
);
CREATE POLICY "certifs_insert" ON entreprises_certifications FOR INSERT WITH CHECK (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
);
CREATE POLICY "certifs_update" ON entreprises_certifications FOR UPDATE USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
);
CREATE POLICY "certifs_delete" ON entreprises_certifications FOR DELETE USING (
  entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
  AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise = 'admin')
);

-- =============================================
-- RLS pour reponses_ao
-- =============================================
ALTER TABLE reponses_ao ENABLE ROW LEVEL SECURITY;

-- SELECT: AO que j'ai créés OU où mon entreprise est dans le groupement (accepté)
CREATE POLICY "reponses_ao_select" ON reponses_ao FOR SELECT USING (
  createur_id = auth.uid()
  OR id IN (
    SELECT projet_id FROM groupements
    WHERE entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
      AND statut = 'accepte'
  )
);

-- INSERT: tout utilisateur authentifié admin ou membre
CREATE POLICY "reponses_ao_insert" ON reponses_ao FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise IN ('admin','membre'))
);

-- UPDATE: seul le créateur (les partenaires contribuent via documents_entreprise
-- et groupements, ils ne modifient pas l'AO lui-même)
CREATE POLICY "reponses_ao_update" ON reponses_ao FOR UPDATE USING (
  createur_id = auth.uid()
);

-- DELETE: seul le créateur admin
CREATE POLICY "reponses_ao_delete" ON reponses_ao FOR DELETE USING (
  createur_id = auth.uid()
  AND EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND role_entreprise = 'admin')
);
