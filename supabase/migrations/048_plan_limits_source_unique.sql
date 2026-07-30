-- =============================================
-- FILAO: Migration 048 — plan_limits, source unique des forfaits
-- =============================================
--
-- CONTEXTE
-- La table `plan_limits` existe en base mais dans aucune migration : elle n'est
-- pas versionnée, et le dépôt ne permet donc pas de savoir ce qu'elle contient.
-- C'est le septième écart de ce type relevé sur ce projet.
--
-- Elle est de surcroît doublée par `PLANS_CONFIG` dans `src/config.ts`, avec un
-- désaccord : `partenaire` autorise 1 dossier côté front et 0 côté base. C'est
-- l'écart que la recette a relevé — le front affichait « 1/1 » pour un forfait
-- qui, en base, n'autorise aucun dossier porté.
--
-- Cette migration fait de la table la source unique, et complète le schéma pour
-- que plus aucune valeur d'affichage ni de tarif n'ait à vivre dans le code.

-- ---------------------------------------------------------------
-- 1. Colonnes manquantes
-- ---------------------------------------------------------------
ALTER TABLE plan_limits
  -- Tarifs en centimes : les flottants sur de la monnaie finissent par produire
  -- des écarts d'arrondi, et Stripe raisonne déjà en centimes.
  ADD COLUMN IF NOT EXISTS prix_mensuel_ht INTEGER,
  ADD COLUMN IF NOT EXISTS prix_annuel_ht INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_price_id_mensuel TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id_annuel TEXT,
  -- Drapeaux de fonctionnalités, pour éviter une colonne par option.
  ADD COLUMN IF NOT EXISTS fonctionnalites JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ordre SMALLINT,
  ADD COLUMN IF NOT EXISTS max_stockage_octets BIGINT,
  -- Distingue « gratuit » de « sur devis » : `organisation` est aujourd'hui à
  -- 0 €, ce qui l'affiche comme un forfait illimité offert.
  ADD COLUMN IF NOT EXISTS sur_devis BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT TRUE;

-- `NULL` doit pouvoir signifier « illimité ». Les deux colonnes étaient en
-- NOT NULL, ce qui obligeait à une valeur sentinelle — 9999 — comparée ensuite
-- comme un nombre réel partout où elle passe.
ALTER TABLE plan_limits ALTER COLUMN max_ao_simultanes DROP NOT NULL;
ALTER TABLE plan_limits ALTER COLUMN max_utilisateurs  DROP NOT NULL;

COMMENT ON COLUMN plan_limits.max_ao_simultanes IS
  'Dossiers portés simultanément (mandataire, statut En cours). NULL = illimité. 0 = ne peut pas porter de dossier.';
COMMENT ON COLUMN plan_limits.prix_mensuel_ht IS
  'Prix mensuel HT en centimes. NULL avec sur_devis = true pour une offre négociée.';
COMMENT ON COLUMN plan_limits.sur_devis IS
  'Offre négociée : le tarif ne s''affiche pas, un contact commercial le remplace.';

-- ---------------------------------------------------------------
-- 2. Reprise des tarifs existants
-- ---------------------------------------------------------------
-- `prix_mensuel` est en euros ; les nouvelles colonnes sont en centimes.
UPDATE plan_limits
   SET prix_mensuel_ht = (prix_mensuel * 100)::INTEGER
 WHERE prix_mensuel_ht IS NULL AND prix_mensuel IS NOT NULL AND prix_mensuel > 0;

-- Deux mois offerts en annuel, conformément à la conception.
UPDATE plan_limits
   SET prix_annuel_ht = (prix_mensuel_ht * 10)
 WHERE prix_annuel_ht IS NULL AND prix_mensuel_ht IS NOT NULL AND prix_mensuel_ht > 0;

-- ---------------------------------------------------------------
-- 3. Cohérence des lignes
-- ---------------------------------------------------------------
-- `organisation` porte 9999 dossiers pour 0 € : en l'état, c'est un forfait
-- illimité gratuit. L'intention étant manifestement une offre négociée, on la
-- marque comme telle plutôt que de laisser un tarif nul s'afficher.
UPDATE plan_limits
   SET sur_devis = TRUE,
       prix_mensuel_ht = NULL,
       prix_annuel_ht = NULL,
       -- NULL plutôt que 9999 : une valeur sentinelle finit toujours par être
       -- comparée comme un nombre réel quelque part.
       max_ao_simultanes = NULL,
       max_utilisateurs = NULL
 WHERE plan = 'organisation';

-- Ordre d'affichage du comparatif.
UPDATE plan_limits SET ordre = CASE plan
    WHEN 'partenaire'   THEN 0
    WHEN 'solo'         THEN 1
    WHEN 'equipe'       THEN 2
    WHEN 'organisation' THEN 3
    ELSE 9 END
 WHERE ordre IS NULL;

-- Volumes de stockage, jusqu'ici uniquement dans `config.ts`.
UPDATE plan_limits SET max_stockage_octets = CASE plan
    WHEN 'partenaire'   THEN 536870912          -- 0,5 Go
    WHEN 'solo'         THEN 5368709120         -- 5 Go
    WHEN 'equipe'       THEN 21474836480        -- 20 Go
    ELSE NULL END                               -- illimité
 WHERE max_stockage_octets IS NULL;

-- Drapeaux de fonctionnalités. `partenaire` ne porte aucun dossier : il rejoint
-- ceux des autres et dépose ses pièces, ce qui reste entièrement gratuit.
UPDATE plan_limits SET fonctionnalites = CASE plan
    WHEN 'partenaire'   THEN '{"ia": false, "veille": false, "reseau": true,  "analytics": false, "multi_utilisateurs": false}'::jsonb
    WHEN 'solo'         THEN '{"ia": true,  "veille": true,  "reseau": true,  "analytics": false, "multi_utilisateurs": false}'::jsonb
    WHEN 'equipe'       THEN '{"ia": true,  "veille": true,  "reseau": true,  "analytics": true,  "multi_utilisateurs": true}'::jsonb
    WHEN 'organisation' THEN '{"ia": true,  "veille": true,  "reseau": true,  "analytics": true,  "multi_utilisateurs": true}'::jsonb
    ELSE '{}'::jsonb END
 WHERE fonctionnalites = '{}'::jsonb;

-- ---------------------------------------------------------------
-- 4. Lecture par le front
-- ---------------------------------------------------------------
-- La grille tarifaire n'a rien de confidentiel : elle est publique sur le site.
-- Les identifiants Stripe, en revanche, n'ont pas à sortir — ils sont utilisés
-- côté serveur uniquement.

ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture des forfaits" ON plan_limits;
CREATE POLICY "Lecture des forfaits"
ON plan_limits FOR SELECT TO anon, authenticated
USING (actif);

-- ---------------------------------------------------------------
-- 5. Vérification
-- ---------------------------------------------------------------
--   select plan, label, max_ao_simultanes, prix_mensuel_ht, sur_devis, ordre
--     from plan_limits order by ordre;
--
-- Attendu : `partenaire` à 0 dossier, `organisation` en sur_devis avec
-- max_ao_simultanes à NULL.
--
-- ⚠️ La grille de la conception — Découverte, Essentiel, Pro — n'est PAS
--    introduite ici : elle reste à arbitrer. Cette migration rend la table
--    exploitable et cohérente avec les forfaits actuellement en place. Le
--    changement de taxonomie se fera par un simple jeu d'INSERT/UPDATE, sans
--    toucher au code, ce qui est précisément l'objet de la manœuvre.