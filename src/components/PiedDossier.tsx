import React from 'react';
import { Trash2, Target, XCircle, CheckCircle, Trophy, Frown, Loader2 } from 'lucide-react';

/**
 * Barre d'actions au pied de la vue décision.
 *
 * CE QU'ELLE ENCODE
 * Trois situations produisent trois barres différentes, et les confondre a des
 * conséquences réelles :
 *
 *   - dossier PAS ENCORE CRÉÉ : on confirme ou on abandonne la réponse ;
 *   - dossier créé et l'on en est PORTEUR : on finalise, puis on saisit
 *     l'issue une fois la réponse déposée ;
 *   - dossier créé et l'on est PARTENAIRE : aucune action de cycle de vie, et
 *     surtout une phrase qui dit pourquoi. Masquer les boutons sans explication
 *     laissait croire à une interface incomplète.
 *
 * La finalisation exige un mandataire désigné : un groupement sans mandataire
 * n'a pas d'interlocuteur responsable vis-à-vis de l'acheteur. Le contrôle est
 * fait ici pour pouvoir refuser AVANT d'ouvrir la confirmation, plutôt que de
 * laisser l'utilisateur confirmer une action qui échouera.
 */
export interface PiedDossierProps {
    /** Absent tant que le dossier n'a pas été créé en base. */
    tenderId?: string | null;
    isOwner: boolean;
    /** Statut brut du dossier, tel qu'il est stocké. */
    statut: string;
    /** Valeurs de `STATUSES`, injectées pour ne pas dupliquer la configuration. */
    statutEnCours: string;
    statutDepose: string;
    /** Au moins un membre actif porte le rôle Mandataire. */
    aUnMandataire: boolean;
    enCours?: boolean;
    onSupprimer: () => void;
    onAbandonner: () => void;
    onConfirmerReponse: () => void;
    onFinaliser: () => void;
    /** Appelé quand la finalisation est demandée sans mandataire désigné. */
    onMandataireManquant: () => void;
    onSaisirIssue: (issue: 'won' | 'lost') => void;
}

export const PiedDossier: React.FC<PiedDossierProps> = ({
    tenderId, isOwner, statut, statutEnCours, statutDepose, aUnMandataire,
    enCours = false, onSupprimer, onAbandonner, onConfirmerReponse,
    onFinaliser, onMandataireManquant, onSaisirIssue,
}) => (
    <div className="px-5 py-3 border-t border-white/30 flex justify-between items-center shrink-0 bg-white/40 backdrop-blur-sm">
        <div className="flex items-center gap-4">
            {tenderId && isOwner && (
                <button
                    onClick={onSupprimer}
                    className="px-4 py-2.5 flex items-center gap-2 bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-all border border-red-100 text-xs font-bold"
                    title="Supprimer le dossier"
                >
                    <Trash2 size={14} aria-hidden="true" /> Supprimer
                </button>
            )}
            {!tenderId && (
                <div className="flex items-center gap-4">
                    <div className="bg-[#0B1F38]/5 p-2 rounded-xl">
                        <Target size={20} className="text-[#0B1F38]" aria-hidden="true" />
                    </div>
                    <div>
                        <h3 className="font-bold text-[#0B1F38] text-base">Décision finale</h3>
                        <p className="text-xs text-[#0B1F38]/60">Validez pour créer l'espace collaboratif</p>
                    </div>
                </div>
            )}
        </div>

        {!tenderId ? (
            <div className="flex gap-3">
                <button
                    onClick={onAbandonner}
                    className="px-5 py-2.5 bg-white border-2 border-red-100 hover:border-red-200 text-red-500 font-bold text-sm rounded-xl shadow-sm transition-all flex items-center gap-2"
                >
                    <XCircle size={18} aria-hidden="true" /> Abandonner le dossier
                </button>
                <button
                    onClick={onConfirmerReponse}
                    className="px-6 py-2.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center gap-2"
                >
                    {enCours
                        ? <Loader2 className="animate-spin" aria-hidden="true" />
                        : <><CheckCircle size={18} aria-hidden="true" /> Confirmer la réponse</>}
                </button>
            </div>
        ) : isOwner ? (
            <div className="flex gap-3">
                {statut === statutDepose ? (
                    <>
                        <button
                            onClick={() => onSaisirIssue('won')}
                            className="px-6 py-2.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-bold text-sm rounded-xl transition-all shadow-sm flex items-center gap-2"
                        >
                            <Trophy size={18} aria-hidden="true" /> GAGNÉ
                        </button>
                        <button
                            onClick={() => onSaisirIssue('lost')}
                            className="px-6 py-2.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-bold text-sm rounded-xl transition-all shadow-sm flex items-center gap-2"
                        >
                            <Frown size={18} aria-hidden="true" /> PERDU
                        </button>
                    </>
                ) : statut === statutEnCours ? (
                    <button
                        onClick={() => (aUnMandataire ? onFinaliser() : onMandataireManquant())}
                        className="flex items-center gap-2 px-6 py-3 bg-[#0B1F38] text-white font-bold text-sm rounded-xl shadow-lg hover:bg-[#00A3E0] transition-all"
                    >
                        {enCours
                            ? <Loader2 className="animate-spin" aria-hidden="true" />
                            : <><CheckCircle size={16} aria-hidden="true" /> Finaliser le dossier</>}
                    </button>
                ) : null}
            </div>
        ) : (
            <p className="text-xs text-[#0B1F38]/50 italic px-2">
                Seul le propriétaire du marché peut effectuer les actions de finalisation.
            </p>
        )}
    </div>
);
