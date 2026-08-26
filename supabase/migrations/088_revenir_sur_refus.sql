-- =============================================
-- FILAO: Migration 088 — Revenir sur un refus de rattachement
-- =============================================
--
-- BESOIN
-- `traiter_demande_rattachement` n'accepte que les demandes au statut
-- « en_attente ». Un administrateur ayant refusé par erreur n'avait donc aucun
-- moyen de se raviser : la demande disparaissait de son écran, et seul le
-- demandeur pouvait la relancer — sans savoir qu'il avait été refusé, puisque
-- rien ne le lui disait.
--
-- On autorise donc l'acceptation d'une demande REFUSÉE, ce qui revient à
-- corriger la décision. L'inverse — refuser une demande déjà acceptée — n'est
-- pas permis : retirer un collaborateur déjà rattaché relève de la gestion des
-- membres, pas du traitement d'une demande.
--
-- Le contrôle de quota s'applique de la même façon : une place peut avoir été
-- prise entre-temps.

CREATE OR REPLACE FUNCTION traiter_demande_rattachement(
  p_demande  UUID,
  p_accepter BOOLEAN
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_demande demandes_rattachement%ROWTYPE;
  v_places  INTEGER;
BEGIN
  SELECT * INTO v_demande FROM demandes_rattachement WHERE id = p_demande;
  IF NOT FOUND THEN
    RETURN 'non_autorise';
  END IF;

  -- Une demande déjà acceptée ne se retraite pas : le rattachement est fait.
  IF v_demande.statut = 'acceptee' THEN
    RETURN 'non_autorise';
  END IF;

  -- Seul un administrateur de CETTE entreprise décide.
  IF NOT EXISTS (
    SELECT 1 FROM utilisateurs u
      JOIN roles r ON r.id = u.role_id
     WHERE u.id = auth.uid()
       AND u.entreprise_id = v_demande.entreprise_id
       AND r.name = 'admin'
       AND u.compte_supprime_le IS NULL
  ) THEN
    RETURN 'non_autorise';
  END IF;

  IF NOT p_accepter THEN
    UPDATE demandes_rattachement
       SET statut = 'refusee', traite_le = now(), traite_par = auth.uid()
     WHERE id = p_demande;
    RETURN 'refusee';
  END IF;

  -- Le demandeur a pu rejoindre une autre entreprise entre-temps.
  IF EXISTS (
    SELECT 1 FROM utilisateurs
     WHERE id = v_demande.utilisateur_id AND entreprise_id IS NOT NULL
  ) THEN
    RETURN 'deja_rattache';
  END IF;

  v_places := places_restantes_entreprise(v_demande.entreprise_id);
  IF v_places IS NOT NULL AND v_places <= 0 THEN
    UPDATE demandes_rattachement
       SET statut = 'refusee',
           motif_refus = 'quota_atteint',
           traite_le = now(),
           traite_par = auth.uid()
     WHERE id = p_demande;
    RETURN 'quota_atteint';
  END IF;

  UPDATE utilisateurs
     SET entreprise_id = v_demande.entreprise_id,
         role_id = (SELECT id FROM roles WHERE name = 'user')
   WHERE id = v_demande.utilisateur_id;

  UPDATE demandes_rattachement
     SET statut = 'acceptee',
         motif_refus = NULL,
         traite_le = now(),
         traite_par = auth.uid()
   WHERE id = p_demande;

  RETURN 'acceptee';
END;
$$;

GRANT EXECUTE ON FUNCTION traiter_demande_rattachement(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Historique complet d'une entreprise :
--   select statut, motif_refus, created_at, traite_le
--     from demandes_rattachement
--    where entreprise_id = '<entreprise>'
--    order by created_at desc;
