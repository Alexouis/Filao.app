-- =============================================
-- FILAO v3.1: Migration 006b — Migrer JSONB collaborateurs → groupements
-- =============================================
-- Les valeurs JSONB utilisent déjà 'Mandataire', 'Co-traitant', 'Sous-traitant'
-- (confirmé dans config.ts:380 et TenderWizard.tsx)
-- COALESCE fallback 'Sous-traitant' couvre les cas null

INSERT INTO groupements (projet_id, entreprise_id, role_groupement, statut, invite_par, date_invitation)
SELECT
  r.id AS projet_id,
  (c->>'entreprise_id')::uuid AS entreprise_id,
  COALESCE(c->>'role', 'Sous-traitant') AS role_groupement,
  CASE (c->>'status')
    WHEN 'approved' THEN 'accepte'
    WHEN 'refused' THEN 'refuse'
    WHEN 'pending' THEN 'invite'
    ELSE 'invite'
  END AS statut,
  r.createur_id AS invite_par,
  r.created_at AS date_invitation
FROM reponses_ao r,
  jsonb_array_elements(r.collaborateurs) AS c
WHERE r.collaborateurs IS NOT NULL
  AND jsonb_typeof(r.collaborateurs) = 'array'
  AND (c->>'entreprise_id') IS NOT NULL
  AND (c->>'deleted')::boolean IS DISTINCT FROM true
ON CONFLICT (projet_id, entreprise_id) DO NOTHING;
