-- =============================================
-- FILAO: Migration 113 — Invitation réseau : l'entreprise doit être la sienne
-- =============================================
--
-- `consommer_invitation_reseau(p_token, p_entreprise)` reliait l'entreprise
-- de l'invitant à `p_entreprise` sans vérifier que celle-ci appartient à
-- l'appelant. Un détenteur de lien pouvait donc relier l'invitant à une
-- entreprise TIERCE.
--
-- On exige désormais que `p_entreprise` soit l'entreprise de l'appelant, ou
-- une entreprise qu'il vient de créer : l'onboarding consomme le jeton juste
-- après la création de l'entreprise, AVANT le rattachement du profil.
--
-- Reprise intégrale de la 076, à cette condition près.

CREATE OR REPLACE FUNCTION consommer_invitation_reseau(
  p_token       TEXT,
  p_entreprise  UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation invitations_reseau%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR p_entreprise IS NULL OR auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  -- L'entreprise à relier est celle de l'appelant.
  IF NOT EXISTS (SELECT 1 FROM utilisateurs WHERE id = auth.uid() AND entreprise_id = p_entreprise)
     AND NOT EXISTS (SELECT 1 FROM entreprises WHERE id = p_entreprise AND created_by = auth.uid()) THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_invitation
    FROM invitations_reseau
   WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     AND consumed_at IS NULL
     AND expires_at > now()
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_invitation.entreprise_origine_id = p_entreprise THEN
    RETURN FALSE;
  END IF;

  PERFORM relier_entreprises(v_invitation.entreprise_origine_id, p_entreprise);

  UPDATE invitations_reseau
     SET consumed_at = now(), consumed_by = auth.uid()
   WHERE id = v_invitation.id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION consommer_invitation_reseau(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION consommer_invitation_reseau(TEXT, UUID) TO authenticated;
