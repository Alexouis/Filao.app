-- =============================================
-- FILAO: Migration 114 — Nommer ou retirer un administrateur
-- =============================================
--
-- PROBLÈME
-- `garantir_admin_entreprise` (080/087) refuse le départ du dernier
-- administrateur tant que plusieurs membres restent : « Désignez un autre
-- administrateur ». Mais rien ne permettait de le faire — ni écran, ni
-- fonction ; et depuis la 112, le rôle ne s'écrit plus directement. Le seul
-- administrateur d'une entreprise de trois personnes ou plus ne pouvait donc
-- ni quitter l'entreprise, ni supprimer son compte.
--
-- RÈGLE
-- Un administrateur de l'entreprise nomme un membre administrateur, ou retire
-- ce rôle (à un autre, ou à lui-même). Le garde-fou de la 080 continue de
-- s'appliquer : on ne peut pas retirer le rôle au dernier administrateur.

CREATE OR REPLACE FUNCTION changer_role_membre(p_membre UUID, p_admin BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprise UUID;
  v_role       UUID;
BEGIN
  IF auth.uid() IS NULL OR p_membre IS NULL THEN
    RETURN 'non_autorise';
  END IF;

  -- L'appelant est administrateur actif, et le membre est de la même entreprise.
  SELECT u.entreprise_id INTO v_entreprise
    FROM utilisateurs u JOIN roles r ON r.id = u.role_id
   WHERE u.id = auth.uid() AND r.name = 'admin' AND u.compte_supprime_le IS NULL;
  IF v_entreprise IS NULL OR NOT EXISTS (
    SELECT 1 FROM utilisateurs
     WHERE id = p_membre AND entreprise_id = v_entreprise AND compte_supprime_le IS NULL
  ) THEN
    RETURN 'non_autorise';
  END IF;

  SELECT id INTO v_role FROM roles WHERE name = CASE WHEN p_admin THEN 'admin' ELSE 'user' END;
  UPDATE utilisateurs SET role_id = v_role WHERE id = p_membre;
  -- Si c'était le dernier administrateur, `garantir_admin_entreprise` lève
  -- une exception : l'appelant reçoit son message.
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION changer_role_membre(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION changer_role_membre(UUID, BOOLEAN) TO authenticated;
