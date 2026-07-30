import React, { useState } from 'react';
import { forfait, tousLesForfaits } from '../helpers/planLimits';
import { Check, Crown, ArrowRight, Mail, Loader2 } from 'lucide-react';
import { PLANS, PLANS_CONFIG, STRIPE_PRICES, PlanType, UserProfile } from '../config';
import { supabase } from '../lib/supabaseClient';

interface PricingPageProps {
    userProfile: UserProfile | null;
    onNavigate?: (tab: string) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ userProfile, onNavigate }) => {
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    let currentPlan = (userProfile?.plan as PlanType) || 'partenaire';
    if (!PLANS_CONFIG[currentPlan]) currentPlan = 'partenaire';

    const handleSubscribe = async (planId: string) => {
        if (planId === 'organisation') {
            window.open('mailto:contact@filao.io?subject=Plan Organisation — Demande de devis', '_blank');
            return;
        }

        if (planId === currentPlan || planId === 'partenaire') return;

        const priceId = STRIPE_PRICES[planId];
        if (!priceId) return;

        try {
            setLoadingPlan(planId);
            setErrorMessage(null);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const response = await supabase.functions.invoke('create-checkout-session', {
                body: {
                    priceId,
                    entrepriseId: userProfile?.entreprise_id,
                },
            });

            if (response.data?.url) {
                window.open(response.data.url, '_blank');
            } else {
                console.error('Checkout error:', response.error || response.data?.error);
                setErrorMessage("Impossible d'initialiser le paiement. Veuillez contacter le support. (Erreur configuration)");
            }
        } catch (err) {
            console.error('Checkout error:', err);
            setErrorMessage("Erreur de connexion. Veuillez réessayer.");
        } finally {
            setLoadingPlan(null);
        }
    };

    return (
        <div className="h-full overflow-y-auto custom-scrollbar">
            <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-3xl md:text-4xl font-bold text-[#0B1F38] mb-3">
                        Choisissez le forfait adapté à votre activité
                    </h1>
                    <p className="text-[#0B1F38]/60 text-base md:text-lg max-w-2xl mx-auto">
                        Des offres transparentes, sans engagement. Passez à l'échelle quand vous êtes prêt.
                    </p>
                    {errorMessage && (
                        <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg inline-block text-sm font-medium">
                            {errorMessage}
                        </div>
                    )}
                </div>

                {/* Plans Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    {/* Comparatif alimenté par `plan_limits` : tarifs, quotas,
                        argumentaire et mise en avant y vivent désormais. Le
                        descriptif de `partenaire` annonçait « 1 AO offert » alors
                        que la table n'en autorise aucun — vendre autre chose que
                        ce qu'on applique. */}
                    {tousLesForfaits().map((offre) => {
                        const plan = {
                            id: offre.code,
                            name: offre.nomCommercial,
                            price: offre.prixMensuelHt ? Math.round(offre.prixMensuelHt / 100) : 0,
                            popular: offre.populaire,
                            cta: offre.libelleAction,
                            features: offre.descriptif,
                        };
                        const isCurrentPlan = plan.id === currentPlan;
                        const isPopular = plan.popular;
                        // L'ordre de la table remplace le `level` codé en dur :
                        // il définit aussi ce qui compte comme montée de gamme.
                        const isUpgrade = offre.ordre > forfait(currentPlan).ordre;
                        const isLoading = loadingPlan === plan.id;

                        return (
                            <div
                                key={plan.id}
                                className={`relative rounded-2xl border-2 p-6 flex flex-col transition-all ${isPopular
                                    ? 'border-[#00A3E0] bg-gradient-to-b from-[#00A3E0]/5 to-white shadow-lg shadow-[#00A3E0]/10 scale-[1.02]'
                                    : isCurrentPlan
                                        ? 'border-green-400 bg-green-50/50'
                                        : 'border-[#0B1F38]/10 bg-white hover:border-[#0B1F38]/20 hover:shadow-md'
                                    }`}
                            >
                                {/* Popular Badge */}
                                {isPopular && (
                                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                                        <span className="inline-flex items-center gap-1.5 px-4 py-1 bg-[#00A3E0] text-white text-xs font-bold rounded-full shadow-md">
                                            <Crown size={12} />
                                            Populaire
                                        </span>
                                    </div>
                                )}

                                {/* Current Plan Badge */}
                                {isCurrentPlan && (
                                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                                        <span className="inline-flex items-center gap-1.5 px-4 py-1 bg-green-500 text-white text-xs font-bold rounded-full shadow-md">
                                            <Check size={12} />
                                            Plan actuel
                                        </span>
                                    </div>
                                )}

                                {/* Plan Name */}
                                <h3 className="text-lg font-bold text-[#0B1F38] mt-2">{plan.name}</h3>

                                {/* Price */}
                                <div className="mt-3 mb-5">
                                    {plan.price > 0 ? (
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-4xl font-extrabold text-[#0B1F38]">{plan.price}€</span>
                                            <span className="text-[#0B1F38]/50 text-sm font-medium">/mois HT</span>
                                        </div>
                                    ) : offre.surDevis ? (
                                        <div className="flex items-baseline">
                                            <span className="text-2xl font-extrabold text-[#0B1F38]">Sur devis</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-baseline">
                                            <span className="text-4xl font-extrabold text-[#0B1F38]">Gratuit</span>
                                        </div>
                                    )}
                                </div>

                                {/* Features */}
                                <ul className="space-y-2.5 flex-1 mb-6">
                                    {plan.features.map((feature, idx) => (
                                        <li key={idx} className="flex items-start gap-2.5 text-sm text-[#0B1F38]/70">
                                            <Check size={16} className="text-[#00A3E0] mt-0.5 shrink-0" />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>

                                {/* CTA Button */}
                                <button
                                    onClick={() => handleSubscribe(plan.id)}
                                    disabled={isCurrentPlan || isLoading}
                                    className={`w-full py-3 px-4 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${isCurrentPlan
                                        ? 'bg-green-100 text-green-700 cursor-default'
                                        : offre.surDevis
                                            ? 'bg-[#0B1F38] text-white hover:bg-[#0B1F38]/90'
                                            : isPopular
                                                ? 'bg-[#00A3E0] text-white hover:bg-[#008CC1] shadow-md shadow-[#00A3E0]/20'
                                                : isUpgrade
                                                    ? 'bg-[#0B1F38] text-white hover:bg-[#0B1F38]/90'
                                                    : 'bg-[#0B1F38]/5 text-[#0B1F38] hover:bg-[#0B1F38]/10'
                                        }`}
                                >
                                    {isLoading ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : isCurrentPlan ? (
                                        <>
                                            <Check size={16} />
                                            Plan actuel
                                        </>
                                    ) : offre.surDevis ? (
                                        <>
                                            <Mail size={16} />
                                            {plan.cta}
                                        </>
                                    ) : (
                                        <>
                                            {plan.cta}
                                            <ArrowRight size={16} />
                                        </>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* FAQ / Note */}
                <div className="mt-12 text-center">
                    <p className="text-sm text-[#0B1F38]/50">
                        Tous les prix sont indiqués hors taxes. Vous pouvez changer de forfait ou annuler à tout moment.
                    </p>
                    <p className="text-sm text-[#0B1F38]/50 mt-1">
                        Paiement sécurisé via Stripe. Facturation mensuelle.
                    </p>
                </div>
            </div>
        </div>
    );
};