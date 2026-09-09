import React, { useState, useEffect, memo } from 'react';
import {
    MapPin, Briefcase, Link, UploadCloud, FileText, X, ChevronDown,
    Loader2, Euro, Globe, ShieldAlert,
} from 'lucide-react';
import {
    DEPARTEMENTS, SECTORS_LABELS, MARKET_TYPES_LABELS, HANDOVER_TYPES_LABELS,
} from '../config';
import { TenderFormData } from '../types';
import { formatCpv } from '../helpers/boampHelpers';
import { libelleCpv } from '../helpers/cpvLabels';
import { lienExterne } from '../helpers/textHelpers';
import { useModale } from '../helpers/useModale';
import { FondModale } from './ui/FondModale';

/**
 * Modale « Détails de l'appel d'offres » (contexte du marché).
 *
 * POURQUOI CE FICHIER EXISTE
 * Cette modale vivait dans `TenderWizard` (7 000+ lignes) sous forme de
 * `renderContextEditModal()`, et écrivait dans le `formData` du parent à CHAQUE
 * frappe. Conséquence : taper un caractère re-rendait l'intégralité du wizard,
 * d'où une saisie saccadée.
 *
 * CE QUI CHANGE
 *  - Composant autonome et mémoïsé (`memo`) : le parent ne le re-rend plus à
 *    chaque respiration.
 *  - État LOCAL (`brouillon`) pendant l'édition : une frappe ne re-rend que
 *    cette modale, pas le wizard entier.
 *  - Le brouillon n'est remonté au parent qu'à la validation, via `onValider`.
 *
 * Le comportement fonctionnel est identique à l'original : mêmes champs, même
 * lecture seule, même bouton « Valider les modifications ».
 */

export interface ContextEditModalProps {
    ouvert: boolean;
    /** Valeurs du dossier au moment de l'ouverture. */
    valeurs: TenderFormData;
    /** Le porteur du dossier peut seul modifier. */
    isOwner: boolean;
    /** Dossier finalisé : informations verrouillées. */
    isLocked: boolean;
    /** Enregistrement en cours (affiche le spinner). */
    loading: boolean;
    /** Styles partagés avec le wizard, passés pour rester à l'identique. */
    inputGlass: string;
    inputGlassPlain: string;
    labelStyle: string;
    onFermer: () => void;
    /**
     * Validation : reçoit le brouillon complet. Le parent l'applique à son
     * `formData` ET le passe en `overrides` à la sauvegarde — ce qui évite de
     * dépendre du rafraîchissement d'état de React avant l'appel réseau.
     */
    onValider: (brouillon: TenderFormData) => void;
    /** Retour utilisateur (codes CPV rejetés). */
    showToast: (message: string, type?: string) => void;
}

const ContextEditModalBase: React.FC<ContextEditModalProps> = ({
    ouvert, valeurs, isOwner, isLocked, loading,
    inputGlass, inputGlassPlain, labelStyle,
    onFermer, onValider, showToast,
}) => {
    const refModale = useModale(ouvert, onFermer);
    // Brouillon local : c'est lui qu'on édite. Réinitialisé à chaque ouverture
    // pour repartir des valeurs à jour du dossier.
    const [brouillon, setBrouillon] = useState<TenderFormData>(valeurs);

    useEffect(() => {
        if (ouvert) setBrouillon(valeurs);
        // `valeurs` n'est pas dans les dépendances : on ne veut PAS écraser la
        // saisie en cours si le parent se met à jour pendant l'édition.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ouvert]);

    if (!ouvert) return null;

    const modifiable = isOwner && !isLocked;
    /** Raccourci de mise à jour d'un champ du brouillon. */
    const maj = (champ: keyof TenderFormData, valeur: any) =>
        setBrouillon(prev => ({ ...prev, [champ]: valeur }));

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <FondModale />
            <div
                ref={refModale as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                className="relative bg-white rounded-3xl w-full max-w-4xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                {/* Header */}
                <div className="p-6 border-b border-[#0B1F38]/5 flex justify-between items-center bg-[#0B1F38]/2 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0]">
                            <FileText size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-[#0B1F38]">Détails de l'appel d'offres</h3>
                            <p className="text-xs text-[#0B1F38]/50">Configurez l'ensemble des informations du marché</p>
                        </div>
                    </div>
                    <button onClick={onFermer} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors">
                        <X size={20} className="text-[#0B1F38]/40" />
                    </button>
                </div>

                {/* Form Content */}
                <div className="p-8 overflow-y-auto custom-scrollbar-dark flex-1">

                    {/* Lecture seule : le fieldset ci-dessous est désactivé, ce qui rendait la
                        modale muette (frappe ignorée, pas de bouton de validation). On explicite
                        la raison au lieu de laisser l'utilisateur croire à un bug de saisie. */}
                    {!modifiable && (
                        <div role="status" className="mb-6 flex items-start gap-3 p-4 rounded-2xl bg-[#0B1F38]/5 border border-[#0B1F38]/10">
                            <ShieldAlert size={18} className="text-[#0B1F38]/50 shrink-0 mt-0.5" />
                            <div className="text-[13px] leading-relaxed">
                                <p className="font-bold text-[#0B1F38]">Consultation seule</p>
                                <p className="text-[#0B1F38]/60">
                                    {isLocked
                                        ? "Ce dossier a été finalisé : ses informations sont verrouillées et ne peuvent plus être modifiées."
                                        : "Seul le créateur de l'appel d'offres peut modifier ces informations."}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Le champ ci-dessous étant désactivé en lecture seule, on expose le lien
                        sous forme d'ancre pour qu'il reste cliquable "dans tous les cas". */}
                    {!modifiable && brouillon.lien_telechargement && (
                        <div className="mb-6 flex items-center gap-2 text-[13px]">
                            <Link size={14} className="text-[#00A3E0] shrink-0" />
                            <a
                                href={lienExterne(brouillon.lien_telechargement)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#00A3E0] font-bold hover:underline truncate focus:outline-none focus:ring-2 focus:ring-[#00A3E0] rounded"
                            >
                                Ouvrir l'appel d'offres
                            </a>
                        </div>
                    )}

                    <fieldset disabled={!modifiable} className="grid grid-cols-1 md:grid-cols-2 gap-6 border-0 p-0 m-0 min-w-0">
                        <div className="md:col-span-2">
                            <label className={labelStyle}>Nom de l'appel d'offres *</label>
                            <input
                                type="text"
                                value={brouillon.titre}
                                onChange={(e) => maj('titre', e.target.value)}
                                className={`${inputGlass} font-bold text-[#0B1F38] bg-[#F8FAFC]`}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelStyle}>Nom de l'organisme acheteur *</label>
                            <input
                                type="text"
                                value={brouillon.organisme_acheteur}
                                onChange={(e) => maj('organisme_acheteur', e.target.value)}
                                className={`${inputGlass} font-bold text-[#0B1F38] bg-[#F8FAFC]`}
                            />
                        </div>

                        <div>
                            <label className={labelStyle}>Lieu d'exécution *</label>
                            <div className="relative">
                                <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none z-10" />
                                <select
                                    value=""
                                    onChange={(e) => {
                                        if (e.target.value && !brouillon.lieu_execution.includes(e.target.value)) {
                                            maj('lieu_execution', [...brouillon.lieu_execution, e.target.value]);
                                        }
                                    }}
                                    className={`${inputGlass} appearance-none cursor-pointer bg-[#F8FAFC]`}
                                >
                                    <option value="">Ajouter une région...</option>
                                    {DEPARTEMENTS.map(d => (
                                        <option key={d} value={d} disabled={brouillon.lieu_execution.includes(d)}>{d}</option>
                                    ))}
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                            </div>
                            {brouillon.lieu_execution.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {brouillon.lieu_execution.map(lieu => (
                                        <span key={lieu} className="bg-[#E8F4FD] text-[#0078B8] text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-[#00A3E0]/10">
                                            {lieu}
                                            {modifiable && <X size={12} className="cursor-pointer" onClick={() => maj('lieu_execution', brouillon.lieu_execution.filter(l => l !== lieu))} />}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className={labelStyle}>Type de marché *</label>
                            <div className="relative">
                                <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none z-10" />
                                <select
                                    value=""
                                    onChange={(e) => {
                                        if (e.target.value && !brouillon.type_marche.includes(e.target.value)) {
                                            maj('type_marche', [...brouillon.type_marche, e.target.value]);
                                        }
                                    }}
                                    className={`${inputGlass} appearance-none cursor-pointer bg-[#F8FAFC]`}
                                >
                                    <option value="">Sélectionnez les types...</option>
                                    {Object.entries(MARKET_TYPES_LABELS).map(([value, label]) => (
                                        <option key={value} value={value} disabled={brouillon.type_marche.includes(value)}>{label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                            </div>
                            {brouillon.type_marche.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                    {brouillon.type_marche.map(type => (
                                        <span key={type} className="bg-[#F3E8FD] text-[#8B5CF6] text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-[#8B5CF6]/10">
                                            {(MARKET_TYPES_LABELS as any)[type] || type}
                                            {modifiable && <X size={12} className="cursor-pointer" onClick={() => maj('type_marche', brouillon.type_marche.filter(t => t !== type))} />}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <label className={labelStyle}>Secteur d'activité *</label>
                            <select
                                value={brouillon.secteur_activite || 'Autres'}
                                onChange={(e) => maj('secteur_activite', e.target.value)}
                                className={`${inputGlass} font-bold text-[#0B1F38] cursor-pointer bg-[#F8FAFC]`}
                            >
                                <option value="">Sélectionner...</option>
                                {Object.keys(SECTORS_LABELS).map(k => <option key={k} value={k}>{(SECTORS_LABELS as any)[k]}</option>)}
                            </select>
                        </div>

                        <div>
                            <label className={labelStyle}>Mode de passation *</label>
                            <select
                                value={brouillon.mode_passation || ''}
                                onChange={(e) => maj('mode_passation', e.target.value)}
                                className={`${inputGlass} font-bold text-[#0B1F38] cursor-pointer bg-[#F8FAFC]`}
                            >
                                <option value="">Sélectionner...</option>
                                {Object.entries(HANDOVER_TYPES_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-3 gap-4 md:col-span-2">
                            <div>
                                <label className={labelStyle}>Date publication</label>
                                <input type="date" value={brouillon.date_publication} onChange={(e) => maj('date_publication', e.target.value)} className={`${inputGlassPlain} w-full`} />
                            </div>
                            <div>
                                <label className={labelStyle}>Date limite *</label>
                                <input type="date" value={brouillon.date_limite} onChange={(e) => maj('date_limite', e.target.value)} className={`${inputGlass} border-red-200 bg-red-50 text-red-600 font-bold`} />
                            </div>
                            <div>
                                <label className={labelStyle}>Dépôt souhaité *</label>
                                <input type="date" value={brouillon.date_depot_souhaitee} onChange={(e) => maj('date_depot_souhaitee', e.target.value)} className={`${inputGlass} border-[#00A3E0]/20 bg-[#00A3E0]/5 text-[#00A3E0] font-bold`} />
                            </div>
                        </div>

                        <div>
                            <label className={labelStyle}>Montant estimé</label>
                            <div className="relative">
                                <Euro size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40" />
                                <input type="number" value={brouillon.montant_estime} onChange={(e) => maj('montant_estime', parseFloat(e.target.value) || 0)} className={`${inputGlass} bg-[#F8FAFC]`} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 md:col-span-2">
                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <label htmlFor="tender-lien-telechargement" className={labelStyle}>Lien vers l'appel d'offres</label>
                                    {brouillon.lien_telechargement && (
                                        <a
                                            href={lienExterne(brouillon.lien_telechargement)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[10px] font-bold text-[#00A3E0] hover:underline shrink-0 focus:outline-none focus:ring-2 focus:ring-[#00A3E0] rounded"
                                        >
                                            Ouvrir →
                                        </a>
                                    )}
                                </div>
                                <div className="relative">
                                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                    <input
                                        id="tender-lien-telechargement"
                                        type="url"
                                        inputMode="url"
                                        value={brouillon.lien_telechargement}
                                        onChange={(e) => maj('lien_telechargement', e.target.value)}
                                        placeholder="https://..."
                                        className={inputGlass}
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <label htmlFor="tender-lien-depot" className={labelStyle}>Lien de dépôt</label>
                                    {brouillon.lien_depot && (
                                        <a
                                            href={lienExterne(brouillon.lien_depot)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[10px] font-bold text-[#00A3E0] hover:underline shrink-0 focus:outline-none focus:ring-2 focus:ring-[#00A3E0] rounded"
                                        >
                                            Ouvrir →
                                        </a>
                                    )}
                                </div>
                                <div className="relative">
                                    <UploadCloud size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                    <input
                                        id="tender-lien-depot"
                                        type="url"
                                        inputMode="url"
                                        value={brouillon.lien_depot}
                                        onChange={(e) => maj('lien_depot', e.target.value)}
                                        placeholder="https://..."
                                        className={inputGlass}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 md:col-span-2">
                            <div>
                                <label htmlFor="tender-reference-marche" className={labelStyle}>Référence du marché</label>
                                <input
                                    id="tender-reference-marche"
                                    type="text"
                                    value={brouillon.reference_marche || ''}
                                    onChange={(e) => maj('reference_marche', e.target.value)}
                                    placeholder="ex. AOO 25-02"
                                    className={`${inputGlassPlain} w-full`}
                                />
                                <p className="text-[10px] text-[#0B1F38]/40 mt-1">Référence attribuée par l'acheteur.</p>
                            </div>

                            <div>
                                <label htmlFor="tender-cpv" className={labelStyle}>Codes CPV</label>
                                <input
                                    id="tender-cpv"
                                    type="text"
                                    inputMode="numeric"
                                    defaultValue={(brouillon.cpv_codes || []).join(', ')}
                                    // onBlur plutôt que onChange : la saisie passe par une chaîne
                                    // libre, la découper à chaque frappe rendrait le champ
                                    // inutilisable dès qu'on tape une virgule.
                                    onBlur={(e) => {
                                        const saisis = e.target.value
                                            .split(/[\s,;]+/)
                                            .map(c => c.trim())
                                            .filter(c => c.length > 0);
                                        const valides = Array.from(new Set(saisis.filter(c => /^\d{8}$/.test(c))));
                                        const rejetes = saisis.filter(c => !/^\d{8}$/.test(c));
                                        maj('cpv_codes', valides);
                                        // Sans ce retour, une faute de frappe faisait disparaître le
                                        // code sans que l'utilisateur comprenne pourquoi.
                                        if (rejetes.length > 0) {
                                            showToast(
                                                `Code CPV ignoré (8 chiffres attendus) : ${rejetes.join(', ')}`,
                                                'warning'
                                            );
                                        }
                                        // Reflète la valeur nettoyée dans le champ.
                                        e.target.value = valides.join(', ');
                                    }}
                                    placeholder="45213000, 71000000"
                                    className={`${inputGlassPlain} w-full`}
                                />
                                <p className="text-[10px] text-[#0B1F38]/40 mt-1">
                                    Un code = 8 chiffres. Séparez-en plusieurs par une virgule, un point-virgule ou un espace.
                                </p>
                                {/* Retour immédiat sur ce que représentent les codes saisis :
                                    sans lui, on ne sait pas si l'on s'est trompé de chiffre. */}
                                {(brouillon.cpv_codes || []).length > 0 && (
                                    <ul className="mt-2 space-y-0.5">
                                        {brouillon.cpv_codes.map(code => (
                                            <li key={code} className="text-[10px] text-[#0B1F38]/50 flex gap-1.5">
                                                <span className="font-mono font-bold text-[#0B1F38]/70 shrink-0">{formatCpv(code)}</span>
                                                <span className="truncate">{libelleCpv(code) ?? 'Division inconnue'}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className="md:col-span-2">
                            <label className={labelStyle}>Description / Objet du marché</label>
                            <textarea
                                rows={4}
                                value={brouillon.description}
                                onChange={(e) => maj('description', e.target.value)}
                                className={`${inputGlass} text-[#0B1F38]/80 italic resize-none bg-[#F8FAFC]`}
                            />
                        </div>
                    </fieldset>
                </div>

                {/* Footer - Only visible if owner can edit */}
                {modifiable && (
                    <div className="p-6 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                        <button
                            onClick={() => onValider(brouillon)}
                            className="px-8 py-3 bg-[#0B1F38] text-white font-bold rounded-xl hover:bg-[#00A3E0] transition-all shadow-lg"
                        >
                            {loading ? <Loader2 size={20} className="animate-spin" /> : "Valider les modifications"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export const ContextEditModal = memo(ContextEditModalBase);
