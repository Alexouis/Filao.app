import React from 'react';
import { ArrowLeft, Users, Building, MapPin, MessageSquare } from 'lucide-react';

/**
 * En-tête de la vue décision : identité du dossier et compte à rebours.
 *
 * DEUX CHOIX À CONSERVER
 *
 * 1. Le badge « Partenaire » est permanent quand on n'est pas porteur du
 *    dossier. Les actions de pilotage sont masquées de toute façon, mais rien
 *    ne disait POURQUOI : on pouvait croire à une interface incomplète plutôt
 *    qu'à un rôle différent.
 *
 * 2. Le compte à rebours change de couleur en approchant, et vire au gris une
 *    fois l'échéance passée — le rouge y signalerait une urgence qui n'existe
 *    plus. Les jours écoulés sont affichés avec un `+` pour qu'on ne confonde
 *    pas « J+3 » avec « il reste 3 jours ».
 */

/** Palette du compte à rebours, selon les jours restants. `null` = pas de date. */
export const couleurEcheance = (joursRestants: number | null): string =>
    joursRestants === null ? 'text-[#0B1F38]/50 bg-[#0B1F38]/5 border-[#0B1F38]/10'
        : joursRestants < 0 ? 'text-gray-400 bg-gray-50 border-gray-200'
            : joursRestants <= 5 ? 'text-red-600 bg-red-50 border-red-200'
                : joursRestants <= 14 ? 'text-amber-600 bg-amber-50 border-amber-200'
                    : 'text-[#00A3E0] bg-[#00A3E0]/5 border-[#00A3E0]/20';

export interface EnteteDossierProps {
    titre: string;
    /** Absent tant que le dossier n'a pas été créé en base. */
    tenderId?: string | null;
    isOwner: boolean;
    /** Libellé et habillage du statut, calculés par l'appelant. */
    statutLabel: string;
    statutClasses: string;
    organismeAcheteur?: string;
    lieuExecution?: string[];
    /** Mode de passation déjà traduit pour l'affichage. */
    modePassationLabel?: string;
    dateLimite?: string | null;
    joursRestants: number | null;
    /** Messagerie masquée pour un invité qui n'a pas encore répondu. */
    afficherMessagerie: boolean;
    messagesNonLus?: number;
    onRetour: () => void;
    onOuvrirMessagerie: () => void;
}

export const EnteteDossier: React.FC<EnteteDossierProps> = ({
    titre, tenderId, isOwner, statutLabel, statutClasses, organismeAcheteur,
    lieuExecution = [], modePassationLabel, dateLimite, joursRestants,
    afficherMessagerie, messagesNonLus = 0, onRetour, onOuvrirMessagerie,
}) => (
    <div className="px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
                <button
                    onClick={onRetour}
                    className="mt-1 p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors shrink-0"
                    title="Retour"
                    aria-label="Revenir à la liste des dossiers"
                >
                    <ArrowLeft size={20} className="text-[#0B1F38]/60" aria-hidden="true" />
                </button>
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h1 className="text-xl font-bold text-[#0B1F38] leading-tight line-clamp-2">
                            {titre || "Nouvel appel d'offres"}
                        </h1>
                        {tenderId && !isOwner && (
                            <span
                                className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 bg-violet-50 text-violet-700 border-violet-200 flex items-center gap-1"
                                title="Ce dossier est piloté par une autre entreprise. Vous y participez comme partenaire : vous déposez vos pièces, sans action sur le cycle de vie du dossier."
                            >
                                <Users size={11} aria-hidden="true" /> Partenaire
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[#0B1F38]/50">
                        {tenderId && (
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 ${statutClasses}`}>
                                {statutLabel}
                            </span>
                        )}
                        {organismeAcheteur && (
                            <span className="flex items-center gap-1 text-xs font-medium">
                                <Building size={12} className="shrink-0" aria-hidden="true" />{organismeAcheteur}
                            </span>
                        )}
                        {lieuExecution.length > 0 && (
                            <span className="flex items-center gap-1 text-xs font-medium">
                                <MapPin size={12} className="shrink-0" aria-hidden="true" />
                                {lieuExecution.slice(0, 2).join(', ')}
                                {lieuExecution.length > 2 ? ` +${lieuExecution.length - 2}` : ''}
                            </span>
                        )}
                        {modePassationLabel && (
                            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-[#0B1F38]/5 border-[#0B1F38]/10 text-[#0B1F38]/60">
                                {modePassationLabel}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {afficherMessagerie && (
                    <button
                        onClick={onOuvrirMessagerie}
                        className="p-2.5 bg-white/60 hover:bg-white rounded-xl transition-all shadow-sm border border-white/60 text-[#0B1F38]/60 hover:text-[#00A3E0] group relative"
                        title="Ouvrir la messagerie"
                        aria-label={messagesNonLus > 0
                            ? `Ouvrir la messagerie, ${messagesNonLus} message(s) non lu(s)`
                            : 'Ouvrir la messagerie'}
                    >
                        <MessageSquare size={20} className="group-hover:scale-110 transition-transform" aria-hidden="true" />
                        {messagesNonLus > 0 && (
                            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
                                {messagesNonLus}
                            </span>
                        )}
                    </button>
                )}
                {dateLimite && (
                    <div className={`shrink-0 rounded-2xl border px-5 py-3 text-center ${couleurEcheance(joursRestants)}`}>
                        <p className="text-[9px] font-bold uppercase tracking-widest opacity-70">Date limite</p>
                        <p className="text-2xl font-extrabold leading-tight">
                            {joursRestants !== null
                                ? (joursRestants >= 0 ? `${joursRestants}` : `+${Math.abs(joursRestants)}`)
                                : '—'}
                            <span className="text-sm font-bold ml-1">jours</span>
                        </p>
                        <p className="text-[10px] font-medium opacity-60">
                            {new Date(dateLimite).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                    </div>
                )}
            </div>
        </div>
    </div>
);
