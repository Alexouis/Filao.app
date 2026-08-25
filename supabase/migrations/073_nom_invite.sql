-- =============================================
-- FILAO: Migration 073 — Nom du partenaire invité
-- =============================================
--
-- PROBLÈME
-- Le bloc « Partenaire recherché » demande explicitement un « Nom du partenaire »
-- (champ obligatoire), mais cette saisie n'était persistée nulle part : la table
-- `invitations` ne porte que `entreprise_nom`, destiné à une entreprise déjà
-- référencée, jamais au contact invité par simple adresse e-mail.
--
-- À l'affichage, l'équipe retombait donc sur `email.split('@')[0]` — la partie
-- locale de l'adresse. Un partenaire saisi comme « QA Partenaire Recette »
-- apparaissait sous « po.bidard ».
--
-- CORRECTIF
-- Une colonne dédiée conserve le nom saisi par le mandataire. Il sert de libellé
-- d'attente : dès que l'invité crée son compte et renseigne sa fiche, c'est son
-- profil réel qui prend le relais à l'affichage.

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS nom_invite TEXT;

COMMENT ON COLUMN invitations.nom_invite IS
  'Nom du partenaire saisi par le mandataire à la création de l''invitation. Libellé d''attente, affiché tant que l''invité n''a pas renseigné sa propre fiche.';

-- Reprise des invitations existantes : on ne peut pas retrouver le nom saisi,
-- perdu à l'époque. La colonne reste NULL et l'affichage conserve son repli sur
-- la partie locale de l'adresse pour ces lignes-là.
