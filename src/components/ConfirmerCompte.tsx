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
    const type = (params.get('type') || 'signup') as 'signup' | 'email' | 'email_change' | 'recovery';

    const [etat, setEtat] = useState<'attente' | 'encours' | 'ok' | 'erreur'>(
        tokenHash ? 'attente' : 'erreur'
    );
    const [message, setMessage] = useState<string>(
        tokenHash ? '' : "Ce lien est incomplet. Demandez un nouveau lien de confirmation."
    );

    const [emailRenvoi, setEmailRenvoi] = useState('');
    const [renvoiEnCours, setRenvoiEnCours] = useState(false);
    const [renvoye, setRenvoye] = useState(false);

    const confirmer = async () => {
        if (!tokenHash) return;
        setEtat('encours');

        // Supabase attend le type `email` pour une confirmation d'inscription
        // par `token_hash` — c'est ce qu'utilisent ses propres exemples de
        // templates — alors que le paramètre transmis vaut souvent `signup`.
        // Les deux existent selon les flux, et se tromper renvoie exactement la
        // même erreur qu'un lien périmé : impossible à distinguer à l'écran.
        // On essaie donc le type reçu, puis le second en repli.
        const candidats: Array<'email' | 'signup' | 'recovery' | 'email_change'> =
            type === 'recovery' || type === 'email_change'
                ? [type]
                : type === 'email' ? ['email', 'signup'] : ['signup', 'email'];

        let derniereErreur: any = null;

        for (const candidat of candidats) {
            const { error } = await supabase.auth.verifyOtp({
                token_hash: tokenHash,
                type: candidat,
            });

            if (!error) {
                // Jeton consommé : on le retire de l'URL pour qu'il ne subsiste
                // ni dans l'historique, ni dans un lien partagé par mégarde.
                window.history.replaceState(null, '', window.location.pathname);
                setEtat('ok');
                setTimeout(() => { window.location.href = '/'; }, 1800);
                return;
            }
            derniereErreur = error;
        }

        // Le détail reste en console : il distingue « déjà confirmé » de
        // « expiré », ce que le message affiché ne peut pas faire sans induire
        // l'utilisateur en erreur.
        console.error('verifyOtp a échoué', derniereErreur);
        setEtat('erreur');
        setMessage(
            "Ce lien a expiré, a déjà été utilisé, ou votre compte est déjà confirmé. "
            + "Essayez de vous connecter — si cela ne fonctionne pas, demandez un nouveau lien."
        );
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

                        {/* Renvoi d'un lien.
                            Chaque inscription ou renvoi INVALIDE le jeton
                            précédent : avec plusieurs e-mails en boîte, ouvrir
                            le mauvais mène ici sans issue. Ce bouton produit un
                            lien neuf, et rend caducs tous les précédents. */}
                        {!renvoye ? (
                            <div className="space-y-2 text-left">
                                <label className="text-xs font-medium text-gray-600">
                                    Recevoir un nouveau lien
                                </label>
                                <input
                                    type="email"
                                    value={emailRenvoi}
                                    onChange={(e) => setEmailRenvoi(e.target.value)}
                                    placeholder="votre@email.com"
                                    className="w-full bg-[#EFF4F8] border border-transparent rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-filao-blue/30 transition-all"
                                />
                                <button
                                    onClick={async () => {
                                        if (!emailRenvoi.trim()) return;
                                        setRenvoiEnCours(true);
                                        try {
                                            await supabase.auth.resend({
                                                type: 'signup',
                                                email: emailRenvoi.trim(),
                                            });
                                            // Réponse neutre quoi qu'il arrive : confirmer
                                            // qu'une adresse existe en ferait un outil
                                            // d'énumération.
                                            setRenvoye(true);
                                        } finally {
                                            setRenvoiEnCours(false);
                                        }
                                    }}
                                    disabled={renvoiEnCours || !emailRenvoi.trim()}
                                    className="w-full bg-[#0E4F70] text-white font-bold py-3 rounded-lg hover:bg-[#0A3D58] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {renvoiEnCours && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Envoyer un nouveau lien
                                </button>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-600 bg-[#EFF4F8] rounded-lg px-4 py-3">
                                Si un compte à confirmer existe pour cette adresse, un nouveau lien
                                vient d'être envoyé. <strong>Ouvrez le message le plus récent</strong> :
                                les précédents ne sont plus valides.
                            </p>
                        )}

                        <a
                            href="/login"
                            className="inline-block text-xs text-[#00A3E0] underline hover:no-underline"
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
