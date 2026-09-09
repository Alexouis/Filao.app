import React from 'react';
import { Trophy, Frown } from 'lucide-react';
import { useModale } from '../helpers/useModale';
import { FondModale } from './ui/FondModale';

/**
 * Confirmation de l'issue d'un marché — gagné ou perdu.
 *
 * POURQUOI UNE CONFIRMATION DÉDIÉE
 * Saisir le résultat fait passer le dossier dans un statut terminal : il se
 * verrouille, libère son emplacement de quota et déclenche une notification à
 * tout le groupement. Une case cochée par erreur ne se rattrape pas d'un clic.
 *
 * Pourquoi pas `ConfirmDialog` : perdre un marché n'est pas une action
 * destructrice, et gagner n'est pas neutre. Les deux issues méritent leur
 * traitement visuel — c'est le seul moment où l'application félicite quelqu'un.
 *
 * Composant de présentation : l'écriture en base, les notifications et la
 * mesure d'audience restent dans `TenderWizard`.
 */
export interface OutcomeConfirmModalProps {
    /** `null` ferme la modale. */
    issue: 'won' | 'lost' | null;
    onConfirmer: (issue: 'won' | 'lost') => void;
    onAnnuler: () => void;
}

export const OutcomeConfirmModal: React.FC<OutcomeConfirmModalProps> = ({
    issue, onConfirmer, onAnnuler,
}) => {
    const refModale = useModale(!!issue, onAnnuler);
    if (!issue) return null;
    const gagne = issue === 'won';

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <FondModale onFermer={onAnnuler} className="bg-[#0B1F38]/60 backdrop-blur-sm" />
            <div
                ref={refModale as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby="titre-issue-marche"
                className="relative bg-white rounded-[2rem] p-10 max-w-md w-full text-center shadow-2xl animate-in zoom-in-95 duration-200"
            >
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${gagne ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                    {gagne ? <Trophy size={40} aria-hidden="true" /> : <Frown size={40} aria-hidden="true" />}
                </div>
                <h2 id="titre-issue-marche" className="text-2xl font-bold text-[#0B1F38] mb-4">
                    {gagne ? 'Félicitations !' : 'Résultat du marché'}
                </h2>
                <p className="text-[#0B1F38]/60 mb-8 font-medium">
                    {gagne
                        ? 'Confirmez-vous que vous avez remporté ce marché ?'
                        : 'Confirmez-vous que ce marché est perdu ?'}
                </p>
                <div className="flex gap-4">
                    <button
                        onClick={onAnnuler}
                        className="flex-1 py-3 px-4 border border-[#0B1F38]/10 rounded-xl font-bold text-[#0B1F38] hover:bg-gray-50 transition-all"
                    >
                        Annuler
                    </button>
                    <button
                        onClick={() => onConfirmer(issue)}
                        className={`flex-1 py-3 px-4 rounded-xl font-bold text-white transition-all shadow-lg ${gagne ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
                    >
                        Confirmer
                    </button>
                </div>
            </div>
        </div>
    );
};
