import React, { memo } from 'react';
import {
    Files, Download, Loader2, X, Info, UploadCloud, FileText,
    Eye, Trash2, RefreshCw,
} from 'lucide-react';
import { useModale } from '../helpers/useModale';

/**
 * Typologie des pièces d'un dossier de consultation.
 *
 * Le champ `type` d'un document contenait jusqu'ici le sous-type MIME — « PDF »,
 * « JPEG » — c'est-à-dire le format, pas la nature de la pièce. Or c'est la
 * seconde qui compte : un acheteur publie un RC, un CCAP, un CCTP, et c'est
 * ainsi que les répondants les désignent entre eux.
 */
export const CATEGORIES_DCE = [
    { value: 'RC', label: 'RC — Règlement de consultation' },
    { value: 'CCAP', label: 'CCAP — Cahier des clauses administratives' },
    { value: 'CCTP', label: 'CCTP — Cahier des clauses techniques' },
    { value: 'DPGF', label: 'DPGF / BPU — Décomposition du prix' },
    { value: 'AE', label: "AE — Acte d'engagement" },
    { value: 'AVIS', label: "Avis de marché" },
    { value: 'PLAN', label: 'Plans et pièces graphiques' },
    { value: 'ANNEXE', label: 'Annexe' },
] as const;

/**
 * Pièces du marché (DCE) : consultation, ajout, renommage, versions.
 *
 * POURQUOI CE FICHIER
 * Extraite de `TenderWizard`, où elle occupait 240 lignes sous forme de
 * `renderDCEPiecesModal()`. Comme les autres modales sorties avant elle, sa
 * présence dans le composant parent la faisait re-rendre à chaque frappe
 * ailleurs dans le wizard.
 *
 * Elle ne porte aucun état : tout arrive par props, toutes les actions sont
 * des rappels. Les pièces du marché sont communes au groupement — leur
 * consultation n'est donc pas réservée au mandataire, contrairement à leur
 * modification, d'où les deux drapeaux `isOwner` et `isLocked`.
 */
export interface DCEPiecesModalProps {
    ouvert: boolean;
    /** Pièces du DCE, telles que stockées sur le dossier. */
    documents: any[];
    /** Seul le porteur modifie ; tout le monde consulte. */
    isOwner: boolean;
    /** Dossier finalisé : les pièces sont figées. */
    isLocked: boolean;
    /** Dépôt en cours (désactive la zone d'ajout). */
    isUploading: boolean;
    /** Archive en préparation. */
    zipEnCours: boolean;
    onFermer: () => void;
    onDeposer: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemplacer: (e: React.ChangeEvent<HTMLInputElement>, doc: any) => void;
    onSupprimer: (doc: any) => void;
    onMajPiece: (id: string, champs: Record<string, any>) => void;
    onOuvrir: (chemin: string) => void;
    onTelecharger: (chemin: string, nom: string) => void;
    onToutTelecharger: () => void;
}

const DCEPiecesModalBase: React.FC<DCEPiecesModalProps> = ({
    ouvert, documents, isOwner, isLocked, isUploading, zipEnCours,
    onFermer, onDeposer, onRemplacer, onSupprimer, onMajPiece,
    onOuvrir, onTelecharger, onToutTelecharger,
}) => {
    useModale(ouvert, onFermer);
    if (!ouvert) return null;


        return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => onFermer()}></div>
                <div className="relative bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                    {/* Header */}
                    <div className="p-6 border-b border-[#0B1F38]/5 flex justify-between items-center bg-[#0B1F38]/2 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0]">
                                <Files size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-[#0B1F38]">Pièces du Marché (DCE)</h3>
                                <p className="text-xs text-[#0B1F38]/50">Documents extraits du dossier de consultation</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* Accessible à tous les membres du dossier, pas seulement
                                au mandataire : les pièces du marché sont communes. */}
                            {(documents || []).length > 0 && (
                                <button
                                    onClick={onToutTelecharger}
                                    disabled={zipEnCours}
                                    className="px-3 py-2 text-xs font-bold text-[#0B1F38] hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50"
                                    title="Télécharger toutes les pièces du marché"
                                >
                                    {zipEnCours
                                        ? <><Loader2 size={16} className="animate-spin" /> Préparation…</>
                                        : <><Download size={16} /> Tout télécharger</>}
                                </button>
                            )}
                            <button onClick={() => onFermer()} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors">
                                <X size={20} className="text-[#0B1F38]/40" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto custom-scrollbar-dark flex-1">
                        <div className="bg-[#0B1F38]/5 p-4 rounded-xl mb-6 flex flex-col gap-4">
                            <div className="flex items-start gap-3">
                                <Info size={16} className="text-[#00A3E0] mt-0.5" />
                                <p className="text-xs text-[#0B1F38]/70 leading-relaxed">
                                    Les documents suivants ont été identifiés dans le DCE. Vous pouvez les consulter individuellement ou en ajouter de nouveaux.
                                </p>
                            </div>

                            {/* Upload Area */}
                            {isOwner && !isLocked && (
                                <div className="relative">
                                    <input
                                        type="file"
                                        id="dce-upload"
                                        className="hidden"
                                        // L'interface annonçait « PDF / DOCX / XLSX / ZIP » alors que
                                        // l'input n'en filtrait aucun. `accept` ne protège rien — il
                                        // ne fait que présélectionner dans la boîte de dialogue — la
                                        // validation qui compte est celle de l'edge function.
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
                                        onChange={onDeposer}
                                        disabled={isUploading}
                                    />
                                    <label
                                        htmlFor="dce-upload"
                                        className={`flex flex-col items-center justify-center p-6 border-2 border-dashed border-[#0B1F38]/10 rounded-2xl hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all cursor-pointer ${isUploading ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                        {isUploading ? (
                                            <Loader2 size={24} className="animate-spin text-[#00A3E0] mb-2" />
                                        ) : (
                                            <UploadCloud size={24} className="text-[#0B1F38]/20 mb-2" />
                                        )}
                                        <span className="text-xs font-bold text-[#0B1F38]">
                                            {isUploading ? 'Envoi en cours...' : 'Ajouter une pièce au DCE'}
                                        </span>
                                        <span className="text-[10px] text-[#0B1F38]/40 mt-1">PDF, ZIP, DOCX (Max 50Mo)</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            {documents && documents.length > 0 ? (
                                documents.map((doc: any, i: number) => (
                                    <div key={doc.id || i} className="flex justify-between items-center p-4 bg-[#F8FAFC] border border-[#0B1F38]/5 rounded-2xl hover:border-[#00A3E0]/30 hover:bg-white transition-all group">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="p-2.5 bg-white rounded-xl border border-[#0B1F38]/5 text-[#00A3E0] shrink-0">
                                                <FileText size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                {/* Renommage en place. Le nom d'origine d'un fichier
                                                    d'acheteur est souvent illisible ; le corriger ne
                                                    déplace pas l'objet, seul le libellé change. */}
                                                {isOwner && !isLocked ? (
                                                    <input
                                                        defaultValue={doc.name}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onBlur={(e) => {
                                                            const nouveau = e.target.value.trim();
                                                            if (nouveau && nouveau !== doc.name) onMajPiece(doc.id, { name: nouveau });
                                                        }}
                                                        aria-label="Nom de la pièce"
                                                        className="text-sm font-bold text-[#0B1F38] block truncate w-full bg-transparent border border-transparent hover:border-[#0B1F38]/10 focus:border-[#00A3E0] focus:bg-white rounded px-1 -ml-1 focus:outline-none"
                                                    />
                                                ) : (
                                                    <span className="text-sm font-bold text-[#0B1F38] block truncate">{doc.name}</span>
                                                )}
                                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase flex items-center gap-1.5 flex-wrap mt-0.5">
                                                    {/* Retypage : la catégorie est devinée au dépôt,
                                                        elle se corrige ici. */}
                                                    {isOwner && !isLocked ? (
                                                        <select
                                                            value={doc.categorie || 'ANNEXE'}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => onMajPiece(doc.id, { categorie: e.target.value })}
                                                            aria-label="Type de pièce"
                                                            className="text-[10px] font-bold uppercase bg-[#00A3E0]/10 text-[#00A3E0] rounded px-1.5 py-0.5 border border-[#00A3E0]/20 focus:outline-none focus:ring-1 focus:ring-[#00A3E0]"
                                                        >
                                                            {CATEGORIES_DCE.map(c => (
                                                                <option key={c.value} value={c.value}>{c.value}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <span className="bg-[#00A3E0]/10 text-[#00A3E0] rounded px-1.5 py-0.5">{doc.categorie || 'ANNEXE'}</span>
                                                    )}
                                                    {(doc.version ?? 1) > 1 && (
                                                        /* Une pièce republiée doit se voir d'un coup d'œil :
                                                           c'est tout l'objet du versionnement. */
                                                        <span className="bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                                                            v{doc.version}
                                                        </span>
                                                    )}
                                                    {doc.type} &bull; {doc.size ? (doc.size / 1024 / 1024).toFixed(2) : '0'} Mo
                                                </span>
                                            </div>
                                            {/* Versions précédentes. Conservées et téléchargeables :
                                                un litige sur un marché se tranche souvent sur « quelle
                                                version faisait foi à telle date ». */}
                                            {(doc.historique || []).length > 0 && (
                                                <details className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                                                    <summary className="text-[10px] font-bold text-[#0B1F38]/40 cursor-pointer hover:text-[#00A3E0] list-none">
                                                        {doc.historique.length} version{doc.historique.length > 1 ? 's' : ''} précédente{doc.historique.length > 1 ? 's' : ''}
                                                    </summary>
                                                    <ul className="mt-1 space-y-0.5">
                                                        {doc.historique.map((v: any, vi: number) => (
                                                            <li key={vi} className="flex items-center gap-2 text-[10px] text-[#0B1F38]/50">
                                                                <span className="font-bold">v{v.version}</span>
                                                                <span className="truncate max-w-[180px]">{v.name}</span>
                                                                <span className="shrink-0">{v.uploaded_at ? new Date(v.uploaded_at).toLocaleDateString('fr-FR') : ''}</span>
                                                                <button
                                                                    onClick={() => onTelecharger(v.path, v.name || `version-${v.version}`)}
                                                                    className="text-[#00A3E0] hover:underline font-bold shrink-0"
                                                                >
                                                                    Télécharger
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </details>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-4">
                                            {/* Consultation sans téléchargement : critère de recette
                                                explicite. Le fichier s'ouvre dans un onglet, où le
                                                navigateur affiche nativement les PDF et les images. */}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onOuvrir(doc.path); }}
                                                className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all"
                                                title="Consulter"
                                            >
                                                <Eye size={16} />
                                            </button>
                                            {/* Download */}
                                            {/* Une URL publique ne résoudra plus rien une fois le
                                                bucket privé : l'URL signée est demandée au clic. */}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onTelecharger(doc.path, doc.name || 'document'); }}
                                                className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all"
                                                title="Télécharger"
                                            >
                                                <Download size={16} />
                                            </button>
                                            {/* Re-upload + Delete (owner only, unlocked) */}
                                            {isOwner && !isLocked && (
                                                <>
                                                    <label
                                                        htmlFor={`dce-replace-${doc.id}`}
                                                        className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all cursor-pointer"
                                                        title="Remplacer le fichier"
                                                    >
                                                        <RefreshCw size={16} />
                                                    </label>
                                                    <input
                                                        type="file"
                                                        id={`dce-replace-${doc.id}`}
                                                        className="hidden"
                                                        onChange={(e) => onRemplacer(e, doc)}
                                                        disabled={isUploading}
                                                    />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onSupprimer(doc); }}
                                                        className="p-2 text-[#0B1F38]/20 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                        title="Supprimer"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-10 bg-[#F8FAFC] rounded-2xl border-2 border-dashed border-[#0B1F38]/5">
                                    <p className="text-sm text-[#0B1F38]/40 italic">Aucun document importé pour le moment.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-between items-center shrink-0">
                        <div className="text-xs text-[#0B1F38]/40 font-medium">
                            Total : {documents?.length || 0} fichier{documents?.length > 1 ? 's' : ''} ({(documents?.reduce((acc: number, d: any) => acc + (d.size || 0), 0) / 1024 / 1024).toFixed(2)} Mo)
                        </div>
                        <button
                            // Ce bouton portait un gestionnaire VIDE (« Simplified
                            // download trigger or logic ») : il ne faisait rien, alors
                            // que celui de l'en-tête fonctionnait. On le branche sur la
                            // même action plutôt que de laisser un bouton mort.
                            onClick={onToutTelecharger}
                            disabled={zipEnCours || (documents || []).length === 0}
                            className="px-6 py-2.5 bg-[#0B1F38] text-white font-bold rounded-xl hover:bg-[#00A3E0] transition-all flex items-center gap-2"
                        >
                            <Download size={16} /> Tout télécharger (.zip)
                        </button>
                    </div>
                </div>
            </div>
        );
};

export const DCEPiecesModal = memo(DCEPiecesModalBase);
