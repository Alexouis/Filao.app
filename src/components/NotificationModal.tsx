import React, { useState, useEffect } from 'react';
import { X, Loader2, FileText, Users, CheckCircle, Bell } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface Notification {
  id: string;
  type: string;
  titre: string;
  message: string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar?: string;
  related_tender_id?: string;
  related_tender_titre?: string;
  date: string;
  read: boolean;
}

interface NotificationModalProps {
  onClose: () => void;
  onViewAll: () => void;
  unreadCount?: number;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  onClose,
  onViewAll,
  unreadCount = 0
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('utilisateurs')
        .select('notifications')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      const allNotifications = data?.notifications || [];
      const recent = allNotifications
        .sort((a: Notification, b: Notification) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )
        .slice(0, 5);

      setNotifications(recent);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('utilisateurs')
          .select('notifications')
          .eq('id', user.id)
          .single();

        const allNotifications = data?.notifications || [];
        const updated = allNotifications.map((n: Notification) =>
          n.id === notification.id ? { ...n, read: true } : n
        );

        await supabase
          .from('utilisateurs')
          .update({ notifications: updated })
          .eq('id', user.id);
      } catch (error) {
        console.error('Error marking read:', error);
      }
    }
    onViewAll();
  };

  // --- HELPERS ---
  const getIcon = (type: string) => {
    switch (type) {
      case 'collaboration_accepted':
      case 'collaboration_rejected':
      case 'collaborator_invited':
        return <Users size={16} className="text-[#00A3E0]" />;
      case 'document_added':
        return <FileText size={16} className="text-[#00A3E0]" />;
      case 'tender_won':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'tender_lost':
        return <CheckCircle size={16} className="text-red-400" />;
      default:
        return <Bell size={16} className="text-[#00A3E0]" />;
    }
  };

  const getTimeAgo = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return new Date(dateString).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Container — clean white card */}
      <div
        className="fixed left-4 md:left-24 bottom-20 w-[calc(100%-2rem)] md:w-[400px] rounded-2xl bg-white border border-[#0B1F38]/8 shadow-2xl shadow-[#0B1F38]/10 z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-bottom-left"
        role="dialog"
        aria-label="Notifications"
      >
        {/* Header */}
        <div className="px-5 py-4 flex justify-between items-center border-b border-[#0B1F38]/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <Bell size={18} className="text-[#00A3E0]" />
            <span className="font-bold text-[#0B1F38] text-base">Notifications</span>
            {unreadCount > 0 && (
              <span className="text-[10px] text-white font-bold bg-[#FF8575] px-2 py-0.5 rounded-full shadow-sm">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#0B1F38]/40 hover:text-[#0B1F38] transition-colors p-1.5 rounded-lg hover:bg-[#0B1F38]/5"
          >
            <X size={18} />
          </button>
        </div>

        {/* List Content */}
        <div className="overflow-y-auto max-h-[55vh] min-h-[160px]" style={{ scrollbarWidth: 'none' }}>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-[#00A3E0]" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-10 text-[#0B1F38]/40 text-sm">
              <Bell size={28} className="mx-auto mb-2 opacity-30" />
              Aucune notification récente
            </div>
          ) : (
            <div className="py-1">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`px-4 py-3 hover:bg-[#0B1F38]/[0.03] transition-colors flex gap-3 items-start cursor-pointer group border-b border-[#0B1F38]/5 last:border-0 ${!notif.read ? 'bg-[#00A3E0]/[0.04]' : ''}`}
                >
                  {/* Avatar / Icon */}
                  <div className="shrink-0 mt-0.5">
                    {notif.sender_avatar ? (
                      <img
                        src={notif.sender_avatar}
                        alt={notif.sender_name || ''}
                        className="w-9 h-9 rounded-full object-cover border border-[#0B1F38]/10 shadow-sm"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full border border-[#0B1F38]/8 bg-[#00A3E0]/10 flex items-center justify-center shadow-sm">
                        {getIcon(notif.type)}
                      </div>
                    )}
                  </div>

                  {/* Text Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#0B1F38]/80 leading-snug group-hover:text-[#0B1F38] transition-colors line-clamp-2">
                      {notif.sender_name && (
                        <span className="font-bold text-[#0B1F38]">{notif.sender_name} </span>
                      )}
                      {notif.message}
                      {notif.related_tender_titre && (
                        <span className="font-bold text-[#00A3E0] ml-1">{notif.related_tender_titre}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-[#0B1F38]/40 font-medium">
                        {getTimeAgo(notif.date)}
                      </span>
                      {!notif.read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#FF8575] shrink-0" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#0B1F38]/5 shrink-0">
          <button
            onClick={onViewAll}
            className="w-full py-2.5 bg-[#FF8575] hover:bg-[#ff715e] text-white text-sm font-bold rounded-xl transition-all shadow-sm hover:shadow-md hover:shadow-[#FF8575]/20 active:scale-[0.99]"
          >
            Voir toutes les notifications
          </button>
        </div>
      </div>
    </>
  );
};