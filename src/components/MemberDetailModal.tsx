import React, { memo } from 'react';
import {
    CheckCircle, AlertCircle, Eye, Lock, FolderOpen, ChevronDown,
    Building2, Mail, Download,
} from 'lucide-react';
import { REQUIRED_DOCS_BY_ROLE, ROLES, GROUPEMENT_STATUSES } from '../config';
import { UIGroupementMember } from '../types';
import { useModale } from '../helpers/useModale';

/**
 * Fiche détaillée d'un membre du groupement : ses pièces, son rôle, son
 * avancement.
 *
 * POURQUOI CE FICHIER
 * Extraite de `TenderWizard` où elle occupait 300 lignes sous forme de
 * `renderMemberDetailModal()`. Elle ne portait aucun état propre, mais sa
 * simple présence dans le composant parent la faisait re-rendre à chaque
 * frappe ailleurs dans le wizard.
 *
 * Elle reste PILOTÉE PAR LE PARENT : toutes les actions (dépôt, rôle,
 * téléchargement, relance) sont des rappels. C'est voulu — ces actions
 * touchent l'état du groupement et la base, qui restent la responsabilité du
 * wizard. Ce composant n'est qu'une vue.
 *
 * La matrice de permissions, elle, vit ici : `isOwner` et `isSelf` décident de
 * ce qui est consultable. Elle double la RLS (migration 039b) plutôt que de
 * la remplacer — l'interface doit dire la même chose que la base, sans quoi on
 * propose des actions vouées à échouer.
 */
export interface MemberDetailModalProps {
    /** Index dans la liste des membres actifs. `null` = modale fermée. */
    selectedMemberIndex: number | null;
    groupementMembers: UIGroupementMember[];
    isOwner: boolean;
    isLocked: boolean;
    userProfileId?: string;
    /** Fichiers déposés, indexés `type-collabId`. */
    uploadedFiles: Record<string, any>;
    onFermer: () => void;
    onTelechargerPiece: (chemin: string, nomPropose: string) => void;
    onTelechargerTout: (member: UIGroupementMember) => void;
    onDeposer: (e: React.ChangeEvent<HTMLInputElement>, docType: string, member: UIGroupementMember) => void;
    onChoisirDepuisEntreprise: (docType: string) => void;
    onRelancer: (member: UIGroupementMember) => void;
    onChangerRole: (member: UIGroupementMember, nouveauRole: string) => void;
}

const MemberDetailModalBase: React.FC<MemberDetailModalProps> = ({
    selectedMemberIndex, groupementMembers, isOwner, isLocked, userProfileId,
    uploadedFiles,
    onFermer, onTelechargerPiece, onTelechargerTout, onDeposer,
    onChoisirDepuisEntreprise, onRelancer, onChangerRole,
}) => {
    useModale(selectedMemberIndex !== null, onFermer);
    if (selectedMemberIndex === null) return null;
        const activeMembers = groupementMembers.filter(m => !m.deleted);
        const member = activeMembers[selectedMemberIndex];
        const isSelf = member.id === userProfileId;
        if (!isOwner && !isSelf) return null; // Security check

        const role = member.role || 'Co-traitant';
        const requiredDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
        const collabId = member.id || selectedMemberIndex.toString();

        const uploadedCount = requiredDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length;
        const totalDocs = requiredDocs.length;
        const missingCount = totalDocs - uploadedCount;
        const memberPercent = totalDocs > 0 ? Math.round((uploadedCount / totalDocs) * 100) : 0;
        const isAllDone = memberPercent === 100 && totalDocs > 0;

        // Categorization logic
        const docCategories = {
            'A': ['dc1', 'dc2', 'dc4', 'dossier_administratif', 'kbis', 'rib', 'attestation_sociale', 'attestation_fiscale', 'attestation_assurance', 'attestation_honneur'],
            'T': ['memoire_technique', 'planning', 'cv', 'references', 'note_methodologique', 'certifications', 'moyens_techniques']
        };

        const adminDocs = requiredDocs.filter(d => docCategories['A'].includes(d.value) || !docCategories['T'].includes(d.value));
        const technicalDocs = requiredDocs.filter(d => docCategories['T'].includes(d.value));

        const renderFileRow = (docDef: any) => {
            const fileKey = `${docDef.value}-${collabId}`;
            const fileObj = uploadedFiles[fileKey];

            /**
             * Matrice de permissions : un co-traitant voit l'avancement et
             * l'intitulé des pièces des autres membres, sans pouvoir les
             * consulter, les télécharger ni en déposer à leur place. Seuls le
             * mandataire et le membre concerné y accèdent.
             *
             * La RLS l'impose déjà (migration 039b) : la policy de lecture ne
             * couvre que son propre dossier, sauf pour le créateur de l'AO.
             * Proposer le bouton ici revenait à annoncer une action qui
             * échouerait — l'interface doit dire la même chose que la base.
             */
            const peutConsulter = isSelf || isOwner;

            return (
                <div key={docDef.value} className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#0B1F38]/5 group transition-all hover:shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${fileObj ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-500'}`}>
                            {fileObj ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        </div>
                        <span className="text-xs font-medium text-[#0B1F38]">{docDef.label}</span>
                    </div>

                    <div className="flex items-center gap-2">
                        {fileObj && member.email && peutConsulter && (
                            <button
                                onClick={() => onTelechargerPiece(`${member.email?.toLowerCase().trim()}/${fileObj.name}`, `${docDef.label}.${fileObj.name.split('.').pop()}`)}
                                title="Consulter la pièce"
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:bg-[#00A3E0] hover:text-white transition-all shadow-sm"
                            >
                                <Eye size={14} />
                            </button>
                        )}
                        {fileObj && !peutConsulter && (
                            /* L'avancement reste visible — c'est ce qui permet de
                               savoir si le dossier avance — mais pas le contenu. */
                            <span
                                title="Pièce déposée. Seuls le mandataire et son propriétaire peuvent la consulter."
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#0B1F38]/20"
                            >
                                <Lock size={14} />
                            </span>
                        )}

                        {isSelf && (
                            <div className="flex items-center gap-1.5">
                                <label className="cursor-pointer">
                                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-sm ${fileObj ? 'bg-white border border-gray-200 text-gray-500 hover:text-[#00A3E0] hover:border-[#00A3E0]' : 'bg-[#0B1F38] text-white hover:bg-[#00A3E0]'}`}>
                                        {fileObj ? 'Mettre à jour' : 'Importer'}
                                    </div>
                                    <input type="file" className="hidden" onChange={(e) => onDeposer(e, docDef.value, member)} />
                                </label>
                                {!isLocked && (
                                    <button
                                        onClick={() => onChoisirDepuisEntreprise(docDef.value)}
                                        className="p-1.5 text-[#0B1F38]/40 hover:text-[#00A3E0] transition-colors bg-gray-50 rounded-lg border border-transparent hover:border-[#00A3E0]/20"
                                        title="Choisir depuis l'entreprise"
                                    >
                                        <FolderOpen size={16} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/40 backdrop-blur-sm" onClick={() => onFermer()}></div>
                <div className="relative bg-[#F4F6F9] rounded-[2.5rem] w-full max-w-5xl max-h-[90vh] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">

                    {/* Top Identity Bar - Improved Layout */}
                    <div className="bg-white p-8 border-b border-[#0B1F38]/5 shrink-0 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00A3E0]/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>

                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                            <div className="flex items-start gap-6">
                                <div className="relative group">
                                    <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#00A3E0] to-[#26367F] flex items-center justify-center text-white font-bold text-4xl shadow-2xl shadow-[#00A3E0]/20 overflow-hidden ring-4 ring-white">
                                        {member.photo_url ? (
                                            <img src={member.photo_url} alt={member.name} className="w-full h-full object-cover" />
                                        ) : (
                                            (member.name || member.email || 'M').charAt(0).toUpperCase()
                                        )}
                                    </div>
                                    <div className={`absolute -bottom-2 -right-2 px-3 py-1 rounded-full text-[10px] font-black border-2 border-white shadow-lg ${isAllDone ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}`}>
                                        {memberPercent}%
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-black text-[#0B1F38] tracking-tight mb-2">{member.name || member.email}</h2>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {isOwner ? (
                                            <div className="relative">
                                                <select
                                                    value={member.role}
                                                    // Toute la logique de changement de rôle — succession
                                                    // obligatoire du mandataire, promotion, confirmation quand
                                                    // des pièces risquent d'être masquées — reste chez le
                                                    // parent : elle touche l'état du groupement et la base.
                                                    onChange={(e) => onChangerRole(member, e.target.value)}
                                                    className="bg-[#00A3E0]/10 text-[#00A3E0] text-[10px] font-black px-4 py-2 rounded-xl border-none focus:ring-2 focus:ring-[#00A3E0] cursor-pointer appearance-none pr-10 uppercase tracking-widest shadow-sm hover:bg-[#00A3E0]/20 transition-all font-sans"
                                                >
                                                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#00A3E0] pointer-events-none" />
                                            </div>
                                        ) : (
                                            <span className="bg-[#00A3E0] text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest shadow-lg shadow-[#00A3E0]/20">{role}</span>
                                        )}
                                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-[#0B1F38]/50 text-[10px] font-bold rounded-xl border border-gray-100 italic">
                                            <Building2 size={12} />
                                            {member.company || 'Entreprise partenaire'}
                                        </div>
                                    </div>

                                    {/* Skills Scrollable Area */}
                                    {member.skills && member.skills.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-4 max-w-2xl max-h-[52px] overflow-y-auto p-2">
                                            {member.skills.map((skill, si) => (
                                                <span key={si} className="px-3 py-1 bg-white text-[#0B1F38]/60 text-[9px] font-bold rounded-lg uppercase tracking-wider border border-gray-100 shadow-sm hover:border-[#00A3E0]/30 transition-colors">
                                                    {skill}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-6 mt-4 md:mt-0 p-4 bg-gray-50/50 rounded-2xl border border-gray-100">
                                <div className="text-center">
                                    <p className="text-[9px] font-black text-[#0B1F38]/30 uppercase tracking-[0.2em] mb-1">PROGRÈS</p>
                                    <span className="text-2xl font-black text-[#0B1F38]">{uploadedCount}/{totalDocs}</span>
                                </div>
                                <div className="w-px h-10 bg-gray-200"></div>
                                {missingCount > 0 ? (
                                    <div className="text-center">
                                        <p className="text-[9px] font-black text-red-400 uppercase tracking-[0.2em] mb-1">À TRAITER</p>
                                        <span className="text-2xl font-black text-red-500">{missingCount}</span>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <CheckCircle size={32} className="text-green-500 mx-auto" />
                                        <p className="text-[8px] font-black text-green-500 uppercase mt-1">COMPLET</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Content Columns */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar-dark grid grid-cols-1 md:grid-cols-2 gap-8 bg-gray-50/50">
                        {/* Admin & Financier */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-[#0B1F38]/5 pb-3">
                                <h4 className="font-black text-[#0B1F38] text-sm tracking-widest uppercase">ADMINISTRATIF & FINANCIER</h4>
                                <span className="text-xs text-[#0B1F38]/40 font-bold">{adminDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length}/{adminDocs.length}</span>
                            </div>
                            <div className="space-y-2">
                                {adminDocs.map(doc => renderFileRow(doc))}
                                {adminDocs.length === 0 && <p className="text-xs italic text-gray-400">Aucun document administratif requis.</p>}
                            </div>
                        </div>

                        {/* Technique */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-[#0B1F38]/5 pb-3">
                                <h4 className="font-black text-[#0B1F38] text-sm tracking-widest uppercase">TECHNIQUE</h4>
                                <span className="text-xs text-[#0B1F38]/40 font-bold">{technicalDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length}/{technicalDocs.length}</span>
                            </div>
                            <div className="space-y-2">
                                {technicalDocs.map(doc => renderFileRow(doc))}
                                {technicalDocs.length === 0 && <p className="text-xs italic text-gray-400">Aucun document technique requis.</p>}
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions (Owner only) */}
                    {isOwner && (
                        <div className="p-6 border-t border-[#0B1F38]/5 bg-white flex justify-between items-center shrink-0">
                            {!isSelf && !isLocked && member.status === GROUPEMENT_STATUSES.accepte ? (
                                <button
                                    onClick={() => onRelancer(member)}
                                    className="flex items-center gap-2 px-6 py-3 border-2 border-[#0B1F38]/10 text-[#0B1F38]/60 hover:text-[#0B1F38] hover:border-[#0B1F38]/20 font-bold rounded-2xl transition-all text-sm"
                                >
                                    <Mail size={18} /> Relancer ce membre
                                </button>
                            ) : <div></div>}
                            <div className="flex items-center gap-4">
                                <button onClick={() => onFermer()} className="px-6 py-3 font-bold text-gray-400 hover:text-gray-600 transition-colors text-sm">Fermer</button>
                                {/* Même règle que pièce par pièce : un co-traitant ne
                                    récupère pas l'archive des pièces d'un autre membre. */}
                                {(isSelf || isOwner) && (
                                    <button
                                        onClick={() => onTelechargerTout(member)}
                                        className="px-8 py-3 bg-[#0B1F38] hover:bg-[#1B2533] text-white font-bold rounded-2xl shadow-xl shadow-[#0B1F38]/20 transition-all active:scale-[0.98] text-sm flex items-center gap-2"
                                    >
                                        <Download size={18} /> Télécharger tout (.zip)
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
};

export const MemberDetailModal = memo(MemberDetailModalBase);
