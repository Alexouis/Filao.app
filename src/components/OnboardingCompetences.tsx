import React, { useState, memo } from 'react';
import { Building2, Check, FolderOpen, Loader2, Search, Wrench } from 'lucide-react';

/**
 * Étape 2 de l'inscription : compétences et zones d'intervention.
 *
 * POURQUOI CE FICHIER
 * `OnboardingWizard` faisait 1 814 lignes, dont ~360 pour cette seule étape.
 * C'est le premier découpage de ce composant, jusqu'ici jamais touché.
 *
 * UN SEUL ÉTAT DESCEND ICI
 * `domainesDeplies`, l'accordéon des domaines : purement visuel, il ne sert
 * qu'à cette étape, et le laisser dans le parent faisait re-rendre tout
 * l'assistant à chaque dépliement.
 *
 * Les SÉLECTIONS et les libellés « Autre » restent au parent : il les amorce
 * depuis la base et les enregistre à la validation de l'étape. Les descendre
 * obligerait à les faire remonter aussitôt.
 */
export interface OnboardingCompetencesProps {
    /** Référentiels, chargés par le parent. */
    refDomains: any[];
    refSpecialties: any[];
    refGeoZones: any[];
    loadingRef: boolean;
    /**
     * L'utilisateur rejoint une entreprise existante sans en être
     * administrateur : il consulte les compétences déjà déclarées, il ne les
     * modifie pas.
     */
    lectureSeule: boolean;
    /** Nom de l'entreprise rejointe, affiché pour expliquer la lecture seule. */
    nomRattachement?: string | null;

    selectedNatures: string[];
    setSelectedNatures: React.Dispatch<React.SetStateAction<string[]>>;
    selectedDomains: string[];
    setSelectedDomains: React.Dispatch<React.SetStateAction<string[]>>;
    selectedSpecialties: any[];
    setSelectedSpecialties: React.Dispatch<React.SetStateAction<any[]>>;
    selectedZones: any[];
    setSelectedZones: React.Dispatch<React.SetStateAction<any[]>>;
    /**
     * Libellés libres des spécialités « Autre ». Gérés par le parent, qui les
     * amorce depuis les spécialités déjà déclarées en base.
     */
    otherLabels: Record<string, string>;
    setOtherLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>;

    /**
     * Décocher une nature fait perdre les domaines qui n'en dépendent plus.
     * Le parent décide s'il faut confirmer (perte de saisie) ou appliquer
     * directement.
     */
    onDemanderRetraitNature: (demande: { naturesRestantes: string[]; domainesPerdus: string[] }) => void;
    onAppliquerRetraitNature: (naturesRestantes: string[], domainesPerdus: string[]) => void;
}

const OnboardingCompetencesBase: React.FC<OnboardingCompetencesProps> = ({
    refDomains, refSpecialties, refGeoZones, loadingRef, lectureSeule, nomRattachement,
    selectedNatures, setSelectedNatures,
    selectedDomains, setSelectedDomains,
    selectedSpecialties, setSelectedSpecialties,
    selectedZones, setSelectedZones, otherLabels, setOtherLabels,
    onDemanderRetraitNature, onAppliquerRetraitNature,
}) => {
    // Accordéon des domaines : purement visuel.
    const [domainesDeplies, setDomainesDeplies] = useState<string[]>([]);

    return (
                        <fieldset
                            disabled={lectureSeule}
                            className={lectureSeule ? 'opacity-70' : undefined}
                        >
                        {/* Un <fieldset> désactivé neutralise tous les boutons et
                            champs qu'il contient : c'est ce qui rend la lecture
                            seule EFFECTIVE, le bandeau seul ne faisait que
                            l'annoncer. */}
                        {lectureSeule && (
                            <p className="max-w-xl mx-auto mb-6 text-xs text-[#0B1F38]/55 bg-[#EFF4F8] border border-[#00A3E0]/15 rounded-xl px-4 py-3 text-center">
                                L'activité et les zones d'intervention sont gérées par un
                                administrateur de {nomRattachement || 'votre entreprise'}.
                            </p>
                        )}
                        <div className="space-y-8 animate-in fade-in duration-500 pb-12">
                            <div className="text-center mb-8">
                                <h1 className="text-2xl font-bold text-gray-900">Votre activité et expertise</h1>
                                <p className="text-gray-500 mt-1">Ces informations nous permettent de vous proposer les meilleurs partenaires et opportunités.</p>
                            </div>

                            {/* Complétude du profil, en direct.
                                Un profil sans spécialité ni zone ne remonte dans aucune
                                recherche de partenaire : l'indiquer pendant la saisie est
                                plus utile qu'un constat en fin de parcours. */}
                            {!loadingRef && (() => {
                                const criteres = [
                                    selectedNatures.length > 0,
                                    selectedDomains.length > 0,
                                    selectedSpecialties.length > 0,
                                    selectedZones.length > 0,
                                ];
                                const remplis = criteres.filter(Boolean).length;
                                const pourcent = Math.round((remplis / criteres.length) * 100);
                                return (
                                    <div className="max-w-xl mx-auto mb-8">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-bold text-gray-600">Complétude de votre profil</span>
                                            <span className={`text-xs font-bold ${pourcent === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {pourcent}%
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-500 ${pourcent === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                                                style={{ width: `${pourcent}%` }}
                                            />
                                        </div>
                                        {pourcent < 100 && (
                                            <p className="text-[11px] text-gray-400 mt-1.5">
                                                Un profil incomplet apparaît moins souvent dans les recherches de
                                                partenaires et les suggestions de groupement.
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}

                            {loadingRef ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <Loader2 size={40} className="animate-spin text-filao-primary" />
                                    <p className="text-sm text-gray-400 font-medium tracking-wide">Chargement de la taxonomie...</p>
                                </div>
                            ) : (
                                <>
                                    {/* SECTION A: NATURE D'ACTIVITÉ */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="w-8 h-8 rounded-lg bg-filao-primary/10 flex items-center justify-center text-filao-primary">
                                                <Building2 size={18} />
                                            </div>
                                            <h3 className="text-base font-bold text-gray-900">1. Nature de votre activité *</h3>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4">
                                            {[
                                                { id: 'travaux', label: 'Travaux', icon: Wrench, desc: 'Bâtiment expertises, rénovation, VRD...' },
                                                { id: 'services', label: 'Services', icon: FolderOpen, desc: "Bureau d'études, architecture, conseil..." },
                                                { id: 'fournitures', label: 'Fournitures', icon: Building2, desc: 'Équipements, matériaux, matériel...' },
                                            ].map(n => {
                                                const isSelected = selectedNatures.includes(n.id);
                                                return (
                                                    <button
                                                        key={n.id}
                                                        onClick={() => {
                                                            if (isSelected) {
                                                                // Décocher une nature retire les domaines qui n'en
                                                                // dépendent plus, et donc leurs spécialités. C'est une
                                                                // perte de saisie : on la fait confirmer plutôt que de
                                                                // l'appliquer silencieusement.
                                                                const naturesRestantes = selectedNatures.filter(x => x !== n.id);
                                                                const domainesPerdus = selectedDomains.filter(did => {
                                                                    const d = refDomains.find(rd => rd.id === did);
                                                                    return !d?.natures.some(rn => naturesRestantes.includes(rn));
                                                                });

                                                                // Perte de saisie : on demande confirmation via la
                                                                // boîte de l'application (le `window.confirm` natif
                                                                // était bloquant et hors charte).
                                                                if (domainesPerdus.length > 0) {
                                                                    onDemanderRetraitNature({ naturesRestantes, domainesPerdus });
                                                                    return;
                                                                }

                                                                onAppliquerRetraitNature(naturesRestantes, domainesPerdus);
                                                                return;
                                                            }
                                                            setSelectedNatures(prev => [...prev, n.id]);
                                                        }}
                                                        className={`relative flex flex-col items-center text-center p-5 rounded-2xl border-2 transition-all duration-300 group ${isSelected
                                                            ? 'border-filao-primary bg-filao-primary/5 shadow-md shadow-filao-primary/10'
                                                            : 'border-gray-100 bg-white hover:border-filao-primary/30'
                                                            }`}
                                                    >
                                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${isSelected ? 'bg-filao-primary text-white' : 'bg-gray-50 text-gray-400 group-hover:bg-gray-100'}`}>
                                                            <n.icon size={24} />
                                                        </div>
                                                        <span className={`text-sm font-bold mb-1 ${isSelected ? 'text-filao-primary' : 'text-gray-900'}`}>{n.label}</span>
                                                        <span className="text-[10px] text-gray-400 leading-tight px-2">{n.desc}</span>
                                                        {isSelected && (
                                                            <div className="absolute top-3 right-3 w-5 h-5 bg-filao-primary text-white rounded-full flex items-center justify-center animate-in zoom-in duration-200">
                                                                <Check size={12} strokeWidth={3} />
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* SECTION B: DOMAINES */}
                                    {selectedNatures.length > 0 && (
                                        <div className="space-y-4 animate-in slide-in-from-top-4 duration-500">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                                    <FolderOpen size={18} />
                                                </div>
                                                <h3 className="text-base font-bold text-gray-900">2. Vos domaines d'intervention *</h3>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {refDomains
                                                    .filter(d => d.natures.some(n => selectedNatures.includes(n)))
                                                    .map(d => {
                                                        const isSelected = selectedDomains.includes(d.id);
                                                        return (
                                                            <button
                                                                key={d.id}
                                                                onClick={() => {
                                                                    setSelectedDomains(prev => {
                                                                        if (isSelected) {
                                                                            // Cascade: remove specialties associated with this domain
                                                                            setSelectedSpecialties(currentSpecs => 
                                                                                currentSpecs.filter(sid => {
                                                                                    const s = refSpecialties.find(rs => rs.id === sid.specialty_id);
                                                                                    return s?.domain_id !== d.id;
                                                                                })
                                                                            );
                                                                            return prev.filter(x => x !== d.id);
                                                                        }
                                                                        return [...prev, d.id];
                                                                    });
                                                                }}
                                                                className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${isSelected
                                                                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                                                                    : 'border-gray-100 bg-white hover:border-blue-200'
                                                                    }`}
                                                            >
                                                                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200'}`}>
                                                                    {isSelected && <Check size={14} strokeWidth={3} />}
                                                                </div>
                                                                <span className="text-xs font-bold text-left leading-tight">{d.label}</span>
                                                            </button>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    )}

                                    {/* SECTION C: SPÉCIALITÉS */}
                                    {selectedDomains.length > 0 && (
                                        <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                                                    <Wrench size={18} />
                                                </div>
                                                <h3 className="text-base font-bold text-gray-900">3. Vos spécialités (facultatif)</h3>
                                            </div>
                                            
                                            <div className="space-y-6">
                                                {/* Affiché une seule fois, au-dessus du premier
                                                    bloc : les spécialités sont facultatives, mais
                                                    ce sont elles qui rendent le matching précis. */}
                                                {selectedDomains.length > 0 && (
                                                    <p className="text-xs text-gray-500 bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-3">
                                                        Plus vos spécialités sont précises, plus les recommandations
                                                        de partenaires seront pertinentes.
                                                    </p>
                                                )}
                                                {selectedDomains.map(domId => {
                                                    const domain = refDomains.find(d => d.id === domId);
                                                    const toutesSpecs = refSpecialties.filter(s => s.domain_id === domId);
                                                    if (!domain) return null;

                                                    // Le référentiel compte 201 spécialités : certains domaines en
                                                    // alignent des dizaines, ce qui noie l'étape et la rend
                                                    // impraticable « en deux clics ». On en montre une vingtaine,
                                                    // le reste sur demande — en gardant TOUJOURS visibles celles
                                                    // déjà sélectionnées, qui pourraient sinon disparaître sous le
                                                    // repli.
                                                    const deplie = domainesDeplies.includes(domId);
                                                    const specs = deplie
                                                        ? toutesSpecs
                                                        : toutesSpecs.filter((s, i) =>
                                                            i < 20 || selectedSpecialties.some(x => x.specialty_id === s.id));
                                                    const masquees = toutesSpecs.length - specs.length;

                                                    return (
                                                        <div key={domId} className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100">
                                                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">{domain.label}</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {specs.map(s => {
                                                                    const isSelected = selectedSpecialties.some(x => x.specialty_id === s.id);
                                                                    const isOther = s.id.endsWith('99');
                                                                    return (
                                                                        <div key={s.id} className="flex flex-col gap-2">
                                                                            <button
                                                                                onClick={() => {
                                                                                    setSelectedSpecialties(prev => 
                                                                                        isSelected 
                                                                                            ? prev.filter(x => x.specialty_id !== s.id)
                                                                                            : [...prev, { specialty_id: s.id, custom_label: otherLabels[s.id] || '' }]
                                                                                    );
                                                                                }}
                                                                                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${isSelected
                                                                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                                                                                    }`}
                                                                            >
                                                                                {s.label}
                                                                            </button>
                                                                            {isSelected && isOther && (
                                                                                <input
                                                                                    type="text"
                                                                                    value={otherLabels[s.id] || ''}
                                                                                    onChange={(e) => {
                                                                                        const val = e.target.value;
                                                                                        setOtherLabels(prev => ({ ...prev, [s.id]: val }));
                                                                                        setSelectedSpecialties(current => 
                                                                                            current.map(x => x.specialty_id === s.id ? { ...x, custom_label: val } : x)
                                                                                        );
                                                                                    }}
                                                                                    placeholder="Précisez votre spécialité..."
                                                                                    className="text-[11px] px-3 py-1.5 bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 w-full animate-in fade-in zoom-in-95 duration-200"
                                                                                    autoFocus
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {(masquees > 0 || deplie) && (
                                                                <button
                                                                    onClick={() => setDomainesDeplies(prev =>
                                                                        deplie ? prev.filter(x => x !== domId) : [...prev, domId])}
                                                                    className="mt-3 text-[11px] font-bold text-filao-primary hover:underline"
                                                                >
                                                                    {deplie
                                                                        ? 'Afficher moins'
                                                                        : `Afficher ${masquees} spécialité${masquees > 1 ? 's' : ''} de plus`}
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* SECTION D: ZONE D'INTERVENTION */}
                                    <div className="pt-4 space-y-4">
                                        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-8 mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
                                                    <Search size={18} />
                                                </div>
                                                <h3 className="text-base font-bold text-gray-900">4. Zone d'intervention *</h3>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    const metropoleIds = refGeoZones.filter(z => z.zone_type === 'metropole').map(z => z.id);
                                                    const allSelected = metropoleIds.every(id => selectedZones.includes(id));
                                                    if (allSelected) {
                                                        setSelectedZones(prev => prev.filter(id => !metropoleIds.includes(id)));
                                                    } else {
                                                        setSelectedZones(prev => [...new Set([...prev, ...metropoleIds])]);
                                                    }
                                                }}
                                                className={`text-xs font-bold px-4 py-2 rounded-xl transition-all border ${
                                                    refGeoZones.filter(z => z.zone_type === 'metropole').every(z => selectedZones.includes(z.id))
                                                        ? 'bg-orange-600 text-white border-orange-600'
                                                        : 'bg-white text-orange-600 border-orange-200 hover:bg-orange-50'
                                                }`}
                                            >
                                                France Entière
                                            </button>
                                        </div>

                                        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-4">Métropole</p>
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                {refGeoZones.filter(z => z.zone_type === 'metropole').map(z => {
                                                    const isSelected = selectedZones.includes(z.id);
                                                    return (
                                                        <button
                                                            key={z.id}
                                                            onClick={() => setSelectedZones(prev => 
                                                                isSelected ? prev.filter(x => x !== z.id) : [...prev, z.id]
                                                            )}
                                                            className={`px-2 py-2 rounded-xl text-[10px] font-bold border transition-all text-center leading-tight min-h-[44px] flex items-center justify-center ${
                                                                isSelected 
                                                                    ? 'bg-orange-500 text-white border-orange-500 shadow-sm' 
                                                                    : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-orange-200 hover:text-orange-600'
                                                            }`}
                                                        >
                                                            {z.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div className="mt-8">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-4">DOM-TOM</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {refGeoZones.filter(z => z.zone_type === 'domtom').map(z => {
                                                        const isSelected = selectedZones.includes(z.id);
                                                        return (
                                                            <button
                                                                key={z.id}
                                                                onClick={() => setSelectedZones(prev => 
                                                                    isSelected ? prev.filter(x => x !== z.id) : [...prev, z.id]
                                                                )}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                                                                    isSelected 
                                                                        ? 'bg-orange-500 text-white border-orange-500' 
                                                                        : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-orange-200 hover:text-orange-600'
                                                                }`}
                                                            >
                                                                {z.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                        </fieldset>
    );
};

export const OnboardingCompetences = memo(OnboardingCompetencesBase);
