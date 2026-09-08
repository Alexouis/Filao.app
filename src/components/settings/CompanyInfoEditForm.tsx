import React, { useState, memo } from 'react';
import {
    Briefcase, Building2, ChevronDown, Eye, EyeOff, Globe, Leaf, Loader2,
    ShieldCheck, Wrench,
} from 'lucide-react';
import { SpecialtyAccordion } from '../ui/SpecialtyAccordion';

/**
 * Styles de champ partagés avec le reste de l'onglet. Repris à l'identique
 * plutôt que passés en props : ce sont des constantes d'apparence, pas des
 * données.
 */
const inputClass = "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary/30 transition-colors";
const lockedInputClass = "w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-600 text-sm cursor-not-allowed";
import { SettingsCard } from './SettingsCard';

/**
 * Fiche entreprise en ÉDITION : identité, localisation, compétences,
 * visibilité dans le réseau.
 *
 * POURQUOI CE FICHIER
 * Pendant du `CompanyInfoReadOnly`, extrait du même `CompanyTab`. Contrairement
 * à la vue en consultation, ce formulaire ÉCRIT : il reçoit donc les setters
 * du parent, qui reste seul détenteur de l'état de la fiche.
 *
 * Seul `expandedThematic` — l'accordéon des thématiques d'expertise — descend
 * ici : c'est un état purement visuel, qui ne concerne que ce formulaire, et
 * le laisser dans le parent faisait re-rendre tout l'onglet à chaque
 * dépliement.
 */
export interface CompanyInfoEditFormProps {
    formData: Record<string, any>;
    entrepriseData?: { id?: string } | null;
    onChangerChamp: (e: React.ChangeEvent<any>) => void;

    /** Référentiels de compétences, chargés par le parent. */
    refDomains: any[];
    refSpecialties: any[];
    refExpertiseTags: any[];
    refGeoZones: any[];

    /** Sélections courantes, et leurs setters : l'état reste au parent. */
    selectedNatures: string[];
    setSelectedNatures: React.Dispatch<React.SetStateAction<string[]>>;
    selectedDomains: string[];
    setSelectedDomains: React.Dispatch<React.SetStateAction<string[]>>;
    selectedSpecialties: any[];
    setSelectedSpecialties: React.Dispatch<React.SetStateAction<any[]>>;
    selectedExpertiseTags: any[];
    setSelectedExpertiseTags: React.Dispatch<React.SetStateAction<any[]>>;
    selectedGeoZones: any[];
    setSelectedGeoZones: React.Dispatch<React.SetStateAction<any[]>>;

    /**
     * Champs verrouillés : données rapportées par le SIRET, non modifiables à
     * la main. Les rendre éditables laisserait diverger la fiche de la source
     * officielle.
     */
    fieldsLocked: boolean;
    /** Référentiels de compétences en cours de chargement. */
    loadingRef: boolean;
    visibleDansReseau: boolean;
    savingReseau: boolean;
    onBasculerReseau: () => void;
}

const CompanyInfoEditFormBase: React.FC<CompanyInfoEditFormProps> = ({
    formData, entrepriseData, onChangerChamp,
    refDomains, refSpecialties, refExpertiseTags, refGeoZones,
    selectedNatures, setSelectedNatures,
    selectedDomains, setSelectedDomains,
    selectedSpecialties, setSelectedSpecialties,
    selectedExpertiseTags, setSelectedExpertiseTags,
    selectedGeoZones, setSelectedGeoZones,
    fieldsLocked, loadingRef, visibleDansReseau, savingReseau, onBasculerReseau,
}) => {
    // Accordéon des thématiques : état d'affichage, local par nature.
    const [expandedThematic, setExpandedThematic] = useState<string | null>(null);

    return (
                        <div className="space-y-3">
                            <SettingsCard title="Identité & Localisation" icon={Building2}>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                    <div className="col-span-2">
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Nom de l'entreprise</label>
                                        <input type="text" value={formData.nom} onChange={(e) => onChangerChamp('nom', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="Ex: Filao SAS" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">SIRET</label>
                                        <input type="text" value={formData.siret} className={lockedInputClass} disabled placeholder="Via recherche" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Effectif</label>
                                        <input type="number" value={formData.effectif} onChange={(e) => onChangerChamp('effectif', e.target.value)}
                                            className={inputClass} placeholder="1" min="1" />
                                    </div>

                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Prénom (Dirigeant)</label>
                                        <input type="text" value={formData.prenom} onChange={(e) => onChangerChamp('prenom', e.target.value)}
                                            className={inputClass} placeholder="Prénom" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Nom (Dirigeant)</label>
                                        <input type="text" value={formData.nom_famille} onChange={(e) => onChangerChamp('nom_famille', e.target.value)}
                                            className={inputClass} placeholder="Nom" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Forme juridique</label>
                                        <input type="text" value={formData.forme_juridique} onChange={(e) => onChangerChamp('forme_juridique', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="SAS, SARL..." />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Taille</label>
                                        <select value={formData.taille} onChange={(e) => onChangerChamp('taille', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked}>
                                            <option value="">Taille</option>
                                            <option value="Micro/TPE">Micro/TPE</option>
                                            <option value="PME">PME</option>
                                            <option value="ETI">ETI</option>
                                            <option value="GE">GE</option>
                                        </select>
                                    </div>

                                    <div className="col-span-2">
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Code NAF</label>
                                        <input type="text" value={formData.code_naf} onChange={(e) => onChangerChamp('code_naf', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="62.01Z" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Activité (NAF)</label>
                                        <input type="text" value={formData.libelle_naf} onChange={(e) => onChangerChamp('libelle_naf', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="Libellé de l'activité" />
                                    </div>

                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-2 mt-1">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                            <div className="col-span-2">
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Adresse</label>
                                                <input type="text" value={formData.adresse} onChange={(e) => onChangerChamp('adresse', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="Ex: 15 Rue des Capucines" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Ville</label>
                                                <input type="text" value={formData.ville} onChange={(e) => onChangerChamp('ville', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Code Postal</label>
                                                <input type="text" value={formData.code_postal} onChange={(e) => onChangerChamp('code_postal', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-2 mt-1">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Date de création</label>
                                                <input type="text" value={formData.date_creation} onChange={(e) => onChangerChamp('date_creation', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="AAAA-MM-JJ" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">N° TVA</label>
                                                <input type="text" value={formData.tva} onChange={(e) => onChangerChamp('tva', e.target.value)} className={inputClass} placeholder="FR..." />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Site web</label>
                                                <input type="url" value={formData.site_web} onChange={(e) => onChangerChamp('site_web', e.target.value)} className={inputClass} placeholder="https://www.exemple.fr" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Zone d'intervention — Premium Grid */}
                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-4 mt-2">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <label className="text-sm font-bold text-gray-900">Zone d'intervention</label>
                                                <p className="text-xs text-gray-400">Sélectionnez vos régions d'activité (Métropole & DOM-TOM)</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const metroIds = refGeoZones.filter(z => z.zone_type === 'metropole').map(z => z.id);
                                                    const alreadyHasAll = metroIds.every(id => selectedGeoZones.includes(id));
                                                    if (alreadyHasAll) {
                                                        setSelectedGeoZones(prev => prev.filter(id => !metroIds.includes(id)));
                                                    } else {
                                                        setSelectedGeoZones(prev => Array.from(new Set([...prev, ...metroIds])));
                                                    }
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                    refGeoZones.filter(z => z.zone_type === 'metropole').length > 0 && 
                                                    refGeoZones.filter(z => z.zone_type === 'metropole').every(z => selectedGeoZones.includes(z.id))
                                                        ? 'bg-filao-primary text-white border-filao-primary shadow-sm'
                                                        : 'bg-white text-filao-primary border-filao-primary/20 hover:border-filao-primary/50'
                                                }`}
                                            >
                                                France Entière
                                            </button>
                                        </div>

                                        <div className="space-y-4">
                                            {/* Metropole Grid */}
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                                {refGeoZones.filter(z => z.zone_type === 'metropole').map(zone => (
                                                    <button
                                                        key={zone.id}
                                                        type="button"
                                                        onClick={() => setSelectedGeoZones(prev => prev.includes(zone.id) ? prev.filter(id => id !== zone.id) : [...prev, zone.id])}
                                                        className={`px-3 py-2 rounded-xl text-left transition-all border ${
                                                            selectedGeoZones.includes(zone.id)
                                                                ? 'bg-filao-primary/5 border-filao-primary text-filao-primary ring-1 ring-filao-primary/20'
                                                                : 'bg-white border-gray-100 text-gray-600 hover:border-gray-300'
                                                        }`}
                                                    >
                                                        <p className="text-[11px] font-bold truncate leading-tight" title={zone.label}>{zone.label}</p>
                                                    </button>
                                                ))}
                                            </div>

                                            {/* DOM-TOM Section */}
                                            {refGeoZones.some(z => z.zone_type === 'domtom') && (
                                                <div className="bg-gray-50/50 rounded-xl p-3 border border-gray-100">
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Départements d'Outre-mer</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {refGeoZones.filter(z => z.zone_type === 'domtom').map(zone => (
                                                            <button
                                                                key={zone.id}
                                                                type="button"
                                                                onClick={() => setSelectedGeoZones(prev => prev.includes(zone.id) ? prev.filter(id => id !== zone.id) : [...prev, zone.id])}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                                                    selectedGeoZones.includes(zone.id)
                                                                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                                                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                                                                }`}
                                                            >
                                                                {zone.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expertises & Qualifications — Accordion Select */}
                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-4 mt-2">
                                        <label className="text-sm font-bold text-gray-900 mb-1 block">Expertises & Qualifications</label>
                                        <p className="text-xs text-gray-400 mb-4">Ciblez vos compétences transversales et certifications.</p>

                                        <div className="space-y-2">
                                            {[
                                                { key: 'environnement', label: 'Approches environnementales & énergétiques', icon: Leaf },
                                                { key: 'contexte', label: 'Contextes d\'intervention', icon: Map },
                                                { key: 'methodologie', label: 'Méthodologies & outils', icon: Wrench },
                                                { key: 'certification', label: 'Certifications & labels', icon: ShieldCheck }
                                            ].map((thematic) => (
                                                <div key={thematic.key} className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedThematic(prev => prev === thematic.key ? null : thematic.key)}
                                                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center">
                                                                <thematic.icon size={16} />
                                                            </div>
                                                            <div className="text-left">
                                                                <p className="text-[13px] font-bold text-gray-800">{thematic.label}</p>
                                                                <p className="text-[10px] text-gray-400">
                                                                    {selectedExpertiseTags.filter(id => refExpertiseTags.find(t => t.id === id)?.thematic === thematic.key).length} sélectionné(s)
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <ChevronDown className={`text-gray-400 transition-transform duration-300 ${expandedThematic === thematic.key ? 'rotate-180' : ''}`} size={16} />
                                                    </button>

                                                    {expandedThematic === thematic.key && (
                                                        <div className="p-4 bg-gray-50/30 border-t border-gray-50">
                                                            <div className="flex flex-wrap gap-2">
                                                                {refExpertiseTags.filter(t => t.thematic === thematic.key).map(tag => (
                                                                    <button
                                                                        key={tag.id}
                                                                        type="button"
                                                                        onClick={() => setSelectedExpertiseTags(prev => prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                                            selectedExpertiseTags.includes(tag.id)
                                                                                ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                                                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                                                                        }`}
                                                                    >
                                                                        {tag.label}
                                                                    </button>
                                                                ))}
                                                                {refExpertiseTags.filter(t => t.thematic === thematic.key).length === 0 && (
                                                                    <p className="text-xs text-gray-400 italic">Aucun tag disponible pour cette thématique.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                            
                            </div>
                            </SettingsCard>

                            <SettingsCard
                                title="Activités & Spécialités"
                                description="Définissez votre nature d'activité, vos domaines d'intervention et vos spécialités pour un meilleur matching."
                                icon={Briefcase}
                            >
                                {loadingRef ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                                        <Loader2 className="w-8 h-8 text-filao-primary animate-spin" />
                                        <p className="text-sm text-gray-400 font-medium">Chargement de la taxonomie...</p>
                                    </div>
                                ) : (
                                    <div>{/* En édition, les spécialités sont toujours modifiables. */}
                                        <SpecialtyAccordion
                                            selectedNatures={selectedNatures}
                                            onNaturesChange={setSelectedNatures}
                                            selectedDomains={selectedDomains}
                                            onDomainsChange={setSelectedDomains}
                                            selectedSpecialties={selectedSpecialties}
                                            onSpecialtiesChange={setSelectedSpecialties}
                                            refDomains={refDomains}
                                            refSpecialties={refSpecialties}
                                        />
                                        {/* Le message « Activez le mode édition pour modifier vos
                                            spécialités » a été retiré : il était conditionné à
                                            `!isEditing`, donc jamais affiché dans ce formulaire —
                                            qui EST le mode édition. */}
                                    </div>
                                )}
                            </SettingsCard>

                            {/* Réseau Filao — also in edit mode */}
                            <SettingsCard title="Réseau Filao" icon={Globe}>
                                <div className="space-y-3">
                                    <p className="text-xs text-gray-500">
                                        Rendez votre entreprise visible dans l'annuaire Filao. Les autres entreprises pourront vous trouver et vous inviter à collaborer sur des appels d'offres.
                                    </p>
                                    <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            {visibleDansReseau ? <Eye size={16} className="text-emerald-600" /> : <EyeOff size={16} className="text-gray-400" />}
                                            <span className="text-sm font-medium text-gray-900">
                                                {visibleDansReseau ? 'Visible sur le réseau' : 'Masqué du réseau'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={onBasculerReseau}
                                            disabled={savingReseau || !entrepriseData?.id}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${visibleDansReseau ? 'bg-emerald-500' : 'bg-gray-300'} ${savingReseau ? 'opacity-50' : ''}`}
                                            role="switch" aria-checked={visibleDansReseau}>
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${visibleDansReseau ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    </div>
                                    {!entrepriseData?.id && (
                                        <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">Enregistrez d'abord votre entreprise pour activer cette option.</p>
                                    )}
                                </div>
                            </SettingsCard>
                        </div>

    );
};

export const CompanyInfoEditForm = memo(CompanyInfoEditFormBase);
