-- =============================================
-- FILAO: Migration 118 — « J'aime » sur un commentaire
-- =============================================
--
-- `toggle_comment_like(p_comment_id, p_user_id)`, créée hors migrations :
--   1. utilisait le `p_user_id` ENVOYÉ PAR LE CLIENT : n'importe qui pouvait
--      aimer ou retirer le « j'aime » d'un commentaire au nom d'autrui ;
--   2. ne vérifiait aucun accès au dossier : exécutée en SECURITY DEFINER,
--      elle agissait sur les commentaires de n'importe quel dossier ;
--   3. lisait puis réécrivait la liste : deux mentions simultanées, et l'une
--      était perdue.
--
-- Nouvelle version : l'utilisateur est TOUJOURS l'appelant (`p_user_id` est
-- conservé dans la signature pour ne pas casser le client, mais ignoré),
-- l'accès suit la policy de lecture des commentaires (membre du dossier, ou
-- administrateur de l'entreprise porteuse — 094), et la bascule tient en une
-- seule instruction UPDATE.
--
-- Toutes les surcharges existantes sont retirées d'abord : une version
-- d'une autre signature coexisterait sinon avec celle-ci, et PostgREST ne
-- saurait laquelle appeler.

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'toggle_comment_like' AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', f.signature);
  END LOOP;
END $$;

CREATE FUNCTION toggle_comment_like(p_comment_id UUID, p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_moi   JSONB := to_jsonb(auth.uid()::TEXT);
  v_likes JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE comments c
     SET likes = CASE
           WHEN COALESCE(c.likes, '[]'::jsonb) @> jsonb_build_array(v_moi)
             THEN COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(c.likes) e WHERE e <> v_moi), '[]'::jsonb)
           ELSE COALESCE(c.likes, '[]'::jsonb) || jsonb_build_array(v_moi)
         END
   WHERE c.id = p_comment_id
     AND (app.est_membre(c.tender_id) OR app.peut_ecrire_dossier(c.tender_id))
  RETURNING c.likes INTO v_likes;

  RETURN v_likes;   -- NULL : commentaire introuvable ou inaccessible
END;
$$;

REVOKE ALL ON FUNCTION toggle_comment_like(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION toggle_comment_like(UUID, UUID) TO authenticated;
