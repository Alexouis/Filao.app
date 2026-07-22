import React from 'react';
import { ChatMessage } from '../../types';
import { FileIcon, Clock } from 'lucide-react';

interface MessageItemProps {
    message: ChatMessage;
    isMe: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, isMe }) => {
    const sender = message.sender || { prenom: 'Utilisateur', nom: 'Inconnu' };
    const initials = (sender.prenom?.[0] || 'U') + (sender.nom?.[0] || '');
    const avatar = sender.photo_url || sender.avatar_url;

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={`flex w-full mb-4 ${isMe ? 'justify-end' : 'justify-start'} animate-fade-in`}>
            {!isMe && (
                <div className="shrink-0 mr-3 mt-1">
                    {avatar ? (
                        <img src={avatar} alt={sender.prenom} className="w-8 h-8 rounded-full border border-white/20 object-cover shadow-sm" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00A3E0] to-[#26367F] flex items-center justify-center text-[10px] text-white font-bold border border-white/20">
                            {initials}
                        </div>
                    )}
                </div>
            )}

            <div className={`max-w-[75%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {/* Sender Name (optional for 'me') */}
                {!isMe && (
                    <span className="text-[10px] font-bold text-[#0B1F38]/50 mb-1 ml-1 uppercase tracking-tight">
                        {sender.prenom} {sender.nom}
                    </span>
                )}

                {/* Bubble */}
                <div className={`
                    px-4 py-3 rounded-2xl shadow-sm text-sm leading-relaxed
                    ${isMe 
                        ? 'bg-gradient-to-br from-[#00A3E0] to-[#0082B4] text-white rounded-tr-none' 
                        : 'bg-white/80 backdrop-blur-md border border-white/60 text-[#0B1F38] rounded-tl-none'}
                `}>
                    {message.type === 'file' ? (
                        <div className="flex items-center gap-3 py-1">
                            <div className={`p-2 rounded-lg ${isMe ? 'bg-white/20' : 'bg-[#00A3E0]/10 text-[#00A3E0]'}`}>
                                <FileIcon size={20} />
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="font-bold truncate max-w-[150px]">{message.content}</span>
                                <span className={`text-[10px] ${isMe ? 'text-white/60' : 'text-[#0B1F38]/40'}`}>
                                    {message.metadata?.size || 'Fichier'}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                </div>

                {/* Timestamp */}
                <div className={`flex items-center gap-1 mt-1 opacity-40 text-[9px] font-medium ${isMe ? 'mr-1' : 'ml-1'}`}>
                    <Clock size={8} />
                    <span>{formatTime(message.created_at)}</span>
                </div>
            </div>

            {isMe && (
                <div className="shrink-0 ml-3 mt-1">
                     {avatar ? (
                        <img src={avatar} alt="Me" className="w-8 h-8 rounded-full border border-white/20 object-cover shadow-sm" />
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-500 font-bold border border-white/20">
                            {initials}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
