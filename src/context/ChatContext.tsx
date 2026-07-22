import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

interface ChatContextType {
    unreadCounts: Record<string, number>;
    totalUnreadCount: number;
    markAsRead: (tenderId: string) => Promise<void>;
    refreshUnreadCounts: () => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [totalUnreadCount, setTotalUnreadCount] = useState(0);

    const refreshUnreadCounts = async () => {
        if (!user) return;

        try {
            // 1. Get all accessible tenders
            const { data: tenders } = await supabase
                .from('reponses_ao')
                .select(`
                    id, 
                    createur_id,
                    groupements (entreprise_id, statut)
                `);

            const accessibleTenderIds = tenders?.filter(t => {
                const isCreator = t.createur_id === user.id;
                const isMember = t.groupements?.some((g: any) => g.statut === 'accepte');
                return isCreator || isMember;
            }).map(t => t.id) || [];

            if (accessibleTenderIds.length === 0) {
                setUnreadCounts({});
                setTotalUnreadCount(0);
                return;
            }

            // 2. Get last viewed timestamps
            const { data: lastViewed } = await supabase
                .from('chat_last_viewed')
                .select('*')
                .eq('user_id', user.id);

            const lastViewedMap: Record<string, string> = {};
            lastViewed?.forEach(lv => {
                lastViewedMap[lv.tender_id] = lv.last_viewed_at;
            });

            // 3. For each tender, count messages created AFTER last_viewed_at (or all if never viewed)
            // This is slightly inefficient but safe for small/medium teams.
            const newCounts: Record<string, number> = {};
            let total = 0;

            await Promise.all(accessibleTenderIds.map(async (tid) => {
                const lastViewedAt = lastViewedMap[tid];
                
                let query = supabase
                    .from('chat_messages')
                    .select('id', { count: 'exact', head: true })
                    .eq('tender_id', tid)
                    .neq('sender_id', user.id); // Don't count my own messages as unread

                if (lastViewedAt) {
                    query = query.gt('created_at', lastViewedAt);
                }

                const { count } = await query;
                const c = count || 0;
                newCounts[tid] = c;
                total += c;
            }));

            setUnreadCounts(newCounts);
            setTotalUnreadCount(total);
        } catch (err) {
            console.error('Error refreshing unread counts:', err);
        }
    };

    const markAsRead = async (tenderId: string) => {
        if (!user) return;

        try {
            const { error } = await supabase
                .from('chat_last_viewed')
                .upsert({
                    user_id: user.id,
                    tender_id: tenderId,
                    last_viewed_at: new Date().toISOString()
                }, { onConflict: 'user_id,tender_id' });

            if (!error) {
                // Optimistic update
                setUnreadCounts(prev => {
                    const oldCount = prev[tenderId] || 0;
                    const next = { ...prev, [tenderId]: 0 };
                    setTotalUnreadCount(t => Math.max(0, t - oldCount));
                    return next;
                });
            }
        } catch (err) {
            console.error('Error marking as read:', err);
        }
    };

    useEffect(() => {
        if (user) {
            refreshUnreadCounts();

            // Subscribe to ALL new messages in my accessible tenders
            const channel = supabase
                .channel('global_chat_notifications')
                .on(
                    'postgres_changes',
                    { event: 'INSERT', schema: 'public', table: 'chat_messages' },
                    (payload) => {
                        const newMsg = payload.new;
                        // If it's not my message, check if I should increment unread
                        if (newMsg.sender_id !== user.id) {
                            // We don't know if this tender is accessible to us without checking, 
                            // but we can just trigger a refresh or do a quick check.
                            // Triggering a full refresh is safer but heavier.
                            refreshUnreadCounts();
                        }
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        } else {
            setUnreadCounts({});
            setTotalUnreadCount(0);
        }
    }, [user]);

    return (
        <ChatContext.Provider value={{ unreadCounts, totalUnreadCount, markAsRead, refreshUnreadCounts }}>
            {children}
        </ChatContext.Provider>
    );
};

export const useChat = () => {
    const context = useContext(ChatContext);
    if (context === undefined) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
};
