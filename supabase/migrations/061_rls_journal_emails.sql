-- =============================================
-- FILAO: Migration 061 — Lecture du journal d'emails et des dépôts (Lot 6)
-- =============================================
--
-- Rend `emails_envoyes` et `depots_pieces` consultables côté front, en LECTURE
-- SEULE et de façon cloisonnée.
--
-- ⚠️ DÉPEND de la migration 062 (rattachement des rôles + fonction
--    `est_admin_entreprise()`). Appliquer 062 AVANT 061.
--
-- Règle : on voit le journal/dépôts liés à un dossier
--   • dont on est le créateur (mandataire), OU
--   • appartenant à un membre de SON entreprise si l'on est admin d'entreprise.

-- Ids de dossiers visibles par un admin d'entreprise (ceux créés par un membre
-- de la même entreprise). Fonction dédiée pour éviter de redupliquer la jointure
-- dans chaque policy.
CREATE OR REPLACE FUNCTION dossiers_de_mon_entreprise()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id
  FROM reponses_ao r
  JOIN utilisateurs u ON u.id = r.createur_id
  WHERE est_admin_entreprise()
    AND u.entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid());
$$;

-- ---------------------------------------------------------------
-- emails_envoyes — lecture
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "emails_envoyes_select" ON emails_envoyes;
CREATE POLICY "emails_envoyes_select"
  ON emails_envoyes FOR SELECT TO authenticated
  USING (
    destinataire_id = auth.uid()
    OR objet_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
    OR objet_id IN (SELECT dossiers_de_mon_entreprise())
  );

-- ---------------------------------------------------------------
-- depots_pieces — lecture (élargit la policy de la migration 058)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "depots_pieces_select" ON depots_pieces;
CREATE POLICY "depots_pieces_select"
  ON depots_pieces FOR SELECT TO authenticated
  USING (
    destinataire_id = auth.uid()
    OR auteur_id = auth.uid()
    OR tender_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
    OR tender_id IN (SELECT dossiers_de_mon_entreprise())
  );

-- Vérification (en tant qu'utilisateur authentifié, pas service_role) :
--   select * from emails_envoyes where objet_id = '<un de mes dossiers>';
--   -- un dossier d'une autre entreprise -> 0 ligne.
