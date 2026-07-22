-- =============================================
-- FILAO: Migration 027 — Taxonomy & Geo Zones RLS Sharing
-- =============================================

-- 1. DROP EXISTING SELECT POLICIES if any (to avoid duplicates or conflicts)
DROP POLICY IF EXISTS "View network company natures" ON company_natures;
DROP POLICY IF EXISTS "View network company domains" ON company_domains;
DROP POLICY IF EXISTS "View network company specialties" ON company_specialties;
DROP POLICY IF EXISTS "View network company expertise tags" ON company_expertise_tags;
DROP POLICY IF EXISTS "View network company geo zones" ON company_geo_zones;
DROP POLICY IF EXISTS "View network company certifications" ON entreprises_certifications;

-- 2. CREATE NEW RELAXED SELECT POLICIES
-- Rule: Taxonomic/Geo data is visible if the enterprise itself is visible to the user.
-- This automatically inherits the visibility rules from the `entreprises` table (own, network, or visible_reseau=true).

CREATE POLICY "View network company natures" ON company_natures
    FOR SELECT USING (
        entreprise_id IN (SELECT id FROM entreprises)
    );

CREATE POLICY "View network company domains" ON company_domains
    FOR SELECT USING (
        entreprise_id IN (SELECT id FROM entreprises)
    );

CREATE POLICY "View network company specialties" ON company_specialties
    FOR SELECT USING (
        entreprise_id IN (SELECT id FROM entreprises)
    );

CREATE POLICY "View network company expertise tags" ON company_expertise_tags
    FOR SELECT USING (
        entreprise_id IN (SELECT id FROM entreprises)
    );

CREATE POLICY "View network company geo zones" ON company_geo_zones
    FOR SELECT USING (
        entreprise_id IN (SELECT id FROM entreprises)
    );

CREATE POLICY "View network company certifications" ON entreprises_certifications
    FOR SELECT USING (
        entreprise_id IN (SELECT id FROM entreprises)
    );
