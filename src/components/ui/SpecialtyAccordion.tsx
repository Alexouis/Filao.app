import React, { useState } from 'react';
import { Building2, Wrench, FolderOpen, Check, Loader2, ChevronDown, Plus, X } from 'lucide-react';

interface SpecialtySelection {
    specialty_id: string;
    custom_label: string;
}

interface SpecialtyAccordionProps {
    selectedNatures: string[];
    onNaturesChange: (natures: string[]) => void;
    selectedDomains: string[];
    onDomainsChange: (domains: string[]) => void;
    selectedSpecialties: SpecialtySelection[];
    onSpecialtiesChange: (specialties: SpecialtySelection[]) => void;
    refDomains: any[];
    refSpecialties: any[];
}

export const SpecialtyAccordion: React.FC<SpecialtyAccordionProps> = ({
    selectedNatures,
    onNaturesChange,
    selectedDomains,
    onDomainsChange,
    selectedSpecialties,
    onSpecialtiesChange,
    refDomains,
    refSpecialties,
}) => {
    const [expandedDomains, setExpandedDomains] = useState<string[]>([]);
    const [otherLabels, setOtherLabels] = useState<Record<string, string>>({});

    const toggleNature = (natureId: string) => {
        const isSelected = selectedNatures.includes(natureId);
        let newNatures: string[];
        
        if (isSelected) {
            newNatures = selectedNatures.filter(n => n !== natureId);
            // Cascade delete: remove domains that no longer have a valid nature
            const newDomains = selectedDomains.filter(did => {
                const d = refDomains.find(rd => rd.id === did);
                return d?.natures.some((n: string) => newNatures.includes(n));
            });
            onDomainsChange(newDomains);
            
            // Cascade delete: remove specialties of those domains
            const newSpecs = selectedSpecialties.filter(sid => {
                const s = refSpecialties.find(rs => rs.id === sid.specialty_id);
                return s && newDomains.includes(s.domain_id);
            });
            onSpecialtiesChange(newSpecs);
        } else {
            newNatures = [...selectedNatures, natureId];
        }
        onNaturesChange(newNatures);
    };

    const toggleDomain = (domainId: string) => {
        const isSelected = selectedDomains.includes(domainId);
        if (isSelected) {
            const newDomains = selectedDomains.filter(d => d !== domainId);
            onDomainsChange(newDomains);
            // Cascade: remove specialties
            onSpecialtiesChange(selectedSpecialties.filter(sid => {
                const s = refSpecialties.find(rs => rs.id === sid.specialty_id);
                return s?.domain_id !== domainId;
            }));
            setExpandedDomains(prev => prev.filter(d => d !== domainId));
        } else {
            onDomainsChange([...selectedDomains, domainId]);
            setExpandedDomains(prev => [...prev, domainId]);
        }
    };

    const toggleSpecialty = (specialtyId: string) => {
        const isSelected = selectedSpecialties.some(s => s.specialty_id === specialtyId);
        if (isSelected) {
            onSpecialtiesChange(selectedSpecialties.filter(s => s.specialty_id !== specialtyId));
        } else {
            onSpecialtiesChange([...selectedSpecialties, { 
                specialty_id: specialtyId, 
                custom_label: otherLabels[specialtyId] || '' 
            }]);
        }
    };

    const handleOtherLabelChange = (specialtyId: string, value: string) => {
        setOtherLabels(prev => ({ ...prev, [specialtyId]: value }));
        onSpecialtiesChange(selectedSpecialties.map(s => 
            s.specialty_id === specialtyId ? { ...s, custom_label: value } : s
        ));
    };

    return (
        <div className="space-y-8">
            {/* SECTION A: NATURE D'ACTIVITÉ */}
            <div className="space-y-4">
                <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-filao-primary/10 flex items-center justify-center text-filao-primary">
                        <Building2 size={18} />
                    </div>
                    <h3 className="text-base font-bold text-gray-900">1. Nature de votre activité *</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {[
                        { id: 'travaux', label: 'Travaux', icon: Wrench, desc: 'Bâtiment expertises, rénovation, VRD...' },
                        { id: 'services', label: 'Services', icon: FolderOpen, desc: "Bureau d'études, architecture, conseil..." },
                        { id: 'fournitures', label: 'Fournitures', icon: Building2, desc: 'Équipements, matériaux, matériel...' },
                    ].map(n => {
                        const isSelected = selectedNatures.includes(n.id);
                        return (
                            <button
                                key={n.id}
                                onClick={() => toggleNature(n.id)}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {refDomains
                            .filter(d => d.natures.some((n: string) => selectedNatures.includes(n)))
                            .map(d => {
                                const isSelected = selectedDomains.includes(d.id);
                                return (
                                    <button
                                        key={d.id}
                                        onClick={() => toggleDomain(d.id)}
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
                        {selectedDomains.map(domId => {
                            const domain = refDomains.find(d => d.id === domId);
                            const specs = refSpecialties.filter(s => s.domain_id === domId);
                            if (!domain) return null;
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
                                                        onClick={() => toggleSpecialty(s.id)}
                                                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${isSelected
                                                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                                            : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                                                            }`}
                                                    >
                                                        {s.label}
                                                    </button>
                                                    {isSelected && isOther && (
                                                        <div className="animate-in slide-in-from-top-2 duration-200 mt-1">
                                                            <input
                                                                type="text"
                                                                placeholder="Précisez..."
                                                                value={otherLabels[s.id] || ''}
                                                                onChange={(e) => handleOtherLabelChange(s.id, e.target.value)}
                                                                className="w-full bg-white border border-emerald-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
