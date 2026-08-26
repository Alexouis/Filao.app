-- =============================================
-- FILAO: Migration 084 — Entreprises sans membre actif
-- =============================================
--
-- CONTEXTE
-- Quand le dernier membre d'une entreprise supprime son compte, son profil est
-- anonymisé (migration 083) mais l'entreprise, ses dossiers et son coffre-fort
-- subsistent — à raison : ces pièces peuvent être rattachées à des dossiers
-- encore en cours chez des cotraitants, et la prescription en marchés publics
-- impose de les conserver.
--
-- L'entreprise devient alors ORPHELINE : plus aucun compte ne la porte.
--
-- POURQUOI CELA DOIT ÊTRE TRAITÉ
-- Son SIRET reste en base. Un nouvel inscrit de la même société tombe donc sur
-- « Cette entreprise est déjà sur Filao » et demande à la rejoindre — mais la
-- validation exige un ADMINISTRATEUR de cette entreprise, et il n'y en a plus
-- aucun. Sa demande resterait indéfiniment en attente, sans que personne puisse
-- la traiter et sans qu'il comprenne pourquoi.
--
-- On marque donc l'état explicitement, pour que le parcours puisse le dire
-- plutôt que de créer une impasse silencieuse.

-- ---------------------------------------------------------------
-- 1. Marqueur
-- ---------------------------------------------------------------
ALTER TABLE entreprises
  ADD COLUMN IF NOT EXISTS sans_membre_depuis TIMESTAMPTZ;

COMMENT ON COLUMN entreprises.sans_membre_depuis IS
  'Non NULL = plus aucun compte ne porte cette entreprise. Ses données sont conservées mais nul ne peut valider un rattachement.';

-- ---------------------------------------------------------------
-- 2. Entretien automatique du marqueur
-- ---------------------------------------------------------------
-- Le marqueur doit suivre la réalité sans intervention : il se pose quand le
-- dernier membre part, et se retire dès qu'un compte rejoint l'entreprise.
CREATE OR REPLACE FUNCTION maj_entreprise_sans_membre()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_concernees UUID[];
  v_entreprise UUID;
  v_membres    INTEGER;
BEGIN
  -- Les deux entreprises peuvent être touchées par un changement de
  -- rattachement : celle qu'on quitte et celle qu'on rejoint.
  v_concernees := ARRAY(
    SELECT DISTINCT x FROM unnest(ARRAY[OLD.entreprise_id, NEW.entreprise_id]) AS x
     WHERE x IS NOT NULL
  );

  FOREACH v_entreprise IN ARRAY v_concernees LOOP
    SELECT count(*) INTO v_membres
      FROM utilisateurs
     WHERE entreprise_id = v_entreprise
       -- Un compte anonymisé ne compte pas : il ne peut plus se connecter.
       AND compte_supprime_le IS NULL;

    UPDATE entreprises
       SET sans_membre_depuis = CASE WHEN v_membres = 0 THEN now() ELSE NULL END
     WHERE id = v_entreprise
       -- Ne pas réécrire l'horodatage à chaque passage.
       AND (sans_membre_depuis IS NULL) = (v_membres = 0);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_entreprise_sans_membre ON utilisateurs;
CREATE TRIGGER trg_entreprise_sans_membre
  AFTER INSERT OR UPDATE OF entreprise_id, compte_supprime_le OR DELETE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION maj_entreprise_sans_membre();

-- ---------------------------------------------------------------
-- 3. Reprise de l'existant
-- ---------------------------------------------------------------
UPDATE entreprises e
   SET sans_membre_depuis = now()
 WHERE sans_membre_depuis IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM utilisateurs u
      WHERE u.entreprise_id = e.id
        AND u.compte_supprime_le IS NULL
   );

-- ---------------------------------------------------------------
-- 4. Le rattachement signale l'impasse
-- ---------------------------------------------------------------
-- Sans ce contrôle, la demande partait et personne ne pouvait la valider.
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

  -- Aucun membre actif : nul ne pourrait valider la demande. On le dit
  -- franchement plutôt que de laisser le demandeur attendre indéfiniment.
  SELECT sans_membre_depuis INTO v_orpheline
    FROM entreprises WHERE id = p_entreprise;
  IF v_orpheline IS NOT NULL THEN
    RETURN 'entreprise_orpheline';
  END IF;

  INSERT INTO demandes_rattachement (entreprise_id, utilisateur_id)
       VALUES (p_entreprise, auth.uid())
  ON CONFLICT (entreprise_id, utilisateur_id) DO UPDATE
      SET statut = 'en_attente', motif_refus = NULL, created_at = now()
      WHERE demandes_rattachement.statut = 'refusee';

  -- Notifier les administrateurs de l'entreprise.
  --
  -- Sans cela, la demande attendait qu'un administrateur ouvre par hasard
  -- « Mon entreprise » : rien ne l'avertissait, et le demandeur restait bloqué
  -- sans comprendre pourquoi.
  --
  -- Les notifications applicatives vivent dans la colonne jsonb
  -- `utilisateurs.notifications` (la table dédiée a été retirée en migration
  -- 063) : on empile donc l'entrée en tête du tableau.
  SELECT COALESCE(NULLIF(TRIM(CONCAT(prenom, ' ', nom)), ''), email)
    INTO v_demandeur
    FROM utilisateurs WHERE id = auth.uid();

  UPDATE utilisateurs u
     SET notifications = (
           jsonb_build_array(
             jsonb_build_object(
               'id', gen_random_uuid(),
               'type', 'demande_rattachement',
               'titre', 'Demande de rattachement',
               'message', v_demandeur || ' souhaite rejoindre votre entreprise sur Filao.',
               'lien', '/?tab=company',
               'lu', false,
               'date', now()
             )
           ) || COALESCE(u.notifications, '[]'::jsonb)
         )
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
-- Contrôle après application
-- ---------------------------------------------------------------
--   select count(*) from entreprises where sans_membre_depuis is not null;
--   -- entreprises dont plus aucun compte actif ne porte les données
--
--   -- Cohérence du marqueur :
--   select e.id from entreprises e
--    where (e.sans_membre_depuis is null)
--       <> exists (select 1 from utilisateurs u
--                   where u.entreprise_id = e.id and u.compte_supprime_le is null);
--   -- attendu : aucune ligne.
