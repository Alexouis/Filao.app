import React, { memo } from 'react';
import {
    AlertTriangle, ArrowRight, CheckCircle, Crown, LogOut, Mail, Network,
    Plus, ShieldAlert, Sparkles, Trash2, UserCheck, UserPlus, Users, X, XCircle,
} from 'lucide-react';
import { UIGroupementMember } from '../types';
import { GROUPEMENT_STATUSES, ROLES } from '../config';

/**
 * Colonne « Équipe & pièces » d'un dossier : composition du groupement,
 * avancement de chacun, compétences requises, partenaires suggérés.
 *
 * POURQUOI CE FICHIER
 * Troisième et dernière étape du découpage de `renderDecisionView`. C'est le
 * bloc le plus imbriqué : il croise l'équipe, les pièces et les compétences.
 * Les deux étapes précédentes l'ont rendu extractible — les règles de calcul
 * sont sorties dans `decisionHelpers` (et testées), les valeurs arrivent ici
 * prêtes à l'emploi.
 *
 * Le composant n'ouvre aucune modale lui-même : il signale l'intention au
 * parent, qui détient les états d'ouverture. Une modale pilotée depuis deux
 * endroits finit toujours par s'ouvrir au mauvais moment.
 */
export interface EquipeEtPiecesProps {
    /** Membres encore en place (ni supprimés ni retirés). */
    activeMembers: UIGroupementMember[];
    /** Avancement agrégé du dossier. */
    globalProgress: { received: number; total: number; percent: number };
    /** Avancement d'un membre donné, calculé par la vue. */
    getMemberProgress: (member: UIGroupementMember, index: number) => { received: number; total: number; percent: number };
    /** Compétences requises que personne ne couvre. */
    missingSpecialties: { id: string; label: string }[];
    requiredSpecialtyIds?: string[] | null;
    /** Référentiel des spécialités, pour afficher les libellés. */
    refSpecialties: { id: string; label: string }[];
    /** Spécialités effectivement couvertes par l'équipe. */
    allCoveredSpecialtyIds: string[];
    requiredSkills?: string[] | null;
    typeGroupement?: string | null;
    /** Gain qu'apporterait une compétence supplémentaire. */
    potentialGain: number;
    /** Position du carrousel de partenaires suggérés, partagée avec les indicateurs. */
    carouselIndex: number;
    isOwner: boolean;
    isLocked: boolean;
    isRefused: boolean;
    /** L'utilisateur est un invité qui n'a pas encore répondu. */
    amIInvitee: boolean;
    userProfileId?: string;
    userProfileEmail?: string;
    onOuvrirMembre: (index: number) => void;
    onOuvrirCoordination: () => void;
    onOuvrirCompetences: () => void;
    onAjouterMembre: () => void;
    onOuvrirReseau: () => void;
    onRetirerMembre: (index: number) => void;
    onRelancerInvitation: (member: UIGroupementMember) => void;
    /** Retire une compétence requise du dossier. */
    onRetirerCompetence: (specialtyId: string) => void;
}

const EquipeEtPiecesBase: React.FC<EquipeEtPiecesProps> = ({
    activeMembers, globalProgress, getMemberProgress, missingSpecialties,
    requiredSpecialtyIds, refSpecialties, allCoveredSpecialtyIds,
    requiredSkills, typeGroupement, potentialGain,
    carouselIndex, isOwner, isLocked, isRefused, amIInvitee, userProfileId, userProfileEmail,
    onOuvrirMembre, onOuvrirCoordination, onOuvrirCompetences,
    onAjouterMembre, onOuvrirReseau, onRetirerMembre, onRelancerInvitation,
    onRetirerCompetence,
}) => {
    // Le commentaire d'origine (« COLONNE GAUCHE ») est remonté dans l'en-tête
    // du fichier : à l'intérieur d'un `return`, il ne serait plus une
    // expression JSX valide.
    return (
        <div className="lg:col-span-2 bg-white/60 border border-white/60 rounded-2xl shadow-sm flex flex-col overflow-hidden">
                                {/* Header */}
                                <div className="p-2 pb-3 shrink-0">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-base font-bold text-[#0B1F38] flex items-center gap-2">
                                            <Users size={18} className="text-[#00A3E0]" /> Équipe & pièces
                                            {typeGroupement && (
                                                <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${typeGroupement === 'solidaire' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                                    {typeGroupement === 'solidaire' ? 'Solidaire' : 'Conjoint'}
                                                </span>
                                            )}
                                            <span className="text-[11px] font-medium text-[#0B1F38]/40 ml-1">· {activeMembers.length} membre{activeMembers.length > 1 ? 's' : ''}</span>
                                        </h3>
                                        {isOwner && (
                                            <button
                                                onClick={() => onOuvrirCoordination()}
                                                className="text-[11px] font-bold text-[#00A3E0] hover:text-[#008BBF] transition-colors flex items-center gap-1"
                                            >
                                                Voir toutes les pièces <ArrowRight size={12} />
                                            </button>
                                        )}
                                    </div>

                                    {/* Global progress bar - Hidden if refused */}
                                    {!isRefused && (
                                        <div className="mb-2">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-xs font-medium text-[#0B1F38]/60">Avancement global du dossier</span>
                                                <span className="text-xs font-bold text-[#0B1F38]">{globalProgress.received} / {globalProgress.total} pièces — {globalProgress.percent}%</span>
                                            </div>
                                            <div className="w-full bg-[#0B1F38]/8 rounded-full h-2.5 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all duration-700 ${globalProgress.percent === 100 ? 'bg-green-500' : 'bg-[#00A3E0]'}`} style={{ width: `${globalProgress.percent}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Skills Tags - Hidden if refused */}
                                    {!isRefused && (
                                        <div className="flex flex-wrap gap-1.5 items-center">
                                            <span className="text-[10px] font-bold text-[#0B1F38]/50 mr-0.5">Requis :</span>
                                            {requiredSpecialtyIds.map(sid => {
                                                const spec = refSpecialties.find(s => s.id === sid);
                                                const skill = spec?.label || "Compétence";
                                                const isCovered = allCoveredSpecialtyIds.includes(sid);
                                                return (
                                                    <span key={sid} className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 group/skill relative ${isOwner ? 'pr-5' : ''} cursor-default ${isCovered ? 'text-green-700 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                                                        {isCovered ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                                                        {skill}
                                                        {isOwner && <button onClick={(e) => { e.stopPropagation(); onRetirerCompetence(sid); }} className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/skill:opacity-100 hover:text-red-700 transition-opacity"><X size={10} /></button>}
                                                    </span>
                                                );
                                            })}

                                            {isOwner && (
                                                <button
                                                    onClick={() => onOuvrirCompetences()}
                                                    className="text-[10px] font-bold bg-[#0B1F38]/5 text-[#0B1F38]/60 hover:bg-[#00A3E0] hover:text-white px-2 py-0.5 rounded flex items-center gap-1 transition-all"
                                                >
                                                    <Plus size={10} /> Ajouter
                                                </button>
                                            )}

                                        </div>
                                    )}
                                </div>

                                {/* Members List - Filtered if refused */}
                                <div className="flex-1 overflow-y-auto custom-scrollbar-dark px-5 pb-3 space-y-2">
                                    {activeMembers.filter(m => !isRefused || m.is_owner).map((c, i) => {
                                        const isMemberOwner = !!c.is_owner;
                                        const isCurrentUser = c.id === userProfileId;
                                        const hasAccount = c.hasAccount || !!c.id;
                                        const effectiveStatus = isMemberOwner ? GROUPEMENT_STATUSES.accepte : (c.status || GROUPEMENT_STATUSES.invite);

                                        // L'état affiché doit refléter l'ENGAGEMENT du partenaire,
                                        // pas la simple existence d'un compte Filao. Le badge se
                                        // fondait sur `hasAccount` : un partenaire déjà inscrit
                                        // apparaissait « Connecté » sans avoir ouvert le dossier,
                                        // laissant croire au mandataire qu'il était actif.
                                        //
                                        //   invited  — invitation envoyée, sans réponse
                                        //   accepted — a accepté, mais n'a encore rien déposé
                                        //   active   — a accepté et commencé à déposer ses pièces
                                        const memberProgress = getMemberProgress(c, i);
                                        const memberType: 'creator' | 'active' | 'accepted' | 'invited' | 'refused' =
                                            isMemberOwner ? 'creator'
                                                : effectiveStatus === GROUPEMENT_STATUSES.refuse ? 'refused'
                                                    : effectiveStatus === GROUPEMENT_STATUSES.accepte
                                                        ? (memberProgress.received > 0 ? 'active' : 'accepted')
                                                        : 'invited';
                                        const displayName = c.name && c.name.trim() ? c.name : c.email;

                                        return (
                                            <div key={c.id || i} onClick={(amIInvitee || effectiveStatus === GROUPEMENT_STATUSES.refuse) ? undefined : () => onOuvrirMembre(i)} className={`group relative p-2 rounded-xl border transition-all duration-200 ${amIInvitee ? '' : 'cursor-pointer hover:border-[#00A3E0]/30 hover:shadow-md'} ${isMemberOwner
                                                ? 'bg-gradient-to-r from-[#0B1F38]/5 to-[#00A3E0]/5 border-[#0B1F38]/15'
                                                : 'bg-white border-[#0B1F38]/5'
                                                }`}>
                                                {/* Top row: avatar + info + status */}
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${isMemberOwner ? 'bg-[#0B1F38] text-white' : hasAccount ? 'bg-white border border-[#00A3E0]/20 text-[#00A3E0]' : 'bg-white border border-orange-200 text-orange-400'}`}>
                                                        {c.photo_url ? (
                                                            <img src={c.photo_url} alt="" className="w-full h-full rounded-lg object-cover" />
                                                        ) : (
                                                            (c.company || c.name || 'M').charAt(0).toUpperCase()
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-4 min-w-0">
                                                            <div className="flex items-center gap-2 min-w-0 shrink-0 max-w-[50%]">
                                                                <p className="font-bold text-[#0B1F38] text-[12px] leading-tight truncate">
                                                                    {c.company || displayName}
                                                                    {isCurrentUser && <span className="text-[#0B1F38]/40 text-[10px] font-normal ml-1">(Vous)</span>}
                                                                </p>
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${isMemberOwner ? 'bg-[#00A3E0] text-white' : 'bg-[#0B1F38]/5 text-[#0B1F38]/50'}`}>
                                                                    {c.role}
                                                                </span>
                                                            </div>

                                                            {/* Member Skills - Horizontal Scroll */}
                                                            {c.skills && c.skills.length > 0 && (
                                                                <div className="flex gap-1.5 overflow-x-auto custom-scrollbar-dark max-w-[280px] min-w-0 shrink">
                                                                    {c.skills.map((skill, sidx) => {
                                                                        const sId = c.specialty_ids?.[sidx];
                                                                        const isRequired = sId ? requiredSpecialtyIds.includes(sId) : requiredSkills.includes(skill);

                                                                        return (
                                                                            <div
                                                                                key={sidx}
                                                                                className={`text-[9px] font-bold px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0 border transition-all ${isRequired
                                                                                        ? 'bg-[#00A3E0]/10 text-[#00A3E0] border-[#00A3E0]/20'
                                                                                        : 'bg-[#0B1F38]/5 text-[#0B1F38]/40 border-transparent'
                                                                                    }`}
                                                                            >
                                                                                {skill}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>


                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[11px] text-[#0B1F38]/50 truncate">{displayName !== c.company ? displayName : ''}</span>
                                                            <p className="text-[10px] text-[#0B1F38]/40 truncate">({c.email})</p>
                                                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${
                                                                memberType === 'creator' ? 'text-[#00A3E0] bg-[#00A3E0]/10'
                                                                    : memberType === 'active' ? 'text-green-600 bg-green-50'
                                                                        : memberType === 'accepted' ? 'text-sky-600 bg-sky-50'
                                                                            : memberType === 'refused' ? 'text-red-500 bg-red-50'
                                                                                : 'text-orange-500 bg-orange-50'
                                                            }`}>
                                                                {memberType === 'creator' && <><Crown size={9} /> Admin</>}
                                                                {memberType === 'active' && <><UserCheck size={9} /> Actif</>}
                                                                {memberType === 'accepted' && <><CheckCircle size={9} /> Accepté</>}
                                                                {memberType === 'refused' && <><XCircle size={9} /> Refusé</>}
                                                                {memberType === 'invited' && <><Mail size={9} /> Invité</>}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {/* Right side: status + actions */}
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        {(() => {
                                                            switch (effectiveStatus) {
                                                                case GROUPEMENT_STATUSES.accepte: return <CheckCircle size={16} className="text-green-500" />;
                                                                case GROUPEMENT_STATUSES.refuse: return <XCircle size={16} className="text-red-400" />;
                                                                case GROUPEMENT_STATUSES.invite:
                                                                default: return <div className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />;
                                                            }
                                                        })()}

                                                        {/* Demande de nouveau lien : l'invité est arrivé après
                                                            expiration et attend un renvoi. Sans ce repère, sa demande
                                                            resterait dans une notification lue une fois puis oubliée. */}
                                                        {isOwner && c.relance_demandee_le && (
                                                            <span
                                                                title={`Nouveau lien demandé le ${new Date(c.relance_demandee_le).toLocaleDateString('fr-FR')}`}
                                                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 shrink-0"
                                                            >
                                                                Lien demandé
                                                            </span>
                                                        )}
                                                        {isOwner && !isLocked && (effectiveStatus === GROUPEMENT_STATUSES.invite) && !isMemberOwner && (
                                                            <button onClick={(e) => { e.stopPropagation(); onRelancerInvitation(c.email || '', c.role, c.access_code || '', c.entreprise_id); }}
                                                                className="p-1 text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded transition-colors" title={effectiveStatus === GROUPEMENT_STATUSES.refuse ? 'Relancer' : 'Inviter'}>
                                                                <Mail size={14} />
                                                            </button>
                                                        )}

                                                        {/* Retrait possible tant que le partenaire n'a pas accepté.
                                                            Une fois l'accord donné, le groupement est constitué : le
                                                            mandataire ne peut plus en sortir quelqu'un unilatéralement.
                                                            Le partenaire garde, lui, la possibilité de le quitter
                                                            (bouton ci-dessous). */}
                                                        {isOwner && !isMemberOwner && effectiveStatus !== GROUPEMENT_STATUSES.accepte && (
                                                            <button onClick={(e) => { e.stopPropagation(); onRetirerMembre({ index: i, name: c.name || c.company || c.email }); }}
                                                                className="p-1 text-[#0B1F38]/15 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Retirer du groupement">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        )}
                                                        {isOwner && !isMemberOwner && effectiveStatus === GROUPEMENT_STATUSES.accepte && (
                                                            <span
                                                                title="Ce partenaire a accepté : il ne peut plus être retiré du groupement"
                                                                className="p-1 text-[#0B1F38]/10 cursor-default"
                                                            >
                                                                <ShieldAlert size={13} />
                                                            </span>
                                                        )}

                                                        {isCurrentUser && !isMemberOwner && effectiveStatus === GROUPEMENT_STATUSES.accepte && (
                                                            <button onClick={(e) => { e.stopPropagation(); onRetirerMembre({ index: i, name: 'Quitter le groupement' }); }}
                                                                className="p-1 text-orange-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Quitter le groupement">
                                                                <LogOut size={13} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Individual progress bar */}
                                                {(effectiveStatus !== GROUPEMENT_STATUSES.refuse) && <div className=" ml-12">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 bg-[#0B1F38]/8 rounded-full h-1.5 overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-500 ${memberProgress.percent === 100 ? 'bg-green-500' : 'bg-[#00A3E0]'}`} style={{ width: `${memberProgress.percent}%` }} />
                                                        </div>
                                                        <span className="text-[10px] font-bold text-[#0B1F38]/50 shrink-0">{memberProgress.received}/{memberProgress.total} — {memberProgress.percent}%</span>
                                                    </div>
                                                </div>}


                                            </div>
                                        );
                                    })}

                                    {missingSpecialties.length > 0 && isOwner && !isLocked && (
                                        <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-[#00A3E0]/30 bg-[#00A3E0]/5 relative overflow-hidden group">
                                            {/* Progress indicator for carousel dots */}
                                            <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                                                {missingSpecialties.map((_, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`w-1 h-1 rounded-full transition-all ${idx === (carouselIndex % missingSpecialties.length) ? 'bg-[#00A3E0] w-2' : 'bg-[#0B1F38]/10'}`}
                                                    />
                                                ))}
                                            </div>

                                            <div className="w-10 h-10 rounded-xl bg-white border border-[#00A3E0]/20 flex items-center justify-center shrink-0 shadow-sm text-[#00A3E0] animate-pulse">
                                                <UserPlus size={18} />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                {missingSpecialties.map((spec, idx) => {
                                                    const isCurrent = idx === (carouselIndex % missingSpecialties.length);
                                                    if (!isCurrent) return null;

                                                    return (
                                                        <div key={spec.id} className="animate-in fade-in slide-in-from-right-2 duration-500">
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <p className="text-[12px] font-bold text-[#0B1F38] truncate">Partenaire {spec.label} recherché</p>
                                                                    <p className="text-[10px] font-bold text-[#00A3E0] flex items-center gap-1.5 mt-0.5">
                                                                        <Sparkles size={11} className="shrink-0" />
                                                                        Potentiel +{potentialGain}% sur votre score global
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <button
                                                                        onClick={() => onOuvrirReseau()}
                                                                        className="px-2.5 py-1.5 bg-[#00A3E0] text-white font-bold text-[10px] rounded-lg hover:bg-[#008BBF] transition-all shadow-sm hover:shadow-md flex items-center gap-1.5"
                                                                    >
                                                                        <Network size={12} /> Réseau
                                                                    </button>
                                                                    <button
                                                                        onClick={() => onAjouterMembre()}
                                                                        className="px-2.5 py-1.5 bg-white border border-[#0B1F38]/10 text-[#0B1F38]/70 font-bold text-[10px] rounded-lg hover:bg-gray-50 transition-all flex items-center gap-1.5"
                                                                    >
                                                                        <Mail size={12} /> Email
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Add member button */}
                                {isOwner && !isLocked && (
                                    <div className="flex items-center gap-2 p-2 border-t border-[#0B1F38]/5 shrink-0">
                                        <button
                                            onClick={() => onAjouterMembre()}
                                            className="w-full py-2 border border-dashed border-[#0B1F38]/15 rounded-xl text-[#0B1F38]/50 font-bold text-xs hover:border-[#00A3E0] hover:text-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all flex items-center justify-center gap-1.5"
                                        >
                                            <Plus size={14} /> Ajouter un membre
                                        </button>
                                        <button
                                            onClick={() => onOuvrirReseau()}
                                            className="w-full py-2 bg-[#00A3E0] text-white font-bold text-sm rounded-xl hover:bg-[#008BBF] transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-1.5"
                                        >
                                            <Network size={14} /> Réseau
                                        </button>
                                    </div>
                                )}
                            </div>
    );
};

export const EquipeEtPieces = memo(EquipeEtPiecesBase);
