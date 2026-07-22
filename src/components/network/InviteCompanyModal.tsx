import React, { useState } from 'react';
import { X, Mail, Send, CheckCircle, Loader2, AlertCircle, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';

interface InviteCompanyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

export const InviteCompanyModal: React.FC<InviteCompanyModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { showToast } = useToast();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [recipientFound, setRecipientFound] = useState<boolean | null>(null);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        try {
            setLoading(true);

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error("Session expirée, veuillez vous reconnecter");

            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            if (!supabaseUrl) throw new Error("Configuration manquante");

            const response = await fetch(`${supabaseUrl}/functions/v1/send-network-invite`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ email: email.trim().toLowerCase() }),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Erreur lors de l'envoi de l'invitation");
            }

            setRecipientFound(result.recipientFound);
            setSuccess(true);

            if (result.recipientFound) {
                showToast("Invitation réseau envoyée avec succès", "success");
            } else {
                showToast("Email d'invitation envoyé", "success");
            }

            setTimeout(() => {
                setSuccess(false);
                setEmail('');
                setRecipientFound(null);
                onClose();
                onSuccess?.();
            }, 3000);

        } catch (error: any) {
            console.error('Error sending network invite:', error);
            showToast(error.message || "Erreur lors de l'envoi de l'invitation", "error");
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setSuccess(false);
        setEmail('');
        setRecipientFound(null);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 relative">
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors z-10"
                    aria-label="Fermer"
                >
                    <X size={20} />
                </button>

                <div className="p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0]">
                            <UserPlus size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-[#0B1F38]">Inviter une entreprise</h2>
                            <p className="text-sm text-[#0B1F38]/60">Envoyez une invitation par email pour rejoindre votre réseau.</p>
                        </div>
                    </div>

                    {success ? (
                        <div className="py-8 flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-4">
                            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                                <CheckCircle size={32} />
                            </div>
                            <h3 className="text-lg font-bold text-[#0B1F38]">
                                {recipientFound ? 'Invitation envoyée !' : 'Email envoyé !'}
                            </h3>
                            <p className="text-sm text-[#0B1F38]/60 mt-2 max-w-xs">
                                {recipientFound
                                    ? `Une notification et un email ont été envoyés à ${email}. L'entreprise apparaîtra dans votre réseau dès qu'elle acceptera.`
                                    : `Un email d'invitation a été envoyé à ${email} pour rejoindre Filao et votre réseau.`
                                }
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="network-invite-email" className="block text-sm font-bold text-[#0B1F38]/70 mb-1">
                                    Adresse Email
                                </label>
                                <div className="relative">
                                    <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        id="network-invite-email"
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="contact@entreprise.com"
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-[#00A3E0] focus:ring-2 focus:ring-[#00A3E0]/20 outline-none transition-all"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="bg-[#00A3E0]/5 border border-[#00A3E0]/10 rounded-xl p-3 flex items-start gap-2.5">
                                <AlertCircle size={16} className="text-[#00A3E0] shrink-0 mt-0.5" />
                                <p className="text-xs text-[#0B1F38]/60 leading-relaxed">
                                    Si cette adresse correspond à un compte Filao, l'utilisateur recevra une notification dans l'application et un email.
                                    Sinon, il recevra un email d'invitation à rejoindre Filao.
                                </p>
                            </div>

                            <button
                                type="submit"
                                disabled={loading || !email}
                                className="w-full bg-[#00A3E0] hover:bg-[#008CC1] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-[#00A3E0]/20"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : <><Send size={18} /> Envoyer l'invitation</>}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
