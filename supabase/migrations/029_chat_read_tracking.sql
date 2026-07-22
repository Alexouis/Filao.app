-- =============================================
-- FILAO v4.0: Migration 029 — Chat Read Tracking
-- =============================================

-- Table to track the last time a user viewed a specific tender's chat
CREATE TABLE IF NOT EXISTS chat_last_viewed (
    user_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    tender_id UUID NOT NULL REFERENCES reponses_ao(id) ON DELETE CASCADE,
    last_viewed_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, tender_id)
);

-- Row Level Security (RLS)
ALTER TABLE chat_last_viewed ENABLE ROW LEVEL SECURITY;

-- Policy: Only I can see/update my own view markers
CREATE POLICY "Acces individuel chat_last_viewed" ON chat_last_viewed
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_chat_last_viewed_user_id ON chat_last_viewed(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_last_viewed_tender_id ON chat_last_viewed(tender_id);
