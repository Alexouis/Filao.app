-- =============================================
-- FILAO: Migration 108 — Émission de la clé de reprise
-- =============================================
--
-- PROBLÈME
-- La 085 a prévu la clé de reprise d'une entreprise orpheline : colonne
-- `cle_reprise_hash`, fonction `reprendre_entreprise`, affichage dans
-- Paramètres > Sécurité. Mais la fonction qui ÉMET la clé,
-- `generer_cle_reprise`, appelée par `delete-account`, n'a jamais été créée.
-- L'appel échouait (erreur seulement journalisée), aucune clé n'était remise
-- au dernier membre, et une entreprise engagée devenait orpheline sans aucun
-- moyen d'en reprendre la main : SIRET bloqué, rattachements impossibles.
--
-- ⚠️ DÉPEND de la migration 085 (et de pgcrypto dans le schéma `extensions`).

CREATE OR REPLACE FUNCTION generer_cle_reprise(p_entreprise UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cle TEXT;
BEGIN
  IF p_entreprise IS NULL THEN
    RETURN NULL;
  END IF;

  -- 128 bits d'aléa, en hexadécimal minuscule : 32 caractères, sans
  -- ambiguïté de lecture (pas de O/0, l/1 mélangés à des lettres capitales).
  v_cle := encode(extensions.gen_random_bytes(16), 'hex');

  UPDATE entreprises
     SET cle_reprise_hash     = encode(extensions.digest(v_cle, 'sha256'), 'hex'),
         cle_reprise_creee_le = now()
   WHERE id = p_entreprise;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- La valeur en clair ne sort qu'ici, vers `delete-account`, qui la remet
  -- une seule fois au partant. La base n'en garde que l'empreinte.
  RETURN v_cle;
END;
$$;

-- Réservée au serveur : un utilisateur ne doit pas pouvoir régénérer la clé
-- d'une entreprise (et invalider celle remise au partant).
REVOKE ALL ON FUNCTION generer_cle_reprise(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION generer_cle_reprise(UUID) TO service_role;

-- ---------------------------------------------------------------
-- Saisie tolérante
-- ---------------------------------------------------------------
-- Reprise de `reprendre_entreprise` (085) à un détail près : la clé est
-- normalisée (espaces, casse) avant comparaison. Recopiée à la main depuis un
-- e-mail ou une note, elle échouait sur une majuscule ou un espace final.
CREATE OR REPLACE FUNCTION reprendre_entreprise(p_cle TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprise UUID;
  v_deja       UUID;
  v_cle        TEXT := lower(btrim(coalesce(p_cle, '')));
BEGIN
  IF length(v_cle) < 16 OR auth.uid() IS NULL THEN
    RETURN 'cle_invalide';
  END IF;

  SELECT entreprise_id INTO v_deja FROM utilisateurs WHERE id = auth.uid();
  IF v_deja IS NOT NULL THEN
    RETURN 'deja_rattache';
  END IF;

  SELECT id INTO v_entreprise
    FROM entreprises
   WHERE cle_reprise_hash = encode(extensions.digest(v_cle, 'sha256'), 'hex')
     AND sans_membre_depuis IS NOT NULL
   LIMIT 1;

  IF v_entreprise IS NULL THEN
    RETURN 'cle_invalide';
  END IF;

  UPDATE utilisateurs
     SET entreprise_id = v_entreprise,
         role_id = (SELECT id FROM roles WHERE name = 'admin')
   WHERE id = auth.uid();

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
-- Entreprises orphelines SANS clé (touchées par le bug) :
--   select id, nom, sans_membre_depuis from entreprises
--    where sans_membre_depuis is not null and cle_reprise_hash is null;
-- Pour elles, une clé peut être émise à la main et transmise au demandeur
-- légitime après vérification :
--   select generer_cle_reprise('<entreprise>');
