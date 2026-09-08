import React, { memo } from 'react';
import { CalendarCheck, FileText, FolderOpen, Link, PenTool } from 'lucide-react';
import { formatCpv } from '../helpers/boampHelpers';
import { SECTORS_LABELS } from '../config';
import { cpvLisible, libelleCpv } from '../helpers/cpvLabels';
import { lienExterne } from '../helpers/textHelpers';

/**
 * Colonne latérale de la vue « décision » : contexte de l'AO, pièces du
 * marché, rétroplanning.
 *
 * POURQUOI CE FICHIER
 * Deuxième étape du découpage de `renderDecisionView`. Ces trois panneaux ne
 * font qu'AFFICHER des valeurs et ouvrir des modales : aucune règle, aucun
 * état. Ils sont donc extractibles sans risque, une fois les calculs sortis à
 * l'étape précédente.
 *
 * Ils reçoivent les champs du dossier un à un plutôt que l'objet entier :
 * le composant ne peut ainsi pas dériver vers autre chose que de l'affichage.
 */
export interface PanneauxLateauxProps {
    referenceMarche?: string | null;
    datePublication?: string | null;
    dateDepotSouhaitee?: string | null;
    secteurActivite?: string | null;
    cpvCodes?: string[] | null;
    lienTelechargement?: string | null;
    dceDocuments?: any[] | null;
    /** Jalons déjà triés et qualifiés par la vue. */
    milestones: { label: string; date: string; status?: string }[];
    /** Un membre ayant refusé ne voit ni les pièces ni le rétroplanning. */
    /** Dossier déjà enregistré : certaines actions n'ont de sens qu'ensuite. */
    tenderId: string | null;
    /** L'utilisateur est un invité en attente de réponse. */
    amIInvitee: boolean;
    isRefused: boolean;
    isOwner: boolean;
    isLocked: boolean;
    onOuvrirContexte: () => void;
    onOuvrirDCE: () => void;
    onOuvrirRetroplanning: () => void;
}

const PanneauxLaterauxBase: React.FC<PanneauxLateauxProps> = ({
    referenceMarche, datePublication, dateDepotSouhaitee, secteurActivite,
    cpvCodes, lienTelechargement, dceDocuments, milestones,
    tenderId, amIInvitee, isRefused, isOwner, isLocked,
    onOuvrirContexte, onOuvrirDCE, onOuvrirRetroplanning,
}) => {
    return (
        <>
                                {/* Panel 1 — Contexte de l'AO */}
                                <div className="bg-white/40 border border-white/60 rounded-2xl p-2 relative group">
                                    {isOwner && !isLocked && <button
                                        onClick={() => onOuvrirContexte()}
                                        className="absolute top-3 right-3 p-1.5 bg-[#0B1F38]/5 text-[#0B1F38]/40 hover:bg-[#00A3E0]/10 hover:text-[#00A3E0] rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                        title="Modifier">
                                        <PenTool size={12} />
                                    </button>}
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-sm font-bold text-[#0B1F38] flex items-center gap-1.5"><FileText size={14} className="text-[#00A3E0]" /> Contexte de l'AO</h4>
                                        <button onClick={() => onOuvrirContexte()} className="text-[10px] font-bold text-[#00A3E0] hover:underline">Voir tout →</button>
                                    </div>
                                    <div className="space-y-2 text-[11px]">
                                        {/* Référence : celle de l'acheteur si connue, sinon l'identifiant
                                            technique Filao en repli explicite. Indépendante du lien
                                            (les deux disparaissaient ensemble auparavant). */}
                                        {(referenceMarche || tenderId) && (
                                            <div className="flex justify-between">
                                                <span className="text-[#0B1F38]/40">Référence</span>
                                                {referenceMarche ? (
                                                    <span className="text-[#0B1F38] font-medium truncate ml-2 max-w-[140px]" title={referenceMarche}>{referenceMarche}</span>
                                                ) : (
                                                    <span className="text-[#0B1F38]/50 font-medium truncate ml-2 max-w-[140px]" title={`Identifiant Filao : ${tenderId}`}>
                                                        Réf. interne
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {datePublication && (
                                            <div className="flex justify-between"><span className="text-[#0B1F38]/40">Publication</span><span className="text-[#0B1F38] font-medium">{new Date(datePublication).toLocaleDateString('fr-FR')}</span></div>
                                        )}
                                        {dateDepotSouhaitee && (
                                            <div className="flex justify-between"><span className="text-[#0B1F38]/40">Dépôt souhaité</span><span className="text-[#0B1F38] font-medium">{new Date(dateDepotSouhaitee).toLocaleDateString('fr-FR')}</span></div>
                                        )}
                                        {/* Le mode de passation est déjà affiché dans l'en-tête de
                                            l'AO ; cette ligne sert donc au secteur, qui n'apparaissait
                                            nulle part alors que la fiche le demande. Taille de carte
                                            inchangée. */}
                                        {secteurActivite && (
                                            <div className="flex justify-between">
                                                <span className="text-[#0B1F38]/40">Secteur</span>
                                                <span className="text-[#0B1F38] font-medium truncate ml-2 max-w-[150px]">
                                                    {(SECTORS_LABELS as any)[secteurActivite] || secteurActivite}
                                                </span>
                                            </div>
                                        )}
                                        {/* Codes CPV — nomenclature européenne de l'objet du marché.
                                            Présenté comme les autres lignes du panneau : intitulé à
                                            gauche, valeur à droite. La version précédente occupait
                                            trois lignes (titre, pastilles, libellé) pour une seule
                                            information. */}
                                        {cpvCodes?.length > 0 && (
                                            <div className="flex justify-between gap-2">
                                                <span className="text-[#0B1F38]/40 shrink-0">CPV</span>
                                                <span
                                                    className="text-[#0B1F38] font-medium truncate text-right"
                                                    // Le détail complet reste accessible au survol :
                                                    // un code par ligne, avec sa division.
                                                    title={cpvCodes.map(c => cpvLisible(c, formatCpv(c))).join('\n')}
                                                >
                                                    <span className="font-mono">{formatCpv(cpvCodes[0])}</span>
                                                    {libelleCpv(cpvCodes[0]) && (
                                                        <span className="text-[#0B1F38]/50"> · {libelleCpv(cpvCodes[0])}</span>
                                                    )}
                                                    {cpvCodes.length > 1 && (
                                                        <span className="text-[#0B1F38]/40"> +{cpvCodes.length - 1}</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {lienTelechargement ? (
                                            <a href={lienExterne(lienTelechargement)} target="_blank" rel="noopener noreferrer" title={lienTelechargement} className="flex items-center gap-1 text-[#00A3E0] font-bold hover:underline mt-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[#00A3E0] rounded">
                                                <Link size={12} /> Lien vers l'appel d'offres →
                                            </a>
                                        ) : (
                                            /* Le lien doit être joignable "dans tous les cas" : si absent, on propose
                                               la saisie au lieu de masquer silencieusement la ligne. */
                                            <button
                                                onClick={() => onOuvrirContexte()}
                                                disabled={!isOwner || isLocked}
                                                className="flex items-center gap-1 text-[#0B1F38]/40 font-bold hover:text-[#00A3E0] hover:underline mt-1 text-[11px] disabled:hover:no-underline disabled:hover:text-[#0B1F38]/40 disabled:cursor-default"
                                            >
                                                <Link size={12} /> {(!isOwner || isLocked) ? "Aucun lien renseigné" : "Ajouter le lien vers l'appel d'offres"}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Panel 2 — Pièces du marché (DCE) - Hidden if refused */}
                                {!isRefused && (
                                    <div className={`bg-white/40 border border-white/60 rounded-2xl p-2 group ${amIInvitee ? 'opacity-80' : 'cursor-pointer'}`} onClick={amIInvitee ? undefined : () => onOuvrirDCE()}>
                                        <div className="flex justify-between items-center">
                                            <h4 className="text-sm font-bold text-[#0B1F38] flex items-center gap-1.5"><FolderOpen size={14} className="text-[#00A3E0]" /> Pièces du marché</h4>
                                            {!amIInvitee && <button className="text-[10px] font-bold text-[#00A3E0] hover:underline group-hover:translate-x-0.5 transition-transform">Consulter →</button>}
                                        </div>
                                        <p className="text-[11px] text-[#0B1F38]/50 mt-1.5">{dceDocuments?.length || 0} document{dceDocuments?.length > 1 ? 's' : ''}</p>
                                    </div>
                                )}

                                {/* Panel 3 — Rétroplanning - Hidden if refused */}
                                {!isRefused && (
                                    <div className="bg-white/40 border border-white/60 rounded-2xl p-2 cursor-pointer group" onClick={() => onOuvrirRetroplanning()}>
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="text-sm font-bold text-[#0B1F38] flex items-center gap-1.5"><CalendarCheck size={14} className="text-[#00A3E0]" /> Rétroplanning</h4>
                                            <button className="text-[10px] font-bold text-[#00A3E0] hover:underline group-hover:translate-x-0.5 transition-transform">Voir tout →</button>
                                        </div>
                                        <div className="space-y-2">
                                            {milestones.slice(0, 3).map((m, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${m.status === 'done' ? 'bg-green-500' : m.status === 'danger' ? 'bg-red-500' : m.status === 'warning' ? 'bg-amber-500' : 'bg-gray-300'}`} />
                                                    <span className="text-[11px] font-medium text-[#0B1F38]/60 shrink-0 w-20">{new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                    <span className="text-[11px] text-[#0B1F38] font-medium">{m.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
        </>
    );
};

export const PanneauxLateraux = memo(PanneauxLaterauxBase);
