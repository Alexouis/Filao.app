-- =============================================
-- FILAO: Migration 051 — Contenu des forfaits en base
-- =============================================
--
-- CONTEXTE
-- Critère d'acceptation : « aucun quota ni libellé d'offre codé en dur — tout
-- vient de `plan_limits` ». Les quotas et tarifs y sont désormais (migration
-- 048), mais l'écran de comparatif lit encore la liste `PLANS` de
-- `src/config.ts` : nom commercial, descriptif, mise en avant, libellé du
-- bouton.
--
-- Conséquence concrète : le descriptif du forfait `partenaire` annonce « 1 AO
-- offert » alors que la table n'en autorise aucun. Une incohérence entre ce
-- qu'on vend et ce qu'on applique — exactement le motif que la recette avait
-- relevé sur le compteur.
--
-- Après cette migration, changer un tarif, un intitulé ou un argumentaire se
-- fait par un UPDATE, sans livraison.

ALTER TABLE plan_limits
  -- Nom commercial, distinct de `label` : `partenaire` s'affiche « Réseau ».
  ADD COLUMN IF NOT EXISTS nom_commercial TEXT,
  -- Tableau de chaînes, affiché en liste à puces.
  ADD COLUMN IF NOT EXISTS descriptif JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS populaire BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS libelle_action TEXT;

COMMENT ON COLUMN plan_limits.nom_commercial IS
  'Nom affiché au public. Distinct de `label`, utilisé en interne.';
COMMENT ON COLUMN plan_limits.descriptif IS
  'Arguments affichés en liste, tableau JSON de chaînes.';
COMMENT ON COLUMN plan_limits.populaire IS
  'Met en avant l''offre dans le comparatif. Une seule à la fois.';

-- ---------------------------------------------------------------
-- Reprise du contenu actuel
-- ---------------------------------------------------------------
-- Le descriptif de `partenaire` est corrigé au passage : il annonçait « 1 AO
-- offert » pour un forfait qui n'autorise aucun dossier porté.

UPDATE plan_limits SET
    nom_commercial = 'Réseau',
    populaire = FALSE,
    libelle_action = 'Votre plan actuel',
    descriptif = '["Rejoindre les dossiers auxquels vous êtes invité", "Déposer vos pièces et gérer votre coffre-fort", "Fiche entreprise et réseau", "1 utilisateur"]'::jsonb
 WHERE plan = 'partenaire';

UPDATE plan_limits SET
    nom_commercial = 'Solo',
    populaire = FALSE,
    libelle_action = 'Choisir Solo',
    descriptif = '["3 dossiers en cours simultanément", "Pilotage de groupement", "1 utilisateur interne", "Outils IA inclus"]'::jsonb
 WHERE plan = 'solo';

UPDATE plan_limits SET
    nom_commercial = 'Équipe',
    populaire = TRUE,
    libelle_action = 'Choisir Équipe',
    descriptif = '["10 dossiers en cours simultanément", "Pilotage de groupement", "Jusqu''à 5 utilisateurs internes", "Outils IA inclus", "Tableau de bord avancé"]'::jsonb
 WHERE plan = 'equipe';

UPDATE plan_limits SET
    nom_commercial = 'Organisation',
    populaire = FALSE,
    libelle_action = 'Contactez-nous',
    descriptif = '["Dossiers illimités", "Utilisateurs illimités", "Support dédié", "Fonctionnalités sur mesure"]'::jsonb
 WHERE plan = 'organisation';

-- Repli : une offre ajoutée plus tard sans contenu reste affichable.
UPDATE plan_limits SET nom_commercial = COALESCE(nom_commercial, label, plan)
 WHERE nom_commercial IS NULL;

-- ---------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------
--   select plan, nom_commercial, populaire, libelle_action,
--          jsonb_array_length(descriptif) as arguments
--     from plan_limits order by ordre;
--
-- ⚠️ Une seule offre doit porter `populaire = true` : deux mises en avant
--    simultanées se neutralisent visuellement. Aucune contrainte ne l'impose,
--    c'est un choix éditorial.