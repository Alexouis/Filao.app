-- =============================================
-- FILAO: Migration 124 — Colonne `entreprises.description`
-- =============================================
--
-- La 002 devait l'ajouter, mais elle se termine par un
-- `referent_id SET NOT NULL` : appliquée alors qu'une entreprise n'avait aucun
-- utilisateur, elle a échoué et tout son contenu a été annulé. La colonne
-- n'a donc jamais existé en base, alors que l'application la lit (fiche du
-- réseau) et l'écrit désormais (présentation de l'entreprise) — toute
-- sauvegarde de la fiche échouait : « Could not find the 'description'
-- column of 'entreprises' in the schema cache ».
--
-- Idempotente : sans effet si la colonne a déjà été ajoutée à la main.

ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS description TEXT;

-- Borne alignée sur l'écran (1 000 caractères). NOT VALID : sans échec sur
-- d'éventuelles valeurs existantes plus longues.
ALTER TABLE entreprises DROP CONSTRAINT IF EXISTS entreprises_description_longueur;
ALTER TABLE entreprises
  ADD CONSTRAINT entreprises_description_longueur CHECK (char_length(coalesce(description, '')) <= 1000) NOT VALID;

-- Le cache de schéma de l'API ne voit une nouvelle colonne qu'après
-- rechargement.
NOTIFY pgrst, 'reload schema';
