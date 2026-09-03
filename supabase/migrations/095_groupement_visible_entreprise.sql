-- =============================================
-- FILAO: Migration 095 — Composition du groupement visible dans l'entreprise
-- =============================================
--
-- BESOIN
-- La 092 a ouvert l'EXISTENCE des dossiers à toute l'entreprise, mais rien de
-- plus. Un membre qui ouvre la fiche d'un dossier porté par un collègue n'y
-- trouve que l'en-tête : intitulé, acheteur, échéance, statut, montant. Savoir
-- AVEC QUI on candidate manque à l'usage visé — le suivi de pipeline par une
-- personne qui n'est pas sur le dossier.
--
-- RÈGLE RETENUE
-- La composition du groupement est lisible par les membres de l'entreprise
-- porteuse. Ce sont des entreprises partenaires et leur rôle dans le
-- groupement : pas des prix, pas des échanges, pas des pièces.
--
-- CE QUE CELA N'OUVRE PAS
-- Les profils des salariés des entreprises partenaires. La requête client joint
-- `entreprises.membres`, mais `utilisateurs_select_soi` (migration 070) limite
-- la lecture de `utilisateurs` à soi-même : la jointure revient vide. Les noms
-- affichables passent par la vue `utilisateurs_publics`, dont le périmètre est
-- inchangé ici.
--
-- Les commentaires, la messagerie et les pièces restent fermés au membre
-- ordinaire (092, 094). Seul l'administrateur y accède.
--
-- ⚠️ DÉPEND des migrations 070, 074, 092 et 094.

DROP POLICY IF EXISTS "groupements_select_convie_ou_admin" ON groupements;
DROP POLICY IF EXISTS "groupements_select_convie_ou_entreprise" ON groupements;
CREATE POLICY "groupements_select_convie_ou_entreprise"
  ON groupements FOR SELECT TO authenticated
  USING (
    app.est_convie(projet_id)
    -- Conservé de la 094 : l'administrateur lit les groupements de ses dossiers
    -- même quand il n'y participe pas.
    OR app.peut_ecrire_dossier(projet_id)
    -- Nouveau : tout membre de l'entreprise porteuse.
    OR app.voit_dossier_entreprise(projet_id)
  );

-- L'ÉCRITURE est inchangée : inviter ou retirer un cotraitant engage des tiers
-- et reste au mandataire (`groupements_insert/update/delete_mandataire`,
-- migration 068). On n'ouvre ici que la lecture.

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- MEMBRE ordinaire de l'entreprise porteuse, sur un dossier d'un collègue :
--   select count(*) from groupements   where projet_id = '<dossier>';  -- > 0
--   select count(*) from comments      where tender_id = '<dossier>';  -- 0
--   select count(*) from chat_messages where tender_id = '<dossier>';  -- 0
--   select count(*) from utilisateurs;                                 -- 1 (soi)
--   insert into groupements (projet_id, entreprise_id) values (...);   -- refusé
--
-- Membre d'une AUTRE entreprise, non conviée : 0 ligne.
