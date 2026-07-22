-- =============================================
-- FILAO v3.2: Migration 032 — Automated Invitation Notifications (Fixed for jsonb[] type)
-- =============================================

-- This trigger automatically handles notifying the tender creator when
-- an invitation is accepted or refused.
-- Fixed the COALESCE error: your 'notifications' column is using the native 
-- PostgreSQL 'jsonb[]' array type, not a single jsonb object.

CREATE OR REPLACE FUNCTION fn_notify_invitation_response()
RETURNS TRIGGER AS $$
DECLARE
    creator_id UUID;
    tender_title TEXT;
    collaborator_name TEXT;
    new_notif JSONB;
BEGIN
    -- Only trigger when status changes from 'pending' to 'accepted' or 'refused'
    IF (OLD.status = 'pending' AND NEW.status IN ('accepted', 'refused')) THEN
        
        -- 1. Fetch Tender & Creator details
        SELECT createur_id, titre INTO creator_id, tender_title 
        FROM reponses_ao 
        WHERE id = NEW.tender_id;

        IF creator_id IS NOT NULL THEN
            -- 2. Determine collaborator name
            collaborator_name := COALESCE(NEW.email, 'Un collaborateur');

            -- 3. Build the notification JSONB object
            new_notif := jsonb_build_object(
                'id', gen_random_uuid(),
                'type', CASE WHEN NEW.status = 'accepted' THEN 'collaboration_accepted' ELSE 'collaboration_rejected' END,
                'titre', CASE WHEN NEW.status = 'accepted' THEN 'Collaboration acceptée' ELSE 'Collaboration refusée' END,
                'message', CASE WHEN NEW.status = 'accepted' 
                            THEN 'a accepté votre demande de collaboration sur' 
                            ELSE 'a refusé votre invitation à collaborer sur' END,
                'sender_name', collaborator_name,
                'sender_avatar', '',
                'related_tender_id', NEW.tender_id,
                'related_tender_titre', tender_title,
                'date', now(),
                'read', false
            );

            -- 4. Append to creator's notifications (jsonb[] native array)
            -- We use array_append and COALESCE with an empty native array {}
            UPDATE utilisateurs 
            SET notifications = array_append(COALESCE(notifications, ARRAY[]::jsonb[]), new_notif)
            WHERE id = creator_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-drop and re-create trigger
DROP TRIGGER IF EXISTS tr_notify_invitation_response ON invitations;
CREATE TRIGGER tr_notify_invitation_response
AFTER UPDATE ON invitations
FOR EACH ROW
EXECUTE FUNCTION fn_notify_invitation_response();

COMMENT ON FUNCTION fn_notify_invitation_response IS 'Automates owner notifications (Fixed for jsonb[] column type)';
