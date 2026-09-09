import React, { useState, useEffect, memo } from 'react';
import { Info, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { CriteresAttribution } from '../helpers/boampHelpers';
import { useModale } from '../helpers/useModale';

/**
 * Critères d'attribution d'un marché : libellés et pondérations.
 *
 * POURQUOI CE FICHIER
 * Extraite de `TenderWizard`, où elle occupait 132 lignes sous forme de
 * `renderCriteresModal()`.
 *
 * Le brouillon (`criteresDraft`) vivait dans le PARENT alors qu'il ne sert
 * qu'ici : chaque caractère tapé dans un libellé re-rendait donc tout le
 * wizard. Il descend avec la modale, comme pour la modale de contexte.
 *
 * L'ENREGISTREMENT reste au parent : il connaît `tenderId` et la persistance.
 * On lui transmet la valeur construite plutôt que de le laisser relire un état
 * pas encore rafraîchi par React.
 */
export interface CriteresModalProps {
    ouvert: boolean;
    /** Critères déjà enregistrés, servant à amorcer le brouillon. */
    criteresExistants: CriteresAttribution | null | undefined;
    /** Seul le porteur modifie ; les autres consultent. */
    isOwner: boolean;
    isLocked: boolean;
    /** Enregistrement en cours. */
    loading: boolean;
    /** Style d'input partagé avec le wizard, pour rester à l'identique. */
    inputGlassPlain: string;
    onFermer: () => void;
    onValider: (criteres: CriteresAttribution) => void;
}

const CriteresModalBase: React.FC<CriteresModalProps> = ({
    ouvert, criteresExistants, isOwner, isLocked, loading, inputGlassPlain, onFermer, onValider,
}) => {
    const refModale = useModale(ouvert, onFermer);
    const [criteresDraft, setCriteresDraft] = useState<{ libelle: string; poids?: number }[]>([]);

    // Amorçage à chaque ouverture. Depuis la forme `priorites`, on reprend les
    // libellés sans inventer de poids : l'acheteur ne les a pas publiés.
    useEffect(() => {
        if (!ouvert) return;
        const crit = criteresExistants;
        if (crit && (crit.kind === 'ponderes' || crit.kind === 'priorites') && crit.criteres.length > 0) {
            setCriteresDraft(crit.criteres.map((c: any) => ({ libelle: c.libelle, poids: c.poids })));
        } else {
            setCriteresDraft([{ libelle: '', poids: undefined }]);
        }
        // `criteresExistants` hors dépendances : on n'écrase pas une saisie en
        // cours si le parent se met à jour pendant l'édition.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ouvert]);

    const buildCriteres = (lignes: { libelle: string; poids?: number }[]): CriteresAttribution => {
        const nettoyees = lignes
            .map(l => ({ libelle: l.libelle.trim(), poids: l.poids }))
            .filter(l => l.libelle.length > 0);
        const total = nettoyees.reduce((s, l) => s + (l.poids ?? 0), 0);
        return {
            kind: nettoyees.length > 0 ? 'ponderes' : 'absent',
            criteres: nettoyees,
            poidsSontDesPourcentages: Math.abs(total - 100) < 0.5,
            source: 'manuel'
        };
    };

    if (!ouvert) return null;

        const crit = criteresExistants;
        const total = criteresDraft.reduce((s, l) => s + (l.poids ?? 0), 0);
        const editable = isOwner && !isLocked;

        const majLigne = (index: number, patch: Partial<{ libelle: string; poids?: number }>) =>
            setCriteresDraft(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

        return (
            <div className="fixed inset-0 z-[115] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => onFermer()}></div>
                <div
                ref={refModale as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                className="relative bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                    <div className="p-6 border-b border-[#0B1F38]/5 flex justify-between items-center shrink-0">
                        <div>
                            <h3 className="text-lg font-bold text-[#0B1F38]">Critères d'attribution</h3>
                            <p className="text-xs text-[#0B1F38]/50">Tels qu'annoncés dans le règlement de consultation.</p>
                        </div>
                        <button onClick={() => onFermer()} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors">
                            <X size={20} className="text-[#0B1F38]/40" />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1">
                        {crit?.kind === 'libre' && crit.texte && (
                            <div className="mb-5 p-4 rounded-2xl bg-[#0B1F38]/5 border border-[#0B1F38]/10">
                                <p className="text-[11px] font-bold text-[#0B1F38]/50 uppercase tracking-wider mb-1.5">Texte publié par l'acheteur</p>
                                <p className="text-[13px] text-[#0B1F38]/70 leading-relaxed">{crit.texte}</p>
                            </div>
                        )}
                        {crit?.kind === 'cctp' && (
                            <div className="mb-5 p-4 rounded-2xl bg-[#0B1F38]/5 border border-[#0B1F38]/10">
                                <p className="text-[13px] text-[#0B1F38]/70">
                                    L'acheteur renvoie au règlement de consultation. Reportez ici les critères qui y figurent.
                                </p>
                            </div>
                        )}

                        <fieldset disabled={!editable} className="border-0 p-0 m-0">
                            {/* En-têtes : sans eux, deux champs côte à côte dont l'un
                                attend un nombre ne s'expliquent pas d'eux-mêmes. */}
                            <div className="grid grid-cols-[1fr_7rem_2rem] gap-2 items-center px-1 mb-1.5">
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider">Critère</span>
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider">Poids</span>
                                <span className="sr-only">Actions</span>
                            </div>
                            <div className="space-y-2">
                                {criteresDraft.map((ligne, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_7rem_2rem] gap-2 items-center">
                                        <input
                                            type="text"
                                            value={ligne.libelle}
                                            onChange={(e) => majLigne(i, { libelle: e.target.value })}
                                            placeholder="ex. Valeur technique"
                                            aria-label={`Intitulé du critère ${i + 1}`}
                                            className={`${inputGlassPlain} w-full min-w-0`}
                                        />
                                        <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            value={ligne.poids ?? ''}
                                            onChange={(e) => {
                                                const v = parseFloat(e.target.value);
                                                majLigne(i, { poids: Number.isFinite(v) ? v : undefined });
                                            }}
                                            placeholder="ex. 50"
                                            aria-label={`Poids du critère ${i + 1}`}
                                            className={`${inputGlassPlain} w-full min-w-0`}
                                        />
                                        {editable && criteresDraft.length > 1 ? (
                                            <button
                                                onClick={() => setCriteresDraft(prev => prev.filter((_, idx) => idx !== i))}
                                                aria-label={`Supprimer le critère ${i + 1}`}
                                                className="p-2 text-[#0B1F38]/30 hover:text-red-500 transition-colors justify-self-center"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        ) : <span />}
                                    </div>
                                ))}
                            </div>

                            {editable && (
                                <button
                                    onClick={() => setCriteresDraft(prev => [...prev, { libelle: '', poids: undefined }])}
                                    className="mt-3 w-full py-2.5 border border-dashed border-[#0B1F38]/15 rounded-xl text-[#0B1F38]/50 font-bold text-xs hover:border-[#00A3E0] hover:text-[#00A3E0] transition-all flex items-center justify-center gap-1.5"
                                >
                                    <Plus size={14} /> Ajouter un critère
                                </button>
                            )}
                        </fieldset>

                        {/* Le total n'a pas à valoir 100 : les acheteurs publient
                            indifféremment des pourcentages ou des coefficients. On
                            informe sans bloquer la saisie. */}
                        <div className="mt-4 flex items-start gap-2 text-[12px]">
                            <Info size={14} className="text-[#0B1F38]/40 shrink-0 mt-0.5" />
                            <span className="text-[#0B1F38]/60">
                                Total : <strong className="text-[#0B1F38]">{Math.round(total * 10) / 10}</strong>
                                {total === 0
                                    ? " — sans poids, les critères sont enregistrés sans pondération."
                                    : Math.abs(total - 100) < 0.5
                                        ? ' — interprété comme des pourcentages.'
                                        : " — interprété comme des coefficients, converti en % à l'affichage."}
                            </span>
                        </div>
                    </div>

                    {editable && (
                        <div className="p-6 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                            <button
                                onClick={() => onValider(buildCriteres(criteresDraft))}
                                className="px-8 py-3 bg-[#0B1F38] text-white font-bold rounded-xl hover:bg-[#00A3E0] transition-all shadow-lg"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Enregistrer'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
};

export const CriteresModal = memo(CriteresModalBase);
