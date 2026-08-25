-- =============================================
-- FILAO: Migration 077 — Activation des liens de réseau en attente
-- =============================================
--
-- PROBLÈME
-- `relier_entreprises` insère les deux lignes symétriques du lien de réseau avec
-- `ON CONFLICT DO NOTHING`. Or une ligne existe souvent déjà : `send-network-invite`
-- en crée une au statut `en_attente` dès l'envoi de l'invitation, lorsque le
-- destinataire est déjà inscrit.
--
-- Conséquence : au moment où le lien devrait devenir effectif — acceptation
-- d'une invitation à un dossier, ou consommation d'un jeton de rattachement —
-- l'insertion entre en conflit et ne fait RIEN. La ligne reste indéfiniment en
-- `en_attente`, et l'invitation continue d'apparaître comme une demande non
-- traitée alors que la collaboration a bien eu lieu.
--
-- CORRECTIF
-- Le conflit doit faire progresser le statut plutôt que d'être ignoré.
--
-- POURQUOI PAS UN SIMPLE `DO UPDATE SET statut = 'actif'`
-- Un lien peut avoir été délibérément passé en `bloque` par l'une des deux
-- entreprises. Le réactiver au premier dossier partagé annulerait ce choix sans
-- que personne ne le demande. La mise à jour est donc conditionnée : seul
-- `en_attente` progresse vers `actif`, `bloque` reste `bloque`.
--
-- ⚠️ DÉPEND de la migration 047 (fonction `relier_entreprises`).

CREATE OR REPLACE FUNCTION relier_entreprises(p_a UUID, p_b UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_creees INTEGER := 0;
BEGIN
    -- Rien à relier si l'une des deux entreprises est inconnue — cas d'un
    -- partenaire sans compte — ou s'il s'agit de la même.
    IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
        RETURN 0;
    END IF;

    -- Relation symétrique : appartenir au réseau de quelqu'un implique qu'il
    -- appartienne au vôtre. Deux lignes, pas une, parce que la table est
    -- orientée et que chaque entreprise interroge la sienne.
    INSERT INTO reseau_entreprises (entreprise_origine_id, entreprise_cible_id, statut)
         VALUES (p_a, p_b, 'actif'), (p_b, p_a, 'actif')
    ON CONFLICT (entreprise_origine_id, entreprise_cible_id) DO UPDATE
        SET statut = 'actif'
        -- Une invitation en attente devient effective ; un lien volontairement
        -- bloqué n'est jamais réactivé par ce chemin.
        WHERE reseau_entreprises.statut = 'en_attente';

    GET DIAGNOSTICS v_creees = ROW_COUNT;
    RETURN v_creees;
END;
$$;

COMMENT ON FUNCTION relier_entreprises(UUID, UUID) IS
  'Crée le lien de réseau symétrique entre deux entreprises. Une ligne déjà en attente passe en actif ; une ligne bloquée reste bloquée.';

-- ---------------------------------------------------------------
-- Reprise des liens restés en attente à tort
-- ---------------------------------------------------------------
-- Les collaborations passées ont laissé des lignes `en_attente` que l'ancienne
-- version n'a jamais activées. On les rattrape : dès lors que les deux
-- entreprises ont réellement collaboré sur un dossier (participation acceptée),
-- le lien est effectif.
UPDATE reseau_entreprises r
   SET statut = 'actif'
 WHERE r.statut = 'en_attente'
   AND EXISTS (
     SELECT 1
       FROM groupements g1
       JOIN groupements g2 ON g2.projet_id = g1.projet_id
      WHERE g1.entreprise_id = r.entreprise_origine_id
        AND g2.entreprise_id = r.entreprise_cible_id
        AND g1.statut = 'accepte'
        AND g2.statut = 'accepte'
   );

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select statut, count(*) from reseau_entreprises group by statut;
--   -- les liens correspondant à une collaboration effective doivent être 'actif'
--
--   -- Vérifier qu'aucun lien bloqué n'a été réactivé :
--   select count(*) from reseau_entreprises where statut = 'bloque';
--   -- doit être identique au comptage effectué avant la migration.
