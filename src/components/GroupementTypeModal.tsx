import React from 'react';
import { Users, Briefcase, CheckCircle } from 'lucide-react';
import { useModale } from '../helpers/useModale';
import { FondModale } from './ui/FondModale';

/**
 * Choix du type de groupement, avant la vérification du dossier.
 *
 * POURQUOI CE CHOIX EST BLOQUANT
 * Conjoint et solidaire n'engagent pas les membres de la même façon : dans un
 * groupement solidaire, chacun répond de la totalité du marché. L'information
 * part au pouvoir adjudicateur avec la candidature et ne se rattrape pas —
 * d'où une modale dédiée plutôt qu'un menu déroulant qu'on remplit sans lire.
 *
 * Composant de présentation : il ne connaît ni Supabase, ni le dossier. La
 * bascule vers la vérification reste dans `TenderWizard`.
 */
export interface GroupementTypeModalProps {
    ouvert: boolean;
    /** Reçoit le type retenu. L'appelant referme la modale. */
    onChoisir: (type: 'conjoint' | 'solidaire') => void;
    onAnnuler: () => void;
}

export const GroupementTypeModal: React.FC<GroupementTypeModalProps> = ({
    ouvert, onChoisir, onAnnuler,
}) => {
    const refModale = useModale(ouvert, onAnnuler);
    if (!ouvert) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <FondModale onFermer={onAnnuler} />
            <div
                ref={refModale as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby="titre-type-groupement"
                className="relative bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300"
            >
                <div className="p-8 text-center pb-4">
                    <div className="w-16 h-16 bg-[#00A3E0]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#00A3E0]">
                        <Users size={32} aria-hidden="true" />
                    </div>
                    <h2 id="titre-type-groupement" className="text-2xl font-bold text-[#0B1F38]">Type de groupement</h2>
                    <p className="text-[#0B1F38]/60 mt-2 max-w-md mx-auto">
                        Cette information est obligatoire pour la constitution du dossier et ne pourra pas être modifiée ultérieurement.
                    </p>
                </div>

                <div className="p-8 pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={() => onChoisir('conjoint')}
                        className="group p-6 rounded-2xl border-2 border-[#0B1F38]/10 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all text-left flex flex-col gap-3 relative overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00A3E0]"
                    >
                        <div className="absolute top-4 right-4 text-[#00A3E0] opacity-0 group-hover:opacity-100 transition-opacity">
                            <CheckCircle size={24} aria-hidden="true" />
                        </div>
                        <div className="bg-white w-10 h-10 rounded-xl shadow-sm flex items-center justify-center text-[#0B1F38]">
                            <Briefcase size={20} aria-hidden="true" />
                        </div>
                        <div>
                            <h3 className="font-bold text-[#0B1F38] text-lg">Groupement Conjoint</h3>
                            <p className="text-xs text-[#0B1F38]/60 mt-1 leading-relaxed">
                                Chaque membre du groupement s'engage à exécuter uniquement les prestations qui lui sont attribuées.
                            </p>
                        </div>
                    </button>

                    <button
                        onClick={() => onChoisir('solidaire')}
                        className="group p-6 rounded-2xl border-2 border-[#0B1F38]/10 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all text-left flex flex-col gap-3 relative overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00A3E0]"
                    >
                        <div className="absolute top-4 right-4 text-[#00A3E0] opacity-0 group-hover:opacity-100 transition-opacity">
                            <CheckCircle size={24} aria-hidden="true" />
                        </div>
                        <div className="bg-white w-10 h-10 rounded-xl shadow-sm flex items-center justify-center text-[#0B1F38]">
                            <Users size={20} aria-hidden="true" />
                        </div>
                        <div>
                            <h3 className="font-bold text-[#0B1F38] text-lg">Groupement Solidaire</h3>
                            <p className="text-xs text-[#0B1F38]/60 mt-1 leading-relaxed">
                                Chaque membre est engagé financièrement et techniquement pour la totalité du marché.
                            </p>
                        </div>
                    </button>
                </div>

                <div className="p-6 bg-[#F8FAFC] flex justify-center border-t border-[#0B1F38]/5">
                    <button onClick={onAnnuler} className="text-[#0B1F38]/50 text-sm font-bold hover:text-[#0B1F38] transition-colors">
                        Annuler
                    </button>
                </div>
            </div>
        </div>
    );
};
