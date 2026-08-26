-- =============================================
-- FILAO: Migration 082 — Doublons du journal de connexions
-- =============================================
--
-- PROBLÈME
-- « Connexions récentes » affiche chaque connexion en double : même appareil,
-- même adresse IP, même minute.
--
-- Origine : `React.StrictMode` monte, démonte puis remonte les composants en
-- développement. L'effet d'authentification s'exécute donc deux fois, avec deux
-- abonnements `onAuthStateChange` simultanés, et le même événement `SIGNED_IN`
-- déclenchait deux appels à `log-connexion`. La garde qui existait côté client
-- était déclarée À L'INTÉRIEUR de l'effet : elle était dupliquée avec lui et ne
-- protégeait donc rien.
--
-- Le correctif principal est côté application (garde au niveau du module). Cette
-- migration ajoute la protection côté base — le front n'est pas le seul appelant
-- possible — et nettoie l'historique déjà pollué.

-- ---------------------------------------------------------------
-- 1. Purge des doublons existants
-- ---------------------------------------------------------------
-- Deux lignes sont réputées identiques si elles concernent le même utilisateur,
-- le même appareil, la même IP, à moins de 30 secondes d'écart. On conserve la
-- plus ancienne de chaque groupe : c'est elle qui correspond à l'événement réel.
WITH classees AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY
        user_id,
        coalesce(appareil, ''),
        coalesce(ip, ''),
        -- Regroupement par tranche de 30 s.
        floor(extract(epoch FROM created_at) / 30)
      ORDER BY created_at
    ) AS rang
  FROM connexions
)
DELETE FROM connexions
 WHERE id IN (SELECT id FROM classees WHERE rang > 1);

-- ---------------------------------------------------------------
-- 2. Garde-fou : rejet des doublons à l'insertion
-- ---------------------------------------------------------------
-- Un index d'unicité ne convient pas ici : la clé porte sur une TRANCHE de
-- temps, qui n'est pas une valeur stable de la ligne. On passe donc par un
-- déclencheur, qui ignore silencieusement une insertion redondante plutôt que
-- de lever une erreur — journaliser une connexion ne doit jamais faire échouer
-- l'authentification.
CREATE OR REPLACE FUNCTION ignorer_connexion_doublon()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM connexions c
     WHERE c.user_id = NEW.user_id
       AND coalesce(c.appareil, '') = coalesce(NEW.appareil, '')
       AND coalesce(c.ip, '') = coalesce(NEW.ip, '')
       AND c.created_at > now() - INTERVAL '30 seconds'
  ) THEN
    RETURN NULL; -- insertion abandonnée, sans erreur
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_connexion_doublon ON connexions;
CREATE TRIGGER trg_connexion_doublon
  BEFORE INSERT ON connexions
  FOR EACH ROW EXECUTE FUNCTION ignorer_connexion_doublon();

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Plus aucun groupe de doublons :
--   select user_id, appareil, ip,
--          floor(extract(epoch from created_at) / 30) AS tranche,
--          count(*)
--     from connexions
--    group by 1, 2, 3, 4
--   having count(*) > 1;
--   -- attendu : aucune ligne.
