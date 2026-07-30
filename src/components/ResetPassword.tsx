import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Loader2, Check, Eye, EyeOff, ShieldAlert } from 'lucide-react';

/**
 * Page de définition d'un nouveau mot de passe, atteinte depuis le lien envoyé
 * par « Mot de passe oublié ? ».
 *
 * Le lien de Supabase ouvre une session temporaire avant d'arriver ici : c'est
 * elle qui autorise `updateUser`. On attend donc l'événement `PASSWORD_RECOVERY`
 * plutôt que de supposer la session établie — sur un lien expiré ou déjà
 * consommé, elle ne le sera jamais, et il faut le dire clairement au lieu
 * d'afficher un formulaire qui échouera à la validation.
 */
/**
 * Longueur minimale du mot de passe.
 *
 * Douze caractères sans contrainte de composition : imposer une majuscule et un
 * chiffre produit surtout des variantes prévisibles d'un même mot, là où la
 * longueur augmente réellement le coût d'une attaque. C'est aussi la règle
 * retenue par la conception.
 */
const LONGUEUR_MINIMALE = 12;

export const ResetPassword: React.FC = () => {
    const [pret, setPret] = useState(false);
    const [lienInvalide, setLienInvalide] = useState(false);
    const [motDePasse, setMotDePasse] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [visible, setVisible] = useState(false);
    const [enCours, setEnCours] = useState(false);
    const [erreur, setErreur] = useState<string | null>(null);
    const [succes, setSucces] = useState(false);

    useEffect(() => {
        const { data: ecoute } = supabase.auth.onAuthStateChange((evenement, session) => {
            if (evenement === 'PASSWORD_RECOVERY' || session) setPret(true);
        });

        // L'événement peut avoir été émis avant le montage du composant : on
        // vérifie aussi la session courante.
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) setPret(true);
            else {
                // Laisse à Supabase le temps de traiter le fragment d'URL.
                const minuteur = setTimeout(() => {
                    supabase.auth.getSession().then(({ data: d2 }) => {
                        if (d2.session) setPret(true);
                        else setLienInvalide(true);
                    });
                }, 1500);
                return () => clearTimeout(minuteur);
            }
        });

        return () => ecoute.subscription.unsubscribe();
    }, []);

    /**
     * Évaluation de la robustesse.
     *
     * Longueur d'abord, variété ensuite. Une phrase de vingt caractères en
     * minuscules vaut mieux qu'un « P@ssw0rd! » de neuf, alors que la plupart
     * des indicateurs classent l'inverse.
     */
    const robustesse = React.useMemo(() => {
        const n = motDePasse.length;
        const varietes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]
            .filter(r => r.test(motDePasse)).length;

        if (n === 0) return { niveau: 0, libelle: '', couleur: 'bg-gray-200' };
        if (n < LONGUEUR_MINIMALE) return { niveau: 1, libelle: `Trop court — ${LONGUEUR_MINIMALE - n} caractère(s) manquant(s)`, couleur: 'bg-red-400' };
        if (n < 16 && varietes < 3) return { niveau: 2, libelle: 'Acceptable — allongez-le pour plus de sûreté', couleur: 'bg-amber-400' };
        if (n < 20) return { niveau: 3, libelle: 'Bon mot de passe', couleur: 'bg-emerald-400' };
        return { niveau: 4, libelle: 'Excellent', couleur: 'bg-emerald-500' };
    }, [motDePasse]);

    const valider = async (e: React.FormEvent) => {
        e.preventDefault();
        setErreur(null);

        // 12 caractères, sans contrainte de composition : la longueur protège
        // davantage qu'un mélange imposé de majuscules et de chiffres, qui pousse
        // surtout à des variantes prévisibles du même mot.
        if (motDePasse.length < LONGUEUR_MINIMALE) {
            setErreur(`Le mot de passe doit contenir au moins ${LONGUEUR_MINIMALE} caractères.`);
            return;
        }
        if (motDePasse !== confirmation) {
            setErreur('Les deux saisies ne correspondent pas.');
            return;
        }

        setEnCours(true);
        try {
            const { error } = await supabase.auth.updateUser({ password: motDePasse });
            if (error) throw error;

            // Déconnexion de TOUTES les sessions, pas seulement celle-ci.
            // Réinitialiser son mot de passe est souvent la réaction à un compte
            // compromis : laisser ouvertes les sessions de l'attaquant viderait
            // le geste de son sens.
            const { error: errDeconnexion } = await supabase.auth.signOut({ scope: 'global' });
            if (errDeconnexion) {
                // Le mot de passe est changé, c'est l'essentiel : on informe
                // sans annuler.
                console.warn('Déconnexion globale incomplète', errDeconnexion);
            }

            // Notification du changement. C'est le seul signal qu'a un
            // utilisateur dont le compte est en train d'être détourné : sans
            // elle, une prise de contrôle passe totalement inaperçue.
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email) {
                const { error: errAvis } = await supabase.functions.invoke('send-reminder', {
                    body: {
                        email: user.email,
                        senderName: 'Filao',
                        tenderTitle: 'votre compte',
                        milestoneLabel: 'Votre mot de passe a été modifié',
                        milestoneDate: new Date().toISOString(),
                    },
                });
                // Le mot de passe est changé : un avis non parti ne doit pas
                // faire croire à un échec.
                if (errAvis) console.warn('Avis de changement non envoyé', errAvis);
            }

            setSucces(true);
            // Laisse le message s'afficher avant de renvoyer vers la connexion.
            setTimeout(() => { window.location.href = '/'; }, 2500);
        } catch (err: any) {
            console.error('updateUser:', err);
            setErreur(err?.message || "La modification a échoué. Redemandez un lien.");
        } finally {
            setEnCours(false);
        }
    };

    const champ = "w-full px-4 py-3 rounded-lg border border-gray-200 focus:border-filao-primary focus:ring-2 focus:ring-filao-primary/20 focus:outline-none transition-all";

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
                <h1 className="text-2xl font-bold text-filao-dark mb-2">Nouveau mot de passe</h1>

                {lienInvalide ? (
                    <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
                        <ShieldAlert size={18} className="text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-bold text-amber-800">Lien expiré ou déjà utilisé</p>
                            <p className="text-amber-700 mt-1">
                                Les liens de réinitialisation ne servent qu'une fois et pour une durée limitée.
                            </p>
                            <a href="/" className="inline-block mt-3 font-bold text-filao-dark underline">
                                Demander un nouveau lien
                            </a>
                        </div>
                    </div>
                ) : succes ? (
                    <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                        <Check size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-bold text-emerald-800">Mot de passe modifié</p>
                            <p className="text-emerald-700 mt-1">Redirection vers la connexion…</p>
                        </div>
                    </div>
                ) : !pret ? (
                    <div className="mt-8 flex items-center gap-2 text-gray-500 text-sm">
                        <Loader2 size={16} className="animate-spin" /> Vérification du lien…
                    </div>
                ) : (
                    <form onSubmit={valider} className="mt-6 space-y-4">
                        <p className="text-sm text-gray-500">
                            Choisissez un mot de passe d'au moins {LONGUEUR_MINIMALE} caractères.
                        </p>

                        <div className="relative">
                            <label htmlFor="mdp" className="sr-only">Nouveau mot de passe</label>
                            <input
                                id="mdp"
                                type={visible ? 'text' : 'password'}
                                value={motDePasse}
                                onChange={(e) => setMotDePasse(e.target.value)}
                                placeholder="Nouveau mot de passe"
                                autoComplete="new-password"
                                className={champ}
                            />
                            <button
                                type="button"
                                onClick={() => setVisible(v => !v)}
                                aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>

                        {/* Indicateur de robustesse. Volontairement fondé sur la
                            longueur et la variété réelle, pas sur des règles de
                            composition : un mot de passe long et simple résiste
                            mieux qu'un court truffé de symboles. */}
                        {motDePasse.length > 0 && (
                            <div>
                                <div className="flex gap-1 h-1.5">
                                    {[0, 1, 2, 3].map(i => (
                                        <div
                                            key={i}
                                            className={`flex-1 rounded-full transition-colors ${
                                                i < robustesse.niveau ? robustesse.couleur : 'bg-gray-200'
                                            }`}
                                        />
                                    ))}
                                </div>
                                <p className="text-xs text-gray-500 mt-1.5">{robustesse.libelle}</p>
                            </div>
                        )}

                        <div>
                            <label htmlFor="mdp2" className="sr-only">Confirmation</label>
                            <input
                                id="mdp2"
                                type={visible ? 'text' : 'password'}
                                value={confirmation}
                                onChange={(e) => setConfirmation(e.target.value)}
                                placeholder="Confirmez le mot de passe"
                                autoComplete="new-password"
                                className={champ}
                            />
                        </div>

                        {erreur && <p className="text-sm text-red-600">{erreur}</p>}

                        <button
                            type="submit"
                            disabled={enCours}
                            className="w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {enCours ? <><Loader2 size={16} className="animate-spin" /> Modification…</> : 'Valider'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};