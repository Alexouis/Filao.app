-- =============================================
-- FILAO: Migration 122 — Suivi des invitations réseau envoyées par e-mail
-- =============================================
--
-- Une invitation au réseau envoyée à une personne pas encore inscrite ne se
-- voyait nulle part : impossible de savoir si elle avait été acceptée, de la
-- relancer ou de l'annuler. La table reste fermée au client (076) ; ces deux
-- fonctions n'exposent que le nécessaire — jamais l'empreinte du jeton.

CREATE OR REPLACE FUNCTION mes_invitations_reseau()
RETURNS TABLE (id UUID, email TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, consumed_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.email, i.created_at, i.expires_at, i.consumed_at
    FROM invitations_reseau i
   WHERE i.entreprise_origine_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
     AND i.email IS NOT NULL
     -- Les invitations closes depuis longtemps n'encombrent pas la liste.
     AND i.created_at > now() - INTERVAL '90 days'
   ORDER BY i.created_at DESC;
$$;

REVOKE ALL ON FUNCTION mes_invitations_reseau() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mes_invitations_reseau() TO authenticated;

-- Annulation : le lien cesse de fonctionner (expiration immédiate). Seule
-- une invitation de SON entreprise, non encore utilisée, peut être annulée.
CREATE OR REPLACE FUNCTION annuler_invitation_reseau(p_invitation UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nb INTEGER;
BEGIN
  UPDATE invitations_reseau
     SET expires_at = now()
   WHERE id = p_invitation
     AND consumed_at IS NULL
     AND expires_at > now()
     AND entreprise_origine_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid());
  GET DIAGNOSTICS v_nb = ROW_COUNT;
  RETURN v_nb > 0;
END;
$$;

REVOKE ALL ON FUNCTION annuler_invitation_reseau(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION annuler_invitation_reseau(UUID) TO authenticated;
