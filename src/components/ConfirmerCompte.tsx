import React, { useState } from 'react';
import { CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { APP_CONFIG } from '../config';

/**
 * Page de confirmation d'inscription.
 *
 * POURQUOI CETTE PAGE EXISTE
 * Le lien d'action de Supabase consomme le jeton DÈS SA VISITE. Or les
 * analyseurs de liens des messageries professionnelles (Outlook Safe Links,
 * Proofpoint, antivirus) ouvrent les URL avant le destinataire pour les
 * inspecter. Le jeton, à usage unique, se trouvait donc déjà consommé quand
 * l'utilisateur cliquait — produisant « Email link is invalid or has expired »
 * sur un lien pourtant tout neuf, sans qu'aucun réglage n'y change rien.
 *
 * La parade consiste à EXIGER UNE ACTION HUMAINE : l'e-mail pointe vers cette
 * page, qui reçoit le jeton sans le consommer. Un robot peut la charger, il ne
 * cliquera pas. `verifyOtp` n'est appelé qu'au clic.
 *
 * Le jeton transite dans l'URL, donc en clair dans l'historique du navigateur :
 * il est retiré de la barre d'adresse dès qu'il est consommé.
 */
export const ConfirmerCompte: React.FC = () => {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type = (params.get('type') || 'signup') as 'signup' | 'email_change' | 'recovery';

    const [etat, setEtat] = useState<'attente' | 'encours' | 'ok' | 'erreur'>(
        tokenHash ? 'attente' : 'erreur'
    );
    const [message, setMessage] = useState<string>(
        tokenHash ? '' : "Ce lien est incomplet. Demandez un nouveau lien de confirmation."
    );

    const confirmer = async () => {
        if (!tokenHash) return;
        setEtat('encours');
        try {
            const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
            if (error) throw error;

            // Jeton consommé : on le retire de l'URL pour qu'il ne subsiste ni
            // dans l'historique, ni dans un lien partagé par mégarde.
            window.history.replaceState(null, '', window.location.pathname);

            setEtat('ok');
            // La session est ouverte : on laisse le temps de lire, puis on entre.
            setTimeout(() => { window.location.href = '/'; }, 1800);
        } catch (err: any) {
            setEtat('erreur');
            setMessage(
                err?.message?.includes('expired') || err?.code === 'otp_expired'
                    ? "Ce lien a expiré ou a déjà été utilisé. Connectez-vous, ou demandez un nouveau lien."
                    : "La confirmation a échoué. Connectez-vous, ou demandez un nouveau lien."
            );
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-white px-4">
            <div className="w-full max-w-md text-center space-y-6">
                <img src={APP_CONFIG.altLogo} alt="FILAO" className="h-10 mx-auto" />

                {etat === 'ok' ? (
                    <>
                        <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                            <CheckCircle className="text-green-500" size={32} />
                        </div>
                        <h1 className="text-2xl font-bold text-filao-dark">Compte confirmé</h1>
                        <p className="text-sm text-gray-500">Vous allez être redirigé…</p>
                    </>
                ) : etat === 'erreur' ? (
                    <>
                        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
                            <AlertTriangle className="text-red-500" size={30} />
                        </div>
                        <h1 className="text-2xl font-bold text-filao-dark">Lien invalide</h1>
                        <p className="text-sm text-gray-500 leading-relaxed">{message}</p>
                        <a
                            href="/login"
                            className="inline-block w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors"
                        >
                            Aller à la connexion
                        </a>
                    </>
                ) : (
                    <>
                        <h1 className="text-2xl font-bold text-filao-dark">Confirmez votre compte</h1>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Dernière étape : cliquez ci-dessous pour activer votre compte Filao.
                        </p>
                        <button
                            onClick={confirmer}
                            disabled={etat === 'encours'}
                            className="w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {etat === 'encours' && <Loader2 className="w-4 h-4 animate-spin" />}
                            Confirmer mon compte
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};
