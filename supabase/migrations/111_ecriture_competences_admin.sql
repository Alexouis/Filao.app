-- =============================================
-- FILAO: Migration 111 — Compétences : écriture réellement réservée aux admins
-- =============================================
--
-- La 089 a créé des policies d'écriture « admin seulement » sur les tables de
-- compétences d'entreprise. Mais les policies d'origine de la 025,
-- « Manage own company … » (FOR ALL, tout membre de l'entreprise), n'ont
-- jamais été supprimées. Les policies PERMISSIVES se cumulant (OU logique),
-- n'importe quel membre pouvait toujours modifier ou effacer les compétences
-- de son entreprise par l'API — l'écran, lui, était en lecture seule.
--
-- `company_expertise_tags` avait par ailleurs été oubliée par la boucle de la
-- 089 : on lui ajoute la même policy avant de retirer l'ancienne, sans quoi
-- plus personne ne pourrait l'écrire.
--
-- La lecture n'est pas concernée (policies `*_select_authentifie`, 069).
-- Le créateur d'une entreprise en devient administrateur au rattachement
-- (déclencheur de la 090) : l'onboarding n'est pas affecté.

DROP POLICY IF EXISTS "company_expertise_tags_write_admin" ON company_expertise_tags;
CREATE POLICY "company_expertise_tags_write_admin" ON company_expertise_tags
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM utilisateurs u JOIN roles r ON r.id = u.role_id
             WHERE u.id = auth.uid() AND u.entreprise_id = company_expertise_tags.entreprise_id
               AND r.name = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM utilisateurs u JOIN roles r ON r.id = u.role_id
             WHERE u.id = auth.uid() AND u.entreprise_id = company_expertise_tags.entreprise_id
               AND r.name = 'admin')
  );

DROP POLICY IF EXISTS "Manage own company natures"        ON company_natures;
DROP POLICY IF EXISTS "Manage own company domains"        ON company_domains;
DROP POLICY IF EXISTS "Manage own company specialties"    ON company_specialties;
DROP POLICY IF EXISTS "Manage own company expertise tags" ON company_expertise_tags;
DROP POLICY IF EXISTS "Manage own company geo zones"      ON company_geo_zones;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select tablename, policyname, cmd from pg_policies
--    where tablename like 'company\_%' escape '\' order by 1, 3;
--   -- attendu par table : *_select_authentifie (SELECT) et *_write_admin (ALL)
