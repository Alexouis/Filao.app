import React, { useState, useEffect } from 'react';
import { useToast } from '../ui/Toast';
import { Shield, Lock, AlertTriangle, Loader2, Check, X } from 'lucide-react';
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

    // Password modal
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
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
    }, [userProfile]);

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
        try {
            setPasswordLoading(true);
            setPasswordError(null);
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
                setPasswordForm({ newPassword: '', confirmPassword: '' });
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
                                <label className="text-xs font-medium text-gray-600 block mb-1">Nouveau mot de passe</label>
                                <input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))} className={modalInputClass} />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-600 block mb-1">Confirmer</label>
                                <input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))} className={modalInputClass} />
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