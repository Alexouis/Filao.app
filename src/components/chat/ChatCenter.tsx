import React, { useState, useEffect } from 'react';
import { Search, Filter, MessageSquare, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { ChatConversation } from '../../types';
import { ChatWindow } from './ChatWindow';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { GLASS_STYLE, GLASS_TILE_STYLE } from '../../lib/styles';

export const ChatCenter: React.FC<{ onNavigate?: (tab: string, id?: string) => void }> = ({ onNavigate }) => {
    const { user } = useAuth();
    const { unreadCounts } = useChat();
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

    useEffect(() => {
        fetchConversations();

        // Subscribe to global chat messages to update last message preview
        const channel = supabase
            .channel('chat_center_updates')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_messages' },
                () => {
                    // When any message is inserted, we refresh the list to update "last_message"
                    // and move the active conversation to the top
                    fetchConversations();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchConversations = async () => {
        setLoading(true);
        try {
            // Get all tenders where I am creator or and accepted member
            // We'll join reponses_ao with their groupements
            const { data: tenders, error } = await supabase
                .from('reponses_ao')
                .select(`
                    id, 
                    titre,
                    createur_id,
                    groupements (
                        entreprise_id,
                        statut
                    )
                `);

            if (error) throw error;

            // Filter tenders where user has access
            const accessibleTenders = tenders?.filter(t => {
                const isCreator = t.createur_id === user?.id;
                const isMember = t.groupements?.some((g: any) => 
                    g.statut === 'accepte'
                );
                return isCreator || isMember;
            }) || [];

            // For each tender, get last message and unread count (mocked for now)
            const chatData = await Promise.all(accessibleTenders.map(async (t) => {
                const { data: lastMsg } = await supabase
                    .from('chat_messages')
                    .select(`
                        *,
                        sender:utilisateurs (nom, prenom, photo_url)
                    `)
                    .eq('tender_id', t.id)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                return {
                    tender_id: t.id,
                    tender_title: t.titre,
                    last_message: lastMsg || undefined,
                    unread_count: 0, // Implement real tracking later
                    participants_count: (t.groupements?.length || 0) + 1
                };
            }));

            // Sort by last message date
            chatData.sort((a, b) => {
                const dateA = a.last_message?.created_at || '0';
                const dateB = b.last_message?.created_at || '0';
                return dateB.localeCompare(dateA);
            });

            setConversations(chatData);
        } catch (err) {
            console.error('Error fetching conversations:', err);
        } finally {
            setLoading(false);
        }
    };

    const filteredConversations = conversations.filter(c => 
        c.tender_title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedConv = conversations.find(c => c.tender_id === selectedTenderId);

    return (
        <div className="flex h-full overflow-hidden gap-6 p-4 md:p-4 animate-fade-in">
            {/* Sidebar List */}
            <div className={`
                flex-col h-full md:w-80 lg:w-96 shrink-0 transition-all duration-300
                ${mobileView === 'chat' ? 'hidden md:flex' : 'flex w-full'}
            `}>
                <div className={`${GLASS_STYLE} !rounded-3xl flex flex-col h-full overflow-hidden`}>
                    {/* Header */}
                    <div className="p-6 border-b border-[#0B1F38]/5">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-xl font-bold text-[#0B1F38]">Messagerie</h2>
                            <div className="p-2 bg-[#00A3E0]/10 text-[#00A3E0] rounded-xl">
                                <MessageSquare size={20} />
                            </div>
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#0B1F38]/30" size={18} />
                            <input 
                                type="text"
                                placeholder="Rechercher une discussion..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-[#0B1F38]/5 border-none rounded-2xl py-3 pl-12 pr-4 text-sm text-[#0B1F38] placeholder-[#0B1F38]/30 focus:ring-2 focus:ring-[#00A3E0]/20 transition-all font-medium"
                            />
                        </div>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center h-40 gap-3">
                                <Loader2 className="animate-spin text-[#00A3E0]/40" size={24} />
                                <span className="text-xs font-medium text-[#0B1F38]/30">Chargement...</span>
                            </div>
                        ) : filteredConversations.length === 0 ? (
                            <div className="p-10 text-center">
                                <p className="text-sm font-medium text-[#0B1F38]/40">Aucun dossier trouvé</p>
                            </div>
                        ) : (
                            filteredConversations.map((conv) => (
                                <button
                                    key={conv.tender_id}
                                    onClick={() => {
                                        setSelectedTenderId(conv.tender_id);
                                        setMobileView('chat');
                                    }}
                                    className={`
                                        w-full flex items-center gap-4 p-4 rounded-2xl transition-all text-left
                                        ${selectedTenderId === conv.tender_id 
                                            ? 'bg-gradient-to-r from-[#00A3E0]/20 to-[#00A3E0]/5 border-l-4 border-[#00A3E0] shadow-sm' 
                                            : 'hover:bg-[#0B1F38]/5 border-l-4 border-transparent'}
                                    `}
                                >
                                    <div className={`
                                        w-12 h-12 rounded-xl shrink-0 flex items-center justify-center text-white shadow-md transition-transform
                                        ${selectedTenderId === conv.tender_id ? 'scale-110' : ''}
                                        bg-gradient-to-br from-[#00A3E0] to-[#26367F]
                                    `}>
                                        <MessageSquare size={22} />
                                    </div>
                                    <div className="flex-1 min-w-0 pr-2">
                                        <div className="flex items-center justify-between mb-1">
                                            <h4 className="text-sm font-bold text-[#0B1F38] truncate">{conv.tender_title}</h4>
                                            {conv.last_message && (
                                                <span className="text-[10px] text-[#0B1F38]/30 font-medium lowercase">
                                                    {new Date(conv.last_message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-[#0B1F38]/40 truncate font-medium">
                                            {conv.last_message ? (
                                                <>
                                                    <span className="text-[#00A3E0]">{conv.last_message.sender?.prenom}: </span>
                                                    {conv.last_message.content}
                                                </>
                                            ) : 'Pas encore de messages'}
                                        </p>
                                    </div>
                                    {unreadCounts[conv.tender_id] > 0 && (
                                        <div className="w-5 h-5 bg-[#FF8575] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-lg animate-pulse">
                                            {unreadCounts[conv.tender_id]}
                                        </div>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Main Chat Area */}
            <div className={`
                flex-1 h-full transition-all duration-300
                ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}
            `}>
                {selectedTenderId ? (
                    <div className={`${GLASS_STYLE} !rounded-3xl w-full h-full overflow-hidden flex flex-col`}>
                        {/* Mobile Back Button */}
                        <div className="md:hidden p-4 border-b border-[#0B1F38]/5 flex items-center gap-3">
                            <button 
                                onClick={() => setMobileView('list')}
                                className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-all"
                            >
                                <ArrowLeft size={20} />
                            </button>
                            <span className="font-bold text-[#0B1F38]">Retour aux discussions</span>
                        </div>

                        <ChatWindow 
                            tenderId={selectedTenderId}
                            tenderTitle={selectedConv?.tender_title || ''}
                            showBackToTender={true}
                            onBackToTender={() => onNavigate?.('wizard', selectedTenderId)}
                        />
                    </div>
                ) : (
                    <div className={`${GLASS_STYLE} !rounded-3xl w-full h-full flex flex-col items-center justify-center text-center p-10`}>
                        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#00A3E0]/10 to-[#26367F]/10 flex items-center justify-center text-[#00A3E0] mb-6 shadow-inner">
                            <MessageSquare size={48} />
                        </div>
                        <h2 className="text-2xl font-bold text-[#0B1F38] mb-4">Sélectionnez une discussion</h2>
                        <p className="text-[#0B1F38]/40 max-w-sm leading-relaxed font-medium">
                            Choisissez un dossier dans la liste pour commencer à échanger avec votre équipe en temps réel.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
