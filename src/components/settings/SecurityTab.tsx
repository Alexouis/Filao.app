import React, { useState, useEffect } from 'react';
import { useToast } from '../ui/Toast';
import { Shield, Lock, AlertTriangle, Loader2, Check, X, Download } from 'lucide-react';
import { SettingsCard } from './SettingsCard';
import { supabase } from '../../lib/supabaseClient';
import { UserProfile } from '../../config';

interface SecurityTabProps {
    userProfile: UserProfile | null;
    onUpdate: () => void;
}

export const SecurityTab: React.FC<SecurityTabProps> = ({ userProfile, onUpdate }) => {
    const { showToast } = useToast();
    const [mfaEnabled, setMfaEnabled] = useState(false);
    const [mfaLastUpdated, setMfaLastUpdated] = useState<string | null>(null);

    // Enrôlement 2FA (TOTP)
    const [showMfaModal, setShowMfaModal] = useState(false);
    const [mfaStep, setMfaStep] = useState<'intro' | 'scan' | 'done'>('intro');
    const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
    const [mfaQrSvg, setMfaQrSvg] = useState<string | null>(null);
    const [mfaSecret, setMfaSecret] = useState<string | null>(null);
    const [mfaCode, setMfaCode] = useState('');
    const [mfaLoading, setMfaLoading] = useState(false);
    const [mfaError, setMfaError] = useState<string | null>(null);
    // Désactivation
    const [showMfaDisableModal, setShowMfaDisableModal] = useState(false);
    const [mfaDisableCode, setMfaDisableCode] = useState('');
    // Codes de secours affichés une seule fois après activation.
    const [backupCodes, setBackupCodes] = useState<string[]>([]);
    // Export RGPD
    const [exportLoading, setExportLoading] = useState(false);
    // Journal des connexions
    const [connexions, setConnexions] = useState<any[]>([]);
    const [connexionsLoading, setConnexionsLoading] = useState(true);
    const [revokeLoading, setRevokeLoading] = useState(false);

    // Password modal
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [passwordLoading, setPasswordLoading] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    // Delete modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [deleteReason, setDeleteReason] = useState('');
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteSuccess, setDeleteSuccess] = useState(false);
    const [deleteError, setDeleteError] = useState<{ message: string; aos?: string[] } | null>(null);

    useEffect(() => {
        fetchMfaStatus();
        fetchConnexions();
    }, [userProfile]);

    const fetchConnexions = async () => {
        try {
            setConnexionsLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            // RLS limite déjà au propriétaire ; l'eq est une ceinture de sécurité.
            const { data, error } = await supabase
                .from('connexions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(20);
            if (!error) setConnexions(data || []);
        } catch (err) {
            console.error('Chargement du journal de connexions échoué', err);
        } finally {
            setConnexionsLoading(false);
        }
    };

    // Révoque toutes les AUTRES sessions (tout appareil sauf celui-ci).
    // L'API Supabase ne permet pas de cibler une session précise par appareil ;
    // on propose donc l'action fiable « déconnecter partout ailleurs ».
    const revoquerAutresSessions = async () => {
        setRevokeLoading(true);
        try {
            const { error } = await supabase.auth.signOut({ scope: 'others' });
            if (error) throw error;
            showToast('Toutes les autres sessions ont été déconnectées.', 'success');
        } catch (err) {
            showToast('Impossible de déconnecter les autres sessions.', 'error');
            console.error('Révocation des sessions échouée', err);
        } finally {
            setRevokeLoading(false);
        }
    };

    const fetchMfaStatus = async () => {
        try {
            const { data, error } = await supabase.auth.mfa.listFactors();
            if (!error && data.totp.length > 0) {
                setMfaEnabled(data.totp[0].status === 'verified');
                setMfaLastUpdated(data.totp[0].created_at);
            }
        } catch (err) {
            console.error('MFA check failed:', err);
        }
    };

    // Démarre l'enrôlement d'un facteur TOTP. Supabase refuse un nouvel enroll
    // s'il subsiste un facteur non vérifié (enrôlement précédent abandonné) : on
    // purge donc d'abord tout facteur `unverified`.
    const startMfaEnroll = async () => {
        setMfaError(null);
        setMfaLoading(true);
        try {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const orphelins = (factors?.all || []).filter(f => f.status === 'unverified');
            for (const f of orphelins) {
                await supabase.auth.mfa.unenroll({ factorId: f.id });
            }

            const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
            if (error) throw error;

            setMfaFactorId(data.id);
            // Supabase fournit le QR déjà rendu (SVG) et le secret en clair.
            setMfaQrSvg(data.totp.qr_code);
            setMfaSecret(data.totp.secret);
            setMfaStep('scan');
        } catch (err: any) {
            setMfaError(err?.message || "Impossible de démarrer l'activation.");
        } finally {
            setMfaLoading(false);
        }
    };

    // Vérifie le code à 6 chiffres et fait passer le facteur en `verified`.
    const verifyMfaEnroll = async () => {
        if (!mfaFactorId) return;
        const code = mfaCode.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) {
            setMfaError('Saisissez le code à 6 chiffres affiché par votre application.');
            return;
        }
        setMfaError(null);
        setMfaLoading(true);
        try {
            const { data: challenge, error: challengeError } =
                await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
            if (challengeError) throw challengeError;

            const { error: verifyError } = await supabase.auth.mfa.verify({
                factorId: mfaFactorId,
                challengeId: challenge.id,
                code,
            });
            if (verifyError) throw verifyError;

            // Génère les codes de secours (affichés une seule fois à l'étape
            // suivante). Un échec ici ne doit pas annuler l'activation réussie
            // du TOTP : on log et on continue sans codes.
            try {
                const { data: gen } = await supabase.functions.invoke('mfa-backup-codes', {
                    body: { action: 'generate' },
                });
                if (gen?.success && Array.isArray(gen.codes)) setBackupCodes(gen.codes);
            } catch (genErr) {
                console.warn('Génération des codes de secours échouée', genErr);
            }

            setMfaStep('done');
            setMfaEnabled(true);
            setMfaLastUpdated(new Date().toISOString());
        } catch (err: any) {
            setMfaError(err?.message || 'Code incorrect. Vérifiez l\'heure de votre téléphone et réessayez.');
        } finally {
            setMfaLoading(false);
        }
    };

    const closeMfaModal = () => {
        setShowMfaModal(false);
        setMfaStep('intro');
        setMfaFactorId(null);
        setMfaQrSvg(null);
        setMfaSecret(null);
        setMfaCode('');
        setMfaError(null);
    };

    // Désactivation : Supabase exige que la session soit en AAL2 pour retirer un
    // facteur. On demande donc un code TOTP valide (challenge + verify) juste
    // avant de désenrôler.
    const disableMfa = async () => {
        setMfaError(null);
        const code = mfaDisableCode.replace(/\s/g, '');
        if (!/^\d{6}$/.test(code)) {
            setMfaError('Saisissez le code à 6 chiffres pour confirmer la désactivation.');
            return;
        }
        setMfaLoading(true);
        try {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const totp = factors?.totp?.[0];
            if (!totp) { setMfaEnabled(false); setShowMfaDisableModal(false); return; }

            const { data: challenge, error: challengeError } =
                await supabase.auth.mfa.challenge({ factorId: totp.id });
            if (challengeError) throw challengeError;

            const { error: verifyError } = await supabase.auth.mfa.verify({
                factorId: totp.id,
                challengeId: challenge.id,
                code,
            });
            if (verifyError) throw verifyError;

            const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: totp.id });
            if (unenrollError) throw unenrollError;

            setMfaEnabled(false);
            setMfaLastUpdated(new Date().toISOString());
            setShowMfaDisableModal(false);
            setMfaDisableCode('');
            showToast('Authentification à deux facteurs désactivée.', 'success');
        } catch (err: any) {
            setMfaError(err?.message || 'Code incorrect. Réessayez.');
        } finally {
            setMfaLoading(false);
        }
    };

    // Export RGPD : récupère les données via l'edge function et déclenche le
    // téléchargement d'un fichier JSON. Aucune donnée ne transite par un tiers.
    const handleExportData = async () => {
        setExportLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke('export-user-data', { body: {} });
            if (error) throw error;
            if (!data?.success) throw new Error('Export indisponible');

            const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `filao-mes-donnees-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showToast('Export téléchargé.', 'success');
        } catch (err: any) {
            showToast('Export impossible pour le moment.', 'error');
            console.error('Export RGPD:', err);
        } finally {
            setExportLoading(false);
        }
    };

    const handlePasswordChange = async () => {
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setPasswordError('Les mots de passe ne correspondent pas');
            return;
        }
        // 12 caractères, comme sur l'écran de réinitialisation. Deux seuils
        // différents pour un même mot de passe n'auraient aucun sens : il
        // suffirait de passer par le formulaire le plus permissif.
        if (passwordForm.newPassword.length < 12) {
            setPasswordError('Le mot de passe doit contenir au moins 12 caractères');
            return;
        }
        if (!passwordForm.currentPassword) {
            setPasswordError('Saisissez votre mot de passe actuel');
            return;
        }
        try {
            setPasswordLoading(true);
            setPasswordError(null);

            // Vérification du mot de passe actuel avant toute modification : on
            // le ré-authentifie. Sans cela, une session laissée ouverte
            // permettrait à un tiers de changer le mot de passe sans connaître
            // l'ancien. `signInWithPassword` ne casse pas la session courante en
            // cas de succès ; en cas d'échec, on s'arrête là.
            const { data: { user: current } } = await supabase.auth.getUser();
            if (!current?.email) throw new Error('Session introuvable, reconnectez-vous.');

            const { error: reauthError } = await supabase.auth.signInWithPassword({
                email: current.email,
                password: passwordForm.currentPassword,
            });
            if (reauthError) {
                setPasswordError('Mot de passe actuel incorrect');
                setPasswordLoading(false);
                return;
            }

            const { error } = await supabase.auth.updateUser({ password: passwordForm.newPassword });
            if (error) throw error;

            // Notification du changement. Ce chemin n'en envoyait aucune, alors
            // que la réinitialisation le fait : un compte détourné dont
            // l'attaquant change le mot de passe depuis l'application ne
            // produisait donc aucun signal, là où le même geste par « mot de
            // passe oublié » en produit deux.
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
                if (errAvis) console.warn('Avis de changement non envoyé', errAvis);
            }

            // Déconnexion des autres sessions. Changer son mot de passe sans
            // fermer les sessions ouvertes ailleurs laisserait un accès actif à
            // qui détiendrait l'ancien.
            const { error: errDeconnexion } = await supabase.auth.signOut({ scope: 'others' });
            if (errDeconnexion) console.warn('Déconnexion des autres sessions incomplète', errDeconnexion);

            setPasswordSuccess(true);
            setTimeout(() => {
                setShowPasswordModal(false);
                setPasswordSuccess(false);
                setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            }, 2000);
        } catch (err: any) {
            setPasswordError(err.message);
        } finally {
            setPasswordLoading(false);
        }
    };

    const handleDeleteAccount = async () => {
        setDeleteLoading(true);
        setDeleteError(null);

        try {
            const { data, error } = await supabase.functions.invoke('delete-account', {
                method: 'POST',
                body: { reason: deleteReason || null },
            });

            if (error) {
                setDeleteError({ message: error.message || 'Une erreur est survenue.' });
                return;
            }

            if (!data?.success) {
                if (data?.error === 'blocking_groupements') {
                    setDeleteError({ message: data.message, aos: data.aos });
                } else {
                    setDeleteError({ message: data?.error || 'Une erreur est survenue.' });
                }
                return;
            }

            // Show success screen then sign out and redirect
            setDeleteSuccess(true);
            await supabase.auth.signOut();
            setTimeout(() => { window.location.href = '/'; }, 2500);
        } catch (err: any) {
            setDeleteError({ message: err.message || 'Une erreur inattendue est survenue.' });
        } finally {
            setDeleteLoading(false);
        }
    };

    const handleCloseDeleteModal = () => {
        if (deleteLoading) return;
        setShowDeleteModal(false);
        setDeleteConfirmText('');
        setDeleteReason('');
        setDeleteError(null);
        setDeleteSuccess(false);
    };

    const modalInputClass = "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary/30 transition-colors";

    return (
        <div className="space-y-3">
            {/* Page Header */}
            <div>
                <h2 className="text-xl font-bold text-gray-900">Sécurité</h2>
                <p className="text-gray-500 text-sm">Accès et protection de votre compte</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* MFA */}
                <SettingsCard title="Authentification à deux facteurs" icon={Shield}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-700">Protégez votre compte avec une seconde couche de sécurité</p>
                            {mfaEnabled ? (
                                <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                    <Check size={12} /> Activé
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                    Désactivé
                                </span>
                            )}
                        </div>
                    </div>
                    {mfaLastUpdated && (
                        <p className="text-xs text-gray-400 mt-3">
                            Dernière modification : {new Date(mfaLastUpdated).toLocaleDateString('fr-FR')}
                        </p>
                    )}
                    {!mfaLastUpdated && (
                        <p className="text-xs text-gray-400 mt-3">Dernière modification : Inconnue</p>
                    )}
                    <div className="mt-4">
                        {mfaEnabled ? (
                            <button
                                onClick={() => { setMfaError(null); setMfaDisableCode(''); setShowMfaDisableModal(true); }}
                                className="px-4 py-2 border border-red-200 text-red-500 hover:bg-red-50 rounded-xl text-sm font-medium transition-colors"
                            >
                                Désactiver
                            </button>
                        ) : (
                            <button
                                onClick={() => { setMfaStep('intro'); setMfaError(null); setShowMfaModal(true); }}
                                className="px-4 py-2 bg-[#0B1F38] hover:bg-[#00A3E0] text-white rounded-xl text-sm font-medium transition-colors"
                            >
                                Activer
                            </button>
                        )}
                    </div>
                </SettingsCard>

                {/* Password */}
                <SettingsCard title="Mot de passe" icon={Lock}>
                    <p className="text-sm text-gray-500 mb-4">Changez votre mot de passe pour sécuriser votre compte.</p>
                    <button
                        onClick={() => setShowPasswordModal(true)}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors"
                    >
                        Modifier le mot de passe
                    </button>
                </SettingsCard>

                {/* Export RGPD */}
                <SettingsCard title="Vos données" icon={Download}>
                    <p className="text-sm text-gray-500 mb-4">
                        Téléchargez une copie de vos données personnelles au format JSON réutilisable (portabilité RGPD).
                    </p>
                    <button
                        onClick={handleExportData}
                        disabled={exportLoading}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                    >
                        {exportLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Exporter mes données
                    </button>
                </SettingsCard>

                {/* Danger Zone */}
                <SettingsCard title="Zone Danger" icon={AlertTriangle} variant="danger">
                    <p className="text-sm text-gray-500 mb-2">
                        <strong className="text-red-600">Supprimer le compte</strong> — Cette action est irréversible et supprime toutes vos données.
                    </p>
                    <p className="text-xs text-gray-400 mb-4">
                        Vos informations personnelles, documents et accès seront définitivement effacés. Si votre entreprise est engagée dans des groupements actifs, la suppression sera bloquée.
                    </p>
                    <button
                        onClick={() => setShowDeleteModal(true)}
                        className="px-4 py-2 border border-red-200 text-red-500 hover:bg-red-50 rounded-xl text-sm font-medium transition-colors"
                    >
                        Supprimer mon compte
                    </button>
                </SettingsCard>
            </div>

            {/* Journal des connexions */}
            <div className="mt-3">
                <SettingsCard title="Connexions récentes" icon={Shield}>
                    <div className="flex items-start justify-between gap-4 mb-4">
                        <p className="text-sm text-gray-500">
                            Vérifiez les connexions récentes à votre compte. Si vous ne reconnaissez pas un accès, déconnectez les autres sessions et changez votre mot de passe.
                        </p>
                        <button
                            onClick={revoquerAutresSessions}
                            disabled={revokeLoading}
                            className="px-4 py-2 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
                        >
                            {revokeLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Déconnecter les autres sessions
                        </button>
                    </div>

                    {connexionsLoading ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                    ) : connexions.length === 0 ? (
                        <p className="text-sm text-gray-400 py-4 text-center">Aucune connexion enregistrée pour le moment.</p>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {connexions.map((c) => (
                                <div key={c.id} className="flex items-center justify-between py-2.5 text-sm">
                                    <div>
                                        <p className="text-gray-800 font-medium">{c.appareil || 'Appareil inconnu'}</p>
                                        <p className="text-xs text-gray-400">
                                            {c.methode === 'google' ? 'via Google' : 'par mot de passe'}
                                            {c.ip ? ` · ${c.ip}` : ''}
                                        </p>
                                    </div>
                                    <span className="text-xs text-gray-500 shrink-0">
                                        {new Date(c.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </SettingsCard>
            </div>

            {/* MFA Enrollment Modal */}
            {showMfaModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeMfaModal}></div>
                    <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                        <button onClick={closeMfaModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Activer la double authentification</h3>
                        {mfaError && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm mb-4">{mfaError}</div>}

                        {mfaStep === 'intro' && (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600">
                                    Utilisez une application d'authentification (Google Authenticator, Authy, 1Password…). À chaque connexion, elle générera un code à 6 chiffres à saisir en plus de votre mot de passe.
                                </p>
                                <button
                                    onClick={startMfaEnroll}
                                    disabled={mfaLoading}
                                    className="w-full bg-filao-primary text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex justify-center items-center gap-2"
                                >
                                    {mfaLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Commencer
                                </button>
                            </div>
                        )}

                        {mfaStep === 'scan' && (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600">Scannez ce QR code avec votre application d'authentification :</p>
                                {mfaQrSvg && (
                                    <div className="flex justify-center bg-white p-3 rounded-xl border border-gray-100" dangerouslySetInnerHTML={{ __html: mfaQrSvg }} />
                                )}
                                {mfaSecret && (
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Ou saisissez cette clé manuellement :</p>
                                        <code className="block text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-all text-gray-800 font-mono">{mfaSecret}</code>
                                    </div>
                                )}
                                <div>
                                    <label className="text-xs font-medium text-gray-600 block mb-1">Code de vérification</label>
                                    <input
                                        type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                                        value={mfaCode}
                                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                                        placeholder="123456"
                                        className={`${modalInputClass} tracking-[0.4em] text-center font-mono`}
                                    />
                                </div>
                                <button
                                    onClick={verifyMfaEnroll}
                                    disabled={mfaLoading}
                                    className="w-full bg-filao-primary text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex justify-center items-center gap-2"
                                >
                                    {mfaLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Vérifier et activer
                                </button>
                            </div>
                        )}

                        {mfaStep === 'done' && (
                            <div className="space-y-4 text-center">
                                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-50 mx-auto">
                                    <Check className="text-green-500" size={28} />
                                </div>
                                <p className="text-sm text-gray-700 font-medium">La double authentification est activée.</p>
                                <p className="text-xs text-gray-500">Un code vous sera demandé à chaque connexion.</p>

                                {backupCodes.length > 0 && (
                                    <div className="text-left bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                                        <p className="text-xs font-bold text-amber-800">Codes de secours</p>
                                        <p className="text-[11px] text-amber-700">
                                            Conservez-les en lieu sûr. En cas de perte de votre téléphone, chaque code permet de récupérer l'accès (à usage unique). Ils ne seront plus affichés.
                                        </p>
                                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                                            {backupCodes.map(c => (
                                                <code key={c} className="text-xs font-mono bg-white border border-amber-200 rounded px-2 py-1 text-gray-800 text-center">{c}</code>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => { navigator.clipboard?.writeText(backupCodes.join('\n')); showToast('Codes copiés.', 'success'); }}
                                            className="text-xs text-amber-800 underline mt-1"
                                        >
                                            Copier les codes
                                        </button>
                                    </div>
                                )}

                                <button
                                    onClick={() => { closeMfaModal(); setBackupCodes([]); onUpdate(); }}
                                    className="w-full bg-filao-primary text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90"
                                >
                                    J'ai noté mes codes — Terminer
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* MFA Disable Modal */}
            {showMfaDisableModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowMfaDisableModal(false)}></div>
                    <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                        <button onClick={() => setShowMfaDisableModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Désactiver la double authentification</h3>
                        {mfaError && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm mb-4">{mfaError}</div>}
                        <p className="text-sm text-gray-600 mb-4">
                            Saisissez un code de votre application d'authentification pour confirmer. Votre compte ne sera plus protégé que par votre mot de passe.
                        </p>
                        <input
                            type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                            value={mfaDisableCode}
                            onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="123456"
                            className={`${modalInputClass} tracking-[0.4em] text-center font-mono`}
                        />
                        <button
                            onClick={disableMfa}
                            disabled={mfaLoading}
                            className="mt-5 w-full bg-red-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {mfaLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Confirmer la désactivation
                        </button>
                    </div>
                </div>
            )}

            {/* Password Modal */}
            {showPasswordModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPasswordModal(false)}></div>
                    <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                        <button onClick={() => setShowPasswordModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        <h3 className="text-lg font-bold text-gray-900 mb-4">Modifier le mot de passe</h3>
                        {passwordError && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm mb-4">{passwordError}</div>}
                        {passwordSuccess && <div className="p-3 bg-green-50 text-green-600 rounded-lg text-sm mb-4">Mot de passe mis à jour !</div>}
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Mot de passe actuel</label>
                                <input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))} className={modalInputClass} autoComplete="current-password" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Nouveau mot de passe</label>
                                <input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))} className={modalInputClass} autoComplete="new-password" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Confirmer</label>
                                <input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))} className={modalInputClass} autoComplete="new-password" />
                            </div>
                        </div>
                        <button
                            onClick={handlePasswordChange}
                            disabled={passwordLoading}
                            className="mt-5 w-full bg-filao-primary text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {passwordLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                            Enregistrer
                        </button>
                    </div>
                </div>
            )}

            {/* Delete Account Modal */}
            {showDeleteModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={!deleteSuccess ? handleCloseDeleteModal : undefined}></div>
                    <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                        {!deleteLoading && !deleteSuccess && (
                            <button onClick={handleCloseDeleteModal} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        )}

                        {/* SUCCESS SCREEN */}
                        {deleteSuccess ? (
                            <div className="text-center py-4">
                                <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Check size={28} className="text-green-500" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">Compte supprimé</h3>
                                <p className="text-sm text-gray-500">Votre compte a bien été supprimé. Vous allez être redirigé…</p>
                            </div>
                        ) : (
                            <>
                                <div className="text-center mb-4">
                                    <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <AlertTriangle size={24} className="text-red-500" />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900">Supprimer votre compte ?</h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Cette action est <strong>irréversible</strong>. Toutes vos données seront supprimées définitivement.
                                    </p>
                                </div>

                                {/* Blocking error */}
                                {deleteError && (
                                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                                        <p className="text-sm text-red-700 font-medium">{deleteError.message}</p>
                                        {deleteError.aos && deleteError.aos.length > 0 && (
                                            <ul className="mt-2 space-y-1">
                                                {deleteError.aos.map((ao, i) => (
                                                    <li key={i} className="text-xs text-red-600 flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                                        {ao}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        <button
                                            onClick={handleCloseDeleteModal}
                                            className="mt-3 w-full py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                                        >
                                            Fermer
                                        </button>
                                    </div>
                                )}

                                {/* Form — only show if not blocked */}
                                {!deleteError && (
                                    <>
                                        <div className="mb-3">
                                            <label className="text-xs font-medium text-gray-600 block mb-1.5">
                                                Raison de la suppression <span className="text-gray-400 font-normal">(optionnel)</span>
                                            </label>
                                            <select
                                                value={deleteReason}
                                                onChange={(e) => setDeleteReason(e.target.value)}
                                                className={modalInputClass}
                                                disabled={deleteLoading}
                                            >
                                                <option value="">— Choisir une raison —</option>
                                                <option value="Je n'utilise plus la plateforme">Je n'utilise plus la plateforme</option>
                                                <option value="Je préfère une autre solution">Je préfère une autre solution</option>
                                                <option value="L'application ne correspond pas à mes besoins">L'application ne correspond pas à mes besoins</option>
                                                <option value="Problèmes techniques récurrents">Problèmes techniques récurrents</option>
                                                <option value="Mon entreprise a cessé son activité">Mon entreprise a cessé son activité</option>
                                                <option value="Autre">Autre</option>
                                            </select>
                                        </div>

                                        <p className="text-xs text-gray-500 mb-2 text-center">
                                            Tapez <strong className="text-gray-800">SUPPRIMER</strong> pour confirmer
                                        </p>
                                        <input
                                            type="text"
                                            value={deleteConfirmText}
                                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                                            className={modalInputClass}
                                            placeholder="SUPPRIMER"
                                            disabled={deleteLoading}
                                        />
                                        <button
                                            onClick={handleDeleteAccount}
                                            disabled={deleteConfirmText !== 'SUPPRIMER' || deleteLoading}
                                            className="mt-4 w-full bg-red-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                        >
                                            {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                            {deleteLoading ? 'Suppression en cours…' : 'Confirmer la suppression'}
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};