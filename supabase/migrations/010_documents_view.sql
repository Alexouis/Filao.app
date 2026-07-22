-- =============================================
-- FILAO v3.1: Migration 010 — Vue expiration documents
-- =============================================
-- SECURITY INVOKER est le défaut en PG15+.
-- Supabase utilise PG15+, donc la vue hérite du RLS de la table sous-jacente.
-- On le spécifie explicitement par sécurité.

CREATE OR REPLACE VIEW documents_entreprise_view
  WITH (security_invoker = true)
AS
SELECT *,
  CASE
    WHEN date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE THEN 'expire'
    ELSE statut
  END AS statut_effectif
FROM documents_entreprise;
