import React, { useState, useEffect, useRef, memo } from 'react';
import { Target, X, Search, CheckCircle, Plus, Loader2 } from 'lucide-react';

/**
 * Modale « Compétences requises ».
 *
 * POURQUOI CE FICHIER EXISTE
 * Extraite de `TenderWizard` (7 000+ lignes) où elle vivait sous forme de
 * `renderSkillsModal()`. Sa zone de recherche, son menu déroulant et son filtre
 * de nature s'appuyaient sur des états déclarés dans le PARENT : chaque
 * caractère tapé dans la recherche re-rendait donc tout le wizard.
 *
 * CE QUI CHANGE
 *  - Composant autonome et mémoïsé (`memo`).
 *  - Les trois états purement visuels (recherche, ouverture du menu, filtre de
 *    nature) et le `ref` de fermeture au clic extérieur descendent ICI : ils ne
 *    concernaient que cette modale et n'avaient rien à faire dans le parent.
 *
 * CE QUI NE CHANGE PAS — VOLONTAIREMENT
 * La sélection des spécialités continue d'écrire dans le `formData` du parent
 * via `onAjouter` / `onRetirer`, et l'enregistrement passe par `onValider`.
 * `saveRequiredSkills` lit `formData` directement : lui faire prendre un
 * brouillon local aurait demandé de modifier aussi la sauvegarde, pour un gain
 * nul — on ne tape pas dans cette liste, on clique. Le coût de rendu était dans
 * la recherche, et il est traité.
 */

interface Specialite {
    id: string;
    label: string;
    domain_id: string;
}

interface Domaine {
    id: string;
    label: string;
    natures: string[];
}

export interface SkillsModalProps {
    ouvert: boolean;
    /** Spécialités déjà retenues pour le dossier. */
    specialitesRetenues: string[];
    /** Référentiels chargés par le parent. */
    refSpecialties: Specialite[];
    refDomains: Domaine[];
    /** Chargement du référentiel en cours. */
    loadingRef: boolean;
    /** Enregistrement en cours. */
    loading: boolean;
    /** Codes CPV de l'avis, source des suggestions. */
    cpvCodes: string[];
    /** Domaines probables déduits des codes CPV. */
    suggererDomainesDepuisCpv: (codes: string[]) => string[];
    onAjouter: (s: { id: string; label: string }) => void;
    onRetirer: (specialiteId: string) => void;
    onFermer: () => void;
    onValider: () => void;
}

const NATURES = [
    { id: 'travaux', label: 'Travaux' },
    { id: 'services', label: 'Services' },
    { id: 'fournitures', label: 'Fournitures' },
];

const SkillsModalBase: React.FC<SkillsModalProps> = ({
    ouvert, specialitesRetenues, refSpecialties, refDomains, loadingRef, loading,
    cpvCodes, suggererDomainesDepuisCpv,
    onAjouter, onRetirer, onFermer, onValider,
}) => {
    // État purement visuel, local à la modale.
    const [selectedNature, setSelectedNature] = useState<string | null>(null);
    const [skillQuery, setSkillQuery] = useState('');
    const [dropOpen, setDropOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    // Ferme le menu déroulant au clic à l'extérieur du champ de recherche.
    useEffect(() => {
        const auClic = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setDropOpen(false);
            }
        };
        document.addEventListener('mousedown', auClic);
        return () => document.removeEventListener('mousedown', auClic);
    }, []);

    // Repart d'une recherche vierge à chaque ouverture.
    useEffect(() => {
        if (ouvert) {
            setSkillQuery('');
            setDropOpen(false);
            setSelectedNature(null);
        }
    }, [ouvert]);

    if (!ouvert) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={onFermer}></div>
            <div className="relative bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="p-3 border-b border-[#0B1F38]/5 flex justify-between items-center bg-[#0B1F38]/2 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0]">
                            <Target size={16} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-[#0B1F38]">Compétences requises</h3>
                            <p className="text-[9px] text-[#0B1F38]/50">Définissez les spécialités d'expertises</p>
                        </div>
                    </div>
                    <button onClick={onFermer} className="p-1.5 hover:bg-[#0B1F38]/5 rounded-lg transition-colors">
                        <X size={16} className="text-[#0B1F38]/40" />
                    </button>
                </div>

                {/* Content */}
                <div className="px-4 py-2.5 overflow-y-auto custom-scrollbar-dark flex-1">
                    {/* Nature Filter */}
                    <div className="flex gap-1 mb-2.5 overflow-x-auto pb-1 custom-scrollbar-horizontal">
                        {NATURES.map(n => (
                            <button
                                key={n.id}
                                onClick={() => setSelectedNature(selectedNature === n.id ? null : n.id)}
                                className={`px-2.5 py-1 rounded-full text-[9px] font-bold transition-all border ${selectedNature === n.id ? 'bg-[#00A3E0] text-white border-[#00A3E0]' : 'bg-white text-[#0B1F38]/40 border-[#0B1F38]/10 hover:border-[#00A3E0]/30'}`}
                            >
                                {n.label}
                            </button>
                        ))}
                    </div>

                    {/* Search Input */}
                    <div className="relative mb-2.5" ref={searchRef}>
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/30" />
                        <input
                            type="text"
                            value={skillQuery}
                            onChange={(e) => { setSkillQuery(e.target.value); setDropOpen(true); }}
                            onFocus={() => setDropOpen(true)}
                            placeholder={loadingRef ? "Chargement..." : "Rechercher une spécialité..."}
                            className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#0B1F38]/10 bg-[#F8FAFC] focus:bg-white focus:ring-2 focus:ring-[#00A3E0] outline-none transition-all text-[11px] font-bold text-[#0B1F38]"
                        />

                        {dropOpen && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#0B1F38]/10 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto custom-scrollbar-dark ring-4 ring-[#0B1F38]/2">
                                {(() => {
                                    const domainesSuggeres = suggererDomainesDepuisCpv(cpvCodes);
                                    const rangDe = (domainId: string) => {
                                        const i = domainesSuggeres.indexOf(domainId);
                                        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
                                    };

                                    const filteredSpecs = refSpecialties
                                        .filter(s => {
                                            const domain = refDomains.find(d => d.id === s.domain_id);
                                            if (selectedNature && (!domain || !domain.natures.includes(selectedNature))) return false;
                                            if (!skillQuery) return true;
                                            return s.label.toLowerCase().includes(skillQuery.toLowerCase()) ||
                                                (domain && domain.label.toLowerCase().includes(skillQuery.toLowerCase()));
                                        })
                                        // Tri avant troncature : sans cela, la limite de 50 rognait
                                        // les domaines suggérés au profit de l'ordre alphabétique.
                                        .sort((a, b) => rangDe(a.domain_id) - rangDe(b.domain_id))
                                        .slice(0, 50);

                                    if (filteredSpecs.length === 0) {
                                        return (
                                            <div className="p-6 text-center text-xs text-[#0B1F38]/40 italic">
                                                Aucun résultat {selectedNature ? `pour ${selectedNature}` : ""}
                                            </div>
                                        );
                                    }

                                    // Groupement par domaine, domaines suggérés par les CPV en tête.
                                    const grouped: Record<string, typeof filteredSpecs> = {};
                                    const rangDomaine: Record<string, number> = {};
                                    filteredSpecs.forEach(s => {
                                        const d = refDomains.find(rd => rd.id === s.domain_id);
                                        const dName = d ? d.label : "Autre";
                                        if (!grouped[dName]) {
                                            grouped[dName] = [];
                                            const idx = d ? domainesSuggeres.indexOf(d.id) : -1;
                                            rangDomaine[dName] = idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
                                        }
                                        grouped[dName].push(s);
                                    });

                                    return Object.entries(grouped)
                                        .sort(([a], [b]) => rangDomaine[a] - rangDomaine[b])
                                        .map(([domainName, specs]) => (
                                        <div key={domainName}>
                                            <div className="px-3 py-1.5 bg-[#F8FAFC] text-[9px] font-bold text-[#0B1F38]/30 uppercase tracking-widest border-y border-[#0B1F38]/5 flex items-center justify-between gap-2">
                                                <span>{domainName}</span>
                                                {rangDomaine[domainName] !== Number.MAX_SAFE_INTEGER && (
                                                    <span className="text-[#00A3E0] shrink-0" title="Domaine suggéré d'après les codes CPV de l'avis">
                                                        suggéré
                                                    </span>
                                                )}
                                            </div>
                                            {specs.map(s => {
                                                const isSelected = specialitesRetenues?.includes(s.id);
                                                return (
                                                    <button
                                                        key={s.id}
                                                        disabled={isSelected}
                                                        onClick={() => onAjouter(s)}
                                                        className={`w-full text-left px-3 py-2 text-[11px] font-bold flex items-center justify-between hover:bg-[#00A3E0]/5 transition-colors ${isSelected ? 'opacity-40 cursor-default' : 'text-[#0B1F38]'}`}
                                                    >
                                                        {s.label}
                                                        {isSelected && <CheckCircle size={12} className="text-[#00A3E0]" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                    </div>

                    {/* Suggestions issues des codes CPV de l'avis.
                        Volontairement non présélectionnées : un CPV décrit l'objet
                        du marché, pas les compétences attendues. Les écrire d'office
                        polluerait reponses_ao_specialties et fausserait le score de
                        couverture, qui se calcule sur required_specialty_ids. */}
                    {(() => {
                        const domaines = suggererDomainesDepuisCpv(cpvCodes).slice(0, 2);
                        if (domaines.length === 0) return null;

                        const proposees = refSpecialties
                            .filter(s => domaines.includes(s.domain_id))
                            .filter(s => !specialitesRetenues?.includes(s.id))
                            .filter(s => {
                                if (!selectedNature) return true;
                                const d = refDomains.find(rd => rd.id === s.domain_id);
                                return d?.natures.includes(selectedNature);
                            })
                            // Les domaines les plus probables d'abord, comme dans le sélecteur.
                            .sort((a, b) => domaines.indexOf(a.domain_id) - domaines.indexOf(b.domain_id))
                            .slice(0, 8);

                        if (proposees.length === 0) return null;

                        return (
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[9px] font-bold text-[#0B1F38]/30 uppercase tracking-wider">
                                        Suggéré d'après les codes CPV
                                    </p>
                                    <button
                                        onClick={() => proposees.forEach(onAjouter)}
                                        className="text-[9px] font-bold text-[#00A3E0] hover:underline shrink-0"
                                    >
                                        Tout ajouter
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {proposees.map(s => {
                                        const domaine = refDomains.find(rd => rd.id === s.domain_id);
                                        return (
                                            <button
                                                key={s.id}
                                                onClick={() => onAjouter(s)}
                                                title={domaine ? `${domaine.label} — ajouter` : 'Ajouter'}
                                                aria-label={`Ajouter la spécialité ${s.label}`}
                                                className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-[#00A3E0]/40 text-[10px] font-bold text-[#0B1F38]/60 hover:bg-[#00A3E0]/5 hover:text-[#00A3E0] hover:border-solid transition-all"
                                            >
                                                <Plus size={10} /> {s.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Selected Skills List */}
                    <div className="space-y-1.5">
                        <p className="text-[9px] font-bold text-[#0B1F38]/30 uppercase tracking-wider mb-1">Spécialités sélectionnées ({specialitesRetenues.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                            {specialitesRetenues.map(sid => {
                                const spec = refSpecialties.find(s => s.id === sid);
                                if (!spec) return null;
                                return (
                                    <div key={sid} className="bg-[#00A3E0]/10 text-[#00A3E0] px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5 group">
                                        {spec.label}
                                        <button
                                            onClick={() => onRetirer(sid)}
                                            className="p-0.5 hover:bg-[#00A3E0]/20 rounded transition-colors"
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                );
                            })}
                            {specialitesRetenues.length === 0 && (
                                <p className="text-xs text-[#0B1F38]/40 italic p-3 bg-[#F8FAFC] rounded-xl w-full text-center">
                                    Aucune compétence sélectionnée.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-3 py-2 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                    <button
                        onClick={onValider}
                        className="px-4 py-1.5 bg-[#0B1F38] text-white font-bold text-xs rounded-lg hover:bg-[#00A3E0] transition-all shadow-md min-w-[80px]"
                    >
                        {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Valider"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const SkillsModal = memo(SkillsModalBase);
