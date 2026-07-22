import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { UserProfile, Notifications } from '../config'; // Or wherever your type is defined

export const useNotificationListener = (userProfile: UserProfile | null) => {
  // Use a ref to track the previous notification count to identify NEW ones
  const prevNotificationsLength = useRef<number>(0);

  useEffect(() => {
    if (!userProfile) return;

    // Initialize the ref with current count
    const currentCount = Array.isArray(userProfile.notifications) ? userProfile.notifications.length : 0;
    prevNotificationsLength.current = currentCount;

    // 1. Define the channel
    const channel = supabase
      .channel(`notifications:${userProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'utilisateurs',
          filter: `id=eq.${userProfile.id}`,
        },
        (payload: any) => {
          const newData = payload.new;
          const oldData = payload.old;

          // 2. Check if notifications array has grown
          const newNotifs: Notifications[] = newData.notifications || [];
          const oldNotifs: Notifications[] = oldData.notifications || [];

          if (newNotifs.length > oldNotifs.length) {
            // Get the newest notification (Assuming unshift was used in helpers, index 0 is newest)
            // If push was used, logic would be newNotifs[newNotifs.length - 1]
            const newestNotification = newNotifs[0];

            // 3. Trigger Alert if enabled
            if (newData.notifications_on) {
              triggerBrowserNotification(newestNotification);
              playNotificationSound();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userProfile?.id]); // Re-run only if user changes
};

// --- HELPER FUNCTIONS ---

const triggerBrowserNotification = (notification: Notifications) => {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    // Create the system notification
    const notif = new window.Notification(notification.titre, {
      body: notification.message + (notification.related_tender_titre ? ` (${notification.related_tender_titre})` : ''),
      icon: '/favicon.ico', // Path to your app icon
      tag: notification.id, // Prevents duplicate notifications
    });

    // Handle click on the notification
    notif.onclick = function (event) {
      event.preventDefault();
      window.focus();
      // Optionally redirect user here:
      // window.location.href = '/notifications'; 
      notif.close();
    };
  }
};

const playNotificationSound = () => {
  // Simple beep or load a custom mp3
  //   const audio = new Audio('/notification-sound.mp3');
  //   audio.play().catch(e => console.log('Audio play failed', e));
};