-- =============================================
-- FILAO: Migration 062 — Rattacher les utilisateurs à un rôle
-- =============================================
--
-- La table `roles` (admin / user) existait sans lien vers les utilisateurs :
-- le modèle de rôles était à moitié construit. Cette migration ajoute le
-- rattachement, avec un backfill fondé sur une donnée déjà fiable.
--
-- Sémantique retenue (décision produit) : « admin » = administrateur de SON
-- entreprise (pas super-admin plateforme). Le créateur de chaque entreprise
-- (`entreprises.created_by`) est l'admin naturel ; tous les autres sont « user ».
--
-- ⚠️ Sécurité : cette migration attribue des droits. Après application, vérifier
--    que les bons utilisateurs sont admin (cf. requête de contrôle en fin).
--    L'attribution ultérieure du rôle (promotion/rétrogradation) reste à câbler
--    dans un écran d'administration — hors périmètre de cette migration.

-- 1. Colonne de rattachement.
ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);

-- 2. Backfill — tout le monde 'user' par défaut…
UPDATE utilisateurs u
SET role_id = (SELECT id FROM roles WHERE name = 'user')
WHERE u.role_id IS NULL;

-- 3. …puis 'admin' pour le créateur de chaque entreprise (son fondateur, donc
--    son administrateur naturel). `entreprises.created_by` référence auth.users,
--    dont l'id correspond à utilisateurs.id.
UPDATE utilisateurs u
SET role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE u.id IN (SELECT created_by FROM entreprises WHERE created_by IS NOT NULL);

-- 4. Défaut pour les nouveaux comptes : 'user'.
--    Postgres n'autorise pas de sous-requête dans un DEFAULT de colonne ; on
--    passe donc par un trigger BEFORE INSERT qui pose 'user' quand aucun rôle
--    n'est fourni. (L'attribution 'admin' se fait à la création d'entreprise ou
--    via un écran d'admin, comme referent_id.)
CREATE OR REPLACE FUNCTION fn_role_defaut()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role_id IS NULL THEN
    NEW.role_id := (SELECT id FROM roles WHERE name = 'user');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_role_defaut ON utilisateurs;
CREATE TRIGGER trg_role_defaut
  BEFORE INSERT ON utilisateurs
  FOR EACH ROW
  EXECUTE FUNCTION fn_role_defaut();

-- 5. Index pour les vérifications de rôle en RLS.
CREATE INDEX IF NOT EXISTS idx_utilisateurs_role ON utilisateurs (role_id);

-- ---------------------------------------------------------------
-- Helper : l'utilisateur courant est-il admin de son entreprise ?
-- Centralise le test pour les policies (évite de redupliquer la jointure).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION est_admin_entreprise()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM utilisateurs u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = auth.uid() AND r.name = 'admin'
  );
$$;

-- Vérification (à exécuter après migration) :
--   -- Combien d'admins, et qui :
--   SELECT u.email, r.name
--   FROM utilisateurs u JOIN roles r ON r.id = u.role_id
--   WHERE r.name = 'admin';
--   -- Doit correspondre aux référents d'entreprise.