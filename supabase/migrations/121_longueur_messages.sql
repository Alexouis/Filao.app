-- =============================================
-- FILAO: Migration 121 — Longueur des messages et commentaires
-- =============================================
--
-- Aucune limite n'existait, ni à l'écran ni en base : un message ou un
-- commentaire de plusieurs mégaoctets était accepté, puis recopié dans les
-- notifications et les récapitulatifs par e-mail. On borne à 5 000
-- caractères, largement au-delà d'un échange normal.
--
-- NOT VALID : la contrainte s'applique aux nouvelles écritures sans échouer
-- sur d'éventuelles lignes existantes plus longues.

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_longueur;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_longueur CHECK (char_length(coalesce(content, '')) <= 5000) NOT VALID;

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_longueur;
ALTER TABLE comments
  ADD CONSTRAINT comments_longueur CHECK (char_length(coalesce(content, '')) <= 5000) NOT VALID;
