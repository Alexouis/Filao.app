-- =============================================
-- FILAO: Migration 117 — Contestation d'une inscription d'entreprise
-- =============================================
--
-- PROBLÈME
-- Le SIRET est unique, et rien ne prouve qu'on appartient à l'entreprise
-- qu'on inscrit (SIRET, nom et dirigeants sont publics). Un tiers peut donc
-- inscrire une société avant elle ; la vraie société ne pouvait alors que
-- demander à rejoindre… ce tiers.
--
-- PROCÉDURE
--   1. Le demandeur conteste depuis l'écran « déjà sur Filao », avec un motif
--      et un extrait Kbis (Edge Function `contester-entreprise`).
--   2. L'équipe Filao est prévenue par e-mail, vérifie le justificatif.
--   3. Elle tranche avec `resoudre_contestation` (SQL Editor, clé de
--      service) : le demandeur devient administrateur, les comptes en place
--      sont détachés ; ou la contestation est rejetée. Chacun est notifié.

CREATE TABLE IF NOT EXISTS contestations_entreprise (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id    UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  demandeur_id     UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  motif            TEXT NOT NULL CHECK (length(btrim(motif)) BETWEEN 20 AND 2000),
  justificatif     TEXT,
  statut           TEXT NOT NULL DEFAULT 'en_attente'
                   CHECK (statut IN ('en_attente', 'acceptee', 'rejetee')),
  note_traitement  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  traite_le        TIMESTAMPTZ
);

-- Une seule contestation EN COURS par demandeur et par entreprise.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contestation_en_cours
  ON contestations_entreprise (entreprise_id, demandeur_id) WHERE statut = 'en_attente';

ALTER TABLE contestations_entreprise ENABLE ROW LEVEL SECURITY;

-- Le demandeur voit ses propres contestations. Aucune écriture client :
-- l'Edge Function insère en clé de service après ses contrôles.
DROP POLICY IF EXISTS "contestations_select_demandeur" ON contestations_entreprise;
CREATE POLICY "contestations_select_demandeur"
  ON contestations_entreprise FOR SELECT TO authenticated
  USING (demandeur_id = auth.uid());

-- ---------------------------------------------------------------
-- Résolution (équipe Filao)
-- ---------------------------------------------------------------
-- Usage, depuis le SQL Editor :
--   select resoudre_contestation('<id>', true,  'Kbis vérifié le 24/09');
--   select resoudre_contestation('<id>', false, 'Kbis illisible, redemander');
--
-- `p_detacher_membres` : en cas d'acceptation, détache les comptes
-- actuellement rattachés (défaut). Leurs dossiers restent attachés à
-- l'entreprise (colonne figée, 092) : à revoir au cas par cas.
CREATE OR REPLACE FUNCTION resoudre_contestation(
  p_contestation      UUID,
  p_accepter          BOOLEAN,
  p_note              TEXT DEFAULT NULL,
  p_detacher_membres  BOOLEAN DEFAULT TRUE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c            contestations_entreprise%ROWTYPE;
  v_nom        TEXT;
  v_admin      UUID;
  v_user       UUID;
  v_membre     RECORD;
BEGIN
  SELECT * INTO c FROM contestations_entreprise WHERE id = p_contestation FOR UPDATE;
  IF NOT FOUND THEN RETURN 'introuvable'; END IF;
  IF c.statut <> 'en_attente' THEN RETURN 'deja_traitee'; END IF;

  SELECT nom INTO v_nom FROM entreprises WHERE id = c.entreprise_id;

  IF NOT p_accepter THEN
    UPDATE contestations_entreprise
       SET statut = 'rejetee', note_traitement = p_note, traite_le = now()
     WHERE id = c.id;
    PERFORM ajouter_notification(c.demandeur_id, jsonb_build_object(
      'id', gen_random_uuid(), 'type', 'contestation_rejetee',
      'titre', 'Contestation non retenue',
      'message', 'Votre contestation de l''inscription de ' || coalesce(v_nom, 'l''entreprise')
                 || ' n''a pas été retenue.' || coalesce(' ' || p_note, ''),
      'date', now(), 'read', false));
    RETURN 'rejetee';
  END IF;

  -- Le demandeur ne doit pas appartenir à une autre entreprise.
  IF EXISTS (SELECT 1 FROM utilisateurs WHERE id = c.demandeur_id
               AND entreprise_id IS NOT NULL AND entreprise_id <> c.entreprise_id) THEN
    RAISE EXCEPTION 'Le demandeur est rattaché à une autre entreprise : il doit d''abord la quitter.';
  END IF;

  SELECT id INTO v_admin FROM roles WHERE name = 'admin';
  SELECT id INTO v_user  FROM roles WHERE name = 'user';

  -- 1. Le demandeur devient administrateur (AVANT les détachements : le
  --    garde-fou de la 080 exige qu'un administrateur subsiste).
  UPDATE utilisateurs SET entreprise_id = c.entreprise_id, role_id = v_admin
   WHERE id = c.demandeur_id;
  UPDATE entreprises SET created_by = c.demandeur_id WHERE id = c.entreprise_id;

  -- 2. Détachement des comptes en place, prévenus.
  IF p_detacher_membres THEN
    FOR v_membre IN
      SELECT id FROM utilisateurs
       WHERE entreprise_id = c.entreprise_id AND id <> c.demandeur_id
    LOOP
      UPDATE utilisateurs SET entreprise_id = NULL, role_id = v_user WHERE id = v_membre.id;
      PERFORM ajouter_notification(v_membre.id, jsonb_build_object(
        'id', gen_random_uuid(), 'type', 'contestation_detachement',
        'titre', 'Rattachement retiré',
        'message', 'Suite à une contestation vérifiée par l''équipe Filao, votre compte n''est plus rattaché à '
                   || coalesce(v_nom, 'cette entreprise') || '.',
        'date', now(), 'read', false));
    END LOOP;
  END IF;

  UPDATE contestations_entreprise
     SET statut = 'acceptee', note_traitement = p_note, traite_le = now()
   WHERE id = c.id;

  PERFORM ajouter_notification(c.demandeur_id, jsonb_build_object(
    'id', gen_random_uuid(), 'type', 'contestation_acceptee',
    'titre', 'Contestation acceptée',
    'message', 'Vous êtes désormais administrateur de ' || coalesce(v_nom, 'votre entreprise') || ' sur Filao.',
    'date', now(), 'read', false));

  RETURN 'acceptee';
END;
$$;

REVOKE ALL ON FUNCTION resoudre_contestation(UUID, BOOLEAN, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION resoudre_contestation(UUID, BOOLEAN, TEXT, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------
-- Suivi (équipe Filao)
-- ---------------------------------------------------------------
--   select c.id, c.created_at, e.nom, e.siret, u.email, c.motif, c.justificatif
--     from contestations_entreprise c
--     join entreprises e on e.id = c.entreprise_id
--     join utilisateurs u on u.id = c.demandeur_id
--    where c.statut = 'en_attente' order by c.created_at;
