-- ============================================================================
-- 102 — Quitter un groupement : départ complet et atomique
-- ============================================================================
--
-- LE PROBLÈME
-- La 101 a ouvert la suppression de sa propre ligne `groupements`. Le départ
-- fonctionnait donc… à moitié : le partenaire réapparaissait chez le mandataire
-- au rechargement.
--
-- La raison : un partenaire arrivé par invitation possède DEUX lignes — une
-- dans `groupements`, une dans `invitations`. L'écran Équipe fusionne les deux
-- sources. Supprimer seulement la première laisse l'invitation intacte, et le
-- partenaire revient dans la liste.
--
-- Or il ne pouvait pas traiter la seconde :
--   - la 034 a supprimé « Public can update invitation status », donc l'UPDATE
--     direct est refusé (silencieusement : zéro ligne, aucune erreur) ;
--   - `revoquer_invitation` (043) est réservée au CRÉATEUR du dossier.
--
-- CE QUE FAIT CETTE FONCTION
-- Un seul geste, côté serveur, pour l'utilisateur courant et lui seul :
--   1. supprime la ligne de groupement de SON entreprise sur ce dossier ;
--   2. révoque SES invitations sur ce dossier (le lien d'accès cesse aussi de
--      fonctionner : partir, c'est partir).
--
-- POURQUOI UNE FONCTION PLUTÔT QUE DES POLICIES
-- Élargir l'UPDATE sur `invitations` laisserait un invité modifier d'autres
-- colonnes que celles visées — son rôle, par exemple. Ici, l'écriture est
-- décidée par la fonction : l'appelant ne choisit que le dossier qu'il quitte.
--
-- SÉCURITÉ
-- `SECURITY DEFINER` avec un `search_path` fixé. Toutes les conditions sont
-- ancrées sur `auth.uid()` : impossible de faire partir quelqu'un d'autre. La
-- fonction est refusée au rôle `anon`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.quitter_groupement(p_tender_id UUID)
RETURNS TABLE (groupements_supprimes INT, invitations_revoquees INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT;
  v_entreprise   UUID;
  v_groupements  INT := 0;
  v_invitations  INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '28000';
  END IF;

  SELECT u.email, u.entreprise_id INTO v_email, v_entreprise
    FROM utilisateurs u
   WHERE u.id = v_uid;

  -- Le porteur du dossier ne « quitte » pas son propre dossier : il le
  -- supprime ou le clôture. Sans ce garde-fou, il se retirerait de son
  -- groupement tout en restant créateur, laissant un dossier incohérent.
  IF EXISTS (SELECT 1 FROM reponses_ao r
              WHERE r.id = p_tender_id AND r.createur_id = v_uid) THEN
    RAISE EXCEPTION 'Le porteur du dossier ne peut pas quitter son propre groupement.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. La ligne de groupement de son entreprise.
  IF v_entreprise IS NOT NULL THEN
    DELETE FROM groupements g
     WHERE g.projet_id = p_tender_id
       AND g.entreprise_id = v_entreprise;
    GET DIAGNOSTICS v_groupements = ROW_COUNT;
  END IF;

  -- 2. Ses invitations sur ce dossier. On révoque plutôt que de supprimer :
  --    la trace du parcours reste consultable par le mandataire.
  IF v_email IS NOT NULL THEN
    UPDATE invitations i
       SET revoked_at = NOW(),
           revoked_by = v_uid,
           status     = 'refused',
           refused_at = COALESCE(i.refused_at, NOW())
     WHERE i.tender_id = p_tender_id
       AND lower(i.email) = lower(v_email)
       AND i.revoked_at IS NULL;
    GET DIAGNOSTICS v_invitations = ROW_COUNT;
  END IF;

  RETURN QUERY SELECT v_groupements, v_invitations;
END;
$$;

COMMENT ON FUNCTION public.quitter_groupement(UUID) IS
  'Retire l''utilisateur courant d''un dossier : supprime la ligne de groupement de son entreprise et révoque ses invitations. Ancrée sur auth.uid().';

REVOKE ALL ON FUNCTION public.quitter_groupement(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quitter_groupement(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.quitter_groupement(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- En tant que cotraitant accepté, sur un dossier qu'il ne porte pas :
--   select * from quitter_groupement('<id du dossier>');
--   -- attendu : groupements_supprimes = 1, invitations_revoquees >= 0
--
-- Puis, côté MANDATAIRE, après rechargement : le partenaire ne doit plus
-- figurer dans l'équipe, ni via `groupements`, ni via `invitations`.
--
-- En tant que porteur du dossier :
--   select * from quitter_groupement('<mon dossier>');
--   -- attendu : exception 42501
