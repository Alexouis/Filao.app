import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    Briefcase, UserPlus, LogIn, XCircle, Loader2,
    Calendar, MapPin, Euro, Building2, User
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { APP_CONFIG, SECTORS_LABELS, MARKET_TYPES_LABELS } from '../config';

interface Invitation {
    id: string;
    token: string;
    tender_id: string;
    email: string;
    role: string;
    status: string;
    message?: string;
    expires_at: string;
    tender?: {
        id: string;
        titre: string;
        organisme_acheteur: string;
        date_limite: string;
        montant_estime: number;
        lieu_execution: string[];
        secteur_activite: string;
        type_marche: string;
        type_groupement?: 'solidaire' | 'conjoint';
        createur_id: string;
    };
    creator?: {
        nom: string;
        prenom: string;
        entreprise: string;
    };
}

export const InvitationLanding: React.FC = () => {
    const { pathname } = useLocation();
    // Extract token manually since we are not using a Route definition
    const token = pathname.split('/invitation/')[1];
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [invitation, setInvitation] = useState<Invitation | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        if (token) {
            fetchInvitation(token);
        } else {
            setLoading(false);
            setError("Lien d'invitation invalide.");
        }
    }, [token]);

    const fetchInvitation = async (inviteToken: string) => {
        try {
            // Fetch invitation with tender and creator info
            const { data, error: fetchError } = await supabase
                .from('invitations')
                .select(`
          *,
          tender:reponses_ao (id, titre, organisme_acheteur, date_limite, montant_estime, lieu_execution, secteur_activite, type_marche, type_groupement, createur_id),
          creator:utilisateurs!invitations_created_by_fkey (nom, prenom, entreprise)
        `)
                .eq('token', inviteToken)
                .single();

            if (fetchError || !data) {
                setError('Invitation introuvable ou expirée.');
                return;
            }

            // Check expiration
            if (new Date(data.expires_at) < new Date()) {
                setError('Cette invitation a expiré.');
                return;
            }

            // Check if already responded
            if (data.status !== 'pending') {
                setError(`Cette invitation a déjà été ${data.status === 'accepted' ? 'acceptée' : 'refusée'}.`);
                return;
            }

            setInvitation(data);
        } catch (err) {
            console.error(err);
            setError('Erreur lors du chargement de l\'invitation.');
        } finally {
            setLoading(false);
        }
    };

    const handleRefuse = async () => {
        if (!invitation) return;
        setActionLoading(true);

        try {
            await supabase
                .from('invitations')
                .update({
                    status: 'refused',
                    refused_at: new Date().toISOString()
                })
                .eq('id', invitation.id);

            setError('Invitation refusée. Vous pouvez fermer cette page.');
        } catch (err) {
            console.error(err);
            setError('Erreur lors du refus de l\'invitation.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleContinueAsGuest = () => {
        if (!invitation) return;
        // Navigate to collaborator submission with token
        navigate(`/collaborator-access?tenderId=${invitation.tender_id}&token=${token}`);
    };

    const handleCreateAccount = () => {
        if (!invitation) return;
        // Store invitation token in session for after signup
        sessionStorage.setItem('invitationToken', token || '');
        sessionStorage.setItem('invitationTenderId', invitation.tender_id);
        navigate('/register');
    };

    const handleLogin = () => {
        if (!invitation) return;
        // Store invitation token in session for after login
        sessionStorage.setItem('invitationToken', token || '');
        sessionStorage.setItem('invitationTenderId', invitation.tender_id);
        navigate('/login');
    };

    // Helper functions
    const formatCurrency = (amount: number) => {
        if (!amount) return 'Non renseigné';
        return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'Non renseignée';
        return new Date(dateString).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    };

    const getCreatorName = () => {
        if (!invitation?.creator) return 'Un utilisateur Filao';
        const { prenom, nom, entreprise } = invitation.creator;
        return `${prenom} ${nom}${entreprise ? ` (${entreprise})` : ''}`;
    };

    // Loading State
    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-[#f5f7fa] to-[#e4e9f0] flex items-center justify-center">
                <div className="text-center">
                    <Loader2 size={48} className="animate-spin text-[#00A3E0] mx-auto mb-4" />
                    <p className="text-gray-600">Chargement de l'invitation...</p>
                </div>
            </div>
        );
    }

    // Error State
    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-[#f5f7fa] to-[#e4e9f0] flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl p-8 shadow-xl text-center max-w-md">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <XCircle size={32} className="text-red-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-800 mb-2">Invitation invalide</h1>
                    <p className="text-gray-500 mb-6">{error}</p>
                    <a
                        href="/"
                        className="inline-block bg-[#0B1F38] text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition-all"
                    >
                        Retour à l'accueil
                    </a>
                </div>
            </div>
        );
    }

    // Main Content
    return (
        <div className="min-h-screen bg-gradient-to-br from-[#f5f7fa] to-[#e4e9f0] py-12 px-4">
            <div className="max-w-2xl mx-auto">

                {/* Logo */}
                <div className="text-center mb-8">
                    <img src={APP_CONFIG.altLogo} alt="Filao" className="h-10 mx-auto" />
                </div>

                {/* Invitation Card */}
                <div className="bg-white rounded-3xl shadow-xl overflow-hidden">

                    {/* Header */}
                    <div className="bg-gradient-to-r from-[#0B1F38] to-[#1B5D7A] p-8 text-white text-center">
                        <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <Briefcase size={32} />
                        </div>
                        <h1 className="text-2xl font-bold mb-2">Vous êtes invité(e) à collaborer</h1>
                        <p className="text-white/70">
                            {getCreatorName()} souhaite vous inviter sur un appel d'offres
                        </p>
                    </div>

                    {/* Tender Info */}
                    <div className="p-6 border-b border-gray-100">
                        <h2 className="text-xl font-bold text-[#0B1F38] mb-4">
                            {invitation?.tender?.titre}
                        </h2>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center gap-2 text-gray-600">
                                <Building2 size={16} className="text-gray-400" />
                                <span>{invitation?.tender?.organisme_acheteur || 'Non renseigné'}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <MapPin size={16} className="text-gray-400" />
                                <span>{Array.isArray(invitation?.tender?.lieu_execution)
                                    ? invitation.tender.lieu_execution.join(', ')
                                    : 'Non renseigné'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <Calendar size={16} className="text-gray-400" />
                                <span>Date limite : {formatDate(invitation?.tender?.date_limite || '')}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <Euro size={16} className="text-gray-400" />
                                <span>{formatCurrency(invitation?.tender?.montant_estime || 0)}</span>
                            </div>
                        </div>

                        {invitation?.tender?.type_groupement && (
                            <div className="mt-4">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${invitation.tender.type_groupement === 'solidaire' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                                    Groupement {invitation.tender.type_groupement.charAt(0).toUpperCase() + invitation.tender.type_groupement.slice(1)}
                                </span>
                            </div>
                        )}

                        {/* Role Badge */}
                        <div className="mt-4 inline-flex items-center gap-2 bg-[#00A3E0]/10 text-[#00A3E0] px-4 py-2 rounded-xl">
                            <User size={16} />
                            <span className="font-bold">Rôle proposé : {invitation?.role}</span>
                        </div>

                        {/* Message */}
                        {invitation?.message && (
                            <div className="mt-4 bg-gray-50 rounded-xl p-4 border-l-4 border-[#00A3E0]">
                                <p className="text-sm text-gray-600 italic">"{invitation.message}"</p>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="p-6 space-y-3">
                        <p className="text-center text-gray-500 text-sm mb-4">
                            Comment souhaitez-vous répondre ?
                        </p>

                        {/* Option 1: Create Account */}
                        <button
                            onClick={handleCreateAccount}
                            className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-[#00A3E0] to-[#1B5D7A] text-white rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg group"
                        >
                            <div className="flex items-center gap-3">
                                <UserPlus size={20} />
                                <span>Créer un compte Filao</span>
                            </div>
                            <span className="text-white/60 text-sm group-hover:text-white transition-colors">Recommandé</span>
                        </button>

                        {/* Option 2: Login */}
                        <button
                            onClick={handleLogin}
                            className="w-full flex items-center gap-3 p-4 border-2 border-[#0B1F38] text-[#0B1F38] rounded-2xl font-bold hover:bg-[#0B1F38] hover:text-white transition-all"
                        >
                            <LogIn size={20} />
                            <span>J'ai déjà un compte</span>
                        </button>

                        {/* Option 3: Continue as Guest */}
                        <button
                            onClick={handleContinueAsGuest}
                            className="w-full flex items-center gap-3 p-4 border-2 border-gray-200 text-gray-600 rounded-2xl font-bold hover:bg-gray-50 transition-all"
                        >
                            <Briefcase size={20} />
                            <span>Continuer en tant qu'invité</span>
                        </button>

                        {/* Option 4: Refuse */}
                        <button
                            onClick={handleRefuse}
                            disabled={actionLoading}
                            className="w-full flex items-center gap-3 p-4 text-red-500 rounded-2xl font-medium hover:bg-red-50 transition-all justify-center"
                        >
                            {actionLoading ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <>
                                    <XCircle size={18} />
                                    <span>Refuser l'invitation</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-gray-400 text-xs mt-8">
                    © {new Date().getFullYear()} Filao. Tous droits réservés.
                </p>
            </div>
        </div>
    );
};
