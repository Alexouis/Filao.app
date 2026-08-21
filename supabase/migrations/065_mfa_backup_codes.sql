-- =============================================
-- FILAO: Migration 065 — Codes de secours 2FA
-- =============================================
--
-- CONTEXTE
-- La 2FA repose sur un facteur TOTP (application d'authentification). En cas de
-- perte du téléphone, l'utilisateur serait définitivement verrouillé hors de
-- son compte. Les codes de secours offrent une voie de récupération : présentés
-- à la connexion, ils autorisent le RETRAIT du facteur TOTP (l'utilisateur
-- reprend la main puis ré-enrôle un nouveau facteur).
--
-- Supabase n'élève une session en AAL2 que via un code TOTP ; un code de secours
-- ne « remplace » donc pas le TOTP en session, il sert exclusivement à la
-- récupération d'accès. Toute la logique vit dans l'edge function
-- `mfa-backup-codes` (service-role) : le client ne lit jamais cette table.
--
-- SÉCURITÉ
-- Les codes ne sont JAMAIS stockés en clair : seul leur hachage SHA-256 est
-- conservé, comparé côté serveur. Un code est à usage unique (`consumed_at`).

CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Hachage SHA-256 du code normalisé (majuscules, sans séparateur).
  code_hash   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);

-- Recherche par utilisateur (vérification d'un code présenté).
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user
  ON mfa_backup_codes (user_id) WHERE consumed_at IS NULL;

-- Un même hash ne peut exister qu'une fois par utilisateur (évite les doublons
-- lors d'une régénération partielle).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mfa_backup_codes_user_hash
  ON mfa_backup_codes (user_id, code_hash);

-- RLS activé SANS policy permissive : la table n'est accessible qu'à la
-- service-role (edge function). Aucun accès direct depuis le client — le
-- hachage des codes ne doit jamais transiter côté navigateur.
ALTER TABLE mfa_backup_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE mfa_backup_codes IS
  'Codes de secours 2FA (hachés SHA-256). Récupération d''accès uniquement, via edge function mfa-backup-codes. Jamais lu par le client.';
