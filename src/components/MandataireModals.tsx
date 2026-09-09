import React from 'react';
import { Crown } from 'lucide-react';
import type { UIGroupementMember } from '../types';

/**
 * Les deux modales qui changent le mandataire d'un groupement.
 *
 * POURQUOI ELLES VONT ENSEMBLE
 * Un groupement a toujours exactement un mandataire. Les deux seules façons
 * d'en changer sont réunies ici parce qu'elles obéissent à la même règle et
 * échoueraient de la même manière si on l'oubliait :
 *
 *   - promotion : le mandataire actuel désigne son remplaçant, et doit dire
 *     quel rôle il prend lui-même — sans quoi le groupement se retrouve avec
 *     deux mandataires ;
 *   - succession : le mandataire veut quitter son rôle, et ne le peut pas tant
 *     que personne n'a repris la fonction.
 *
 * Ces composants sont purement présentationnels. Le recalcul de la liste des
 * membres et son enregistrement restent dans `TenderWizard` : eux seuls savent
 * qu'il faut construire le tableau à jour AVANT d'appeler la sauvegarde, l'état
 * React n'étant pas rafraîchi dans le même tour.
 */

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------
export interface MandatairePromotionModalProps {
    /** Membre à promouvoir. `null` ferme la modale. */
    cible: UIGroupementMember | null;
    /** Mandataire en place, qui va être rétrogradé. */
    mandataireActuel?: UIGroupementMember | null;
    /** Reçoit le rôle que prend le mandataire sortant. */
    onPromouvoir: (roleSortant: 'Co-traitant' | 'Sous-traitant') => void;
    onAnnuler: () => void;
}

/** Nom d'affichage : l'e-mail sert de repli tant que l'invité n'a pas de compte. */
const nomAffiche = (m: UIGroupementMember | null | undefined): string =>
    m?.name || m?.email || '';

export const MandatairePromotionModal: React.FC<MandatairePromotionModalProps> = ({
    cible, mandataireActuel, onPromouvoir, onAnnuler,
}) => {
    if (!cible) return null;

    // Le sortant n'est mentionné que s'il existe ET qu'il n'est pas la cible :
    // se voir demander son propre nouveau rôle n'aurait pas de sens.
    const sortant = mandataireActuel && mandataireActuel !== cible ? mandataireActuel : null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={onAnnuler}></div>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="titre-promotion-mandataire"
                className="relative bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl flex flex-col p-8 animate-in zoom-in-95 duration-200 text-center"
            >
                <div className="w-16 h-16 bg-[#00A3E0]/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-[#00A3E0]">
                    <Crown size={32} aria-hidden="true" />
                </div>
                <h3 id="titre-promotion-mandataire" className="text-2xl font-black text-[#0B1F38] tracking-tight">
                    Promouvoir un Mandataire
                </h3>
                <p className="text-sm text-[#0B1F38]/50 mt-2 mb-8">
                    Vous avez choisi de nommer <strong>{nomAffiche(cible)}</strong> comme nouveau Mandataire.
                    {sortant && (
                        <> Quel doit être le nouveau rôle de <strong>{nomAffiche(sortant)}</strong> ? </>
                    )}
                </p>

                <div className="grid grid-cols-2 gap-4">
                    <button
                        onClick={() => onPromouvoir('Co-traitant')}
                        className="p-6 rounded-2xl border-2 border-gray-100 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00A3E0]"
                    >
                        <div className="font-black text-[#0B1F38] group-hover:text-[#00A3E0] transition-colors">Co-traitant</div>
                        <div className="text-[10px] text-[#0B1F38]/40 uppercase mt-1">Soutien solidaire</div>
                    </button>
                    <button
                        onClick={() => onPromouvoir('Sous-traitant')}
                        className="p-6 rounded-2xl border-2 border-gray-100 hover:border-[#003B71] hover:bg-[#003B71]/5 transition-all group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#003B71]"
                    >
                        <div className="font-black text-[#0B1F38] group-hover:text-[#003B71] transition-colors">Sous-traitant</div>
                        <div className="text-[10px] text-[#0B1F38]/40 uppercase mt-1">Exécution technique</div>
                    </button>
                </div>

                <button
                    onClick={onAnnuler}
                    className="mt-6 text-[#0B1F38]/30 hover:text-[#0B1F38] text-sm font-bold transition-colors"
                >
                    Annuler
                </button>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Succession
// ---------------------------------------------------------------------------
export interface MandataireSuccessionModalProps {
    ouvert: boolean;
    /**
     * Successeurs éligibles. Restreint aux membres ayant ACCEPTÉ l'invitation :
     * confier le mandat à quelqu'un qui n'a pas encore répondu laisserait le
     * groupement sans interlocuteur responsable.
     */
    successeurs: UIGroupementMember[];
    onChoisir: (successeur: UIGroupementMember) => void;
    onAnnuler: () => void;
}

export const MandataireSuccessionModal: React.FC<MandataireSuccessionModalProps> = ({
    ouvert, successeurs, onChoisir, onAnnuler,
}) => {
    if (!ouvert) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={onAnnuler}></div>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="titre-succession-mandataire"
                className="relative bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl flex flex-col p-8 animate-in zoom-in-95 duration-200"
            >
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-yellow-600">
                        <Crown size={32} aria-hidden="true" />
                    </div>
                    <h3 id="titre-succession-mandataire" className="text-2xl font-black text-[#0B1F38] tracking-tight">
                        Désigner un successeur
                    </h3>
                    <p className="text-sm text-[#0B1F38]/50 mt-2">
                        Le rôle de Mandataire est obligatoire. Veuillez choisir un collaborateur parmi ceux ayant déjà accepté l'invitation pour prendre le relais.
                    </p>
                </div>

                {successeurs.length === 0 ? (
                    // Sans cette branche, la modale s'ouvrait vide : l'utilisateur
                    // voyait une liste blanche sans comprendre qu'il devait
                    // d'abord attendre qu'un membre accepte son invitation.
                    <p className="text-sm text-center text-[#0B1F38]/50 bg-gray-50 rounded-2xl px-4 py-6">
                        Aucun membre n'a encore accepté son invitation. Le mandat ne peut être transmis qu'à un membre actif du groupement.
                    </p>
                ) : (
                    <div className="space-y-3 max-h-[40vh] overflow-y-auto px-1">
                        {successeurs.map((succ) => (
                            <button
                                key={succ.id || succ.email}
                                onClick={() => onChoisir(succ)}
                                className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-100 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all group text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00A3E0]"
                            >
                                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[#0B1F38] font-bold group-hover:bg-[#00A3E0] group-hover:text-white transition-colors overflow-hidden">
                                    {succ.photo_url ? (
                                        <img src={succ.photo_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        (succ.name || succ.email || 'M').charAt(0).toUpperCase()
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold text-[#0B1F38]">{nomAffiche(succ)}</p>
                                    <p className="text-[10px] text-[#0B1F38]/40 uppercase font-black tracking-widest">{succ.company || 'Entreprise'}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                <div className="mt-8 flex gap-3">
                    <button
                        onClick={onAnnuler}
                        className="flex-1 px-6 py-3 border border-gray-200 rounded-2xl font-bold text-[#0B1F38]/50 hover:bg-gray-50 transition-all"
                    >
                        Annuler
                    </button>
                </div>
            </div>
        </div>
    );
};
