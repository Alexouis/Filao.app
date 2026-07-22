import React from 'react';
import { X, Rocket, Lock } from 'lucide-react';

interface LimitReachedModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUpgrade?: () => void;
    limitType?: 'activeTenders' | 'storage' | 'ai';
    planLabel?: string;
    message?: string; // Optional custom message override
}

export const LimitReachedModal: React.FC<LimitReachedModalProps> = ({
    isOpen,
    onClose,
    onUpgrade,
    limitType = 'activeTenders',
    planLabel = 'Gratuit',
    message
}) => {
    if (!isOpen) return null;

    const content = {
        activeTenders: {
            title: "Limite de dossiers atteinte",
            defaultMessage: `Vous avez atteint le nombre maximum d'appels d'offres actifs pour votre forfait ${planLabel}.`,
            cta: "Débloquer plus de dossiers"
        },
        storage: {
            title: "Espace de stockage plein",
            defaultMessage: `Vous avez utilisé tout l'espace de stockage inclus dans votre forfait ${planLabel}.`,
            cta: "Augmenter mon stockage"
        },
        ai: {
            title: "Fonctionnalité Premium",
            defaultMessage: "L'analyse IA est disponible uniquement dans les forfaits supérieurs.",
            cta: "Passer à la vitesse supérieure"
        }
    }[limitType];

    const displayMessage = message || content?.defaultMessage;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in-up transform transition-all scale-100 opacity-100">
                {/* Header with gradient */}
                <div className="bg-gradient-to-br from-[#FF8575] to-[#E65100] p-8 text-white text-center relative overflow-hidden">
                    {/* Decorative background circles */}
                    <div className="absolute top-0 left-0 w-32 h-32 bg-white/10 rounded-full -translate-x-1/2 -translate-y-1/2 blur-2xl"></div>
                    <div className="absolute bottom-0 right-0 w-24 h-24 bg-white/10 rounded-full translate-x-1/2 translate-y-1/2 blur-xl"></div>

                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
                    >
                        <X size={20} />
                    </button>

                    <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-[inset_0_0_20px_rgba(255,255,255,0.3)] border border-white/30 transform rotate-3 hover:rotate-6 transition-transform duration-500">
                        <Rocket size={40} className="text-white drop-shadow-md" strokeWidth={2.5} />
                    </div>
                    <h2 className="text-3xl font-bold relative z-10 leading-tight">{content?.title}</h2>
                </div>

                <div className="p-8 text-center bg-white">
                    <p className="text-[#3A4D62] text-lg mb-8 leading-relaxed font-medium">
                        {displayMessage}
                        <br />
                        {onUpgrade && <span className="text-sm text-gray-400 mt-3 block font-normal">Ne laissez pas les limites freiner votre croissance.</span>}
                    </p>

                    <div className="flex flex-col gap-4">
                        {onUpgrade && (
                            <button
                                onClick={onUpgrade}
                                className="w-full py-4 bg-gradient-to-r from-[#00A3E0] to-[#007AA8] text-white rounded-xl font-bold text-lg shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 group"
                            >
                                <span className="group-hover:animate-pulse"><Rocket size={20} /></span>
                                {content?.cta}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className={`w-full py-3 text-gray-400 hover:text-gray-600 font-semibold hover:bg-gray-50 rounded-xl transition-colors text-sm ${!onUpgrade ? 'bg-gray-100/50 text-gray-600' : ''}`}
                        >
                            {onUpgrade ? "Non merci, je reste limité" : "Fermer"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
