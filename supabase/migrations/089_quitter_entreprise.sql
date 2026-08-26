-- =============================================
-- FILAO: Migration 089 — Quitter une entreprise, et redemander à la rejoindre
-- =============================================
--
-- CE QUE CE LOT RÈGLE
--
-- 1. QUITTER UNE ENTREPRISE
--    Aucun moyen n'existait de se détacher. Un utilisateur rattaché par erreur,
--    ou changeant d'employeur, restait lié définitivement — et l'onboarding
--    l'empêchait de saisir un autre SIRET, faute de pouvoir libérer le premier.
--
-- 2. REDEMANDER APRÈS AVOIR QUITTÉ
--    `demander_rattachement` ne relançait une demande que si son statut était
--    « refusee » (ON CONFLICT ... WHERE statut = 'refusee'). Après un départ, la
--    demande précédente porte le statut « acceptee » : la clause ne s'appliquait
--    pas, RIEN n'était mis à jour, et la fonction renvoyait pourtant
--    « en_attente ». L'administrateur n'aurait jamais vu la nouvelle demande, et
--    le demandeur aurait attendu indéfiniment.
--
-- 3. L'ÉDITION RÉSERVÉE AUX ADMINISTRATEURS
--    La fiche d'entreprise et ses compétences sont partagées par tous ses
--    membres. Un arrivant pouvait les modifier — et donc écraser le travail de
--    ses collègues — simplement en traversant l'onboarding. Les policies
--    d'écriture sont resserrées ici ; l'interface suit.
--
-- ⚠️ DÉPEND des migrations 080, 084 et 088.

-- ---------------------------------------------------------------
-- 1. Quitter son entreprise
-- ---------------------------------------------------------------
-- Renvoie 'quitte', ou un motif d'empêchement.
--
-- Le déclencheur `trg_garantir_admin` (migrations 080/087) s'applique : si
-- l'utilisateur est le dernier administrateur et que plusieurs membres restent,
-- l'opération est refusée tant qu'il n'a pas transmis son rôle.
CREATE OR REPLACE FUNCTION quitter_entreprise()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprise UUID;
  v_dossiers   INTEGER;
BEGIN
  SELECT entreprise_id INTO v_entreprise FROM utilisateurs WHERE id = auth.uid();
  IF v_entreprise IS NULL THEN
    RETURN 'non_rattache';
  END IF;

  -- Les dossiers portés restent liés à leur créateur : partir les laisserait
  -- sans pilote, et les cotraitants sans interlocuteur. Même raisonnement que
  -- pour la suppression de compte (migration 083).
  SELECT count(*) INTO v_dossiers
    FROM reponses_ao r
   WHERE r.createur_id = auth.uid()
     AND r.statut NOT IN ('Gagné', 'Perdu');

  IF v_dossiers > 0 THEN
    RETURN 'dossiers_en_cours';
  END IF;

  -- Le détachement peut lever une exception si l'utilisateur est le dernier
  -- administrateur d'une équipe à plusieurs : on la laisse remonter, son
  -- message indique quoi faire.
  UPDATE utilisateurs
     SET entreprise_id = NULL,
         role_id = (SELECT id FROM roles WHERE name = 'user')
   WHERE id = auth.uid();

  RETURN 'quitte';
END;
$$;

GRANT EXECUTE ON FUNCTION quitter_entreprise() TO authenticated;

COMMENT ON FUNCTION quitter_entreprise() IS
  'Détache l''utilisateur courant de son entreprise. Refuse s''il porte des dossiers en cours ou s''il en est le dernier administrateur.';

-- ---------------------------------------------------------------
-- 2. Relance d'une demande, quel que soit son statut précédent
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION demander_rattachement(p_entreprise UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deja       UUID;
  v_orpheline  TIMESTAMPTZ;
  v_demandeur  TEXT;
BEGIN
  IF p_entreprise IS NULL OR auth.uid() IS NULL THEN
    RETURN 'erreur';
  END IF;

  SELECT entreprise_id INTO v_deja FROM utilisateurs WHERE id = auth.uid();
  IF v_deja IS NOT NULL THEN
    RETURN 'deja_rattache';
  END IF;

  SELECT sans_membre_depuis INTO v_orpheline
    FROM entreprises WHERE id = p_entreprise;
  IF v_orpheline IS NOT NULL THEN
    RETURN 'entreprise_orpheline';
  END IF;

  INSERT INTO demandes_rattachement (entreprise_id, utilisateur_id)
       VALUES (p_entreprise, auth.uid())
  ON CONFLICT (entreprise_id, utilisateur_id) DO UPDATE
      SET statut = 'en_attente',
          motif_refus = NULL,
          created_at = now(),
          traite_le = NULL,
          traite_par = NULL;
      -- Plus de clause WHERE : une demande « acceptee » doit pouvoir repartir
      -- après un départ de l'entreprise. Le contrôle utile est en amont — on ne
      -- passe ici que si l'utilisateur n'est rattaché à personne.

  SELECT COALESCE(NULLIF(TRIM(CONCAT(prenom, ' ', nom)), ''), email)
    INTO v_demandeur
    FROM utilisateurs WHERE id = auth.uid();

  UPDATE utilisateurs u
     SET notifications = ARRAY[
           jsonb_build_object(
             'id', gen_random_uuid(),
             'type', 'demande_rattachement',
             'titre', 'Demande de rattachement',
             'message', v_demandeur || ' souhaite rejoindre votre entreprise sur Filao.',
             'date', now(),
             'read', false
           )
         ] || COALESCE(u.notifications, ARRAY[]::jsonb[])
    FROM roles r
   WHERE r.id = u.role_id
     AND u.entreprise_id = p_entreprise
     AND r.name = 'admin'
     AND u.compte_supprime_le IS NULL;

  RETURN 'en_attente';
END;
$$;

GRANT EXECUTE ON FUNCTION demander_rattachement(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 3. Écriture de la fiche d'entreprise réservée aux administrateurs
-- ---------------------------------------------------------------
-- La lecture reste ouverte à tous les membres : chacun doit voir le profil de
-- son entreprise. Seule la modification est restreinte.
DROP POLICY IF EXISTS "entreprises_update_admin" ON entreprises;
CREATE POLICY "entreprises_update_admin"
  ON entreprises FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM utilisateurs u
        JOIN roles r ON r.id = u.role_id
       WHERE u.id = auth.uid()
         AND u.entreprise_id = entreprises.id
         AND r.name = 'admin'
    )
  );

-- Compétences, domaines, natures et zones : même règle.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_natures', 'company_domains', 'company_specialties', 'company_geo_zones']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write_admin', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM utilisateurs u JOIN roles r ON r.id = u.role_id
                 WHERE u.id = auth.uid() AND u.entreprise_id = %I.entreprise_id
                   AND r.name = 'admin')
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM utilisateurs u JOIN roles r ON r.id = u.role_id
                 WHERE u.id = auth.uid() AND u.entreprise_id = %I.entreprise_id
                   AND r.name = 'admin')
      )
    $f$, t || '_write_admin', t, t, t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Quitter (depuis le compte concerné) :
--   select quitter_entreprise();
--   -- 'quitte', 'non_rattache' ou 'dossiers_en_cours'
--
--   -- Puis redemander : la demande doit repasser en attente même si elle
--   -- portait le statut 'acceptee'.
--   select demander_rattachement('<entreprise>');
--   select statut from demandes_rattachement where utilisateur_id = auth.uid();
--
--   -- Vérifier qu'un membre non-admin ne peut plus écrire :
--   -- (connecté en 'user') update entreprises set nom = 'X' where id = '<son entreprise>';
--   -- attendu : 0 ligne modifiée.
