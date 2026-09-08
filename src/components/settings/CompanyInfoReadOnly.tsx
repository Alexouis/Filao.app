import React, { memo } from 'react';
import {
    Briefcase, Building2, Calendar as CalendarIcon, Eye, EyeOff, Globe, Hash,
    Loader2, MapPin, ShieldCheck, Upload,
} from 'lucide-react';
import { SettingsCard } from './SettingsCard';
import { InfoItem } from './CompanyInfoAtoms';

/**
 * Fiche entreprise en consultation : identité, localisation, activité, logo,
 * visibilité dans le réseau.
 *
 * POURQUOI CE FICHIER
 * `CompanyTab` faisait 2 093 lignes, dont ~170 pour cette seule vue. Elle
 * n'affiche que des valeurs déjà chargées et ne porte aucun état : la sortir
 * ne demande que de nommer ce dont elle a besoin.
 *
 * Elle ne s'affiche que pour une entreprise VÉRIFIÉE (données issues d'une
 * recherche SIRET) et hors édition — c'est l'appelant qui en décide, la
 * condition reste chez lui.
 */

/** Formatage local d'une date ISO, sans dépendre du parent. */
const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime())
        ? ''
        : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
};

export interface CompanyInfoReadOnlyProps {
    /** Champs de la fiche, tels que saisis ou rapportés par le SIRET. */
    formData: Record<string, any>;
    /** Entreprise enregistrée en base — absente tant qu'elle ne l'est pas. */
    entrepriseData?: { id?: string; logo_url?: string | null } | null;
    /** Libellé lisible d'une forme juridique, résolu par le parent. */
    getLegalFormLabel: (code: string, currentLabel: string) => string;
    /** L'entreprise apparaît dans l'annuaire des partenaires. */
    visibleDansReseau: boolean;
    depotLogoEnCours: boolean;
    /** Enregistrement de la visibilité réseau en cours. */
    savingReseau: boolean;
    /**
     * Référentiels et sélections de compétences.
     *
     * Passés tels quels : cette vue ne fait que les afficher, le parent reste
     * seul à les charger et à les modifier.
     */
    refDomains: any[];
    refSpecialties: any[];
    refExpertiseTags: any[];
    refGeoZones: any[];
    selectedNatures: string[];
    selectedDomains: string[];
    selectedSpecialties: any[];
    selectedExpertiseTags: any[];
    selectedGeoZones: any[];
    onDeposerLogo: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBasculerReseau: () => void;
}

const CompanyInfoReadOnlyBase: React.FC<CompanyInfoReadOnlyProps> = ({
    formData, entrepriseData, getLegalFormLabel,
    visibleDansReseau, depotLogoEnCours, savingReseau, onDeposerLogo, onBasculerReseau,
    refDomains, refSpecialties, refExpertiseTags, refGeoZones,
    selectedNatures, selectedDomains, selectedSpecialties,
    selectedExpertiseTags, selectedGeoZones,
}) => {
    return (
        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {/* Card 1: Identité */}
                                <SettingsCard title="Identité" icon={Building2}>
                                    <div className="flex items-start gap-4">
                                        <div className="relative group shrink-0">
                                            <div className="w-16 h-16 rounded-xl border border-gray-100 bg-white flex items-center justify-center overflow-hidden shadow-sm">
                                                {entrepriseData?.logo_url ? (
                                                    <img src={entrepriseData.logo_url} alt="Logo" className="w-full h-full object-contain" />
                                                ) : (
                                                    <Building2 className="w-8 h-8 text-gray-300" />
                                                )}
                                            </div>
                                            {/* Le dépôt de logo reste offert en consultation :
                                                remplacer une image n'est pas modifier la fiche
                                                légale, et l'exiger de passer en édition serait un
                                                détour inutile. La condition `!isEditing` d'origine
                                                était toujours vraie ici, ce composant n'étant rendu
                                                qu'en consultation. */}
                                            {true && (
                                                <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                                    {depotLogoEnCours ? <Loader2 className="w-5 h-5 animate-spin text-white" /> : <Upload className="w-5 h-5 text-white" />}
                                                    <input type="file" accept="image/*" onChange={onDeposerLogo} className="hidden" disabled={depotLogoEnCours} />
                                                </label>
                                            )}
                                        </div>
                                        <div className="space-y-3 flex-1">
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">{formData.nom}</p>
                                                {(formData.prenom || formData.nom_famille) && (
                                                    <p className="text-xs text-gray-500 font-medium">{formData.prenom} {formData.nom_famille}</p>
                                                )}
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md font-mono">{formData.siret}</span>
                                                    <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md">{getLegalFormLabel(formData.forme_juridique, formData.forme_juridique)}</span>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <InfoItem label="Date de création" value={formatDate(formData.date_creation)} icon={CalendarIcon} />
                                                <div className="flex gap-4">
                                                    <InfoItem label="Taille" value={formData.taille} />
                                                    <InfoItem label="Effectif" value={formData.effectif} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* Card 2: Localisation */}
                                <SettingsCard title="Localisation" icon={MapPin}>
                                    <div className="space-y-3">
                                        <div>
                                            <p className="text-sm text-gray-900">{formData.adresse}</p>
                                            <p className="text-sm text-gray-900">{formData.code_postal} {formData.ville}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <InfoItem label="N° TVA" value={formData.tva} icon={Hash} />
                                            <InfoItem label="Poste occupé" value={formData.poste} />
                                        </div>
                                        {formData.site_web && (
                                            <InfoItem label="Site web" value={formData.site_web} icon={Globe} />
                                        )}
                                    </div>
                                </SettingsCard>

                                {/* Card 3: Activité & Spécialités (Summary) */}
                                <SettingsCard title="Activités & Spécialités" icon={Briefcase}>
                                    <div className="space-y-4">
                                        {/* Natures */}
                                        <div className="flex flex-wrap gap-2">
                                            {selectedNatures.map(n => (
                                                <span key={n} className="px-3 py-1 rounded-full bg-filao-primary text-white text-[10px] font-bold uppercase tracking-wider">
                                                    {n}
                                                </span>
                                            ))}
                                            {selectedNatures.length === 0 && <span className="text-gray-400 italic text-xs">Aucune nature d'activité</span>}
                                        </div>

                                        {/* Structured Skills Summary */}
                                        <div className="space-y-3">
                                            {refDomains
                                                .filter(dom => selectedDomains.includes(dom.id))
                                                .map(dom => {
                                                    const domSpecs = selectedSpecialties.filter(s => {
                                                        const ref = refSpecialties.find(rs => rs.id === s.specialty_id);
                                                        return ref?.domain_id === dom.id;
                                                    });
                                                    if (domSpecs.length === 0) return null;

                                                    return (
                                                        <div key={dom.id} className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                                                            <p className="text-[11px] font-bold text-gray-700 mb-2 uppercase tracking-tight">{dom.label}</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {domSpecs.map(s => {
                                                                    const ref = refSpecialties.find(rs => rs.id === s.specialty_id);
                                                                    return (
                                                                        <span key={s.specialty_id} className="px-2 py-0.5 bg-white border border-gray-200 text-gray-600 rounded text-[11px] font-medium">
                                                                            {ref?.label}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            {selectedDomains.length === 0 && <p className="text-xs text-gray-400 italic px-1">Aucune spécialité sélectionnée</p>}
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* Card 4: Réseau Filao */}
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
                                                role="switch"
                                                aria-checked={visibleDansReseau}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${visibleDansReseau ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                        {!entrepriseData?.id && (
                                            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">Enregistrez d'abord votre entreprise pour activer cette option.</p>
                                        )}
                                    </div>
                                </SettingsCard>
                            </div>

                             {/* Expertises & Zones Summary (Full Width) */}
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                 <SettingsCard title="Expertises & Qualifications" icon={ShieldCheck}>
                                     <div className="flex flex-wrap gap-1.5">
                                         {selectedExpertiseTags.map(tagId => {
                                             const tag = refExpertiseTags.find(t => t.id === tagId);
                                             return (
                                                 <span key={tagId} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-semibold">
                                                     {tag?.label}
                                                 </span>
                                             );
                                         })}
                                         {selectedExpertiseTags.length === 0 && <span className="text-gray-400 italic text-xs">Aucune expertise renseignée</span>}
                                     </div>
                                 </SettingsCard>

                                 <SettingsCard title="Périmètre géographique" icon={MapPin}>
                                     <div className="flex flex-wrap gap-1.5">
                                         {selectedGeoZones.length >= 13 && refGeoZones.filter(z => z.zone_type === 'metropole').every(z => selectedGeoZones.includes(z.id)) ? (
                                             <span className="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-bold uppercase tracking-tight">
                                                 France Entière (Métropole)
                                             </span>
                                         ) : (
                                             selectedGeoZones.map(zoneId => {
                                                 const zone = refGeoZones.find(z => z.id === zoneId);
                                                 return (
                                                     <span key={zoneId} className="px-2.5 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-xs font-medium">
                                                         {zone?.label}
                                                     </span>
                                                 );
                                             })
                                         )}
                                         {selectedGeoZones.length === 0 && <span className="text-gray-400 italic text-xs">Aucune zone sélectionnée</span>}
                                     </div>
                                 </SettingsCard>
                             </div>
        </>
    );
};

export const CompanyInfoReadOnly = memo(CompanyInfoReadOnlyBase);
