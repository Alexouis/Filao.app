import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useToast } from './ui/Toast';
import { Lock, Unlock, AlertTriangle, Loader2 } from 'lucide-react';
import { forfait } from '../helpers/planLimits';
import type { Tender } from '../types';

/**
 * Bandeau des dossiers au-delà du quota.
 *
 * Après une résiliation, un échec de paiement ou une rétrogradation, l'usage
 * peut dépasser l'offre. La règle retenue : **aucune donnée n'est supprimée ni
 * masquée**, les dossiers excédentaires passent en lecture seule, et
 * l'utilisateur choisit lesquels il rouvre.
 *
 * Ce choix lui appartient parce que nous ne pouvons pas le faire à sa place :
 * le dossier le plus récemment modifié n'est pas nécessairement le plus urgent.
 * Le verrouillage automatique retient les plus récents faute de mieux, et ce
 * bandeau permet de corriger.
 */

interface Props {
    userProfile: any;
    tenders: Tender[];
    /** Rechargement après bascule d'un verrou. */
    onChange: () => void;
}

export const BandeauQuotaDepasse: React.FC<Props> = ({ userProfile, tenders, onChange }) => {
    const { showToast } = useToast();
    const [enCours, setEnCours] = useState<string | null>(null);

    const verrouilles = tenders.filter((t: any) => t.verrouille_par_quota);
    if (verrouilles.length === 0) return null;

    const offre = forfait(userProfile?.plan);

    const basculer = async (tenderId: string, rouvrir: boolean) => {
        setEnCours(tenderId);
        try {
            const { data, error } = await supabase.rpc('basculer_verrou_quota', {
                p_tender_id: tenderId,
                p_rouvrir: rouvrir,
            });
            if (error) throw error;

            const resultat = data?.[0];
            if (resultat && resultat.ok === false) {
                // Le motif vient du serveur et nomme la contrainte : « votre
                // offre permet 3 dossiers ouverts, refermez-en un ».
                showToast(resultat.motif || "Réouverture impossible.", 'warning');
                return;
            }
            onChange();
        } catch (err: any) {
            console.error('basculer_verrou_quota:', err);
            showToast(err?.message || "L'opération a échoué.", 'error');
        } finally {
            setEnCours(null);
        }
    };

    return (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                    <p className="font-bold text-amber-900">
                        {verrouilles.length} dossier{verrouilles.length > 1 ? 's' : ''} au-delà de votre offre {offre.libelle}
                    </p>
                    {/* Le message dit explicitement que rien n'est perdu : c'est
                        la première inquiétude devant un dossier bloqué. */}
                    <p className="text-sm text-amber-800 mt-1">
                        Ces dossiers restent consultables et leurs pièces téléchargeables, mais ne peuvent plus être
                        modifiés. Rouvrez-en un en refermant un autre, ou passez à une offre supérieure.
                    </p>

                    <ul className="mt-4 space-y-2">
                        {verrouilles.map((t: any) => (
                            <li key={t.id} className="flex items-center justify-between gap-3 bg-white/70 rounded-xl px-3 py-2">
                                <span className="text-sm font-medium text-amber-900 truncate" title={t.titre}>
                                    {t.titre}
                                </span>
                                <button
                                    onClick={() => basculer(t.id, true)}
                                    disabled={enCours === t.id}
                                    className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-200 hover:bg-amber-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {enCours === t.id
                                        ? <><Loader2 size={13} className="animate-spin" /> …</>
                                        : <><Unlock size={13} /> Rouvrir</>}
                                </button>
                            </li>
                        ))}
                    </ul>

                    {/* Refermer volontairement un dossier ouvert pour en libérer un
                        autre : sans cette action, la seule issue serait de payer. */}
                    {tenders.some((t: any) => !t.verrouille_par_quota && t.statut === 'En cours') && (
                        <details className="mt-4">
                            <summary className="text-xs font-bold text-amber-800 cursor-pointer">
                                Refermer un dossier pour libérer une place
                            </summary>
                            <ul className="mt-2 space-y-1.5">
                                {tenders
                                    .filter((t: any) => !t.verrouille_par_quota && t.statut === 'En cours')
                                    .map((t: any) => (
                                        <li key={t.id} className="flex items-center justify-between gap-3 text-xs">
                                            <span className="truncate text-amber-900" title={t.titre}>{t.titre}</span>
                                            <button
                                                onClick={() => basculer(t.id, false)}
                                                disabled={enCours === t.id}
                                                className="shrink-0 flex items-center gap-1 font-bold text-amber-700 hover:text-amber-900 disabled:opacity-50"
                                            >
                                                <Lock size={12} /> Refermer
                                            </button>
                                        </li>
                                    ))}
                            </ul>
                        </details>
                    )}
                </div>
            </div>
        </div>
    );
};