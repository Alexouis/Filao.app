import React, { useState, useEffect } from 'react';
import { useToast } from './ui/Toast';
import { Eye, EyeOff, CheckSquare, Square, Mail } from 'lucide-react';

type AUTH_VIEW_MODES = 'new' | 'existing';

interface AuthProps {
    onLogin?: () => void;
    viewMode?: AUTH_VIEW_MODES;
}

import { APP_CONFIG } from '../config';
import { supabase } from '../lib/supabaseClient';

const GoogleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

const MockSidebar = () => (
    <div className="w-16 bg-filao-dark rounded-r-xl h-[400px] flex flex-col items-center py-6 gap-6 shadow-2xl mr-8">
        <div className="text-white font-bold text-xl">F</div>
        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-gray-400/50"></div>
        </div>
        <div className="flex flex-col gap-4 mt-2">
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="w-4 h-4 rounded bg-white/20"></div>
            ))}
        </div>
        <div className="mt-auto w-4 h-4 rounded bg-white/20"></div>
    </div>
);

/**
 * Version des conditions générales présentée à l'inscription.
 *
 * Conservée avec l'horodatage : des CGU modifiées depuis rendraient la seule
 * date inexploitable en cas de contestation. À mettre à jour à chaque
 * révision du texte.
 */
const VERSION_CGU = '2026-07-01';

export const Auth: React.FC<AuthProps> = ({ onLogin, viewMode }) => {
    const { showToast } = useToast();
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmEmail, setConfirmEmail] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [nom, setNom] = useState('');
    const [prenom, setPrenom] = useState('');
    const [dateNaissance, setDateNaissance] = useState('');
    const [entreprise, setEntreprise] = useState('');
    const [telephone, setTelephone] = useState('');
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [confirmationSent, setConfirmationSent] = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState('');

    // Form styles
    const inputClass = "w-full bg-[#EFF4F8] border border-transparent rounded-lg px-4 py-3 text-filao-dark placeholder-gray-400 focus:outline-none focus:border-filao-blue/30 focus:bg-white transition-all";
    const labelClass = "block text-sm font-bold text-filao-dark mb-1";

    useEffect(() => {
        if (viewMode) {
            setMode(viewMode)
        }
    }, [viewMode]);

    const getFrenchErrorMessage = (errorMessage: string): string => {
        // Normalize to lowercase for easier matching
        const msg = errorMessage.toLowerCase();

        if (msg.includes("invalid login credentials")) {
            return "Email ou mot de passe incorrect.";
        }
        if (msg.includes("user already registered") || msg.includes("unique violation")) {
            return "Un compte existe déjà avec cet email. Veuillez vous connecter.";
        }
        if (msg.includes("email not confirmed")) {
            return "Veuillez confirmer votre adresse email en cliquant sur le lien reçu.";
        }
        if (msg.includes("password should be at least")) {
            return "Le mot de passe doit contenir au moins 6 caractères.";
        }
        if (msg.includes("rate limit exceeded") || msg.includes("too many requests")) {
            return "Trop de tentatives. Veuillez réessayer dans quelques minutes.";
        }
        if (msg.includes("network request failed")) {
            return "Erreur de connexion. Veuillez vérifier votre réseau.";
        }
        if (msg.includes("auth/invalid-email")) {
            return "Format d'email invalide.";
        }

        // Fallback for unhandled errors
        return "Une erreur inattendue est survenue. Veuillez réessayer.";
    };

    /**
     * Réinitialisation du mot de passe.
     *
     * Le bouton « Mot de passe oublié ? » existait sans `onClick` : la
     * fonctionnalité n'avait jamais été implémentée, le clic ne faisait rien.
     *
     * Le message de confirmation est volontairement identique que l'adresse
     * existe ou non : répondre « compte inconnu » permettrait d'énumérer les
     * comptes de la plateforme. Supabase se comporte d'ailleurs ainsi et ne
     * signale pas l'absence de compte.
     */
    const handleForgotPassword = async () => {
        const adresse = email.trim().toLowerCase();
        if (!adresse) {
            setError('Renseignez votre adresse e-mail, puis cliquez à nouveau.');
            return;
        }

        setError(null);
        setLoading(true);
        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(adresse, {
                redirectTo: `${window.location.origin}/reset-password`,
            });
            if (resetError) throw resetError;
            showToast(
                "Si un compte existe pour cette adresse, un lien de réinitialisation vient d'être envoyé.",
                'success'
            );
        } catch (err: any) {
            console.error('resetPasswordForEmail:', err);
            setError(err?.message || "L'envoi du lien a échoué. Réessayez dans un instant.");
        } finally {
            setLoading(false);
        }
    };

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (mode === 'login') {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                onLogin?.();
            } else {
                if (!nom || !prenom || !email || !confirmEmail || !password || !confirmPassword) {
                    throw new Error('Veuillez remplir tous les champs obligatoires (*)');
                }

                if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
                    throw new Error('Les adresses email ne correspondent pas');
                }

                if (password !== confirmPassword) {
                    throw new Error('Les mots de passe ne correspondent pas');
                }

                if (!acceptTerms) {
                    throw new Error('Vous devez accepter les Conditions Générales');
                }

                // Comparaison insensible à la casse : les adresses sont stockées
                // telles que saisies. Avec `.eq`, « Alex@x.fr » ne trouvait pas
                // « alex@x.fr » et un second compte était créé pour la même
                // personne — deux profils, deux entreprises possibles, et une
                // invitation qui n'arrive jamais au bon endroit.
                //
                // `maybeSingle` plutôt que `single` : ce dernier renvoie une
                // erreur quand aucune ligne ne correspond, c'est-à-dire dans le
                // cas nominal d'une inscription.
                const { data: existingUser } = await supabase
                    .from('utilisateurs')
                    .select('email')
                    .ilike('email', email.trim())
                    .maybeSingle();

                // If we found a row, stop everything
                if (existingUser) {
                    throw new Error('Un compte existe déjà avec cette adresse email. Veuillez vous connecter.');
                }

                // Origine du compte. `InvitationLanding` dépose l'identifiant du
                // dossier avant de rediriger : sa présence suffit à qualifier la
                // source, sans paramètre d'URL à transporter.
                const dossierInvitation = sessionStorage.getItem('invitationTenderId');
                const source = dossierInvitation ? 'invitation'
                    : document.referrer && !document.referrer.includes(window.location.host) ? 'referral'
                    : 'direct';

                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            nom,
                            prenom,
                            telephone: telephone || null,
                            date_naissance: dateNaissance || null,
                            // Transmis à la création du profil : la trace doit
                            // être posée au même moment que le compte, sinon un
                            // abandon en cours de route la ferait disparaître.
                            cgu_acceptees_le: new Date().toISOString(),
                            cgu_version: VERSION_CGU,
                            source_inscription: source,
                            source_detail: dossierInvitation || null,
                        }
                    }
                });

                if (authError) throw authError;

                if (authData.user) {
                    // Send branded confirmation email via Brevo
                    // (fire-and-forget — Supabase email is fallback)
                    supabase.functions.invoke('send-confirmation-email', {
                        body: { email },
                    }).catch((e) => console.warn('send-confirmation-email failed:', e));

                    setRegisteredEmail(email);
                    setConfirmationSent(true);
                    setNom('');
                    setPrenom('');
                    setEmail('');
                    setConfirmEmail('');
                    setPassword('');
                    setConfirmPassword('');
                    setDateNaissance('');
                    setTelephone('');
                    setAcceptTerms(false);
                }
            }
        } catch (err: any) {
            if (err.message && (
                err.message.includes("Veuillez remplir") ||
                err.message.includes("correspondent pas") ||
                err.message.includes("accepter les Conditions") ||
                err.message.includes("compte existe déjà") // From your duplicate check
            )) {
                setError(err.message);
            } else {
                // 2. Translate Supabase technical errors
                setError(getFrenchErrorMessage(err.message || ""));
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setError(null);
        setLoading(true);
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    queryParams: {
                      access_type: 'offline',
                      prompt: 'consent'
                    },
                    redirectTo: window.location.origin
                }
            });
            if (error) throw error;
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    };

    const renderConfirmation = () => (
        <div className="w-full max-w-md mx-auto space-y-8 px-4 text-center">
            <img src={APP_CONFIG.altLogo} alt="Filao" className="h-12 mb-6 mx-auto" />

            <div className="flex items-center justify-center w-20 h-20 rounded-full bg-green-50 mx-auto">
                <Mail className="text-green-500" size={36} />
            </div>

            <div className="space-y-3">
                <h2 className="text-2xl font-bold text-filao-dark">Vérifiez votre boîte mail</h2>
                <p className="text-gray-500 text-sm leading-relaxed">
                    Un email de confirmation a été envoyé à<br />
                    <span className="font-semibold text-filao-dark">{registeredEmail}</span>
                </p>
                <p className="text-gray-400 text-xs leading-relaxed pt-2">
                    Cliquez sur le lien dans l'email pour activer votre compte.
                    Pensez à vérifier vos spams si vous ne le voyez pas.
                </p>
            </div>

            <button
                onClick={() => { setConfirmationSent(false); setMode('login'); }}
                className="w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors"
            >
                Retour à la connexion
            </button>

            <p className="text-xs text-gray-400">
                Vous n'avez pas reçu d'email ?{' '}
                <button
                    className="underline text-filao-dark hover:text-filao-primary"
                    onClick={async () => {
                        await supabase.auth.resend({ type: 'signup', email: registeredEmail });
                        showToast('Email renvoyé !', 'success');
                    }}
                >
                    Renvoyer
                </button>
            </p>
        </div>
    );

    const renderLeftPanel = () => (
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#E0F7FA] via-[#E3F2FD] to-[#FFCCBC] relative overflow-hidden items-center justify-center p-12 min-h-screen">
            <div className="flex items-center w-full max-w-lg">
                <MockSidebar />
                <div className="flex-1 space-y-8">
                    {mode === 'login' ? (
                        <h1 className="text-5xl font-bold text-filao-dark leading-tight">
                            Répondre à un <br />
                            appel d'offres <br />
                            <span className="text-filao-primary italic font-serif">n'a jamais été aussi simple.</span>
                        </h1>
                    ) : (
                        <div className="space-y-8">
                            <h1 className="text-4xl font-bold text-filao-dark leading-tight mb-8">
                                Gérez tous vos <br />
                                appels d'offres <br />
                                <span className="text-filao-primary italic font-serif">au même endroit</span>
                            </h1>

                            <div className="bg-[#6B7C8E] p-6 rounded-2xl shadow-xl text-white w-64">
                                <h3 className="text-sm font-medium opacity-90 mb-4">Pourcentage de marchés que vous avez remportés</h3>
                                <span className="text-4xl font-bold">80%</span>
                                <div className="mt-2 flex gap-0.5 h-6 opacity-80">
                                    {Array.from({ length: 15 }).map((_, i) => (
                                        <div key={i} className={`flex-1 rounded-sm ${i < 12 ? 'bg-white' : 'bg-white/20'}`} />
                                    ))}
                                </div>
                            </div>

                            <div className="bg-[#568FA6] p-4 rounded-2xl shadow-xl text-white w-56 translate-x-12">
                                <h3 className="text-sm font-medium mb-3">Collaborateurs</h3>
                                <div className="flex items-center -space-x-2">
                                    <img src="https://picsum.photos/50/50" className="w-8 h-8 rounded-full border border-white" />
                                    <img src="https://picsum.photos/51/51" className="w-8 h-8 rounded-full border border-white" />
                                    <img src="https://picsum.photos/52/52" className="w-8 h-8 rounded-full border border-white" />
                                    <div className="w-8 h-8 rounded-full border border-white bg-white text-filao-dark flex items-center justify-center text-xs font-bold">+3</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const renderLogin = () => (
        <div className="w-full max-w-md mx-auto space-y-8 px-4">
            <div className="text-center md:text-left">
                <img src={APP_CONFIG.altLogo} alt="Filao" className="h-12 mb-6 mx-auto md:mx-0" />
                <h2 className="text-xl font-semibold text-filao-dark">Nous sommes heureux de vous revoir</h2>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3 text-sm">
                    {error}
                </div>
            )}

            <form className="space-y-5" onSubmit={handleAuth}>
                <div>
                    <label className={labelClass}>Adresse email</label>
                    <input
                        type="email"
                        required
                        placeholder="@email.com"
                        className={inputClass}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div>
                    <label className={labelClass}>Mot de passe</label>
                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            required
                            placeholder="Entrer le mot de passe"
                            className={inputClass}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-filao-dark">
                        <input type="checkbox" className="w-4 h-4 rounded text-filao-primary focus:ring-filao-primary border-gray-300" />
                        <span>Se souvenir de moi</span>
                    </label>
                    <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={loading}
                        className="text-sm text-filao-dark underline hover:text-filao-primary disabled:opacity-50"
                    >
                        Mot de passe oublié ?
                    </button>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors disabled:opacity-50"
                >
                    {loading ? 'Traitement...' : 'Se connecter'}
                </button>
            </form>

            <div className="space-y-4">
                <button
                    onClick={handleGoogleLogin}
                    disabled={loading}
                    className="w-full bg-[#1F2937] text-white font-medium py-3.5 rounded-lg hover:bg-black transition-colors flex items-center justify-center gap-3 disabled:opacity-50"
                >
                    <GoogleIcon />
                    Continuer avec Google
                </button>

                <p className="text-center text-sm text-gray-600">
                    Vous n'avez pas de compte ? <button onClick={() => setMode('register')} className="underline text-filao-dark font-medium hover:text-filao-primary">S'inscrire</button>
                </p>
            </div>
        </div>
    );

    const renderRegister = () => (
        <div className="w-full max-w-xl mx-auto space-y-6 px-4 py-8">
            <div className="text-center md:text-left">
                <img src={APP_CONFIG.altLogo} alt="Filao" className="h-12 mb-6 mx-auto md:mx-0" />
            </div>

            <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full bg-gray-800 text-white font-medium py-3.5 rounded-lg hover:bg-black transition-colors flex items-center justify-center gap-3 mb-6 disabled:opacity-50"
            >
                <GoogleIcon />
                Inscrivez-vous avec votre compte Google
            </button>

            <div className="space-y-2">
                <h3 className="font-bold text-gray-800 text-lg border-t border-gray-200 pt-6 mt-6">S'inscrire</h3>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                </div>
            )}

            <form className="space-y-4" onSubmit={handleAuth} autoComplete="off">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Nom*</label>
                        <input
                            type="text"
                            required
                            placeholder="Nom"
                            className={inputClass}
                            value={nom}
                            onChange={(e) => setNom(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Prénom*</label>
                        <input
                            type="text"
                            required
                            placeholder="Prénom"
                            className={inputClass}
                            value={prenom}
                            onChange={(e) => setPrenom(e.target.value)}
                        />
                    </div>
                </div>

                <div>
                    <label className={labelClass}>Date de naissance</label>
                    <input
                        type="date"
                        placeholder="00/00/0000"
                        className={inputClass}
                        value={dateNaissance}
                        onChange={(e) => setDateNaissance(e.target.value)}
                    />
                </div>

                <div>
                    <label className={labelClass}>Numéro de téléphone</label>
                    <input
                        type="text"
                        placeholder="Numéro de téléphone"
                        className={inputClass}
                        value={telephone}
                        onChange={(e) => setTelephone(e.target.value)}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Adresse email*</label>
                        <input
                            type="email"
                            required
                            placeholder="@email.com"
                            autoComplete="off"
                            className={inputClass}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className={labelClass}>Confirmer votre adresse email*</label>
                        <input
                            type="email"
                            required
                            placeholder="@email.com"
                            autoComplete="off"
                            className={inputClass}
                            value={confirmEmail}
                            onChange={(e) => setConfirmEmail(e.target.value)}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Mot de passe*</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                required
                                placeholder="Entrer le mot de passe"
                                autoComplete="new-password"
                                className={inputClass}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>Confirmer le mot de passe*</label>
                        <div className="relative">
                            <input
                                type={showConfirmPassword ? "text" : "password"}
                                required
                                placeholder="Entrer le mot de passe"
                                autoComplete="new-password"
                                className={inputClass}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-start gap-3 mt-2">
                    <input
                        type="checkbox"
                        className="mt-1 w-4 h-4 rounded text-blue-600 border-gray-300"
                        checked={acceptTerms}
                        onChange={(e) => setAcceptTerms(e.target.checked)}
                    />
                    <p className="text-xs text-gray-800 leading-relaxed">
                        En cochant cette case, j'accepte et je reconnais avoir pris connaissance des Conditions Générales de Vente ainsi que de la Politique de Confidentialité.
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#0E4F70] text-white font-bold py-3.5 rounded-lg hover:bg-[#0A3D58] transition-colors disabled:opacity-50"
                >
                    {loading ? 'Inscription en cours...' : "S'inscrire"}
                </button>
            </form>

            <p className="text-center text-sm text-gray-600 pb-8">
                Vous avez déjà un compte ? <button onClick={() => setMode('login')} className="underline text-gray-800 font-medium hover:text-blue-600">Se connecter</button>
            </p>
        </div>
    );

    return (
        <div className="min-h-screen flex bg-white font-sans">
            {renderLeftPanel()}

            <div className="w-full lg:w-1/2 h-screen overflow-y-auto flex items-center justify-center">
                {confirmationSent
                    ? renderConfirmation()
                    : mode === 'login' ? renderLogin() : renderRegister()
                }
            </div>
        </div>
    );
};

export default Auth;