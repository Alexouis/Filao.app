-- =============================================
-- FILAO: Migration 064 — UTM d'acquisition
-- =============================================
--
-- CONTEXTE
-- La migration 045 a posé `source_inscription` (invitation | annuaire | landing
-- | referral | direct) et `source_detail`. Elle qualifie le CANAL, mais pas la
-- CAMPAGNE : une inscription venue d'un lien sponsorisé et une venue d'un lien
-- organique tombent toutes deux dans « landing », sans moyen de les distinguer.
--
-- Les paramètres UTM portent cette précision. Ils ne sont présents que sur
-- l'URL du premier contact et disparaissent à la moindre navigation ou à la
-- redirection OAuth : le front les capture au chargement et les fige en session
-- jusqu'à la création de compte (voir src/helpers/acquisitionHelpers.ts). Cette
-- migration crée seulement les colonnes de destination.
--
-- Colonnes nullables, sans contrainte de valeur : un UTM est une chaîne libre
-- fournie par la campagne, et une inscription ne doit jamais échouer parce
-- qu'un paramètre marketing a une forme inattendue.

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term     TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT;

COMMENT ON COLUMN utilisateurs.utm_source IS
  'UTM first-touch : plateforme d''origine (ex. linkedin, google). Null si organique.';
COMMENT ON COLUMN utilisateurs.utm_medium IS
  'UTM first-touch : canal (ex. cpc, email, social). Null si organique.';
COMMENT ON COLUMN utilisateurs.utm_campaign IS
  'UTM first-touch : nom de campagne. Null si organique.';
COMMENT ON COLUMN utilisateurs.utm_term IS
  'UTM first-touch : mot-clé (campagnes de recherche). Null si absent.';
COMMENT ON COLUMN utilisateurs.utm_content IS
  'UTM first-touch : variante créative / lien cliqué. Null si absent.';

-- Analyse d'acquisition : la campagne sera groupée, jamais filtrée par égalité
-- sur une valeur unique. Index partiel pour ne pas peser sur les lignes
-- organiques (utm_campaign NULL), largement majoritaires.
CREATE INDEX IF NOT EXISTS idx_utilisateurs_utm_campaign
  ON utilisateurs (utm_campaign) WHERE utm_campaign IS NOT NULL;
