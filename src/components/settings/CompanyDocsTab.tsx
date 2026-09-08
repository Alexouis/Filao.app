import React, { memo } from 'react';
import {
    Calendar as CalendarIcon, Download, FileText, FolderOpen, Loader2, Plus,
    Upload, X,
} from 'lucide-react';

/**
 * Onglet « Documents de candidature » de la fiche entreprise : coffre-fort des
 * pièces administratives, standard et personnalisées.
 *
 * POURQUOI CE FICHIER
 * Dernier gros bloc de `CompanyTab`, après la vue en consultation et le
 * formulaire d'édition.
 *
 * Il ne porte aucun état : tout — la saisie d'un nouveau libellé, la catégorie
 * en cours d'ajout, les dates d'expiration — reste au parent, parce que ses
 * gestionnaires d'enregistrement les relisent. Descendre ces états ici aurait
 * obligé à les faire remonter aussitôt.
 */
export interface CompanyDocsTabProps {
    /** Catégories et emplacements standard, définis par le parent. */
    docCategories: any[];
    standardDocSlots: any[];
    /** Champ en cours d'envoi (affiche le sélecteur en attente). */
    uploadingField: string | null;
    /** Catégorie dans laquelle un ajout est en cours, et son libellé saisi. */
    addingInCategory: any;
    setAddingInCategory: (categorie: any) => void;
    newDocLabel: string;
    setNewDocLabel: (valeur: string) => void;
    /** Dates d'expiration saisies pour les pièces standard. */
    standardDocExpiry: Record<string, string>;
    setStandardDocExpiry: React.Dispatch<React.SetStateAction<Record<string, string>>>;

    /** Champs de la fiche : les pièces standard y sont référencées par URL. */
    formData: Record<string, any>;
    /** Documents personnalisés, hors emplacements standard. */
    customDocs: any[];
    /** État de validité de chaque pièce (à jour, bientôt expirée, expirée). */
    docStatuses: Record<string, any>;
    /** Résout l'état affichable d'une pièce — la règle vit chez le parent. */
    computeEffectiveStatus: (entry: any) => any;
    /** Formatage d'une date, partagé avec le reste de l'onglet. */
    formatDate: (dateStr: string) => string;

    onOuvrirDocument: (chemin: string) => void;
    onTelechargerDocument: (chemin: string, nom: string) => void;

    onDeposerDocument: (e: React.ChangeEvent<HTMLInputElement>, champ: string, categorie?: any) => void;
    onAjouterDocPersonnalise: (e: React.ChangeEvent<HTMLInputElement>, categorie: any, libelle?: string) => void;
    onRedeposerDocPersonnalise: (e: React.ChangeEvent<HTMLInputElement>, doc: any) => void;
    onSupprimerDocPersonnalise: (doc: any) => void;
    onMajExpiration: (champ: string, doc?: any) => void;
}

const CompanyDocsTabBase: React.FC<CompanyDocsTabProps> = ({
    docCategories, standardDocSlots, uploadingField,
    addingInCategory, setAddingInCategory, newDocLabel, setNewDocLabel,
    standardDocExpiry, setStandardDocExpiry,
    formData, customDocs, docStatuses, computeEffectiveStatus, formatDate,
    onOuvrirDocument, onTelechargerDocument,
    onDeposerDocument, onAjouterDocPersonnalise, onRedeposerDocPersonnalise,
    onSupprimerDocPersonnalise, onMajExpiration,
}) => {
    return (
                <div className="flex flex-col h-full gap-3">
                    {/* Standard administrative docs banner */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                <FolderOpen size={14} />
                            </div>
                            <p className="text-xs font-semibold text-gray-800">Documents administratifs</p>
                            <span className="text-[10px] text-gray-400">·  Documents légaux obligatoires</span>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {standardDocSlots.map(slot => {
                                const url = formData[slot.field];
                                const status = url ? computeEffectiveStatus(docStatuses[slot.field]) : undefined;
                                const statusColor = status === 'valide' ? 'text-emerald-500' : status === 'expire' ? 'text-red-500' : status === 'en_attente' ? 'text-amber-500' : 'text-gray-300';
                                return (
                                    <div key={slot.field} className="space-y-1.5">
                                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{slot.label}</p>
                                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                            <FileText size={14} className={statusColor} />
                                            {/* `substring(0, 20)` coupait le nom sans ellipse, en plus
                                                du `truncate` CSS : « Attestation_vigilan » au lieu de
                                                « Attestation_vigilance_URSSAF_2026.pdf ». On laisse le
                                                CSS gérer, et le nom complet reste lisible au survol. */}
                                            {/* Le document n'était consultable nulle part : on pouvait
                                                le déposer et le remplacer, jamais le relire. L'URL signée
                                                est demandée au clic, elle n'est valable qu'une heure. */}
                                            {url ? (
                                                <>
                                                    <button
                                                        onClick={() => onOuvrirDocument(url)}
                                                        className="text-xs text-blue-600 flex-1 truncate text-left hover:underline"
                                                        title={`Ouvrir ${slot.label}`}
                                                    >
                                                        {/* Le nom stocké est canonique et sans extension
                                                            (« kbis ») : le libellé de l'emplacement est
                                                            plus parlant. */}
                                                        {slot.label}
                                                    </button>
                                                    {/* Téléchargement séparé : il rétablit une extension
                                                        déduite du type réel de l'objet, sans quoi le
                                                        fichier enregistré s'appellerait « kbis ». */}
                                                    <button
                                                        onClick={() => onTelechargerDocument(url, slot.label.replace(/[^\p{L}\p{N} _-]/gu, '').trim())}
                                                        title={`Télécharger ${slot.label}`}
                                                        aria-label={`Télécharger ${slot.label}`}
                                                        className="p-1 text-gray-400 hover:text-blue-600 shrink-0"
                                                    >
                                                        <Download size={12} />
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-xs text-gray-500 flex-1 truncate">Aucun fichier</span>
                                            )}
                                            <label className={`px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer transition-all shrink-0 ${uploadingField === slot.field ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                                                }`}>
                                                {uploadingField === slot.field ? <Loader2 size={12} className="animate-spin" /> : <><Upload size={10} className="inline mr-1" />{url ? 'Modifier' : 'Ajouter'}</>}
                                                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => onDeposerDocument(e, slot.field)} className="hidden" disabled={uploadingField === slot.field} />
                                            </label>
                                        </div>
                                        {/* Date d'expiration : seulement pour les documents qui en
                                            portent une (assurance). Les autres dérivent leur fraîcheur
                                            d'une durée conventionnelle, sans saisie. Visible une fois le
                                            document déposé. */}
                                        {slot.saisieExpiration && url && (
                                            <div className="flex items-center gap-1.5 px-1">
                                                <CalendarIcon size={11} className="text-gray-400 shrink-0" />
                                                <label className="text-[10px] text-gray-500 shrink-0">Expire le</label>
                                                <input
                                                    type="date"
                                                    value={standardDocExpiry[slot.field] || ''}
                                                    onChange={(e) => setStandardDocExpiry(prev => ({ ...prev, [slot.field]: e.target.value }))}
                                                    onBlur={() => onMajExpiration(slot.field)}
                                                    className="text-[10px] text-gray-700 bg-transparent border-b border-gray-200 focus:border-blue-400 focus:outline-none flex-1 min-w-0"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 3x2 Category cards grid (Library structure) */}
                    <div className="grid grid-cols-3 gap-3">
                        {docCategories.map((cat) => {
                            const catCustomDocs = customDocs.filter(d => d.categorie === cat.key);
                            const CatIcon = cat.icon;

                            return (
                                <div key={cat.key} className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col p-4">
                                    {/* Card header */}
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-7 h-7 rounded-lg bg-filao-primary/10 text-filao-primary flex items-center justify-center shrink-0">
                                            <CatIcon size={14} />
                                        </div>
                                        <p className="text-sm font-semibold text-gray-800">{cat.label}</p>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mb-3">{cat.description}</p>

                                    {/* Default document slots */}
                                    <div className="flex-1 space-y-3">
                                        {cat.defaultDocs.map(docLabel => {
                                            const matchingDoc = catCustomDocs.find(d => d.label === docLabel);
                                            return (
                                                <div key={docLabel}>
                                                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{docLabel}</p>
                                                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                                        <FileText size={14} className={matchingDoc ? 'text-emerald-500' : 'text-gray-300'} />
                                                        <span className="text-xs text-gray-500 flex-1 truncate" title={matchingDoc?.label}>
                                                            {matchingDoc ? matchingDoc.label : 'Aucun fichier'}
                                                        </span>
                                                        {matchingDoc ? (
                                                            <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 shrink-0 transition-all">
                                                                <Upload size={10} className="inline mr-1" />Modifier
                                                                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                                    onChange={(e) => onRedeposerDocPersonnalise(e, matchingDoc.id)} className="hidden" />
                                                            </label>
                                                        ) : (
                                                            <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 shrink-0 transition-all">
                                                                <Upload size={10} className="inline mr-1" />Ajouter
                                                                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                                    onChange={(e) => onAjouterDocPersonnalise(e, cat.key, docLabel)} className="hidden" />
                                                            </label>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* Extra custom docs added by user */}
                                        {catCustomDocs.filter(d => !cat.defaultDocs.includes(d.label)).map(doc => (
                                            <div key={doc.id}>
                                                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{doc.label}</p>
                                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 group">
                                                    <FileText size={14} className="text-emerald-500" />
                                                    <div className="flex-1 min-w-0 flex flex-col">
                                                        <span className="text-xs text-gray-700 truncate font-medium" title={doc.label}>{doc.label}</span>
                                                        {doc.created_at && (
                                                            <span className="text-[9px] text-gray-400">
                                                                Ajouté le {formatDate(doc.created_at)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 shrink-0 transition-all opacity-0 group-hover:opacity-100">
                                                        <Upload size={10} className="inline mr-1" />Modifier
                                                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                            onChange={(e) => onRedeposerDocPersonnalise(e, doc.id)} className="hidden" />
                                                    </label>
                                                    <button onClick={() => onSupprimerDocPersonnalise(doc.id)}
                                                        className="text-gray-300 hover:text-red-500 transition-colors p-1" title="Supprimer">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Pending Document Row (When adding) */}
                                    {
                                        addingInCategory === cat.key && (
                                            <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Nouveau document</p>
                                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                                    <FileText size={14} className="text-gray-300" />
                                                    <input type="text"
                                                        value={newDocLabel}
                                                        onChange={(e) => setNewDocLabel(e.target.value)}
                                                        placeholder={cat.placeholder || "Nom du document..."}
                                                        className="flex-1 bg-transparent border-none text-xs focus:ring-0 px-0 text-gray-700 placeholder:text-gray-400 font-medium"
                                                        autoFocus
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 shrink-0 transition-all flex items-center">
                                                            {uploadingField === 'custom_new' ? <Loader2 size={10} className="animate-spin mr-1" /> : <Upload size={10} className="inline mr-1" />}
                                                            {uploadingField === 'custom_new' ? '...' : 'Ajouter'}
                                                            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                                onChange={(e) => onAjouterDocPersonnalise(e, cat.key)} className="hidden" disabled={uploadingField === 'custom_new'} />
                                                        </label>
                                                        <button onClick={() => { setAddingInCategory(null); setNewDocLabel(''); }} className="text-gray-400 hover:text-gray-600 transition-colors p-1" title="Annuler">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    }

                                    {/* Add custom document footer button */}
                                    {
                                        !addingInCategory && (
                                            <div className="mt-3 pt-2 border-t border-gray-100">
                                                <button onClick={() => { setAddingInCategory(cat.key); setNewDocLabel(''); }}
                                                    className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-filao-primary transition-colors cursor-pointer">
                                                    <Plus size={14} /> Ajouter un document
                                                </button>
                                            </div>
                                        )
                                    }
                                </div>
                            );
                        })}
                    </div>
                </div>

    );
};

export const CompanyDocsTab = memo(CompanyDocsTabBase);
