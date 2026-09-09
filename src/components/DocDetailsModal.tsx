import React, { memo } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, Download, Loader2, Mail, X } from 'lucide-react';
import { REQUIRED_DOCS_BY_ROLE } from '../config';
import { UIGroupementMember } from '../types';
import { EmailLogPanel } from './EmailLogPanel';
import { useModale } from '../helpers/useModale';

/**
 * Coordination documentaire : suivi global des pièces du groupement, membre
 * par membre, avec relance et téléchargement.
 *
 * POURQUOI CE FICHIER
 * Extraite de `TenderWizard`, où elle occupait 189 lignes sous forme de
 * `renderDocDetailsModal()`. Elle ne porte aucun état propre ; seule sa
 * présence dans le composant parent la faisait re-rendre à chaque frappe
 * ailleurs dans le wizard.
 *
 * RÉSERVÉE AU PORTEUR
 * La garde `isOwner` de l'original est conservée : cette vue croise les pièces
 * de TOUS les membres, ce que seul le mandataire a le droit de voir
 * (migration 039b). Le parent la monte quand même, la garde est ici.
 */
export interface DocDetailsModalProps {
    ouvert: boolean;
    /** Seul le porteur accède à cette vue transverse. */
    isOwner: boolean;
    groupementMembers: UIGroupementMember[];
    /** Fichiers déposés, indexés `type-collabId`. */
    uploadedFiles: Record<string, any>;
    userProfileId?: string;
    tenderId: string | null;
    /**
     * Avancement global, calculé par le parent : il s'en sert aussi ailleurs
     * (message de félicitations à 100 %). Le dupliquer ici ferait diverger les
     * deux affichages au premier changement de règle.
     */
    docProgress: { total: number; uploaded: number; percent: number };
    /** Membres déjà relancés durant la session (bouton grisé). */
    resentInvitations: Record<string, boolean>;
    /** Une action est en cours côté parent (relance, enregistrement). */
    loading: boolean;
    onFermer: () => void;
    onRelancer: (member: UIGroupementMember) => void;
    onTelechargerTout: (member: UIGroupementMember) => void;
    onTelechargerPiece: (chemin: string, nomPropose: string) => void;
    onDeposer: (e: React.ChangeEvent<HTMLInputElement>, docType: string, member: UIGroupementMember) => void;
}

const DocDetailsModalBase: React.FC<DocDetailsModalProps> = ({
    ouvert, isOwner, groupementMembers, uploadedFiles, userProfileId, tenderId, docProgress,
    resentInvitations, loading,
    onFermer, onRelancer, onTelechargerTout, onTelechargerPiece, onDeposer,
}) => {
    const refModale = useModale(ouvert, onFermer);
    if (!ouvert || !isOwner) return null;

    const activeMembers = groupementMembers.filter(m => !m.deleted);

        return (
            <div
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#0B1F38]/60 backdrop-blur-sm animate-in fade-in duration-200"
                // Clic sur le fond uniquement : `currentTarget` écarte les clics
                // propagés depuis l'intérieur de la modale, qui la fermeraient
                // en plein remplissage de formulaire.
                onClick={(e) => { if (e.target === e.currentTarget) onFermer(); }}
                ref={refModale as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-label="Coordination documentaire"
            >
                <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                    {/* Header */}
                    <div className="p-6 border-b border-[#0B1F38]/10 flex justify-between items-center bg-gray-50/50 shrink-0">
                        <div>
                            <h3 className="text-xl font-bold text-[#0B1F38]">Coordination Documentaire</h3>
                            <p className="text-sm text-[#0B1F38]/60">Suivi global des pièces du groupement</p>
                        </div>
                        <button onClick={() => onFermer()} className="p-2 hover:bg-[#0B1F38]/5 rounded-full text-[#0B1F38]/40 hover:text-[#0B1F38] transition-colors">
                            <X size={24} />
                        </button>
                    </div>

                    {/* Progress Global */}
                    <div className="px-6 pt-5 pb-3 shrink-0">
                        <div className="bg-[#0B1F38]/5 p-4 rounded-xl border border-[#0B1F38]/10">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold text-[#0B1F38]">Progression globale du groupement</span>
                                <span className="text-sm font-bold text-[#00A3E0]">{docProgress.percent}%</span>
                            </div>
                            <div className="w-full h-2.5 bg-[#0B1F38]/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-[#00A3E0] to-[#26367F] transition-all duration-700 ease-out shadow-[0_0_10px_rgba(38,54,127,0.3)]"
                                    style={{ width: `${docProgress.percent}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-widest">{docProgress.uploaded} / {docProgress.total} documents validés</span>
                            </div>
                        </div>
                    </div>

                    {/* Member Accordions */}
                    <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3 custom-scrollbar-dark mt-2">
                        {activeMembers.map((member, mIdx) => {
                            const role = member.role || 'Co-traitant';
                            const reqDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
                            const collabId = member.id || mIdx.toString();

                            const memberUploaded = reqDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length;
                            const memberPercent = reqDocs.length > 0 ? Math.round((memberUploaded / reqDocs.length) * 100) : 0;
                            const isAllDone = memberPercent === 100 && reqDocs.length > 0;

                            return (
                                <details key={mIdx} className="group border border-[#0B1F38]/10 rounded-2xl overflow-hidden bg-white hover:border-[#00A3E0]/30 transition-all shadow-sm">
                                    <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50/80 list-none font-bold text-[#0B1F38] select-none">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold transition-all shadow-md overflow-hidden ${isAllDone ? 'bg-green-500' : 'bg-gradient-to-br from-[#0B1F38] to-[#1B2533]'}`}>
                                                    {isAllDone ? (
                                                        <CheckCircle size={20} />
                                                    ) : member.photo_url ? (
                                                        <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        (member.name || member.email || 'M').charAt(0).toUpperCase()
                                                    )}
                                                </div>
                                                {memberPercent > 0 && !isAllDone && (
                                                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center border-2 border-[#F4F6F9] shadow-sm">
                                                        <div className="text-[8px] font-black text-[#00A3E0] leading-none">{memberPercent}%</div>
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-black tracking-tight">{member.name || member.email}</span>
                                                    {member.role === 'Mandataire' && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[8px] font-black rounded uppercase">Mandataire</span>}
                                                </div>
                                                <p className="text-[10px] text-[#0B1F38]/40 font-medium">{role}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right hidden sm:block">
                                                <p className={`text-xs font-black ${isAllDone ? 'text-green-500' : 'text-[#0B1F38]/70'}`}>{memberUploaded}/{reqDocs.length}</p>
                                            </div>
                                            <ChevronDown size={18} className="text-[#0B1F38]/20 transition-transform duration-300 group-open:rotate-180" />
                                        </div>
                                    </summary>

                                    <div className="px-4 pb-4 bg-gray-50/50 space-y-2 border-t border-[#0B1F38]/5 pt-4 animate-in slide-in-from-top-2 duration-300">
                                        {reqDocs.map((doc, dIdx) => {
                                            const fileKey = `${doc.value}-${collabId}`;
                                            const fileObj = uploadedFiles[fileKey];
                                            const isSelf = member.id === userProfileId;

                                            return (
                                                <div key={dIdx} className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#0B1F38]/5 group/item transition-all hover:shadow-sm">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-1.5 rounded-lg ${fileObj ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-500'}`}>
                                                            {fileObj ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                                                        </div>
                                                        <span className="text-xs font-bold text-[#0B1F38]/70">{doc.label}</span>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {fileObj && member.email && (
                                                            <button
                                                                onClick={() => onTelechargerPiece(`${member.email?.toLowerCase().trim()}/${fileObj.name}`, `${doc.label}.${fileObj.name.split('.').pop()}`)}
                                                                className="p-1.5 text-[#00A3E0] hover:bg-[#00A3E0] hover:text-white rounded-lg transition-all shadow-sm bg-white border border-[#00A3E0]/10"
                                                                title="Voir/Télécharger"
                                                            >
                                                                <Download size={14} />
                                                            </button>
                                                        )}
                                                        {isSelf && (
                                                            <label className="cursor-pointer">
                                                                <div className={`px-3 py-1 bg-[#0B1F38] text-white text-[10px] font-black rounded-lg hover:bg-[#00A3E0] transition-all`}>
                                                                    {fileObj ? "Update" : "Import"}
                                                                </div>
                                                                <input type="file" className="hidden" onChange={(e) => onDeposer(e, doc.value, member)} />
                                                            </label>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {reqDocs.length === 0 && <p className="text-xs text-center text-gray-400 py-4 italic">Aucune pièce requise pour ce membre.</p>}

                                        {!isAllDone && (() => {
                                            const cleRelance = (member.email || '').trim().toLowerCase();
                                            const dernierRappel = resentInvitations[cleRelance];
                                            // Verrou d'une heure : même règle que `handleRelancer`,
                                            // reflétée ici pour que le bouton dise ce qu'il fera.
                                            const verrouille = !!dernierRappel && (Date.now() - dernierRappel < 3600000);
                                            return (
                                                <>
                                                    <button
                                                        onClick={() => onRelancer(member)}
                                                        disabled={verrouille || loading}
                                                        className="w-full mt-2 py-2 text-[10px] font-black text-[#0B1F38]/40 hover:text-[#0B1F38] border-2 border-dashed border-[#0B1F38]/10 rounded-xl hover:bg-white hover:border-[#0B1F38]/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                                                    >
                                                        <Mail size={12} /> {verrouille ? 'RAPPEL DÉJÀ ENVOYÉ' : 'ENVOYER UN RAPPEL'}
                                                    </button>
                                                    {dernierRappel && (
                                                        <p className="text-[10px] text-center text-[#0B1F38]/35 mt-1.5">
                                                            Dernier rappel : {new Date(dernierRappel).toLocaleDateString('fr-FR', {
                                                                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                                                            })}
                                                        </p>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </details>
                            );
                        })}

                        {/* Journal des emails et dépôts liés au dossier —
                            réservé au mandataire (créateur), une fois le dossier
                            créé. La RLS restreint déjà les données visibles. */}
                        {isOwner && tenderId && (
                          <div className="mt-6 pt-4 border-t border-white/10">
                            <EmailLogPanel tenderId={tenderId} />
                          </div>
                        )}
                    </div>
                    <div className="p-6 border-t border-[#0B1F38]/10 bg-gray-50/80 shrink-0">
                        <button
                            onClick={() => onTelechargerTout()}
                            disabled={loading || docProgress.uploaded === 0}
                            className="w-full py-4 bg-[#0B1F38] hover:bg-[#1B2533] text-white font-black rounded-2xl shadow-xl shadow-[#0B1F38]/20 flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
                        >
                            {loading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                            <div className="text-left">
                                <p className="text-sm font-black leading-none">TÉLÉCHARGER LE DOSSIER COMPLET</p>
                                <p className="text-[10px] text-white/50 mt-1 uppercase tracking-widest">{docProgress.uploaded} fichiers archivés (.zip)</p>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
};

export const DocDetailsModal = memo(DocDetailsModalBase);
