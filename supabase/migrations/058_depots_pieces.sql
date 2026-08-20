-- =============================================
-- FILAO: Migration 058 — Suivi des dépôts de pièces (Lot 4)
-- =============================================
--
-- Trace chaque dépôt de pièce sur un dossier. Deux usages :
--   • Récapitulatif quotidien 18h : agréger les dépôts du jour par destinataire
--     et envoyer UN email plutôt qu'un par pièce.
--   • Journal côté fiche partenaire (Lot 6).
--
-- Les fichiers eux-mêmes restent dans le bucket Storage `documents` ; cette
-- table ne porte que les métadonnées de traçabilité (qui a déposé quoi, quand,
-- sur quel dossier, pour qui). Alimentée par le flux d'upload
-- (CollaboratorSubmission), au même endroit que la notification in-app.

CREATE TABLE IF NOT EXISTS depots_pieces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       UUID NOT NULL REFERENCES reponses_ao(id) ON DELETE CASCADE,
  -- Destinataire du récap : le créateur du dossier (celui que ça concerne).
  destinataire_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  -- Auteur du dépôt (partenaire). Peut être un invité sans compte : on garde
  -- au moins un libellé.
  auteur_id       UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
  auteur_libelle  TEXT,
  -- Type/nom de la pièce déposée (Kbis, DC1…).
  type_piece      TEXT,
  nom_piece       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parcours du récap : « dépôts du jour pour ce destinataire ».
CREATE INDEX IF NOT EXISTS idx_depots_pieces_destinataire_jour
  ON depots_pieces (destinataire_id, created_at DESC);
-- Parcours fiche partenaire : dépôts d'un dossier.
CREATE INDEX IF NOT EXISTS idx_depots_pieces_tender
  ON depots_pieces (tender_id, created_at DESC);

-- RLS : le destinataire voit les dépôts qui le concernent ; l'écriture passe
-- par le flux applicatif (utilisateur authentifié déposant sur un dossier).
ALTER TABLE depots_pieces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "depots_pieces_select" ON depots_pieces;
CREATE POLICY "depots_pieces_select"
  ON depots_pieces FOR SELECT TO authenticated
  USING (
    destinataire_id = auth.uid()
    OR auteur_id = auth.uid()
    -- le créateur du dossier y a accès (fiche partenaire côté mandataire)
    OR tender_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
  );

DROP POLICY IF EXISTS "depots_pieces_insert" ON depots_pieces;
CREATE POLICY "depots_pieces_insert"
  ON depots_pieces FOR INSERT TO authenticated
  WITH CHECK (auteur_id = auth.uid() OR auteur_id IS NULL);

-- Vérification :
--   insert into depots_pieces (tender_id, destinataire_id, auteur_libelle, type_piece)
--     values ('<tender>', '<user>', 'Alice', 'kbis');
--   select * from depots_pieces where destinataire_id = '<user>'
--     and created_at >= date_trunc('day', now());
