-- =============================================
-- FILAO: Migration 056 — File d'envoi et journal des emails (Lot 1)
-- =============================================
--
-- Socle de l'industrialisation des emails transactionnels. Deux tables :
--
--   • emails_a_envoyer  — la FILE. Une tâche planifiée calcule les emails à
--     produire (échéances, récap, etc.) et écrit ici. Une seconde fonction
--     consomme la file et envoie. Séparer calcul et envoi permet de rejouer
--     l'envoi après incident sans recalculer, et inversement.
--
--   • emails_envoyes    — le JOURNAL. Une ligne par tentative d'envoi, enrichie
--     ensuite par les webhooks du prestataire (livré, ouvert, bounce…). Rend
--     chaque envoi traçable pour trancher un « je n'ai rien reçu ».
--
-- Ce lot ne crée que le socle : les fonctions de calcul/consommation et les
-- webhooks viennent dans les lots suivants.

-- ---------------------------------------------------------------
-- 1. File d'envoi
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emails_a_envoyer (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Clé d'idempotence métier : un même email logique ne doit être enfilé
  -- qu'une fois. `objet_id` référence l'entité concernée (dossier, document…)
  -- sans FK stricte car le type d'objet varie selon type_email.
  type_email    TEXT NOT NULL,
  objet_id      UUID,
  destinataire  TEXT NOT NULL,
  -- `jour_cible` = date (sans heure) à laquelle l'email doit partir. Fait partie
  -- de la clé d'idempotence : « J-7 pour ce dossier, pour ce destinataire, ce
  -- jour-là » est unique.
  jour_cible    DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Charge utile résolue au moment du calcul (sujet, variables de gabarit…).
  payload       JSONB NOT NULL DEFAULT '{}',

  -- Cycle de vie dans la file.
  statut        TEXT NOT NULL DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente','en_cours','envoye','echoue','annule')),
  tentatives    INTEGER NOT NULL DEFAULT 0,
  derniere_erreur TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotence : clé (type_email, objet_id, destinataire, jour_cible).
-- COALESCE sur objet_id car certains emails n'ont pas d'objet (bienvenue) —
-- un index UNIQUE ignore les NULL, on les neutralise donc par un uuid nul.
CREATE UNIQUE INDEX IF NOT EXISTS uq_emails_a_envoyer_idempotence
  ON emails_a_envoyer (type_email, COALESCE(objet_id, '00000000-0000-0000-0000-000000000000'::uuid), destinataire, jour_cible);

-- Parcours de consommation : la file lit les 'en_attente' par ancienneté.
CREATE INDEX IF NOT EXISTS idx_emails_a_envoyer_a_traiter
  ON emails_a_envoyer (statut, jour_cible) WHERE statut = 'en_attente';

-- ---------------------------------------------------------------
-- 2. Journal d'envoi
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emails_envoyes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_email     TEXT NOT NULL,
  destinataire   TEXT NOT NULL,
  objet          TEXT,               -- sujet de l'email
  objet_id       UUID,               -- entité liée (traçabilité côté fiche)
  destinataire_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,

  -- Statut de délivrance, enrichi par les webhooks prestataire.
  statut         TEXT NOT NULL DEFAULT 'envoye'
    CHECK (statut IN ('envoye','livre','ouvert','clique','differe','bounce','plainte','erreur')),
  identifiant_prestataire TEXT,      -- messageId Brevo
  erreur         TEXT,

  horodatage     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emails_envoyes_destinataire ON emails_envoyes (destinataire, horodatage DESC);
CREATE INDEX IF NOT EXISTS idx_emails_envoyes_objet ON emails_envoyes (objet_id) WHERE objet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_envoyes_prestataire ON emails_envoyes (identifiant_prestataire) WHERE identifiant_prestataire IS NOT NULL;

-- ---------------------------------------------------------------
-- 3. Adresses en rejet définitif (hard bounce / plainte)
-- ---------------------------------------------------------------
-- Une adresse en rejet définitif doit être EXCLUE des envois suivants pour
-- protéger la réputation. Alimentée par les webhooks (bounce dur, plainte).
CREATE TABLE IF NOT EXISTS emails_bloques (
  destinataire  TEXT PRIMARY KEY,
  motif         TEXT NOT NULL CHECK (motif IN ('hard_bounce','plainte','desinscription')),
  bloque_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------
-- File et journal sont opérés par le service_role (fonctions planifiées et
-- webhooks). Les tables restent en RLS activée SANS policy pour les rôles
-- authenticated : par défaut, aucun accès direct client, ce qui est voulu.
-- La consultation du journal côté admin/mandataire se fera via une vue ou une
-- fonction dédiée dans un lot ultérieur (avec sa propre policy), pas par accès
-- direct à la table.
ALTER TABLE emails_a_envoyer ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails_envoyes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE emails_bloques   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- 5. Vérification
-- ---------------------------------------------------------------
--   \d emails_a_envoyer
--   -- l'idempotence rejette un doublon :
--   insert into emails_a_envoyer (type_email, objet_id, destinataire)
--     values ('deadline_j7', '...uuid...', 'a@b.fr');
--   insert ... (mêmes valeurs)  -> doit échouer sur uq_emails_a_envoyer_idempotence
