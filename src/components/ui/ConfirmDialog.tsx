import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Boîte de confirmation de l'application.
 *
 * POURQUOI CE COMPOSANT
 * Plusieurs actions destructrices passaient par le `confirm()` du navigateur.
 * Outre l'aspect (« localhost:3000 indique… », impossible à styler), il est
 * BLOQUANT : il fige le fil d'exécution et ne permet ni de nommer précisément
 * l'objet supprimé, ni d'afficher un état de chargement.
 *
 * Ce composant reprend la présentation déjà employée pour le retrait d'un
 * membre, afin que l'app parle d'une seule voix.
 *
 * USAGE
 * Comme une modale React, l'appel est asynchrone : on stocke l'élément en
 * attente dans un état, et l'action s'exécute dans `onConfirmer`.
 *
 *   const [aSupprimer, setASupprimer] = useState<Doc | null>(null);
 *   ...
 *   <ConfirmDialog
 *       ouvert={!!aSupprimer}
 *       titre="Supprimer ce document ?"
 *       message={`« ${aSupprimer?.name} » sera définitivement retiré.`}
 *       onConfirmer={() => { supprimer(aSupprimer!); setASupprimer(null); }}
 *       onAnnuler={() => setASupprimer(null)}
 *   />
 */
export interface ConfirmDialogProps {
    ouvert: boolean;
    titre: string;
    message: React.ReactNode;
    /** Libellé du bouton d'action. « Supprimer » par défaut. */
    libelleConfirmer?: string;
    libelleAnnuler?: string;
    /**
     * Action destructrice (rouge) par défaut. Passer `false` pour une
     * confirmation neutre, où le rouge serait un contresens.
     */
    destructif?: boolean;
    onConfirmer: () => void;
    onAnnuler: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    ouvert, titre, message,
    libelleConfirmer = 'Supprimer',
    libelleAnnuler = 'Annuler',
    destructif = true,
    onConfirmer, onAnnuler,
}) => {
    if (!ouvert) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[#0B1F38]/40 backdrop-blur-sm" onClick={onAnnuler}></div>
            <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-6 text-center">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${destructif ? 'bg-red-50 text-red-500' : 'bg-[#00A3E0]/10 text-[#00A3E0]'}`}>
                        <AlertCircle size={24} />
                    </div>
                    <h3 className="text-lg font-bold text-[#0B1F38] mb-2">{titre}</h3>
                    <p className="text-sm text-[#0B1F38]/60 leading-relaxed">{message}</p>
                </div>
                <div className="flex border-t border-[#0B1F38]/5">
                    <button
                        onClick={onAnnuler}
                        className="flex-1 py-4 text-sm font-bold text-[#0B1F38]/40 hover:bg-gray-50 transition-colors border-r border-[#0B1F38]/5"
                    >
                        {libelleAnnuler}
                    </button>
                    <button
                        onClick={onConfirmer}
                        className={`flex-1 py-4 text-sm font-bold transition-colors ${destructif ? 'text-red-500 hover:bg-red-50' : 'text-[#00A3E0] hover:bg-[#00A3E0]/5'}`}
                    >
                        {libelleConfirmer}
                    </button>
                </div>
            </div>
        </div>
    );
};
