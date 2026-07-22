// notificationHelpers.ts
// Notification system with preference-based filtering
// Checks notification_preferences before creating in-app or email notifications

import { supabase } from '../lib/supabaseClient';
import { Notifications } from '@/config';

// Preference keys matching the notification_preferences JSONB structure
type NotifPrefKey = 'nouveau_document' | 'rappels' | 'messages_feed' | 'communications';

/**
 * Fetch a user's notification preferences
 */
const getUserPreferences = async (userId: string) => {
  const { data, error } = await supabase
    .from('utilisateurs')
    .select('notification_preferences, email, prenom, nom')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
};

/**
 * Send a notification email via the send-notification-email Edge Function
 */
const sendNotificationEmail = async (
  recipientEmail: string,
  recipientName: string,
  eventType: NotifPrefKey,
  senderName: string | undefined,
  tenderTitle: string,
  detail: string
) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    await fetch(`${supabaseUrl}/functions/v1/send-notification-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        recipientEmail,
        recipientName,
        eventType,
        senderName,
        tenderTitle,
        detail,
      }),
    });
  } catch (err) {
    console.error('Error sending notification email:', err);
  }
};

/**
 * Add a notification to a user's notification array.
 * Routes through the `notify-user` Edge Function which uses SUPABASE_SERVICE_ROLE_KEY
 * to bypass RLS — enabling cross-user notifications safely from the client.
 *
 * If prefKey is provided, the edge function checks user preferences before writing.
 * If prefKey is null, the notification is always created (critical system events).
 */
export const addNotification = async (
  userId: string,
  notificationData: Omit<Notifications, 'id' | 'date' | 'read'>,
  prefKey: NotifPrefKey | null = null
): Promise<boolean> => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    if (!session || !supabaseUrl) {
      console.warn('addNotification: no session or supabaseUrl, skipping');
      return false;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/notify-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        userId,
        notification: notificationData,
        prefKey,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('notify-user edge function error:', err);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error adding notification:', error);
    return false;
  }
};

// =========================================================================
// PREFERENCE-FILTERED NOTIFICATIONS
// These check notification_preferences before creating in-app/email notifs
// =========================================================================

/**
 * Notify when a document is added to a tender
 * prefKey: nouveau_document
 */
export const notifyDocumentAdded = async (
  recipientIds: string[],
  uploaderName: string,
  uploaderAvatar: string,
  tenderId: string,
  tenderTitle: string,
  documentName: string
) => {
  const promises = recipientIds.map(userId =>
    addNotification(userId, {
      type: 'document_added',
      titre: 'Document ajouté',
      message: `a ajouté le document "${documentName}" à`,
      sender_name: uploaderName,
      sender_avatar: uploaderAvatar,
      related_tender_id: tenderId,
      related_tender_titre: tenderTitle
    }, 'nouveau_document')
  );

  return Promise.all(promises);
};

/**
 * Notify about an upcoming deadline (3 days before)
 * prefKey: rappels
 */
export const notifyDeadlineReminder = async (
  userId: string,
  tenderId: string,
  tenderTitle: string,
  deadlineDate: string
) => {
  return addNotification(userId, {
    type: 'deadline_reminder',
    titre: 'Date limite proche',
    message: `La date limite pour l'appel d'offres approche :`,
    related_tender_id: tenderId,
    related_tender_titre: `${tenderTitle} (${new Date(deadlineDate).toLocaleDateString('fr-FR')})`
  }, 'rappels');
};

/**
 * Notify collaborators who are missing documents
 * prefKey: rappels
 */
export const notifyDocumentReminder = async (
  recipientIds: string[],
  senderName: string,
  tenderId: string,
  tenderTitle: string
) => {
  const promises = recipientIds.map(userId =>
    addNotification(userId, {
      type: 'document_reminder',
      titre: 'Rappel de documents',
      message: `Vous avez des documents manquants pour l'appel d'offres`,
      sender_name: senderName,
      related_tender_id: tenderId,
      related_tender_titre: tenderTitle
    }, 'rappels')
  );

  return Promise.all(promises);
};

/**
 * Notify when someone adds a comment
 * prefKey: messages_feed
 */
export const notifyCommentAdded = async (
  recipientIds: string[],
  commenterName: string,
  commenterAvatar: string,
  tenderId: string,
  tenderTitle: string,
  commentPreview: string
) => {
  const promises = recipientIds.map(userId =>
    addNotification(userId, {
      type: 'comment_added',
      titre: 'Nouveau commentaire',
      message: `a commenté sur`,
      sender_name: commenterName,
      sender_avatar: commenterAvatar,
      related_tender_id: tenderId,
      related_tender_titre: `${tenderTitle}: "${commentPreview}"`
    }, 'messages_feed')
  );

  return Promise.all(promises);
};

// =========================================================================
// ALWAYS-SEND NOTIFICATIONS (critical system events, no preference filter)
// =========================================================================

/**
 * Notify when a collaborator accepts an invitation
 */
export const notifyCollaborationAccepted = async (
  creatorId: string,
  collaboratorName: string,
  collaboratorAvatar: string,
  tenderId: string,
  tenderTitle: string
) => {
  return addNotification(creatorId, {
    type: 'collaboration_accepted',
    titre: 'Collaboration acceptée',
    message: 'a accepté votre demande de collaboration sur',
    sender_name: collaboratorName,
    sender_avatar: collaboratorAvatar,
    related_tender_id: tenderId,
    related_tender_titre: tenderTitle
  });
};

/**
 * Notify when a collaborator rejects an invitation
 */
export const notifyCollaborationRejected = async (
  creatorId: string,
  collaboratorName: string,
  collaboratorAvatar: string,
  tenderId: string,
  tenderTitle: string
) => {
  return addNotification(creatorId, {
    type: 'collaboration_rejected',
    titre: 'Collaboration refusée',
    message: 'a refusé votre invitation à collaborer sur',
    sender_name: collaboratorName,
    sender_avatar: collaboratorAvatar,
    related_tender_id: tenderId,
    related_tender_titre: tenderTitle
  });
};

/**
 * Notify when an accepted collaborator voluntarily quits a groupement
 */
export const notifyCollaborationLeft = async (
  creatorId: string,
  collaboratorName: string,
  collaboratorAvatar: string,
  tenderId: string,
  tenderTitle: string
) => {
  return addNotification(creatorId, {
    type: 'collaboration_left',
    titre: 'Départ du groupement',
    message: 'a quitté le groupement pour',
    sender_name: collaboratorName,
    sender_avatar: collaboratorAvatar,
    related_tender_id: tenderId,
    related_tender_titre: tenderTitle
  });
};

/**
 * Notify when a tender is won
 */
export const notifyTenderWon = async (
  userId: string,
  tenderId: string,
  tenderTitle: string,
  amount: number
) => {
  return addNotification(userId, {
    type: 'tender_won',
    titre: 'Appel d\'offres remporté !',
    message: `Félicitations ! Vous avez remporté l'appel d'offres`,
    related_tender_id: tenderId,
    related_tender_titre: `${tenderTitle} (${amount}€)`
  });
};

/**
 * Notify when a tender is lost
 */
export const notifyTenderLost = async (
  userId: string,
  tenderId: string,
  tenderTitle: string
) => {
  return addNotification(userId, {
    type: 'tender_lost',
    titre: 'Appel d\'offres non remporté',
    message: `Malheureusement, l'appel d'offres n'a pas été remporté :`,
    related_tender_id: tenderId,
    related_tender_titre: tenderTitle
  });
};

/**
 * Notify when invited as collaborator
 */
export const notifyCollaboratorInvited = async (
  recipientId: string,
  inviterName: string,
  inviterAvatar: string,
  tenderId: string,
  tenderTitle: string
) => {
  return addNotification(recipientId, {
    type: 'collaborator_invited',
    titre: 'Invitation à collaborer',
    message: 'vous a invité à collaborer sur',
    sender_name: inviterName,
    sender_avatar: inviterAvatar,
    related_tender_id: tenderId,
    related_tender_titre: tenderTitle
  });
};

/**
 * Deletes the 'collaborator_invited' notification for a specific tender from a user's list.
 * Used when a creator revokes a pending invitation.
 * Routes through the notify-user edge function to bypass RLS.
 */
export const deleteInvitationNotification = async (
  userId: string,
  tenderId: string
) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!session || !supabaseUrl) return;

    await fetch(`${supabaseUrl}/functions/v1/notify-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        userId,
        action: 'delete',
        deleteFilter: { type: 'collaborator_invited', related_tender_id: tenderId },
      }),
    });
  } catch (error) {
    console.error('Error removing notification:', error);
  }
};

/**
 * Notify when a user accepts a network invitation.
 * Sent to the original inviter.
 */
export const notifyNetworkInviteAccepted = async (
  recipientId: string,
  accepterName: string,
  accepterAvatar: string
) => {
  return addNotification(recipientId, {
    type: 'network_invite_accepted',
    titre: 'Invitation réseau acceptée',
    message: 'a accepté votre invitation réseau',
    sender_name: accepterName,
    sender_avatar: accepterAvatar,
  });
};