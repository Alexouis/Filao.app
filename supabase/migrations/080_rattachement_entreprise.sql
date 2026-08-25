-- =============================================
-- FILAO: Migration 080 — Rattachement d'un collaborateur à une entreprise
-- =============================================
--
-- PROBLÈME
-- Les forfaits vendent « jusqu'à 5 utilisateurs internes » (`max_utilisateurs`
-- vaut 1, 5 ou illimité selon le plan), mais rien ne permet à un second
-- collaborateur de rejoindre une entreprise déjà inscrite. `entreprises.siret`
-- porte une contrainte UNIQUE : l'onboarding tente une insertion et l'utilisateur
-- reçoit une erreur de base de données brute, sans aucune issue.
--
-- RÈGLES RETENUES
--   - La demande est validée par un ADMINISTRATEUR de l'entreprise
--     (`utilisateurs.role_id` -> `roles.name = 'admin'`, modele de la migration 062).
--   - Si le quota d'utilisateurs du plan est ATTEINT, la demande est refusée
--     avec un motif explicite : on bloque plutôt que de laisser le quota
--     devenir décoratif.
--   - Une entreprise conserve TOUJOURS au moins un administrateur.

-- ---------------------------------------------------------------
-- 1. Demandes de rattachement
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demandes_rattachement (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id  UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  statut         TEXT NOT NULL DEFAULT 'en_attente'
                 CHECK (statut IN ('en_attente', 'acceptee', 'refusee')),
  motif_refus    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  traite_le      TIMESTAMPTZ,
  traite_par     UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  -- Une seule demande en cours par couple : un utilisateur qui insiste ne crée
  -- pas dix lignes à traiter.
  UNIQUE (entreprise_id, utilisateur_id)
);

CREATE INDEX IF NOT EXISTS idx_demandes_rattachement_entreprise
  ON demandes_rattachement (entreprise_id) WHERE statut = 'en_attente';

ALTER TABLE demandes_rattachement ENABLE ROW LEVEL SECURITY;

-- Le demandeur suit sa demande ; les administrateurs de l'entreprise voient
-- celles qui les concernent.
DROP POLICY IF EXISTS "demandes_rattachement_select" ON demandes_rattachement;
CREATE POLICY "demandes_rattachement_select"
  ON demandes_rattachement FOR SELECT TO authenticated
  USING (
    utilisateur_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM utilisateurs u
        JOIN roles r ON r.id = u.role_id
       WHERE u.id = auth.uid()
         AND u.entreprise_id = demandes_rattachement.entreprise_id
         AND r.name = 'admin'
    )
  );

-- L'écriture passe exclusivement par les fonctions ci-dessous : aucune policy
-- d'insertion ou de mise à jour n'est accordée au client.

COMMENT ON TABLE demandes_rattachement IS
  'Demandes d''un utilisateur pour rejoindre une entreprise déjà inscrite. Validées par un administrateur de cette entreprise.';

-- ---------------------------------------------------------------
-- 2. Places restantes selon le forfait
-- ---------------------------------------------------------------
-- NULL = illimité. Renvoie le nombre de sièges encore disponibles, ou NULL si
-- le plan n'impose pas de limite.
CREATE OR REPLACE FUNCTION places_restantes_entreprise(p_entreprise UUID)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max     INTEGER;
  v_actuels INTEGER;
BEGIN
  SELECT pl.max_utilisateurs INTO v_max
    FROM entreprises e
    JOIN plan_limits pl ON pl.plan = COALESCE(e.plan, 'partenaire')
   WHERE e.id = p_entreprise;

  IF v_max IS NULL THEN
    RETURN NULL; -- illimité
  END IF;

  SELECT count(*) INTO v_actuels
    FROM utilisateurs WHERE entreprise_id = p_entreprise;

  RETURN GREATEST(0, v_max - v_actuels);
END;
$$;

GRANT EXECUTE ON FUNCTION places_restantes_entreprise(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 3. Déposer une demande
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION demander_rattachement(p_entreprise UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deja UUID;
BEGIN
  IF p_entreprise IS NULL OR auth.uid() IS NULL THEN
    RETURN 'erreur';
  END IF;

  -- Un utilisateur déjà rattaché n'a rien à demander.
  SELECT entreprise_id INTO v_deja FROM utilisateurs WHERE id = auth.uid();
  IF v_deja IS NOT NULL THEN
    RETURN 'deja_rattache';
  END IF;

  INSERT INTO demandes_rattachement (entreprise_id, utilisateur_id)
       VALUES (p_entreprise, auth.uid())
  ON CONFLICT (entreprise_id, utilisateur_id) DO UPDATE
      -- Une demande refusée peut être renouvelée (le quota a pu se libérer).
      SET statut = 'en_attente', motif_refus = NULL, created_at = now()
      WHERE demandes_rattachement.statut = 'refusee';

  RETURN 'en_attente';
END;
$$;

GRANT EXECUTE ON FUNCTION demander_rattachement(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Traiter une demande (administrateur)
-- ---------------------------------------------------------------
-- Renvoie 'acceptee', 'refusee', 'quota_atteint' ou 'non_autorise'.
CREATE OR REPLACE FUNCTION traiter_demande_rattachement(
  p_demande  UUID,
  p_accepter BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_demande demandes_rattachement%ROWTYPE;
  v_places  INTEGER;
BEGIN
  SELECT * INTO v_demande FROM demandes_rattachement WHERE id = p_demande;
  IF NOT FOUND OR v_demande.statut <> 'en_attente' THEN
    RETURN 'non_autorise';
  END IF;

  -- Seul un administrateur de CETTE entreprise décide.
  IF NOT EXISTS (
    SELECT 1 FROM utilisateurs u
      JOIN roles r ON r.id = u.role_id
     WHERE u.id = auth.uid()
       AND u.entreprise_id = v_demande.entreprise_id
       AND r.name = 'admin'
  ) THEN
    RETURN 'non_autorise';
  END IF;

  IF NOT p_accepter THEN
    UPDATE demandes_rattachement
       SET statut = 'refusee', traite_le = now(), traite_par = auth.uid()
     WHERE id = p_demande;
    RETURN 'refusee';
  END IF;

  -- Quota : on bloque plutôt que d'accepter un dépassement silencieux.
  v_places := places_restantes_entreprise(v_demande.entreprise_id);
  IF v_places IS NOT NULL AND v_places <= 0 THEN
    UPDATE demandes_rattachement
       SET statut = 'refusee',
           motif_refus = 'quota_atteint',
           traite_le = now(),
           traite_par = auth.uid()
     WHERE id = p_demande;
    RETURN 'quota_atteint';
  END IF;

  -- Rattachement effectif, au rôle « membre » : seul un admin existant peut
  -- élever quelqu'un ensuite.
  UPDATE utilisateurs
     SET entreprise_id = v_demande.entreprise_id,
         role_id = (SELECT id FROM roles WHERE name = 'user')
   WHERE id = v_demande.utilisateur_id;

  UPDATE demandes_rattachement
     SET statut = 'acceptee', traite_le = now(), traite_par = auth.uid()
   WHERE id = p_demande;

  RETURN 'acceptee';
END;
$$;

GRANT EXECUTE ON FUNCTION traiter_demande_rattachement(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------
-- 5. Une entreprise garde toujours un administrateur
-- ---------------------------------------------------------------
-- Le rôle est porté par `utilisateurs.role_id` vers la table `roles`
-- (migration 062) : « admin » y désigne l'administrateur de SON entreprise.
--
-- Règle retenue : si le dernier administrateur s'en va et qu'il ne reste qu'un
-- seul membre, celui-ci est promu automatiquement. S'il en reste plusieurs, la
-- succession doit être explicite — on refuse alors le départ, l'application
-- devant demander à qui léguer le rôle.
CREATE OR REPLACE FUNCTION garantir_admin_entreprise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprise UUID;
  v_id_admin   UUID;
  v_admins     INTEGER;
  v_membres    INTEGER;
  v_seul       UUID;
BEGIN
  v_entreprise := OLD.entreprise_id;
  IF v_entreprise IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id INTO v_id_admin FROM roles WHERE name = 'admin';

  -- L'ancienne ligne était-elle administratrice ? Sinon, rien à garantir.
  IF OLD.role_id IS DISTINCT FROM v_id_admin THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Reste-t-elle administratrice de la même entreprise ? (simple mise à jour
  -- d'un autre champ) — dans ce cas non plus, rien à faire.
  IF TG_OP = 'UPDATE'
     AND NEW.role_id IS NOT DISTINCT FROM v_id_admin
     AND NEW.entreprise_id IS NOT DISTINCT FROM v_entreprise THEN
    RETURN NEW;
  END IF;

  SELECT count(*) FILTER (WHERE u.role_id = v_id_admin), count(*)
    INTO v_admins, v_membres
    FROM utilisateurs u
   WHERE u.entreprise_id = v_entreprise
     AND u.id <> OLD.id;

  IF v_admins > 0 OR v_membres = 0 THEN
    -- Il reste un administrateur, ou plus personne : rien à garantir.
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_membres = 1 THEN
    SELECT u.id INTO v_seul
      FROM utilisateurs u
     WHERE u.entreprise_id = v_entreprise AND u.id <> OLD.id;
    UPDATE utilisateurs SET role_id = v_id_admin WHERE id = v_seul;
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'Designez un autre administrateur avant de quitter ce role : % membres sont rattaches a cette entreprise.',
    v_membres
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_garantir_admin ON utilisateurs;
CREATE TRIGGER trg_garantir_admin
  AFTER UPDATE OF role_id, entreprise_id OR DELETE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION garantir_admin_entreprise();

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select places_restantes_entreprise('<entreprise>');  -- NULL = illimité
--   select demander_rattachement('<entreprise>');        -- 'en_attente'
--   select traiter_demande_rattachement('<demande>', true);
--   -- 'acceptee' ou 'quota_atteint' selon le forfait
--
--   -- Aucune entreprise ne doit se retrouver sans administrateur :
--   select e.id, e.nom from entreprises e
--    where exists (select 1 from utilisateurs u where u.entreprise_id = e.id)
--      and not exists (select 1 from utilisateurs u
--                       join roles r on r.id = u.role_id
--                       where u.entreprise_id = e.id and r.name = 'admin');
--   -- attendu : aucune ligne.
