import React, { useState } from 'react';
import { X, Send, Loader2, Mail, User, MessageSquare, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { ROLES } from '../config';
import { notifyCollaboratorInvited } from '../helpers/notificationHelpers';

interface InvitePartnerModalProps {
    isOpen: boolean;
    onClose: () => void;
    tenderId: string;
    tenderTitle: string;
    senderName: string;
    initialEmail?: string;
    initialRole?: string;
    accessCode?: string;
}

export const InvitePartnerModal: React.FC<InvitePartnerModalProps> = ({
    isOpen,
    onClose,
    tenderId,
    tenderTitle,
    senderName,
    initialEmail = '',
    initialRole = 'Sous-traitant',
    accessCode
}) => {
    const [email, setEmail] = useState(initialEmail);
    const [role, setRole] = useState(initialRole);
    const [message, setMessage] = useState('');

    React.useEffect(() => {
        if (isOpen) {
            setEmail(initialEmail);
            setRole(initialRole);
            setMessage('');
            setSuccess(false);
            setError(null);
        }
    }, [isOpen, initialEmail, initialRole]);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const accessToken = sessionData?.session?.access_token;

            if (!accessToken) {
                throw new Error('Non authentifié');
            }

            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invitation`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`,
                    },
                    body: JSON.stringify({
                        tenderId,
                        tenderTitle,
                        email: email.trim(),
                        role,
                        message: message.trim() || undefined,
                        senderName,
                        accessCode,
                    }),
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Erreur lors de l\'envoi');
            }

            // If recipient has an account and is not the current user, send in-app notification
            const currentUserId = sessionData?.session?.user?.id;
            if (result.recipientId && result.recipientId !== currentUserId) {
                try {
                    await notifyCollaboratorInvited(
                        result.recipientId,
                        senderName,
                        '', // avatar
                        tenderId,
                        tenderTitle
                    );
                } catch (notifErr) {
                    console.warn('Notification warning:', notifErr);
                }
            }

            setSuccess(true);
            setTimeout(() => {
                onClose();
                // Reset state
                setEmail('');
                setRole('Sous-traitant');
                setMessage('');
                setSuccess(false);
            }, 2000);

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Erreur lors de l\'envoi de l\'invitation');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in-up">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#0B1F38] to-[#1B5D7A] p-6 text-white">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                            <Send size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Inviter un partenaire</h2>
                            <p className="text-white/70 text-sm">Envoyer une invitation par email</p>
                        </div>
                    </div>
                </div>

                {/* Content */}
                {success ? (
                    <div className="p-8 text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle size={32} className="text-green-600" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800 mb-2">Invitation envoyée !</h3>
                        <p className="text-gray-500">Le partenaire recevra un email avec le lien d'invitation.</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-6 space-y-5">
                        {/* Email */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                Adresse email du partenaire
                            </label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-[#00A3E0] focus:ring-1 focus:ring-[#00A3E0] transition-all"
                                    placeholder="partenaire@exemple.com"
                                />
                            </div>
                        </div>

                        {/* Role */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                Rôle dans le groupement
                            </label>
                            <div className="relative">
                                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <select
                                    value={role}
                                    onChange={(e) => setRole(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-[#00A3E0] focus:ring-1 focus:ring-[#00A3E0] transition-all appearance-none cursor-pointer"
                                >
                                    {ROLES.map((r) => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Message (optional) */}
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">
                                Message personnalisé <span className="font-normal text-gray-400">(optionnel)</span>
                            </label>
                            <div className="relative">
                                <MessageSquare size={18} className="absolute left-3 top-3 text-gray-400" />
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    rows={3}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-[#00A3E0] focus:ring-1 focus:ring-[#00A3E0] transition-all resize-none"
                                    placeholder="Ajouter un message pour le partenaire..."
                                />
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                                {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 px-6 py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                            >
                                Annuler
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 px-6 py-3 bg-[#00A3E0] text-white rounded-xl font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60"
                            >
                                {loading ? (
                                    <Loader2 className="animate-spin" size={20} />
                                ) : (
                                    <>
                                        <Send size={18} />
                                        Envoyer l'invitation
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};
