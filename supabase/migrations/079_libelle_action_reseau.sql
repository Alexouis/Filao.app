-- =============================================
-- FILAO: Migration 079 — Libellé d'action du forfait Réseau
-- =============================================
--
-- PROBLÈME
-- Sur l'écran des forfaits, deux cartes portaient simultanément la mention du
-- plan courant : celle du forfait réellement souscrit, et celle du forfait
-- « partenaire » (Réseau).
--
-- L'affichage n'est pas en cause : le front donne déjà la priorité au plan
-- courant (`isCurrentPlan`) et n'utilise `libelle_action` que pour les AUTRES
-- forfaits. C'est la donnée qui est fautive — `plan_limits.partenaire.libelle_action`
-- contient littéralement la chaîne « Votre plan actuel », qui s'affiche donc sur
-- la carte Réseau quel que soit le forfait de l'utilisateur.
--
-- Un libellé d'action doit décrire l'action proposée, jamais un état.

UPDATE plan_limits
   SET libelle_action = 'Choisir Réseau'
 WHERE plan = 'partenaire'
   AND libelle_action ILIKE '%plan actuel%';

-- ---------------------------------------------------------------
-- Contrôle : aucun libellé d'action ne doit décrire un état
-- ---------------------------------------------------------------
-- Le même défaut peut exister sur d'autres lignes. Cette requête les liste ;
-- toute ligne renvoyée est à corriger par un verbe d'action.
--
--   select plan, libelle_action
--     from plan_limits
--    where libelle_action ILIKE '%actuel%'
--       or libelle_action ILIKE '%votre plan%';
--
-- Attendu : aucune ligne.
--
--   select plan, libelle_action from plan_limits order by ordre;
--   -- chaque libellé doit être une action : « Choisir … », « Demander un devis »…
