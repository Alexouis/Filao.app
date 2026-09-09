import React from 'react';
import { Mail, UserCheck, Loader2 } from 'lucide-react';

/**
 * Bandeau proposé au partenaire invité, en tête de la vue décision.
 *
 * POURQUOI IL DISTINGUE LES DOSSIERS CLOS
 * Une invitation peut arriver — ou rester en attente — après que la réponse a
 * été déposée, gagnée ou perdue. Accepter reste utile : le partenaire accède
 * alors à l'historique. Mais lui proposer « Accepter et rejoindre » sans
 * précision laissait croire qu'il allait contribuer à un dossier vivant. Le
 * libellé et le texte disent donc explicitement que l'accès sera en
 * consultation, et pourquoi.
 *
 * Composant de présentation : la réponse à l'invitation reste dans
 * `TenderWizard`, qui seul sait écrire en base et notifier le mandataire.
 */
export interface BandeauInvitationProps {
    titreDossier: string;
    /** Rôle proposé au partenaire (Co-traitant, Sous-traitant…). */
    role: string;
    /** Dossier déjà joué : déposé, gagné, perdu ou expiré. */
    dossierTermine: boolean;
    /** Issue effective, pour nommer précisément ce qui s'est passé. */
    issue?: 'remporté' | 'perdu' | 'expiré';
    /** Désactive les deux boutons pendant l'écriture. */
    enCours?: boolean;
    onAccepter: () => void;
    onRefuser: () => void;
}

export const BandeauInvitation: React.FC<BandeauInvitationProps> = ({
    titreDossier, role, dossierTermine, issue = 'expiré', enCours = false,
    onAccepter, onRefuser,
}) => (
    <div className="mx-4 mt-4 p-5 bg-gradient-to-r from-[#0B1F38] to-[#1B5D7A] text-white rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 animate-in fade-in slide-in-from-top-4 duration-500">
        <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 rounded-xl shrink-0">
                <Mail size={22} className="text-white" aria-hidden="true" />
            </div>
            <div>
                <h3 className="font-bold text-base">
                    {dossierTermine ? 'Invitation sur un dossier clôturé' : 'Invitation à collaborer'}
                </h3>
                <p className="text-white/75 text-sm">
                    Vous avez été invité à travailler sur <strong>"{titreDossier}"</strong> en tant que <strong>{role}</strong>.
                    {dossierTermine ? (
                        <>
                            {' '}Ce dossier est <strong>{issue}</strong> : la réponse a déjà été jouée. En rejoignant, vous y accédez <strong>en consultation</strong>.
                        </>
                    ) : (
                        <> Acceptez pour accéder à l'ensemble du dossier.</>
                    )}
                </p>
            </div>
        </div>
        <div className="flex gap-3 shrink-0">
            <button
                onClick={onRefuser}
                disabled={enCours}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-bold text-sm transition-colors disabled:opacity-50"
            >
                Refuser
            </button>
            <button
                onClick={onAccepter}
                disabled={enCours}
                className="px-5 py-2.5 bg-white text-[#0B1F38] font-bold rounded-xl hover:bg-gray-100 transition-colors shadow-lg text-sm flex items-center gap-2 disabled:opacity-50"
            >
                {enCours
                    ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    : <><UserCheck size={16} aria-hidden="true" /> {dossierTermine ? 'Rejoindre en consultation' : 'Accepter et rejoindre'}</>}
            </button>
        </div>
    </div>
);
