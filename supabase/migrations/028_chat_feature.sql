-- =============================================
-- FILAO v4.0: Migration 028 — Chat Feature
-- =============================================

-- 1. Create messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tender_id UUID NOT NULL REFERENCES reponses_ao(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    type TEXT DEFAULT 'text' CHECK (type IN ('text', 'file', 'system')),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Enable Realtime
ALTER TABLE chat_messages REPLICA IDENTITY FULL;
-- Note: Realtime must also be enabled in the Supabase Dashboard for the 'public' schema or specifically for this table.
-- Usually: ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages; (Handled by Supabase if toggled)

-- 3. Row Level Security (RLS)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Lecture messages
-- A user can read messages if they are the tender creator OR if their company is an accepted member of the groupement.
CREATE POLICY "Lecture chat_messages" ON chat_messages
    FOR SELECT
    USING (
        -- I am the tender creator
        tender_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
        OR
        -- OR I am a member of the team
        tender_id IN (
            SELECT projet_id FROM groupements 
            WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
            AND statut = 'accepte'
        )
    );

-- Policy: Envoi messages
-- A user can insert messages if they are an accepted member of the tender team (creator is implicitly part of it).
CREATE POLICY "Insertion chat_messages" ON chat_messages
    FOR INSERT
    WITH CHECK (
        tender_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
        OR
        tender_id IN (
            SELECT projet_id FROM groupements 
            WHERE entreprise_id IN (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
            AND statut = 'accepte'
        )
    );

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_tender_id ON chat_messages(tender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
