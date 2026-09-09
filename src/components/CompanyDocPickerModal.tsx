import React, { useEffect, useState, useMemo } from 'react';
import { X, Search, ShieldAlert, FileText, ArrowRight, Loader2 } from 'lucide-react';
import { useModale } from '../helpers/useModale';

/**
 * Reprise d'une pièce déjà déposée au niveau de l'entreprise.
 *
 * Évite de re-téléverser une attestation d'assurance ou un extrait Kbis à
 * chaque dossier : on pointe celle qui est déjà en fiche entreprise, et la
 * copie est faite côté serveur.
 *
 * DEUX RÉGLAGES À NE PAS DÉFAIRE
 *
 * 1. `z-[130]`. Ce sélecteur s'ouvre DEPUIS la modale « détail membre »
 *    (z-[100]) et depuis la coordination documentaire (z-[60]). En z-[70] il
 *    passait derrière la première, donc invisible au moment précis où on
 *    venait de le demander. Il doit dominer toute modale susceptible de
 *    l'ouvrir.
 *
 * 2. Un document légal sans URL reste AFFICHÉ, désactivé, avec la mention
 *    « non renseigné ». Le masquer donnerait l'impression que la pièce n'est
 *    pas attendue, alors qu'elle manque en fiche entreprise — le seul endroit
 *    où l'utilisateur peut la corriger.
 *
 * Composant de présentation : la copie du fichier reste dans `TenderWizard`.
 */
export interface DocumentEntreprise {
    id: string;
    label: string;
    url: string;
    categorie?: string;
}

export interface CompanyDocPickerModalProps {
    ouvert: boolean;
    /** Pièces légales obligatoires, par libellé. `null` = chargement en cours. */
    documentsLegaux: Record<string, string | null | undefined> | null;
    documentsPersonnalises: DocumentEntreprise[];
    /** Une copie est en cours : on fige toute la liste. */
    copieEnCours?: boolean;
    /** Libellé de la pièce en cours de copie, pour n'animer que sa ligne. */
    libelleEnCours?: string | null;
    onChoisir: (url: string, libelle: string) => void;
    onFermer: () => void;
}

/**
 * Filtre des documents personnalisés : libellé ou catégorie.
 *
 * La catégorie est incluse à dessein — on cherche souvent « urbanisme » ou
 * « qualification » sans se rappeler l'intitulé exact du fichier.
 */
export const filtrerDocuments = (
    documents: DocumentEntreprise[],
    recherche: string
): DocumentEntreprise[] => {
    const terme = recherche.trim().toLowerCase();
    if (!terme) return documents;
    return documents.filter((d) =>
        d.label?.toLowerCase().includes(terme) ||
        d.categorie?.toLowerCase().includes(terme)
    );
};

export const CompanyDocPickerModal: React.FC<CompanyDocPickerModalProps> = ({
    ouvert, documentsLegaux, documentsPersonnalises, copieEnCours = false,
    libelleEnCours, onChoisir, onFermer,
}) => {
    const refModale = useModale(ouvert, onFermer);
    const [recherche, setRecherche] = useState('');

    // Repart d'une recherche vierge à chaque ouverture : sans cela, un filtre
    // laissé en place masquait les documents à la visite suivante, et l'on
    // concluait que la fiche entreprise était vide.
    useEffect(() => {
        if (ouvert) setRecherche('');
    }, [ouvert]);

    const visibles = useMemo(
        () => filtrerDocuments(documentsPersonnalises, recherche),
        [documentsPersonnalises, recherche]
    );

    if (!ouvert) return null;

    const fermer = () => { setRecherche(''); onFermer(); };

    return (
        <div
            className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-[#0B1F38]/60 backdrop-blur-md animate-in fade-in duration-200"
            onClick={(e) => { if (e.target === e.currentTarget) fermer(); }}
        >
            <div
                ref={refModale as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-label="Documents de l'entreprise"
                className="bg-white rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden"
            >
                <div className="p-6 border-b border-[#0B1F38]/10 flex justify-between items-center shrink-0">
                    <div>
                        <h3 className="text-xl font-bold text-[#0B1F38]">Documents de l'entreprise</h3>
                        <p className="text-sm text-[#0B1F38]/60">Sélectionnez un document à importer</p>
                    </div>
                    <button
                        onClick={fermer}
                        aria-label="Fermer"
                        className="p-2 hover:bg-[#0B1F38]/5 rounded-full text-[#0B1F38]/40 hover:text-[#0B1F38]"
                    >
                        <X size={24} aria-hidden="true" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar-dark space-y-6">
                    <section>
                        <h4 className="text-xs font-bold text-[#0B1F38]/40 uppercase tracking-widest mb-3">
                            Documents légaux obligatoires
                        </h4>
                        <div className="space-y-2">
                            {documentsLegaux ? Object.entries(documentsLegaux).map(([libelle, url]) => (
                                <button
                                    key={libelle}
                                    disabled={!url || copieEnCours}
                                    onClick={() => url && onChoisir(url, libelle)}
                                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${url ? 'hover:bg-gray-50 border-gray-100' : 'opacity-40 cursor-not-allowed border-dashed bg-gray-50/50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-[#00A3E0]/5 text-[#00A3E0] rounded-lg">
                                            <ShieldAlert size={18} aria-hidden="true" />
                                        </div>
                                        <span className="text-sm font-bold text-[#0B1F38]">{libelle}</span>
                                    </div>
                                    {copieEnCours && libelleEnCours === libelle ? (
                                        <Loader2 size={16} className="animate-spin text-[#00A3E0]" aria-hidden="true" />
                                    ) : url ? (
                                        <ArrowRight size={16} className="text-[#0B1F38]/20" aria-hidden="true" />
                                    ) : (
                                        <span className="text-[10px] font-bold text-[#0B1F38]/30 italic uppercase">
                                            Non renseigné
                                        </span>
                                    )}
                                </button>
                            )) : (
                                <div className="flex justify-center p-4">
                                    <Loader2 size={24} className="animate-spin text-[#00A3E0]/40" aria-hidden="true" />
                                </div>
                            )}
                        </div>
                    </section>

                    <section>
                        <h4 className="text-xs font-bold text-[#0B1F38]/40 uppercase tracking-widest mb-3">
                            Autres documents
                        </h4>
                        {documentsPersonnalises.length > 0 && (
                            <div className="relative mb-3">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/30 pointer-events-none" aria-hidden="true" />
                                <input
                                    type="text"
                                    placeholder="Rechercher..."
                                    aria-label="Rechercher un document"
                                    value={recherche}
                                    onChange={(e) => setRecherche(e.target.value)}
                                    className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#00A3E0] focus:border-[#00A3E0] transition-colors"
                                />
                            </div>
                        )}
                        <div className="space-y-2">
                            {visibles.length > 0 ? visibles.map((doc) => (
                                <button
                                    key={doc.id}
                                    disabled={copieEnCours}
                                    onClick={() => onChoisir(doc.url, doc.label)}
                                    className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-all text-left"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-gray-100 text-[#0B1F38]/40 rounded-lg">
                                            <FileText size={18} aria-hidden="true" />
                                        </div>
                                        <div>
                                            <span className="text-sm font-bold text-[#0B1F38] block leading-tight">{doc.label}</span>
                                            <span className="text-[10px] text-[#0B1F38]/40 italic">{doc.categorie || 'Autres'}</span>
                                        </div>
                                    </div>
                                    <ArrowRight size={16} className="text-[#0B1F38]/20" aria-hidden="true" />
                                </button>
                            )) : documentsLegaux && (
                                <p className="text-center text-[#0B1F38]/30 text-xs italic py-4">
                                    {recherche
                                        ? 'Aucun document ne correspond à cette recherche.'
                                        : 'Aucun document personnalisé trouvé.'}
                                </p>
                            )}
                        </div>
                    </section>
                </div>

                <div className="p-4 border-t border-[#0B1F38]/10 bg-gray-50/50 shrink-0">
                    <button
                        onClick={fermer}
                        className="w-full py-3 bg-[#0B1F38] text-white font-bold text-sm rounded-xl hover:bg-[#0B1F38]/90 transition-all"
                    >
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
};
