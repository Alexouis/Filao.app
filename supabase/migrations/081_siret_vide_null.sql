-- =============================================
-- FILAO: Migration 081 — SIRET vide : NULL plutôt que chaîne vide
-- =============================================
--
-- PROBLÈME
-- `entreprises.siret` porte une contrainte UNIQUE. PostgreSQL autorise plusieurs
-- NULL sous une telle contrainte — deux valeurs inconnues ne sont pas réputées
-- égales — mais deux CHAÎNES VIDES entrent en collision.
--
-- Le front envoyait `siret: ''` pour une entreprise créée sans SIRET. La
-- première passait ; toutes les suivantes échouaient sur
-- `duplicate key value violates unique constraint "entreprises_siret_key"`,
-- message SQL affiché tel quel à l'utilisateur.
--
-- Autrement dit : dès qu'UNE entreprise portait la chaîne vide, plus personne ne
-- pouvait créer d'entreprise sans SIRET.
--
-- CORRECTIF EN DEUX TEMPS
--   1. Reprise des lignes existantes : chaîne vide (ou espaces) -> NULL.
--   2. Contrainte empêchant la réintroduction du défaut, quelle que soit
--      l'origine de l'écriture — le correctif côté front ne protège pas des
--      imports, scripts ou futurs appels.
--
-- Le même raisonnement vaut pour tout champ texte optionnel sous contrainte
-- d'unicité ; `siret` est aujourd'hui le seul concerné dans cette table.

-- ---------------------------------------------------------------
-- 1. Reprise des données
-- ---------------------------------------------------------------
UPDATE entreprises
   SET siret = NULL
 WHERE siret IS NOT NULL
   AND trim(siret) = '';

-- ---------------------------------------------------------------
-- 2. Garde-fou
-- ---------------------------------------------------------------
-- Un SIRET est soit absent (NULL), soit renseigné : jamais une chaîne vide ni
-- une suite d'espaces.
ALTER TABLE entreprises
  DROP CONSTRAINT IF EXISTS entreprises_siret_non_vide;

ALTER TABLE entreprises
  ADD CONSTRAINT entreprises_siret_non_vide
  CHECK (siret IS NULL OR length(trim(siret)) > 0);

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select count(*) from entreprises where siret = '';
--   -- attendu : 0
--
--   -- La création de plusieurs entreprises sans SIRET doit désormais passer :
--   -- deux lignes à siret NULL ne violent pas la contrainte d'unicité.
--   select count(*) from entreprises where siret is null;
--
--   -- Et la chaîne vide doit être refusée :
--   -- insert into entreprises (nom, siret) values ('Test', '');
--   -- attendu : ERROR ... violates check constraint "entreprises_siret_non_vide"
