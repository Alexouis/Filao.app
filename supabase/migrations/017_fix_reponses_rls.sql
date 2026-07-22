-- =============================================
-- FILAO v3.1: Migration 017 — Fix RLS Reponses AO (Insert)
-- =============================================

-- Le check précédent sur role_entreprise IN ('admin', 'membre') bloquait la création
-- si l'utilisateur n'avait pas le rôle défini (ou null).
-- On simplifie pour autoriser tout utilisateur authentifié à créer SON dossier.

DROP POLICY IF EXISTS "reponses_ao_insert" ON reponses_ao;

CREATE POLICY "reponses_ao_insert" ON reponses_ao FOR INSERT WITH CHECK (
  auth.uid() = createur_id
);
