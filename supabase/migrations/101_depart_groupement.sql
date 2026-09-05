-- ============================================================================
-- 101 — Un partenaire peut quitter un groupement
-- ============================================================================
--
-- LE PROBLÈME
-- L'écran d'un dossier propose à un cotraitant accepté de « quitter le
-- groupement ». Le code supprime alors sa ligne dans `groupements`. Mais la
-- policy posée en 068 réserve la suppression au mandataire :
--
--     groupements_delete_mandataire  USING (app.est_mandataire(projet_id))
--
-- Un partenaire qui part est donc refusé. Et le refus est SILENCIEUX : une
-- suppression bloquée par RLS ne lève aucune erreur, elle supprime zéro ligne.
-- L'application affichait « Vous avez quitté le groupement. », redirigeait, et
-- le partenaire réapparaissait au rechargement suivant.
--
-- CE QUE CETTE MIGRATION CHANGE
-- La suppression devient possible pour DEUX acteurs, et deux seulement :
--   - le mandataire, qui retire un partenaire de son dossier (inchangé) ;
--   - un membre de l'entreprise concernée, qui retire SA PROPRE ligne.
--
-- On conserve la convention de la 068 — une seule policy par table et par
-- verbe — en remplaçant la policy existante plutôt qu'en en ajoutant une
-- seconde, ce qui rendrait la lecture des droits plus difficile.
--
-- POURQUOI PAS UN STATUT « retire »
-- L'énumération applicative prévoit bien un statut `retire`, sémantiquement
-- plus riche qu'une suppression. Mais l'UPDATE reste réservé au mandataire, et
-- l'ouvrir laisserait un partenaire modifier aussi son propre rôle_groupement
-- (se promouvoir mandataire, par exemple). La suppression est ici le geste le
-- plus étroit : elle ne permet que de partir.
--
-- CE QUI N'EST PAS OUVERT
-- `app.entreprise_courante()` borne l'action à la ligne de sa propre
-- entreprise : un partenaire ne peut pas retirer un autre cotraitant, ni
-- toucher un dossier auquel il n'appartient pas.
-- ============================================================================

DROP POLICY IF EXISTS "groupements_delete_mandataire" ON groupements;

CREATE POLICY "groupements_delete_mandataire_ou_soi"
  ON groupements FOR DELETE TO authenticated
  USING (
    -- Le mandataire retire un partenaire de son dossier.
    app.est_mandataire(projet_id)
    -- Ou un partenaire quitte le dossier de son propre chef.
    OR entreprise_id = app.entreprise_courante()
  );

COMMENT ON POLICY "groupements_delete_mandataire_ou_soi" ON groupements IS
  'Suppression d''une ligne de groupement : par le mandataire du dossier, ou par un membre de l''entreprise concernée qui quitte le groupement.';

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Une seule policy DELETE sur la table :
--
--   select policyname, cmd, qual
--     from pg_policies
--    where tablename = 'groupements' and cmd = 'DELETE';
--
-- En tant que cotraitant accepté, sur SON dossier :
--   delete from groupements where id = '<ma ligne>';
--   -- attendu : 1 ligne supprimée
--
-- En tant que cotraitant, sur la ligne d'un AUTRE cotraitant :
--   delete from groupements where id = '<ligne d''un tiers>';
--   -- attendu : 0 ligne supprimée
