-- =============================================
-- FILAO v3.1: Migration 006 — Créer groupements
-- =============================================

CREATE TABLE IF NOT EXISTS groupements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projet_id UUID NOT NULL REFERENCES reponses_ao(id) ON DELETE CASCADE,
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  role_groupement TEXT NOT NULL
    CHECK (role_groupement IN ('Mandataire','Co-traitant','Sous-traitant')),
  statut TEXT DEFAULT 'invite'
    CHECK (statut IN ('invite','accepte','refuse','retire')),
  date_invitation TIMESTAMPTZ DEFAULT now(),
  date_reponse TIMESTAMPTZ,
  invite_par UUID REFERENCES utilisateurs(id),
  UNIQUE(projet_id, entreprise_id)
);
