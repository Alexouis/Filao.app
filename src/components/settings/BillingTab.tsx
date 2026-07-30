import React, { useState, useEffect } from 'react';
import { forfait, tousLesForfaits, prixLisible, illimite } from '../../helpers/planLimits';
import { CreditCard, AlertCircle, Loader2, ExternalLink, X, ArrowUpRight } from 'lucide-react';
import { SettingsCard } from './SettingsCard';
import { supabase } from '../../lib/supabaseClient';
import { PLANS, PLANS_CONFIG, PLANS_TYPES, PlanType, UserProfile, STATUSES } from '../../config';
import { isActive } from '../../helpers/tenderHelpers';

interface BillingTabProps {
    userProfile: UserProfile | null;
    onUpdate: () => void;
    onNavigate?: (tab: string) => void;
}

export const BillingTab: React.FC<BillingTabProps> = ({ userProfile, onUpdate, onNavigate }) => {
    const [activeTendersCount, setActiveTendersCount] = useState(0);
    const [countLoading, setCountLoading] = useState(true);
    const [portalLoading, setPortalLoading] = useState(false);

    // TVA / Billing Email modals
    const [isTVAModalOpen, setIsTVAModalOpen] = useState(false);
    const [isBillingEmailModalOpen, setIsBillingEmailModalOpen] = useState(false);

    useEffect(() => {
        const fetchTenderCount = async () => {
            if (!userProfile) return;
            // Décompte de référence, calculé en base : il porte sur l'ENTREPRISE
            // et non sur l'utilisateur. La version précédente filtrait sur
            // `createur_id`, donc chaque membre voyait son propre compteur — un
            // collègue pouvait saturer le quota sans que cela n'apparaisse ici.
            //
            // `isActive` incluait de surcroît les dossiers déposés, qui ne
            // consomment plus de place : le compteur affichait plus que la
            // réalité, ce qui est précisément le « KPI incohérent » relevé.
            if (userProfile.entreprise_id) {
                const { data, error } = await supabase.rpc('dossiers_portes_entreprise', {
                    p_entreprise_id: userProfile.entreprise_id,
                });
                if (!error && typeof data === 'number') setActiveTendersCount(data);
                else console.error('dossiers_portes_entreprise:', error);
            }
            setCountLoading(false);
        };

        fetchTenderCount();
    }, [userProfile]);

    const handleOpenPortal = async () => {
        if (!userProfile?.entreprise_id) return;
        try {
            setPortalLoading(true);
            const response = await supabase.functions.invoke('create-portal-session', {
                body: { entrepriseId: userProfile.entreprise_id },
            });

            if (response.data?.url) {
                window.open(response.data.url, '_blank');
            } else {
                console.error('Portal error:', response.error || response.data?.error);
            }
        } catch (err) {
            console.error('Portal error:', err);
        } finally {
            setPortalLoading(false);
        }
    };

    const SimpleInputModal = ({ isOpen, onClose, title, label, initialValue, onSave, type = 'text' }: any) => {
        const [val, setVal] = useState(initialValue);
        const [loading, setLoading] = useState(false);

        useEffect(() => setVal(initialValue), [initialValue, isOpen]);

        const handleSave = async () => {
            setLoading(true);
            await onSave(val);
            setLoading(false);
            onClose();
        };

        if (!isOpen) return null;

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
                <div className="relative bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                    <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                    <h3 className="text-lg font-bold text-gray-900 mb-4">{title}</h3>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input type={type} value={val} onChange={e => setVal(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary/30 transition-colors mb-4" />
                    <button onClick={handleSave} disabled={loading} className="w-full bg-filao-primary text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Enregistrer'}
                    </button>
                </div>
            </div>
        );
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Mo';
        const k = 1024;
        const sizes = ['Octets', 'Ko', 'Mo', 'Go', 'To'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Forfait lu depuis `plan_limits` : les valeurs de `PLANS_CONFIG`
    // divergeaient de la base, et un changement de tarif imposait une livraison.
    const offre = forfait(userProfile?.plan);
    const currentPlanKey = offre.code;
    const currentPlanInfo = PLANS.find(p => p.id === currentPlanKey);
    const usedStorage = (userProfile as any)?.storage_used || 0;
    const totalStorage = offre.maxStockageOctets;
    // Stockage illimité : aucun pourcentage n'a de sens, la barre reste vide.
    const storagePercentage = totalStorage
        ? Math.min(100, Math.max(0, (usedStorage / totalStorage) * 100))
        : 0;
    const hasStripeSubscription = Boolean((userProfile as any)?.stripe_subscription_id)
        || currentPlanKey !== PLANS_TYPES.free;

    return (
        <div className="space-y-3">
            {/* Page Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Abonnement & Facturation</h2>
                    <p className="text-gray-500 text-sm">Gérez votre forfait et vos informations de paiement</p>
                </div>
                <button
                    onClick={() => onNavigate?.('pricing')}
                    className="px-5 py-2 bg-filao-primary text-white rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-filao-primary/20 transition-all flex items-center gap-2"
                >
                    <ArrowUpRight size={16} />
                    Voir les forfaits
                </button>
            </div>

            {/* Current Plan Card */}
            <div className="bg-gradient-to-br from-[#1A3350] to-[#0D1F33] rounded-2xl p-6 shadow-lg">
                <div className="flex justify-between items-end mb-6">
                    <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Votre forfait</p>
                        <h3 className="text-2xl font-bold text-white">
                            {currentPlanInfo?.name || 'Réseau'}
                        </h3>
                        <p className="text-gray-400 text-sm mt-0.5">
                            {prixLisible(offre)}
                        </p>
                    </div>
                    {currentPlanKey !== 'partenaire' && currentPlanKey !== 'organisation' && (
                        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${hasStripeSubscription ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'
                            }`}>
                            {hasStripeSubscription ? 'Actif' : 'En attente'}
                        </span>
                    )}
                </div>

                {/* Usage Bars */}
                <div className="space-y-4">
                    <div>
                        <div className="flex justify-between text-xs mb-1.5">
                            <span className="text-gray-400">Espace de stockage</span>
                            <span className="text-white font-medium">{formatBytes(usedStorage)} / {formatBytes(totalStorage)}</span>
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-1.5">
                            <div className="bg-filao-primary h-1.5 rounded-full transition-all" style={{ width: `${storagePercentage}%` }}></div>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between text-xs mb-1.5 gap-2">
                            {/* Libellé explicite, comme le demande la conception.
                                « Appels d'offres actifs » ne disait ni ce qui est
                                compté — les dossiers créés, pas ceux rejoints — ni
                                que le quota est partagé par l'entreprise. C'est cette
                                imprécision qui a fait passer un comportement normal
                                pour un bug en recette. */}
                            <span className="text-gray-400">
                                Dossiers en cours créés par votre entreprise
                            </span>
                            <span className="text-white font-medium shrink-0">
                                {activeTendersCount} / {illimite(offre) ? 'Illimité' : offre.maxAoSimultanes}
                            </span>
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-1.5">
                            <div className="bg-filao-primary h-1.5 rounded-full transition-all" style={{
                                width: illimite(offre)
                                    ? '100%'
                                    : `${Math.min(100, (activeTendersCount / Math.max(offre.maxAoSimultanes ?? 1, 1)) * 100)}%`
                            }}></div>
                        </div>
                        {/* Le forfait Partenaire n'autorise aucun dossier porté :
                            « 0 / 0 » sans explication laisse croire à une erreur. */}
                        {offre.maxAoSimultanes === 0 && (
                            <p className="text-[11px] text-gray-400 mt-1.5">
                                Ce forfait permet de rejoindre les dossiers d'autres entreprises, sans en créer.
                            </p>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <SettingsCard title="Informations de facturation" icon={CreditCard}>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center py-2.5 border-b border-gray-100">
                            <div>
                                <span className="text-xs text-gray-500 block">Email de facturation</span>
                                <span className="text-sm text-gray-900 font-medium">{userProfile?.email_facturation || userProfile?.email}</span>
                            </div>
                            <button onClick={() => setIsBillingEmailModalOpen(true)} className="text-xs text-filao-primary hover:underline font-medium">Modifier</button>
                        </div>
                        <div className="flex justify-between items-center py-2.5 border-b border-gray-100">
                            <div>
                                <span className="text-xs text-gray-500 block">Numéro de TVA</span>
                                <span className="text-sm text-gray-900 font-medium">{userProfile?.tva || 'Non renseigné'}</span>
                            </div>
                            <button onClick={() => setIsTVAModalOpen(true)} className="text-xs text-filao-primary hover:underline font-medium">Modifier</button>
                        </div>
                    </div>
                </SettingsCard>

                <SettingsCard title="Portail de paiement" icon={AlertCircle}>
                    <p className="text-sm text-gray-500 mb-4">
                        Gérez vos moyens de paiement, téléchargez vos factures et mettez à jour votre abonnement via le portail sécurisé Stripe.
                    </p>
                    <button
                        onClick={handleOpenPortal}
                        disabled={portalLoading || !hasStripeSubscription}
                        className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {portalLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <>
                                <ExternalLink size={14} />
                                Accéder au portail Stripe
                            </>
                        )}
                    </button>
                    {!hasStripeSubscription && (
                        <p className="text-xs text-gray-400 mt-2 text-center">
                            Disponible après souscription à un forfait payant
                        </p>
                    )}
                </SettingsCard>
            </div>

            <SimpleInputModal
                isOpen={isTVAModalOpen}
                onClose={() => setIsTVAModalOpen(false)}
                title="Modifier TVA"
                label="Numéro de TVA"
                initialValue={userProfile?.tva || ''}
                onSave={async (val: string) => {
                    await supabase.from('utilisateurs').update({ tva: val }).eq('id', userProfile?.id);
                    onUpdate();
                }}
            />

            <SimpleInputModal
                isOpen={isBillingEmailModalOpen}
                onClose={() => setIsBillingEmailModalOpen(false)}
                title="Modifier email de facturation"
                label="Email"
                type="email"
                initialValue={userProfile?.email_facturation || userProfile?.email || ''}
                onSave={async (val: string) => {
                    await supabase.from('utilisateurs').update({ email_facturation: val }).eq('id', userProfile?.id);
                    onUpdate();
                }}
            />
        </div>
    );
};