-- =============================================
-- FILAO: Migration 052 — Date de décision des dossiers (Gagné / Perdu)
-- =============================================
--
-- CONTEXTE
-- Le tableau de bord affiche une tendance du taux de succès (90 jours vs. les
-- 90 jours précédents). Faute de date de décision dédiée, ce calcul situait la
-- clôture d'un dossier avec `modified_at` — une approximation : un dossier
-- gagné puis modifié pour une autre raison (ajout d'une pièce, correction)
-- ressortait daté de cette dernière retouche, faussant la fenêtre.
--
-- POURQUOI UNE COLONNE DÉDIÉE
-- Réutiliser `modified_at` mélange deux faits distincts : « quand a-t-on touché
-- le dossier » et « quand a-t-il été tranché ». Seul le second sert à mesurer
-- une performance dans le temps. La colonne isole ce fait et le fige : une
-- modification ultérieure ne le déplace plus.
--
-- HISTORIQUE
-- Les dossiers déjà clôturés avant cette migration n'ont pas de date de
-- décision connue. On les laisse volontairement à NULL plutôt que d'y recopier
-- `modified_at`, ce qui fabriquerait une précision qui n'existe pas. Le front
-- retombe sur `modified_at` tant que `date_decision` est absente : aucune
-- régression, et la donnée se fiabilise à mesure que de nouveaux dossiers sont
-- tranchés.

ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS date_decision TIMESTAMPTZ;

COMMENT ON COLUMN reponses_ao.date_decision IS
  'Horodatage du passage à Gagné ou Perdu. NULL tant que le dossier n''est pas tranché, ou pour les dossiers clôturés avant la migration 052. Distinct de `modified_at`, qui suit toute modification.';

-- Le tableau de bord filtre les dossiers clôturés par fenêtre de temps :
-- l'index couvre ce parcours (clôturés récents d'abord).
CREATE INDEX IF NOT EXISTS idx_reponses_ao_date_decision
  ON reponses_ao (date_decision DESC) WHERE date_decision IS NOT NULL;

-- ---------------------------------------------------------------
-- 1. Renseignement automatique
-- ---------------------------------------------------------------
-- La date est posée en base, pas côté client : un dossier peut être tranché par
-- un appel direct à l'API, par une action back, ou par plusieurs écrans
-- différents. Centraliser la règle dans un trigger garantit qu'elle s'applique
-- quelle que soit la voie d'écriture.
--
-- Règle :
--   • passage vers Gagné/Perdu, date encore vide → on pose now().
--   • sortie de Gagné/Perdu (réouverture, retour En cours) → on remet à NULL,
--     sinon un dossier rouvert garderait une date de décision périmée.
--   • une date déjà posée n'est pas écrasée si le statut reste clôturé : la
--     décision initiale fait foi, on ne la redate pas à chaque retouche.

CREATE OR REPLACE FUNCTION poser_date_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.statut IN ('Gagné', 'Perdu') THEN
        -- Ne dater que la première clôture, ou une clôture qui n'avait pas de
        -- date (dossier importé, correction manuelle).
        IF NEW.date_decision IS NULL THEN
            NEW.date_decision := now();
        END IF;
    ELSE
        -- Le dossier n'est plus clôturé : la date de décision n'a plus de sens.
        NEW.date_decision := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_date_decision ON reponses_ao;

CREATE TRIGGER trg_date_decision
    BEFORE INSERT OR UPDATE OF statut ON reponses_ao
    FOR EACH ROW
    EXECUTE FUNCTION poser_date_decision();

-- ---------------------------------------------------------------
-- 2. Vérification
-- ---------------------------------------------------------------
--   update reponses_ao set statut = 'Gagné' where id = '<id>';
--   select statut, date_decision from reponses_ao where id = '<id>';
--     -> date_decision renseignée
--
--   update reponses_ao set statut = 'En cours' where id = '<id>';
--   select date_decision from reponses_ao where id = '<id>';
--     -> NULL
--
-- ⚠️ Cette migration ne rétro-date PAS l'historique : les dossiers déjà
--    clôturés restent à NULL par choix. Le front les traite via le repli sur
--    `modified_at`.