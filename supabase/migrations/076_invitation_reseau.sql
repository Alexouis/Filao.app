-- =============================================
-- FILAO: Migration 076 — Jeton d'invitation au réseau
-- =============================================
--
-- PROBLÈME
-- L'e-mail « … vous invite à rejoindre Filao » pointe vers `/register` sans
-- aucun paramètre : ni jeton, ni identifiant de l'invitant, ni adresse
-- pré-remplie. Le lien entre l'invitant et le nouvel inscrit est donc perdu dès
-- l'envoi, et le rattachement au réseau ne peut pas avoir lieu.
--
-- POURQUOI UNE TABLE DÉDIÉE
-- `reseau_entreprises` relie deux entreprises existantes. Or l'invité n'a ni
-- compte ni entreprise au moment de l'envoi : on ne peut pas y créer de ligne
-- « en_attente ». Le jeton porte donc l'intention jusqu'à ce que l'entreprise du
-- nouvel inscrit existe, puis il est consommé.
--
-- SÉCURITÉ
-- Même traitement que les jetons d'invitation à un dossier (migration 042) : la
-- base ne conserve que l'empreinte SHA-256, jamais la valeur en clair. Un accès
-- en lecture à la table ne permet donc pas de forger un lien.

CREATE TABLE IF NOT EXISTS invitations_reseau (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Empreinte SHA-256 du jeton ; la valeur en clair ne vit que dans l'e-mail.
  token_hash             TEXT NOT NULL UNIQUE,
  entreprise_origine_id  UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  -- Adresse invitée, pour pré-remplir le formulaire et tracer l'usage.
  email                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 30 jours : au-delà, l'intention n'est plus d'actualité.
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  -- Usage unique.
  consumed_at            TIMESTAMPTZ,
  consumed_by            UUID REFERENCES utilisateurs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_reseau_hash
  ON invitations_reseau (token_hash) WHERE consumed_at IS NULL;

-- RLS active sans policy permissive : la table n'est manipulée que par la
-- service_role (edge function) et par la fonction de consommation ci-dessous,
-- toutes deux en SECURITY DEFINER. Aucun accès direct depuis le client.
ALTER TABLE invitations_reseau ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE invitations_reseau IS
  'Jetons d''invitation au réseau (hachés). Portent le lien invitant → invité jusqu''à la création de son entreprise.';

-- ---------------------------------------------------------------
-- Consommation du jeton
-- ---------------------------------------------------------------
-- Appelée par le nouvel inscrit une fois son entreprise créée. Valide le jeton,
-- relie les deux entreprises via la fonction existante, puis marque le jeton
-- consommé.
--
-- Renvoie TRUE si un rattachement a eu lieu. Toute autre situation — jeton
-- inconnu, expiré, déjà consommé — renvoie FALSE sans distinction : le message
-- affiché doit rester neutre, sous peine de permettre de sonder les jetons
-- valides.
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
  IF p_token IS NULL OR length(p_token) < 16 OR p_entreprise IS NULL THEN
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

  -- Ne pas relier une entreprise à elle-même (l'invitant s'invitant lui-même).
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

COMMENT ON FUNCTION consommer_invitation_reseau(TEXT, UUID) IS
  'Consomme un jeton d''invitation réseau et relie les deux entreprises. Renvoie FALSE sans détail si le jeton est invalide, expiré ou déjà utilisé.';
