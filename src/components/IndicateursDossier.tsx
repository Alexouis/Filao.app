import React, { memo } from 'react';
import { Calendar as CalendarIcon, CheckCircle, PenTool } from 'lucide-react';
import { normaliserPoids } from '../helpers/boampHelpers';

/** Abrège un montant pour l'affichage compact d'une carte. */
const formatBudget = (val: number) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M€`;
    if (val >= 1000) return `${Math.round(val / 1000)}k€`;
    return `${val}€`;
};

/**
 * Bandeau des quatre indicateurs stratégiques d'un dossier : potentiel de
 * succès, budget, critères d'attribution, prochain jalon.
 *
 * POURQUOI CE FICHIER
 * Deuxième étape du découpage de `renderDecisionView`. Les règles de calcul
 * sont déjà sorties dans `decisionHelpers` et testées ; ce composant ne fait
 * plus que présenter des valeurs prêtes, ce qui le rend extractible sans
 * risque.
 *
 * Il ne calcule RIEN : c'est délibéré. Un indicateur recalculé localement
 * finit toujours par diverger de son équivalent ailleurs — le score de succès
 * et la progression en ont fait la démonstration cette semaine.
 */
export interface IndicateursDossierProps {
    /** Score du dossier, ou `null` si les compétences n'ont pas pu être lues. */
    successScore: number | null;
    /** Gain qu'apporterait une compétence supplémentaire couverte. */
    potentialGain: number;
    /** Compétences requises que personne ne couvre. */
    missingSpecialties: { id: string; label: string }[];
    montantEstime?: number | null;
    /** Critères d'attribution tels qu'enregistrés. */
    criteresAttribution: any;
    /** Prochain jalon à tenir, `null` si le rétroplanning est vide. */
    nextMilestone: { label: string; date: string; status?: string } | null | undefined;
    isOwner: boolean;
    isLocked: boolean;
    /** Géométrie de la jauge, calculée par la vue. */
    gaugeRadius: number;
    gaugeCircumference: number;
    gaugeOffset: number;
    gaugeColor: string;
    /**
     * Position du carrousel des compétences manquantes. Partagé avec la zone
     * « Équipe & pièces », qui fait défiler la même liste : un état local ici
     * désynchroniserait les deux affichages.
     */
    carouselIndex: number;
    onOuvrirCriteres: () => void;
    onOuvrirRetroplanning: () => void;
}

const IndicateursDossierBase: React.FC<IndicateursDossierProps> = ({
    successScore, potentialGain, missingSpecialties, montantEstime,
    criteresAttribution, nextMilestone, isOwner, isLocked,
    gaugeRadius, gaugeCircumference, gaugeOffset, gaugeColor, carouselIndex,
    onOuvrirCriteres, onOuvrirRetroplanning,
}) => {
    const renderCriteresCard = () => {
            const crit = criteresAttribution;
            const editable = isOwner && !isLocked;

            const Wrapper = ({ children }: { children: React.ReactNode }) => (
                <div
                    className={`bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all ${editable ? 'cursor-pointer' : ''}`}
                    onClick={editable ? onOuvrirCriteres : undefined}
                >
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider">Critères d'attribution</p>
                        {editable && <PenTool size={10} className="text-[#0B1F38]/25" />}
                    </div>
                    {children}
                </div>
            );

            // Aucune donnée, ou renvoi au règlement de consultation.
            if (!crit || crit.kind === 'absent' || crit.kind === 'cctp') {
                return (
                    <Wrapper>
                        <p className="text-[11px] text-[#0B1F38]/50 leading-snug">
                            {crit?.kind === 'cctp'
                                ? "L'acheteur renvoie au règlement de consultation."
                                : 'Non communiqués dans l\'avis.'}
                        </p>
                        {editable && (
                            <p className="text-[9px] text-[#00A3E0] font-bold mt-1.5">Saisir les critères →</p>
                        )}
                    </Wrapper>
                );
            }

            // Texte libre : on affiche tel quel, tronqué.
            if (crit.kind === 'libre') {
                return (
                    <Wrapper>
                        <p className="text-[11px] text-[#0B1F38]/70 leading-snug line-clamp-4">{crit.texte}</p>
                    </Wrapper>
                );
            }

            // Critères classés sans pondération.
            if (crit.kind === 'priorites') {
                return (
                    <Wrapper>
                        <div className="space-y-1">
                            {crit.criteres.map((c, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                    <span className="text-[10px] font-bold text-[#00A3E0] shrink-0 mt-px">{c.ordre}.</span>
                                    <span className="text-[11px] text-[#0B1F38] leading-snug line-clamp-2">{c.libelle}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-[#0B1F38]/40 mt-1.5 italic">Classés par ordre d'importance, sans pondération publiée.</p>
                    </Wrapper>
                );
            }

            // Critères pondérés. ⚠️ Les poids ne somment pas toujours à 100 :
            // on normalise pour la barre, et on signale la conversion.
            const parts = normaliserPoids(crit.criteres);
            const palette = ['#00A3E0', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#0B1F38'];

            return (
                <Wrapper>
                    <div className="space-y-1.5">
                        {parts.map((p, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                                    <span className="text-[11px] font-medium text-[#0B1F38] truncate" title={p.libelle}>{p.libelle}</span>
                                </div>
                                <span className="text-xs font-bold text-[#0B1F38] shrink-0">{p.pourcentage}%</span>
                            </div>
                        ))}
                    </div>
                    {parts.length > 0 && (
                        <div className="flex rounded-full h-2 overflow-hidden mt-2">
                            {parts.map((p, i) => (
                                <div key={i} className="h-full" style={{ width: `${p.pourcentage}%`, background: palette[i % palette.length] }} />
                            ))}
                        </div>
                    )}
                    {!crit.poidsSontDesPourcentages && (
                        <p className="text-[9px] text-[#0B1F38]/40 mt-1.5 italic">
                            Coefficients publiés par l'acheteur, convertis en pourcentages.
                        </p>
                    )}
                </Wrapper>
            );
        };

    return (
                        <div className="px-5 pb-3">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                {/* Carte 1 — Potentiel de succès */}
                                <div className="bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all">
                                    <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider mb-2">Potentiel de succès</p>
                                    <div className="flex items-center gap-3">
                                        <div className="relative shrink-0">
                                            <svg width="90" height="90" viewBox="0 0 100 100" className="transform -rotate-90">
                                                <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke="#0B1F38" strokeOpacity="0.06" strokeWidth="8" />
                                                <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke={gaugeColor} strokeWidth="8" strokeLinecap="round"
                                                    strokeDasharray={gaugeCircumference} strokeDashoffset={gaugeOffset}
                                                    className="transition-all duration-1000" />
                                            </svg>
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <span className="text-xl font-extrabold text-[#0B1F38]" title={successScore === null ? "Les compétences requises n'ont pas pu être lues : score indisponible." : undefined}>{successScore === null ? '—' : `${successScore}%`}</span>
                                            </div>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-[#0B1F38]/50 leading-snug">Couverture des compétences requises par l'équipe</p>
                                            {missingSpecialties.length > 0 && (
                                                <p className="text-[10px] font-bold text-[#00A3E0] mt-1 leading-snug">+{potentialGain}% via partenaire {missingSpecialties[carouselIndex % missingSpecialties.length].label}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Carte 2 — Budget et offre */}
                                <div className="bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all">
                                    <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider mb-2">Budget et offre</p>
                                    <p className="text-2xl font-extrabold text-[#0B1F38] leading-tight">
                                        {montantEstime > 0 ? formatBudget(montantEstime) : '—'}
                                    </p>
                                    <p className="text-[10px] text-[#0B1F38]/40 font-medium">Budget estimé (acheteur)</p>
                                    <div className="mt-2 pt-2 border-t border-[#0B1F38]/5">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] text-[#0B1F38]/50">Offre groupement</span>
                                            <span className="text-xs font-bold text-[#0B1F38]/30">— €</span>
                                        </div>
                                        <p className="text-[9px] text-[#0B1F38]/30 mt-1 italic">Se calcule via le DPGF</p>
                                    </div>
                                </div>

                                {/* Carte 3 — Critères d'attribution */}
                                {renderCriteresCard()}

                                {/* Carte 4 — Prochain jalon */}
                                <div className="bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all cursor-pointer" onClick={() => onOuvrirRetroplanning()}>
                                    <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider mb-2">Prochain jalon</p>
                                    {nextMilestone ? (
                                        <div className="flex flex-col items-center text-center gap-1">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${nextMilestone.status === 'done' ? 'bg-green-100 text-green-600' :
                                                nextMilestone.status === 'danger' ? 'bg-red-100 text-red-500' :
                                                    nextMilestone.status === 'warning' ? 'bg-amber-100 text-amber-600' :
                                                        'bg-[#00A3E0]/10 text-[#00A3E0]'
                                                }`}>
                                                {nextMilestone.status === 'done' ? <CheckCircle size={20} /> : <CalendarIcon size={20} />}
                                            </div>
                                            <p className="text-sm font-bold text-[#0B1F38] leading-tight">{nextMilestone.label}</p>
                                            <p className="text-xs font-medium text-[#0B1F38]/60">{new Date(nextMilestone.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                            {nextMilestone.status === 'danger' && <p className="text-[10px] font-bold text-red-500">Urgent</p>}
                                            {nextMilestone.status === 'warning' && <p className="text-[10px] font-bold text-amber-500">Bientôt</p>}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-[#0B1F38]/40 italic">Aucun jalon défini</p>
                                    )}
                                </div>
                            </div>
                        </div>
    );
};

export const IndicateursDossier = memo(IndicateursDossierBase);
