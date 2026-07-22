import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Trash2, Check, Loader2, FileText, Users, CheckCircle, Clock, MessageSquare } from 'lucide-react';
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
  link?: string;
}

interface NotificationsProps {
  onNavigate?: (tab: string, tenderId?: string) => void;
}

const NotificationItem: React.FC<{
  notification: Notification;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onNavigate?: (tab: string, tenderId?: string) => void;
}> = ({
  notification,
  selected,
  onSelect,
  onDelete,
  onMarkAsRead,
  onNavigate
}) => {
    const getIcon = () => {
      switch (notification.type) {
        case 'collaboration_accepted':
        case 'collaboration_rejected':
        case 'collaborator_invited':
        case 'network_invite':
        case 'network_invite_accepted':
          return <Users size={20} />;
        case 'document_added':
        case 'document_reminder':
          return <FileText size={20} />;
        case 'tender_won':
          return <CheckCircle size={20} className="text-green-500" />;
        case 'tender_lost':
          return <CheckCircle size={20} className="text-red-500" />;
        case 'deadline_reminder':
          return <Clock size={20} className="text-orange-500" />;
        case 'comment_added':
          return <MessageSquare size={20} />;
        default:
          return <FileText size={20} />;
      }
    };

    const handleClick = () => {
      if (!notification.read) {
        onMarkAsRead(notification.id);
      }

      // Network notifications navigate to the collaborators tab
      if ((notification.type === 'network_invite' || notification.type === 'network_invite_accepted') && onNavigate) {
        onNavigate('collaborators');
        return;
      }

      if (notification.related_tender_id && onNavigate) {
        onNavigate('tenders', notification.related_tender_id);
      }
    };

    return (
      <div 
        className={`p-4 md:p-5 flex items-center gap-4 border-b border-[#0B1F38]/5 last:border-0 hover:bg-white/60 transition-colors group cursor-pointer ${!notification.read ? 'bg-white/80' : 'bg-transparent'}`}
        onClick={handleClick}
      >
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onSelect(notification.id)}
            className="w-5 h-5 rounded border border-[#0B1F38]/20 bg-white cursor-pointer accent-[#00A3E0]"
          />
        </div>

        <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center">
          {notification.sender_avatar ? (
            <img
              src={notification.sender_avatar}
              alt={notification.sender_name || ''}
              className="w-12 h-12 rounded-full object-cover border border-white shadow-sm"
            />
          ) : (
            <div className="w-12 h-12 rounded-full border border-white bg-[#0B1F38]/5 flex items-center justify-center text-[#0B1F38]/40 shadow-sm">
              {getIcon()}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm md:text-base text-[#0B1F38]">
            {notification.sender_name && (
              <span className="font-bold">{notification.sender_name} </span>
            )}
            {notification.message}
            {notification.related_tender_titre && (
              <span className="text-[#00A3E0] hover:text-[#008CC1] font-bold ml-1 transition-colors">
                {notification.related_tender_titre}
              </span>
            )}
          </p>
          <p className="text-[#0B1F38]/50 text-xs mt-1 font-medium text-left">
            {new Date(notification.date).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!notification.read && (
            <div className="w-2.5 h-2.5 bg-[#FF8575] rounded-full shadow-sm flex-shrink-0" title="Non lu"></div>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification.id);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-[#0B1F38]/5 rounded-xl text-[#0B1F38]/40 hover:text-red-500"
            title="Supprimer"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    );
  };

export const Notifications: React.FC<NotificationsProps> = ({ onNavigate }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'unread'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSelectMenu, setShowSelectMenu] = useState(false);
  const userIdRef = useRef<string | null>(null);

  // Reset visible count on filter change
  useEffect(() => {
    setVisibleCount(20);
  }, [filterType, categoryFilter]);

  // Helper to sort notifications by date descending
  const sortNotifications = useCallback((notifs: Notification[]) => {
    return [...notifs].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }, []);

  // Initial fetch + Supabase Realtime subscription
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      // Get user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      userIdRef.current = user.id;

      // Initial data fetch
      await fetchNotifications();

      // Subscribe to Realtime changes on this user's row
      channel = supabase
        .channel(`notif-page:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'utilisateurs',
            filter: `id=eq.${user.id}`,
          },
          (payload: any) => {
            const newNotifs: Notification[] = payload.new?.notifications || [];
            setNotifications(sortNotifications(newNotifs));
          }
        )
        .subscribe();
    };

    init();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [sortNotifications]);

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

      const notifs = data?.notifications || [];
      setNotifications(notifs.sort((a: Notification, b: Notification) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      ));
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveNotifications = async (updatedNotifications: Notification[]) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('utilisateurs')
        .update({ notifications: updatedNotifications })
        .eq('id', user.id);

      if (error) throw error;
      setNotifications(updatedNotifications);
    } catch (error) {
      console.error('Error saving notifications:', error);
    }
  };

  const handleSelectAll = () => {
    const filtered = getFilteredNotifications();
    if (selectedNotifications.size === filtered.length) {
      setSelectedNotifications(new Set());
    } else {
      setSelectedNotifications(new Set(filtered.map(n => n.id)));
    }
  };

  const handleSelectUnread = () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    setSelectedNotifications(new Set(unreadIds));
    setShowSelectMenu(false);
  };

  const handleSelectRead = () => {
    const readIds = notifications.filter(n => n.read).map(n => n.id);
    setSelectedNotifications(new Set(readIds));
    setShowSelectMenu(false);
  };

  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selectedNotifications);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedNotifications(newSelected);
  };

  const handleMarkAsRead = async (id: string) => {
    const updated = notifications.map(n =>
      n.id === id ? { ...n, read: true } : n
    );
    await saveNotifications(updated);
  };

  const handleMarkSelectedAsRead = async () => {
    setActionLoading(true);
    const updated = notifications.map(n =>
      selectedNotifications.has(n.id) ? { ...n, read: true } : n
    );
    await saveNotifications(updated);
    setSelectedNotifications(new Set());
    setActionLoading(false);
  };

  const handleDeleteNotification = async (id: string) => {
    setActionLoading(true);
    const updated = notifications.filter(n => n.id !== id);
    await saveNotifications(updated);
    setSelectedNotifications(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
    setActionLoading(false);
  };

  const handleDeleteSelected = async () => {
    setActionLoading(true);
    const updated = notifications.filter(n => !selectedNotifications.has(n.id));
    await saveNotifications(updated);
    setSelectedNotifications(new Set());
    setActionLoading(false);
  };

  const getFilteredNotifications = () => {
    let result = notifications;

    if (filterType === 'unread') {
      result = result.filter(n => !n.read);
    }

    if (categoryFilter !== 'all') {
      result = result.filter(n => {
        if (categoryFilter === 'invitations') return ['collaboration_accepted', 'collaboration_rejected', 'collaborator_invited', 'network_invite', 'network_invite_accepted'].includes(n.type);
        if (categoryFilter === 'documents') return ['document_added', 'document_reminder'].includes(n.type);
        if (categoryFilter === 'results') return ['tender_won', 'tender_lost'].includes(n.type);
        if (categoryFilter === 'reminders') return ['deadline_reminder', 'document_reminder'].includes(n.type);
        if (categoryFilter === 'comments') return n.type === 'comment_added';
        return true;
      });
    }

    return result;
  };

  const getUnreadCount = () => notifications.filter(n => !n.read).length;

  const filtered = getFilteredNotifications();
  const displayedNotifications = filtered.slice(0, visibleCount);
  const allSelected = filtered.length > 0 && selectedNotifications.size === filtered.length;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 150) {
      if (visibleCount < filtered.length) {
        setVisibleCount(prev => Math.min(prev + 20, filtered.length));
      }
    }
  };

  const glassStyle = "bg-gradient-to-br from-white/40 via-white/20 to-white/5 backdrop-blur-3xl border border-white/80 shadow-[0_8px_32px_0_rgba(31,38,135,0.1),inset_0_1px_0_0_rgba(255,255,255,0.5)]";

  const categories = [
    { id: 'all', label: 'Toutes' },
    { id: 'invitations', label: 'Invitations' },
    { id: 'documents', label: 'Documents' },
    { id: 'results', label: 'Résultats' },
    { id: 'reminders', label: 'Rappels' },
    { id: 'comments', label: 'Commentaires' }
  ];

  if (loading) {
    return (
      <div className="animate-fade-in p-2 md:p-4 flex items-center justify-center min-h-[400px] h-full">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#00A3E0]"></div>
          <p className="mt-4 text-[#0B1F38]/70">Chargement des notifications...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full p-4">
      <div className={`h-full flex flex-col ${glassStyle} rounded-3xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500`}>
        {/* Header */}
        <div className="p-6 border-b border-white/30 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
          <div>
            <h1 className="text-3xl font-bold text-[#00A3E0]">Notifications</h1>
            <p className="text-sm text-[#0B1F38]/60 mt-1">
              {getUnreadCount() > 0 ? (
                <>{getUnreadCount()} notification{getUnreadCount() > 1 ? 's' : ''} non lue{getUnreadCount() > 1 ? 's' : ''}</>
              ) : (
                "Vous êtes à jour"
              )}
            </p>
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#0B1F38]/40">
            <CheckCircle size={48} className="mb-4 text-[#00A3E0]/40" />
            <p className="text-lg">Vous n'avez aucune notification pour le moment</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="bg-white/20 p-4 shrink-0 border-b border-white/30 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    className="w-5 h-5 rounded border border-[#0B1F38]/20 bg-white cursor-pointer accent-[#00A3E0]"
                  />

                  <div className="relative">
                    <button
                      onClick={() => setShowSelectMenu(!showSelectMenu)}
                      className="bg-white text-[#0B1F38] px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      Sélectionner
                      <ChevronDown size={16} />
                    </button>

                    {showSelectMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowSelectMenu(false)}
                        ></div>
                        <div className="absolute left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-20 min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
                          <button
                            onClick={() => {
                              handleSelectAll();
                              setShowSelectMenu(false);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors text-sm font-medium text-[#0B1F38]"
                          >
                            Tout sélectionner
                          </button>
                          <button
                            onClick={handleSelectUnread}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors text-sm font-medium text-[#0B1F38]"
                          >
                            Non lues
                          </button>
                          <button
                            onClick={handleSelectRead}
                            className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors text-sm font-medium text-[#0B1F38]"
                          >
                            Lues
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {selectedNotifications.size > 0 && (
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        onClick={handleMarkSelectedAsRead}
                        disabled={actionLoading}
                        className="bg-[#00A3E0] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#008CC1] transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check size={16} />}
                        Marquer comme lues
                      </button>
                      <button
                        onClick={handleDeleteSelected}
                        disabled={actionLoading}
                        className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-red-600 transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 size={16} />}
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowFilterMenu(!showFilterMenu)}
                    className="bg-white/40 border border-white/60 text-[#0B1F38] px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 hover:bg-white/60 transition-colors shadow-sm"
                  >
                    {filterType === 'all' ? 'Toutes / Lues' : 'Non lues'}
                    <ChevronDown size={16} />
                  </button>

                  {showFilterMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowFilterMenu(false)}
                      ></div>
                      <div className="absolute right-0 mt-2 bg-white rounded-xl shadow-xl overflow-hidden border border-gray-100 z-20 min-w-[150px] animate-in fade-in zoom-in-95 duration-200">
                        <button
                          onClick={() => {
                            setFilterType('all');
                            setShowFilterMenu(false);
                          }}
                          className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors text-sm font-medium ${filterType === 'all' ? 'bg-[#00A3E0]/10 text-[#00A3E0]' : 'text-[#0B1F38]'}`}
                        >
                          Toutes
                        </button>
                        <button
                          onClick={() => {
                            setFilterType('unread');
                            setShowFilterMenu(false);
                          }}
                          className={`w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors text-sm font-medium ${filterType === 'unread' ? 'bg-[#00A3E0]/10 text-[#00A3E0]' : 'text-[#0B1F38]'}`}
                        >
                          Non lues
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Category Pills */}
              <div className="flex gap-2 overflow-x-auto custom-scrollbar-dark pb-1">
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors border ${categoryFilter === cat.id ? 'bg-[#00A3E0] text-white border-[#00A3E0] shadow-sm' : 'bg-white/40 text-[#0B1F38] border-[#0B1F38]/10 hover:bg-white/60 hover:border-[#0B1F38]/20'}`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div 
              className="flex-1 overflow-y-auto custom-scrollbar-dark p-2 md:p-4"
              onScroll={handleScroll}
            >
              <div className="flex flex-col rounded-2xl overflow-hidden bg-white/20 border border-white/30 shadow-sm">
                {displayedNotifications.map(notif => (
                  <NotificationItem
                    key={notif.id}
                    notification={notif}
                    selected={selectedNotifications.has(notif.id)}
                    onSelect={handleToggleSelect}
                    onDelete={handleDeleteNotification}
                    onMarkAsRead={handleMarkAsRead}
                    onNavigate={onNavigate}
                  />
                ))}

                {displayedNotifications.length === 0 && (
                  <div className="text-center py-12 text-[#0B1F38]/40">
                    <p className="text-sm">Aucune notification correspondante</p>
                  </div>
                )}
                
                {visibleCount < filtered.length && (
                  <div className="py-6 flex justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-[#00A3E0]/50" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};