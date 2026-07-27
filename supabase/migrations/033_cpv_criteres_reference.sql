-- =============================================
-- FILAO: Migration 033 — CPV, critères d'attribution, référence marché
-- =============================================
--
-- Contexte : l'écran « Contexte / Détails de l'AO » affichait des critères
-- d'attribution codés en dur (50/40/10, identiques sur tous les AO) et aucun
-- code CPV. Cette migration crée le stockage manquant.
--
-- Idempotente : peut être rejouée sans effet de bord.

-- ---------------------------------------------------------------
-- 1. Codes CPV (Common Procurement Vocabulary)
-- ---------------------------------------------------------------
-- Nomenclature européenne obligatoire dans les avis de marché.
-- Stockés en text[] de codes à 8 chiffres, sans libellé : la nomenclature
-- complète (~9 500 entrées) fera l'objet d'une table de référence dédiée.
-- Le BOAMP publie plusieurs CPV par avis (marché + lots), d'où le tableau.

ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS cpv_codes TEXT[] NOT NULL DEFAULT '{}';

-- Garde-fou : uniquement des codes à 8 chiffres. Le BOAMP ne publie pas la
-- clé de contrôle, on ne peut donc pas la vérifier.
--
-- PostgreSQL interdit les sous-requêtes dans une contrainte CHECK. La
-- validation élément par élément passe donc par une fonction IMMUTABLE, qui
-- elle a le droit d'en contenir.
CREATE OR REPLACE FUNCTION filao_cpv_codes_valides(codes TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT codes IS NULL
      OR NOT EXISTS (SELECT 1 FROM unnest(codes) AS c WHERE c !~ '^[0-9]{8}$');
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reponses_ao_cpv_codes_format'
  ) THEN
    -- NOT VALID : la contrainte s'applique aux écritures futures sans exiger
    -- un scan complet de la table existante. À valider ensuite si besoin via
    --   ALTER TABLE reponses_ao VALIDATE CONSTRAINT reponses_ao_cpv_codes_format;
    ALTER TABLE reponses_ao
      ADD CONSTRAINT reponses_ao_cpv_codes_format
      CHECK (filao_cpv_codes_valides(cpv_codes))
      NOT VALID;
  END IF;
END $$;

-- Recherche par CPV (« tous les AO en 45xxxxxx ») : index GIN sur le tableau.
CREATE INDEX IF NOT EXISTS idx_reponses_ao_cpv_codes
  ON reponses_ao USING GIN (cpv_codes);

-- ---------------------------------------------------------------
-- 2. Critères d'attribution
-- ---------------------------------------------------------------
-- Le BOAMP publie quatre formes mutuellement exclusives, dont deux seulement
-- sont structurées. Un jsonb est donc préférable à des colonnes dédiées :
--
--   {
--     "kind": "ponderes" | "priorites" | "libre" | "cctp" | "absent",
--     "criteres": [ { "libelle": "Prix", "poids": 80, "ordre": 1 } ],
--     "texte": "…",                      -- formes libre / cctp
--     "poidsSontDesPourcentages": true,  -- faux si ce sont des coefficients
--     "source": "boamp" | "manuel"       -- traçabilité de la saisie
--   }
--
-- ⚠️ Les poids ne somment pas toujours à 100 : certains acheteurs publient des
-- coefficients (ex. 2/2/5/1). Aucune contrainte de somme n'est donc posée ici,
-- la normalisation est faite à l'affichage.

ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS criteres_attribution JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reponses_ao_criteres_attribution_kind'
  ) THEN
    ALTER TABLE reponses_ao
      ADD CONSTRAINT reponses_ao_criteres_attribution_kind
      CHECK (
        criteres_attribution IS NULL
        OR criteres_attribution->>'kind' IN ('ponderes','priorites','libre','cctp','absent')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 3. Référence du marché
-- ---------------------------------------------------------------
-- Référence attribuée par l'acheteur (ex. « AOO 15-02 »), publiée par le BOAMP
-- sous donnees.CONDITION_ADMINISTRATIVE.REFERENCE_MARCHE.
-- Jusqu'ici le panneau « Contexte » affichait l'UUID technique tronqué de la
-- réponse, ce qui n'a aucun sens pour l'utilisateur.

ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS reference_marche TEXT;

-- ---------------------------------------------------------------
-- 4. Documentation des colonnes
-- ---------------------------------------------------------------
COMMENT ON COLUMN reponses_ao.cpv_codes IS
  'Codes CPV à 8 chiffres (nomenclature UE). Alimenté depuis donnees.OBJET.CPV du BOAMP ou saisi manuellement.';
COMMENT ON COLUMN reponses_ao.criteres_attribution IS
  'Critères d''attribution et pondérations. Voir migration 033 pour la structure. Les poids peuvent être des coefficients, pas des pourcentages.';
COMMENT ON COLUMN reponses_ao.reference_marche IS
  'Référence du marché attribuée par l''acheteur. À ne pas confondre avec reponses_ao.id (UUID technique Filao).';

-- ---------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------
-- Aucune policy à ajouter : les nouvelles colonnes héritent des policies
-- existantes de reponses_ao (les policies PostgreSQL portent sur la ligne,
-- pas sur la colonne).