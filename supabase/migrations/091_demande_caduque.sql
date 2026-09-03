-- =============================================
-- FILAO: Migration 091 — Demandes de rattachement devenues sans objet
-- =============================================
--
-- PROBLÈME
-- Depuis la migration 088, `traiter_demande_rattachement` refuse à juste titre
-- de déplacer un demandeur qui a rejoint une autre entreprise entre-temps : elle
-- renvoie « deja_rattache » sans toucher à `utilisateurs.entreprise_id`.
--
-- Mais la demande, elle, RESTE au statut « en_attente ». Elle continue donc de
-- figurer dans la liste de l'administrateur, qui clique « Accepter » et ne voit
-- strictement rien se produire : la ligne est toujours là au rechargement. Il
-- recommence, indéfiniment. Le refus est correct, sa restitution est absente.
--
-- Le cas se produit à chaque fois qu'un utilisateur emprunte « Ce n'est pas mon
-- entreprise — en renseigner une autre » après avoir envoyé sa demande : il
-- crée sa propre entreprise, et laisse derrière lui une demande que plus rien ne
-- peut satisfaire.
--
-- RÈGLE RETENUE
-- Un quatrième statut, « caduque » : la demande n'a pas été refusée — personne
-- ne l'a jugée — elle a simplement perdu son objet. Les deux écrans filtrent
-- déjà sur ('en_attente', 'refusee') : une demande caduque disparaît donc de la
-- liste de l'administrateur sans autre modification, tout en restant en base
-- pour l'historique.
--
-- On l'applique par les deux bouts :
--   - à la sortie, quand le demandeur annonce lui-même qu'il repart ailleurs ;
--   - à l'arrivée, quand l'administrateur traite une demande dont le demandeur
--     est déjà rattaché (course entre les deux).
--
-- `demander_rattachement` n'a pas besoin d'être touchée : la migration 089 a
-- retiré la clause WHERE de son `ON CONFLICT DO UPDATE`. Une demande caduque
-- repart donc en « en_attente » si l'utilisateur se ravise.

-- ---------------------------------------------------------------
-- 1. Ouvrir le statut
-- ---------------------------------------------------------------
-- La contrainte est déclarée en ligne dans la migration 080 : son nom est
-- attribué par PostgreSQL. On la retrouve par son contenu plutôt que de parier
-- sur ce nom.
DO $$
DECLARE
  v_contrainte TEXT;
BEGIN
  SELECT conname INTO v_contrainte
    FROM pg_constraint
   WHERE conrelid = 'demandes_rattachement'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%statut%';

  IF v_contrainte IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE demandes_rattachement DROP CONSTRAINT %I', v_contrainte
    );
  END IF;
END $$;

ALTER TABLE demandes_rattachement
  ADD CONSTRAINT demandes_rattachement_statut_check
  CHECK (statut IN ('en_attente', 'acceptee', 'refusee', 'caduque'));

-- ---------------------------------------------------------------
-- 2. Retirer sa propre demande
-- ---------------------------------------------------------------
-- Appelée quand l'utilisateur déclare que l'entreprise trouvée n'est pas la
-- sienne. Seules les demandes EN ATTENTE sont retirées : un refus reste visible
-- pour l'administrateur, qui doit pouvoir revenir dessus (migration 088).
--
-- Aucune policy d'écriture n'est ouverte au client sur cette table : le passage
-- par une fonction SECURITY DEFINER est la seule voie, et elle ne touche qu'aux
-- demandes de l'appelant.
CREATE OR REPLACE FUNCTION annuler_demande_rattachement()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprises UUID[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'erreur';
  END IF;

  WITH annulees AS (
    UPDATE demandes_rattachement
       SET statut = 'caduque', traite_le = now()
     WHERE utilisateur_id = auth.uid()
       AND statut = 'en_attente'
    RETURNING entreprise_id
  )
  SELECT array_agg(entreprise_id) INTO v_entreprises FROM annulees;

  IF v_entreprises IS NULL THEN
    RETURN 'aucune';
  END IF;

  -- Retirer la notification devenue sans objet.
  --
  -- L'administrateur gardait un badge non lu menant à une liste vide : la
  -- demande avait disparu de son écran, l'alerte qui l'y envoyait non.
  --
  -- Les notifications vivent dans la colonne `utilisateurs.notifications`
  -- (jsonb[], voir migration 089). PostgreSQL n'offre pas de filtre direct sur
  -- un tableau : on le déplie, on écarte les entrées concernées, on le
  -- reconstruit. `WITH ORDINALITY` préserve l'ordre d'origine — les
  -- notifications sont empilées les plus récentes en tête, et une
  -- réagrégation non ordonnée les mélangerait.
  UPDATE utilisateurs u
     SET notifications = COALESCE((
           SELECT array_agg(n ORDER BY ord)
             FROM unnest(u.notifications) WITH ORDINALITY AS t(n, ord)
            WHERE NOT (
                  n->>'type' = 'demande_rattachement'
              AND n->>'demandeur_id' = auth.uid()::text
            )
         ), ARRAY[]::jsonb[])
    FROM roles r
   WHERE r.id = u.role_id
     AND r.name = 'admin'
     AND u.entreprise_id = ANY (v_entreprises)
     AND u.compte_supprime_le IS NULL
     AND u.notifications IS NOT NULL;

  RETURN 'annulee';
END;
$$;

GRANT EXECUTE ON FUNCTION annuler_demande_rattachement() TO authenticated;

COMMENT ON FUNCTION annuler_demande_rattachement() IS
  'Rend caduques les demandes en attente de l''appelant, lorsqu''il repart sur une autre entreprise.';

-- ---------------------------------------------------------------
-- 3. Clore la demande côté administrateur
-- ---------------------------------------------------------------
-- Reprise intégrale de la version 088, à une addition près : le cas
-- « deja_rattache » marque désormais la demande caduque avant de rendre la
-- main. Sans cet UPDATE, la fonction rendait un verdict que rien n'enregistrait,
-- et l'administrateur restait devant une ligne qu'aucun clic ne faisait bouger.
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

  -- Ni une demande acceptée (le rattachement est fait), ni une demande caduque
  -- (le demandeur l'a retirée) ne se retraitent.
  --
  -- Sans « caduque » ici, une demande retirée par son auteur restait
  -- acceptable : elle ne s'affiche plus dans la liste, mais rien n'empêchait un
  -- écran resté ouvert d'en envoyer l'identifiant. Le retrait doit être
  -- définitif tant que l'utilisateur ne redemande pas lui-même.
  IF v_demande.statut IN ('acceptee', 'caduque') THEN
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

  -- Le demandeur a pu rejoindre une autre entreprise entre-temps. La demande
  -- n'a plus d'objet : on la clôt, sans quoi elle reviendrait à chaque clic.
  -- Contrôle placé avant le refus : refuser une demande sans objet n'a pas de
  -- sens non plus, et laisserait croire à une décision qui n'en est pas une.
  IF EXISTS (
    SELECT 1 FROM utilisateurs
     WHERE id = v_demande.utilisateur_id AND entreprise_id IS NOT NULL
  ) THEN
    UPDATE demandes_rattachement
       SET statut = 'caduque', traite_le = now(), traite_par = auth.uid()
     WHERE id = p_demande;
    RETURN 'deja_rattache';
  END IF;

  IF NOT p_accepter THEN
    UPDATE demandes_rattachement
       SET statut = 'refusee', traite_le = now(), traite_par = auth.uid()
     WHERE id = p_demande;
    RETURN 'refusee';
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
-- 4. Identifier le demandeur dans la notification
-- ---------------------------------------------------------------
-- Reprise intégrale de la version 089, à un champ près : `demandeur_id`.
--
-- La notification ne portait que le NOM du demandeur, en clair dans son
-- message. Retirer l'alerte au moment de l'annulation aurait supposé de
-- reconnaître ce nom dans une chaîne de caractères — fragile, et faux dès que
-- deux homonymes demandent la même entreprise. L'identifiant rend le retrait
-- exact.
--
-- Les notifications déjà émises n'ont pas ce champ : elles ne seront pas
-- retirées. La dégradation est silencieuse et sans conséquence — un badge
-- résiduel sur une liste vide, ce que la 091 corrige pour la suite.
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
      -- Pas de clause WHERE (migration 089) : une demande « acceptee » doit
      -- pouvoir repartir après un départ de l'entreprise, et une demande
      -- « caduque » si l'utilisateur se ravise. Le contrôle utile est en amont.

  SELECT COALESCE(NULLIF(TRIM(CONCAT(prenom, ' ', nom)), ''), email)
    INTO v_demandeur
    FROM utilisateurs WHERE id = auth.uid();

  UPDATE utilisateurs u
     SET notifications = ARRAY[
           jsonb_build_object(
             'id', gen_random_uuid(),
             'type', 'demande_rattachement',
             -- Nouveau : permet de retirer précisément cette alerte si le
             -- demandeur retire sa demande.
             'demandeur_id', auth.uid(),
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
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Demandes qui ne peuvent plus aboutir et devraient être caduques :
--   select d.id, d.statut
--     from demandes_rattachement d
--     join utilisateurs u on u.id = d.utilisateur_id
--    where d.statut = 'en_attente'
--      and u.entreprise_id is not null;
--
--   -- Le statut est bien accepté par la contrainte :
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'demandes_rattachement'::regclass and contype = 'c';
