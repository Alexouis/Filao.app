import React, { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, MoreVertical, X, ArrowUpRight, Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { ChatMessage } from '../../types';
import { MessageItem } from './MessageItem';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { GLASS_TILE_STYLE } from '../../lib/styles';

interface ChatWindowProps {
    tenderId: string;
    tenderTitle: string;
    showBackToTender?: boolean;
    onBackToTender?: () => void;
    mode?: 'full' | 'drawer';
}

export const ChatWindow: React.FC<ChatWindowProps> = ({ 
    tenderId, 
    tenderTitle, 
    showBackToTender, 
    onBackToTender,
    mode = 'full'
}) => {
    const { user, userProfile } = useAuth();
    const { markAsRead } = useChat();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchMessages();
        markAsRead(tenderId);

        // Subscribe to NEW messages
        const channel = supabase
            .channel(`tender_chat_${tenderId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `tender_id=eq.${tenderId}`
                },
                async (payload) => {
                    // Fetch full sender data for the new message
                    const { data, error } = await supabase
                        .from('chat_messages')
                        .select(`
                            *,
                            sender:utilisateurs (
                                id, nom, prenom, photo_url
                            )
                        `)
                        .eq('id', payload.new.id)
                        .maybeSingle();
                    
                    if (!error && data) {
                        setMessages(prev => {
                            // Check if message already exists to avoid duplicates (from our own send)
                            if (prev.some(m => m.id === data.id)) return prev;
                            return [...prev, data];
                        });
                        scrollToBottom();
                        // If window is open/active, mark as read immediately
                        markAsRead(tenderId);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [tenderId]);

    const fetchMessages = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('chat_messages')
                .select(`
                    *,
                    sender:utilisateurs (
                        id, nom, prenom, photo_url
                    )
                `)
                .eq('tender_id', tenderId)
                .order('created_at', { ascending: true });

            if (error) throw error;
            setMessages(data || []);
            setTimeout(scrollToBottom, 100);
        } catch (err) {
            console.error('Error fetching messages:', err);
        } finally {
            setLoading(false);
        }
    };

    const scrollToBottom = () => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    };

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newMessage.trim() || !user || sending) return;

        setSending(true);
        const text = newMessage.trim();
        setNewMessage('');

        try {
            const { data, error } = await supabase
                .from('chat_messages')
                .insert({
                    tender_id: tenderId,
                    sender_id: user.id,
                    content: text,
                    type: 'text'
                })
                .select(`
                    *,
                    sender:utilisateurs (
                        id, nom, prenom, photo_url
                    )
                `)
                .single();

            if (error) throw error;
            
            if (data) {
                setMessages(prev => {
                    if (prev.some(m => m.id === data.id)) return prev;
                    return [...prev, data];
                });
                setTimeout(scrollToBottom, 50);
            }
        } catch (err) {
            console.error('Error sending message:', err);
            setNewMessage(text); // Restore text on error
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-[#0B1F38]/40 gap-4">
                <Loader2 className="animate-spin" size={32} />
                <p className="text-sm font-medium">Chargement de la conversation...</p>
            </div>
        );
    }

    return (
        <div className={`flex flex-col h-full overflow-hidden ${mode === 'full' ? 'bg-transparent' : 'bg-white/90 backdrop-blur-3xl'}`}>
            
            {/* Header */}
            <div className="p-4 border-b border-[#0B1F38]/5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00A3E0] to-[#26367F] flex items-center justify-center text-white shadow-md">
                        <MessageSquare size={20} />
                    </div>
                    <div className="flex flex-col">
                        <h3 className="text-sm font-bold text-[#0B1F38] truncate max-w-[180px]">
                            {tenderTitle}
                        </h3>
                        <span className="text-[10px] font-medium text-emerald-500 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Discussion d'équipe
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {showBackToTender && (
                        <button 
                            onClick={onBackToTender}
                            className="p-2 text-[#0B1F38]/40 hover:text-[#00A3E0] hover:bg-[#00A3E0]/5 rounded-lg transition-all"
                            title="Accéder au dossier"
                        >
                            <ArrowUpRight size={20} />
                        </button>
                    )}
                    <button className="p-2 text-[#0B1F38]/40 hover:text-[#0B1F38] rounded-lg transition-all">
                        <MoreVertical size={20} />
                    </button>
                    {mode === 'drawer' && (
                        <button className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-all">
                            <X size={20} />
                        </button>
                    )}
                </div>
            </div>

            {/* Messages Area */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4"
            >
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-10">
                        <div className="w-16 h-16 rounded-full bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0] mb-4">
                            <MessageSquare size={32} />
                        </div>
                        <h4 className="text-[#0B1F38] font-bold mb-2">Pas encore de messages</h4>
                        <p className="text-xs text-[#0B1F38]/50 leading-relaxed">
                            Commencez la discussion à propos de ce dossier avec votre équipe.
                        </p>
                    </div>
                ) : (
                    messages.map((msg) => (
                        <MessageItem 
                            key={msg.id} 
                            message={msg} 
                            isMe={msg.sender_id === user?.id} 
                        />
                    ))
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-[#0B1F38]/5 shrink-0">
                <form 
                    onSubmit={handleSendMessage}
                    className="relative flex items-end gap-3"
                >
                    <div className={`flex-1 relative ${GLASS_TILE_STYLE} !bg-white/40 !rounded-2xl border-white/60 p-1`}>
                        <textarea
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage(e);
                                }
                            }}
                            placeholder="Écrivez votre message..."
                            className="w-full bg-transparent border-none focus:ring-0 text-sm text-[#0B1F38] placeholder-[#0B1F38]/40 py-3 pl-3 pr-12 resize-none custom-scrollbar max-h-32"
                            rows={1}
                        />
                        <button 
                            type="button"
                            className="absolute right-3 bottom-3 p-1.5 text-[#0B1F38]/40 hover:text-[#00A3E0] transition-colors"
                        >
                            <Paperclip size={18} />
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={!newMessage.trim() || sending}
                        className={`
                            shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-lg
                            ${newMessage.trim() && !sending 
                                ? 'bg-[#00A3E0] text-white hover:scale-105 active:scale-95' 
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}
                        `}
                    >
                        {sending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                    </button>
                </form>
            </div>
        </div>
    );
};
