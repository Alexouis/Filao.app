-- =============================================
-- FILAO: Migration 085 — Reprise d'une entreprise orpheline
-- =============================================
--
-- PROBLÈME
-- Une entreprise dont le dernier membre est parti reste en base : son SIRET est
-- pris, mais personne ne peut valider un rattachement. Un collègue voulant
-- reprendre le flambeau se retrouve dans une impasse.
--
-- POURQUOI ON NE PEUT PAS SIMPLEMENT SUPPRIMER L'ENTREPRISE
-- `groupements.entreprise_id` est déclarée ON DELETE CASCADE. Supprimer une
-- entreprise effacerait donc ses lignes de groupement dans les dossiers
-- D'AUTRES entreprises — le mandataire verrait un cotraitant disparaître de son
-- équipe sans explication, et les pièces déposées deviendraient orphelines.
-- C'est le même défaut que la cascade sur `reponses_ao` (migration 083), vu
-- depuis l'autre côté.
--
-- DEUX RÉPONSES, SELON LE CAS
--
--   a) Entreprise JAMAIS ENGAGÉE (aucun groupement, aucun dossier, aucune
--      pièce, aucun lien de réseau) : rien ne la retient, on la supprime. Son
--      SIRET redevient libre.
--
--   b) Entreprise ENGAGÉE : on la conserve — ses données sont référencées
--      ailleurs — et on émet une CLÉ DE REPRISE remise au dernier membre au
--      moment de son départ. Quiconque la présente devient administrateur de
--      l'entreprise. La clé prouve la continuité, ce qu'un simple SIRET ne fait
--      pas : n'importe qui peut saisir un SIRET trouvé en ligne.
--
-- ⚠️ DÉPEND des migrations 080, 083 et 084.

-- ---------------------------------------------------------------
-- 1. Clé de reprise
-- ---------------------------------------------------------------
-- Stockée hachée, comme les jetons d'invitation : la base ne contient jamais la
-- valeur en clair, qui n'existe que dans l'e-mail remis au partant.
ALTER TABLE entreprises
  ADD COLUMN IF NOT EXISTS cle_reprise_hash TEXT,
  ADD COLUMN IF NOT EXISTS cle_reprise_creee_le TIMESTAMPTZ;

COMMENT ON COLUMN entreprises.cle_reprise_hash IS
  'Empreinte SHA-256 de la clé permettant de reprendre une entreprise sans membre. Émise au départ du dernier membre.';

-- ---------------------------------------------------------------
-- 2. Suppression sûre d'une entreprise jamais engagée
-- ---------------------------------------------------------------
-- Renvoie TRUE si l'entreprise a été supprimée, FALSE si elle est engagée
-- quelque part et doit être conservée.
CREATE OR REPLACE FUNCTION supprimer_entreprise_si_inutilisee(p_entreprise UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_entreprise IS NULL THEN RETURN FALSE; END IF;

  -- Le moindre engagement suffit à la conserver : effacer une entreprise
  -- référencée ailleurs casserait les dossiers de tiers.
  IF EXISTS (SELECT 1 FROM groupements WHERE entreprise_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM documents_candidature WHERE entreprise_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM reseau_entreprises
                 WHERE entreprise_origine_id = p_entreprise
                    OR entreprise_cible_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM utilisateurs WHERE entreprise_id = p_entreprise)
  THEN
    RETURN FALSE;
  END IF;

  DELETE FROM entreprises WHERE id = p_entreprise;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION supprimer_entreprise_si_inutilisee(UUID) FROM PUBLIC, anon, authenticated;
-- Réservée à la service_role : appelée par `delete-account`, jamais par le client.

-- ---------------------------------------------------------------
-- 3. Reprise d'une entreprise par sa clé
-- ---------------------------------------------------------------
-- Renvoie 'reprise', ou un motif de refus. Aucun détail n'est donné sur la
-- raison exacte d'un échec : distinguer « clé inconnue » de « clé expirée »
-- permettrait de sonder les clés valides.
CREATE OR REPLACE FUNCTION reprendre_entreprise(p_cle TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprise UUID;
  v_deja       UUID;
BEGIN
  IF p_cle IS NULL OR length(p_cle) < 16 OR auth.uid() IS NULL THEN
    RETURN 'cle_invalide';
  END IF;

  -- Un utilisateur déjà rattaché n'a rien à reprendre.
  SELECT entreprise_id INTO v_deja FROM utilisateurs WHERE id = auth.uid();
  IF v_deja IS NOT NULL THEN
    RETURN 'deja_rattache';
  END IF;

  SELECT id INTO v_entreprise
    FROM entreprises
   WHERE cle_reprise_hash = encode(extensions.digest(p_cle, 'sha256'), 'hex')
     -- Ne vaut que tant que l'entreprise est effectivement sans membre : une
     -- clé ancienne ne doit pas donner accès à une entreprise repeuplée.
     AND sans_membre_depuis IS NOT NULL
   LIMIT 1;

  IF v_entreprise IS NULL THEN
    RETURN 'cle_invalide';
  END IF;

  -- Le repreneur devient administrateur : sans cela, l'entreprise resterait
  -- sans personne habilitée à valider les rattachements suivants.
  UPDATE utilisateurs
     SET entreprise_id = v_entreprise,
         role_id = (SELECT id FROM roles WHERE name = 'admin')
   WHERE id = auth.uid();

  -- Clé consommée : à usage unique.
  UPDATE entreprises
     SET cle_reprise_hash = NULL,
         cle_reprise_creee_le = NULL
   WHERE id = v_entreprise;

  RETURN 'reprise';
END;
$$;

GRANT EXECUTE ON FUNCTION reprendre_entreprise(TEXT) TO authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Entreprises orphelines disposant d'une clé de reprise :
--   select id, nom, sans_membre_depuis, (cle_reprise_hash is not null) AS cle_emise
--     from entreprises where sans_membre_depuis is not null;
--
--   -- Une entreprise orpheline SANS clé ne peut être reprise que par le
--   -- support : c'est le cas des entreprises devenues orphelines avant cette
--   -- migration.
