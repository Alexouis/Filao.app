-- =============================================
-- FILAO: Migration 045 — Traçabilité de l'inscription
-- =============================================
--
-- CONTEXTE
-- La fiche « Création de compte » demande deux traces que rien ne conserve
-- aujourd'hui :
--
--  * « Acceptation des CGU horodatée et tracée ». La case existe et bloque le
--    formulaire, mais son état n'est enregistré nulle part. En cas de
--    contestation, rien ne permet d'établir qu'un utilisateur a accepté, ni
--    quelle version il a acceptée — une case cochée qui ne laisse pas de trace
--    n'a aucune valeur probante.
--
--  * « Tracer la source d'inscription (invitation, annuaire, landing,
--    referral) », désignée comme prérequis de l'analyse d'acquisition. Sans
--    elle, impossible de savoir si le mécanisme d'invitation amène réellement
--    des comptes — ce qui est pourtant la question centrale du produit.

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS cgu_acceptees_le TIMESTAMPTZ,
  -- La version acceptée, pas seulement la date : des CGU modifiées depuis
  -- rendraient l'horodatage inexploitable.
  ADD COLUMN IF NOT EXISTS cgu_version TEXT,
  ADD COLUMN IF NOT EXISTS source_inscription TEXT,
  -- Contexte de la source. Pour une invitation, l'identifiant du dossier :
  -- c'est ce qui permettra de mesurer la conversion du parcours partenaire.
  ADD COLUMN IF NOT EXISTS source_detail TEXT;

COMMENT ON COLUMN utilisateurs.cgu_acceptees_le IS
  'Horodatage de l''acceptation des conditions générales. Valeur probante en cas de contestation.';
COMMENT ON COLUMN utilisateurs.cgu_version IS
  'Version des CGU acceptée, au format AAAA-MM-JJ.';
COMMENT ON COLUMN utilisateurs.source_inscription IS
  'Origine du compte : invitation, annuaire, landing, referral, direct.';
COMMENT ON COLUMN utilisateurs.source_detail IS
  'Précision sur la source — identifiant du dossier pour une invitation, campagne pour une landing.';

-- Valeurs attendues, sans contrainte stricte : une source inconnue vaut mieux
-- qu'une inscription refusée parce qu'un canal n'avait pas été prévu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'utilisateurs_source_inscription_connue') THEN
    ALTER TABLE utilisateurs
      ADD CONSTRAINT utilisateurs_source_inscription_connue
      CHECK (source_inscription IS NULL OR source_inscription IN
             ('invitation', 'annuaire', 'landing', 'referral', 'direct'))
      NOT VALID;
  END IF;
END $$;

-- Analyse d'acquisition : cette colonne sera groupée, jamais filtrée par égalité
-- sur une valeur unique.
CREATE INDEX IF NOT EXISTS idx_utilisateurs_source_inscription
  ON utilisateurs (source_inscription) WHERE source_inscription IS NOT NULL;

-- ---------------------------------------------------------------
-- Vérification
-- ---------------------------------------------------------------
--   select source_inscription, count(*) from utilisateurs group by 1 order by 2 desc;
--   select count(*) filter (where cgu_acceptees_le is null) as sans_trace from utilisateurs;
--
-- ⚠️ Les comptes existants n'ont ni trace d'acceptation ni source : ces
--    informations n'ont jamais été collectées et ne peuvent pas être
--    reconstituées. Seules les inscriptions à venir seront renseignées.