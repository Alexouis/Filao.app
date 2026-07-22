import React, { useEffect, useState } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { ChatWindow } from './ChatWindow';
import { GLASS_MODAL_STYLE } from '../../lib/styles';

interface ChatDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    tenderId: string;
    tenderTitle: string;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({ 
    isOpen, 
    onClose, 
    tenderId, 
    tenderTitle
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Close on Escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-[#0B1F38]/20 backdrop-blur-sm z-[100] transition-opacity duration-500 ease-in-out"
                    onClick={onClose}
                />
            )}

            {/* Sidebar drawer */}
            <div className={`
                fixed top-0 right-0 h-full z-[110] transition-all duration-500 ease-in-out shadow-2xl
                ${isOpen ? 'translate-x-0' : 'translate-x-full'}
                ${isExpanded ? 'w-full md:w-[600px]' : 'w-full md:w-[450px]'}
            `}>
                <div className="h-full bg-white flex flex-col relative overflow-hidden">
                    
                    {/* Header Controls (Overlay icons) */}
                    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                        <button 
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-2 bg-white/50 backdrop-blur-sm text-[#0B1F38]/40 hover:text-[#00A3E0] rounded-lg transition-all"
                            title={isExpanded ? "Réduire" : "Agrandir"}
                        >
                            {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                        </button>
                        <button 
                            onClick={onClose}
                            className="p-2 bg-white/50 backdrop-blur-sm text-[#0B1F38]/40 hover:text-red-500 rounded-lg transition-all"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Chat Content */}
                    <div className="flex-1 overflow-hidden">
                        <ChatWindow 
                            tenderId={tenderId}
                            tenderTitle={tenderTitle}
                            mode="drawer"
                        />
                    </div>
                </div>
            </div>
        </>
    );
};
