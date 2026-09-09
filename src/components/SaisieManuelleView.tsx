import React from 'react';
import { ArrowLeft, Search, Loader2, MapPin, ChevronDown, X, XCircle, CheckCircle } from 'lucide-react';
import { MARKET_TYPES, HANDOVER_TYPES_LABELS, SECTORS_LABELS, DEPARTEMENTS } from '../config';
import { messageErreurIdentifiantAcheteur, dateValide } from '../helpers/validationHelpers';
import type { TenderFormData } from '../types';

/**
 * Saisie manuelle d'un appel d'offres, quand l'avis n'a pas été trouvé au BOAMP.
 *
 * DEUX PRINCIPES QUI GOUVERNENT CE FORMULAIRE
 *
 * 1. LES CONTRÔLES SONT INFORMATIFS, JAMAIS BLOQUANTS. La clé de contrôle d'un
 *    SIRET et une date limite déjà passée sont signalées, mais n'empêchent pas
 *    de continuer : un avis peut légitimement porter un identifiant qu'on
 *    recopie tel quel, et on saisit parfois un dossier après coup pour
 *    l'archiver. Bloquer transformerait une aide en obstacle.
 *
 * 2. LES CHAMPS OBLIGATOIRES SONT CEUX QUE LA BASE EXIGE. `lieu_execution`
 *    manquait ici alors que `validateAndGoToTeam` le réclame : l'utilisateur
 *    était bloqué à la validation sur un champ qu'il n'avait aucun moyen de
 *    renseigner depuis cet écran. Toute colonne NOT NULL de `reponses_ao` doit
 *    avoir sa saisie ici.
 *
 * Composant de présentation : la recherche d'acheteur et la conversion en
 * dossier restent dans `TenderWizard`.
 */
export interface SaisieManuelleViewProps {
    formData: TenderFormData;
    setFormData: React.Dispatch<React.SetStateAction<TenderFormData>>;
    /** Requête de recherche acheteur (SIRET, SIREN ou raison sociale). */
    siretQuery: string;
    setSiretQuery: (v: string) => void;
    siretLoading: boolean;
    siretError?: string | null;
    /** Classes partagées avec le reste du wizard, pour une saisie homogène. */
    inputGlassPlain: string;
    labelStyle: string;
    loading: boolean;
    onRechercherAcheteur: () => void;
    onConvertir: () => void;
    onAnnuler: () => void;
}

export const SaisieManuelleView: React.FC<SaisieManuelleViewProps> = ({
    formData, setFormData, siretQuery, setSiretQuery, siretLoading, siretError,
    inputGlassPlain, labelStyle, loading,
    onRechercherAcheteur, onConvertir, onAnnuler,
}) => (
    <div className="w-full h-full flex flex-col animate-in slide-in-from-right-4 duration-500 overflow-hidden">

        {/* HEADER - fixed, won't scroll */}
        <div className="flex items-center gap-4 px-8 py-4 border-b border-white/30 bg-white/40 backdrop-blur-sm shrink-0">
            <button onClick={() => onAnnuler()} className="p-2 bg-white/50 hover:bg-white rounded-xl transition-all text-[#0B1F38]/60 hover:text-[#00A3E0]">
                <ArrowLeft size={24} />
            </button>
            <div>
                <h2 className="text-2xl font-bold text-[#0B1F38]">Saisie manuelle du dossier</h2>
                <p className="text-sm text-[#0B1F38]/60">Saisissez les informations de l'appel d'offres</p>
            </div>
        </div>

        {/* CONTENT - scrollable middle */}
        <div className="flex-1 overflow-y-auto custom-scrollbar-dark p-6">
            <div className="bg-white/60 border border-white/60 rounded-3xl p-6 shadow-sm relative overflow-hidden">

                {/* SIRET search bar - compact top row */}
                <div className="bg-[#0B1F38]/5 rounded-xl p-3 mb-6">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-[#0B1F38]/60 uppercase shrink-0">Recherche acheteur</span>
                        <div className="flex gap-2 flex-1">
                            <input value={siretQuery} onChange={e => setSiretQuery(e.target.value)} type="text" placeholder="SIRET, SIREN ou nom..." className={`${inputGlassPlain} w-full`} />
                            <button onClick={onRechercherAcheteur} disabled={siretLoading} className="px-4 py-2 bg-[#0B1F38] text-white rounded-xl hover:bg-[#00A3E0] font-bold shadow-sm transition-all shrink-0">
                                {siretLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                            </button>
                        </div>
                        {siretError && <p className="text-xs text-red-500 font-bold shrink-0">{siretError}</p>}
                    </div>
                    {/* Contrôle de clé en temps réel : informatif, jamais bloquant.
                        La recherche par nom passe sans avertissement. */}
                    {(() => {
                        const avert = messageErreurIdentifiantAcheteur(siretQuery);
                        return avert ? <p className="text-[11px] text-amber-600 font-medium mt-1.5">{avert}</p> : null;
                    })()}
                </div>

                {/* ALL FIELDS in a single dense grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Acheteur */}
                    <div className="md:col-span-2">
                        <label className={labelStyle}>Nom de l'acheteur <span className="text-red-500">*</span></label>
                        <input value={formData.organisme_acheteur} onChange={e => setFormData(prev => ({ ...prev, organisme_acheteur: e.target.value }))} type="text" placeholder="Ex: Mairie de Paris" className={`${inputGlassPlain} w-full`} />
                    </div>

                    {/* Titre */}
                    <div className="md:col-span-2">
                        <label className={labelStyle}>Intitulé de l'appel d'offres <span className="text-red-500">*</span></label>
                        <input value={formData.titre} onChange={e => setFormData(prev => ({ ...prev, titre: e.target.value }))} type="text" placeholder="Titre complet du marché" className={`${inputGlassPlain} w-full`} />
                    </div>

                    {/* Type marché / Mode passation */}
                    <div>
                        <label className={labelStyle}>Type de marché <span className="text-red-500">*</span></label>
                        <select value={formData.type_marche?.[0] || ''} onChange={e => setFormData(prev => ({ ...prev, type_marche: [e.target.value] }))} className={`${inputGlassPlain} w-full`}>
                            <option value="" disabled>Sélectionner...</option>
                            {MARKET_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelStyle}>Mode de passation <span className="text-red-500">*</span></label>
                        <select value={formData.mode_passation || ''} onChange={e => setFormData(prev => ({ ...prev, mode_passation: e.target.value }))} className={`${inputGlassPlain} w-full`}>
                            <option value="" disabled>Sélectionner...</option>
                            {Object.entries(HANDOVER_TYPES_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label as string}</option>
                            ))}
                        </select>
                    </div>

                    {/* Secteur / Date limite */}
                    <div>
                        <label className={labelStyle}>Secteur d'activité <span className="text-red-500">*</span></label>
                        <select value={formData.secteur_activite || ''} onChange={e => setFormData(prev => ({ ...prev, secteur_activite: e.target.value }))} className={`${inputGlassPlain} w-full`}>
                            <option value="" disabled>Sélectionner...</option>
                            {Object.keys(SECTORS_LABELS).map(k => <option key={k} value={k}>{(SECTORS_LABELS as any)[k]}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelStyle}>Date limite <span className="text-red-500">*</span></label>
                        <input value={formData.date_limite} onChange={e => setFormData(prev => ({ ...prev, date_limite: e.target.value }))} type="date" className={`${inputGlassPlain} w-full`} />
                        {/* Cohérence de date, informatif et non bloquant : l'input
                            natif garantit déjà le format, on ne signale qu'une
                            date limite déjà passée. */}
                        {(() => {
                            if (!dateValide(formData.date_limite)) {
                                return <p className="text-[11px] text-amber-600 font-medium mt-1.5">Cette date n'est pas valide.</p>;
                            }
                            if (formData.date_limite) {
                                const auj = new Date(); auj.setHours(0, 0, 0, 0);
                                if (new Date(formData.date_limite) < auj) {
                                    return <p className="text-[11px] text-amber-600 font-medium mt-1.5">La date limite est déjà passée.</p>;
                                }
                            }
                            return null;
                        })()}
                    </div>

                    {/* Lieu d'exécution.
                        Ce champ est exigé par `validateAndGoToTeam` mais ne figurait
                        pas dans ce formulaire : l'utilisateur était bloqué à la
                        validation sur un champ qu'il n'avait aucun moyen de
                        renseigner. Même composant que la fiche détaillée : sélection
                        multiple par région, avec retrait au clic. */}
                    <div className="md:col-span-2">
                        <label className={labelStyle}>Lieu d'exécution <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none z-10" />
                            <select
                                value=""
                                onChange={(e) => {
                                    if (e.target.value && !formData.lieu_execution.includes(e.target.value)) {
                                        setFormData(prev => ({ ...prev, lieu_execution: [...prev.lieu_execution, e.target.value] }));
                                    }
                                }}
                                className={`${inputGlassPlain} w-full appearance-none cursor-pointer pl-9`}
                            >
                                <option value="">Ajouter une région...</option>
                                {DEPARTEMENTS.map(d => (
                                    <option key={d} value={d} disabled={formData.lieu_execution.includes(d)}>{d}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                        </div>
                        {formData.lieu_execution.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                                {formData.lieu_execution.map(lieu => (
                                    <span key={lieu} className="bg-[#E8F4FD] text-[#0078B8] text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-[#00A3E0]/10">
                                        {lieu}
                                        <button
                                            onClick={() => setFormData(prev => ({
                                                ...prev,
                                                lieu_execution: prev.lieu_execution.filter(l => l !== lieu),
                                            }))}
                                            className="hover:text-red-500 transition-colors"
                                        >
                                            <X size={11} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Montant — optional */}
                    <div className="md:col-span-2">
                        <label className={labelStyle}>Montant estimé (€ HT) <span className="text-[#0B1F38]/30 font-normal normal-case">— optionnel</span></label>
                        <input value={formData.montant_estime || ''} onChange={e => setFormData(prev => ({ ...prev, montant_estime: parseFloat(e.target.value) || 0 }))} type="number" placeholder="Ex: 150000" className={`${inputGlassPlain} w-full`} />
                    </div>
                </div>
            </div>
        </div>

        {/* FOOTER - fixed at bottom, never scrolls */}
        <div className="p-4 border-t border-white/30 flex justify-end items-center shrink-0 bg-white/40 backdrop-blur-sm gap-4">
            <button onClick={() => onAnnuler()} className="px-6 py-2.5 font-bold text-[#0B1F38]/60 hover:text-[#0B1F38] bg-white border border-[#0B1F38]/10 hover:border-[#0B1F38]/20 transition-colors rounded-xl flex items-center gap-2">
                <XCircle size={18} /> Annuler
            </button>
            <button onClick={onConvertir} disabled={loading} className="px-8 py-2.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold rounded-xl shadow-lg transition-transform hover:scale-[1.02] active:scale-95 flex items-center gap-2">
                {loading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={18} />} Convertir en dossier
            </button>
        </div>
    </div>
);
