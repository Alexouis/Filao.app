import React, { useState, useEffect, memo } from 'react';
import {
    Calendar as CalendarIcon, X, CheckCircle, AlertTriangle, UserCheck,
    Pencil, ShieldAlert, Trash2, Plus,
} from 'lucide-react';
import { estEnRetard } from '../helpers/jalonHelpers';

/**
 * Modale « Rétroplanning » — jalons et échéances clés du dossier.
 *
 * POURQUOI CE FICHIER EXISTE
 * Extraite de `TenderWizard` (7 000+ lignes) où elle vivait sous forme de
 * `renderRetroplanningModal()`. Les états d'édition (jalon en cours de
 * modification, formulaire d'ajout) étaient déclarés dans le PARENT : taper un
 * libellé de jalon re-rendait donc tout le wizard.
 *
 * CE QUI CHANGE
 *  - Composant autonome et mémoïsé (`memo`).
 *  - Les états d'édition descendent ICI : ils ne concernaient que cette modale.
 *
 * CE QUI NE CHANGE PAS — VOLONTAIREMENT
 * Chaque modification (ajout, édition, suppression) est persistée
 * immédiatement, comme avant. Le parent reçoit la nouvelle liste via
 * `onJalonsChange` et reste seul responsable de l'écriture en base : ce
 * composant ne connaît ni Supabase, ni `tenderId`.
 */

export interface Jalon {
    label: string;
    date: string;
    color?: string;
    source?: string;
    editable?: boolean;
    obligatoire?: boolean;
    statut?: string;
    responsable?: string;
    non_tenable?: boolean;
}

interface MembreGroupement {
    email: string;
    name?: string;
    deleted?: boolean;
}

export interface RetroplanningModalProps {
    ouvert: boolean;
    jalons: Jalon[];
    /** Seul le porteur du dossier modifie le rétroplanning. */
    isOwner: boolean;
    /** Membres du groupement, pour attribuer un responsable. */
    groupementMembers: MembreGroupement[];
    /** Reçoit la liste complète à jour ; le parent enregistre. */
    onJalonsChange: (jalons: Jalon[]) => void;
    onFermer: () => void;
    showToast: (message: string, type?: string) => void;
}

const RetroplanningModalBase: React.FC<RetroplanningModalProps> = ({
    ouvert, jalons, isOwner, groupementMembers,
    onJalonsChange, onFermer, showToast,
}) => {
    // États d'édition, locaux à la modale.
    const [editingJalonIndex, setEditingJalonIndex] = useState<number | null>(null);
    const [editingJalon, setEditingJalon] = useState<Partial<Jalon> | null>(null);
    const [showAddJalonForm, setShowAddJalonForm] = useState(false);
    const [newJalon, setNewJalon] = useState<{ label: string; date: string }>({ label: '', date: '' });

    // Repart d'un état vierge à chaque ouverture : sans cela, un formulaire
    // d'ajout laissé ouvert réapparaissait à la visite suivante.
    useEffect(() => {
        if (ouvert) {
            setEditingJalonIndex(null);
            setEditingJalon(null);
            setShowAddJalonForm(false);
            setNewJalon({ label: '', date: '' });
        }
    }, [ouvert]);

    if (!ouvert) return null;

    const sortedJalons = [...(jalons || [])].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[#0B1F38]/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-[2.5rem] p-0 w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden flex flex-col h-[85vh] max-h-[800px]">
                {/* Header */}
                <div className="p-8 pb-6 border-b border-[#0B1F38]/5 bg-[#F8FAFC] shrink-0">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-[#00A3E0]/10 rounded-2xl flex items-center justify-center text-[#00A3E0]">
                                <CalendarIcon size={24} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-[#0B1F38]">Rétroplanning</h2>
                                <p className="text-sm text-[#0B1F38]/60">Échéances clés et jalons du dossier</p>
                            </div>
                        </div>
                        <button onClick={onFermer} className="p-3 bg-white hover:bg-[#0B1F38]/5 text-[#0B1F38]/40 hover:text-[#0B1F38] rounded-xl transition-all shadow-sm">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar-dark p-8 py-6">
                    <div className="space-y-6 relative">
                        {/* Vertical Line */}
                        <div className="absolute left-[21px] top-6 bottom-6 w-0.5 bg-[#0B1F38]/5" />

                        {sortedJalons.length > 0 ? (
                            sortedJalons.map((jalon: any, idx: number) => {
                                // Une date passée ne veut pas dire « fait » : sans
                                // distinction, un jalon en retard s'affichait en vert
                                // avec une coche, ce qui masquait tout retard.
                                const estFait = jalon.statut === 'fait';
                                const enRetard = estEnRetard(jalon);
                                const isNext = !estFait && !enRetard && (idx === 0 || new Date(sortedJalons[idx - 1].date) < new Date());

                                return (
                                    <div key={idx} className="flex gap-6 group relative">
                                        {/* Node */}
                                        <div className={`w-11 h-11 rounded-full shrink-0 z-10 flex items-center justify-center border-4 border-white shadow-sm transition-all ${estFait ? 'bg-green-500 text-white' :
                                                enRetard ? 'bg-red-500 text-white ring-4 ring-red-500/10' :
                                                    isNext ? 'bg-[#00A3E0] text-white ring-4 ring-[#00A3E0]/10' :
                                                        'bg-gray-100 text-[#0B1F38]/40'
                                            }`}>
                                            {estFait ? <CheckCircle size={18} /> : enRetard ? <AlertTriangle size={18} /> : <span>{idx + 1}</span>}
                                        </div>

                                        {/* Card */}
                                        <div className={`flex-1 p-4 rounded-2xl border transition-all ${enRetard ? 'bg-red-50/60 border-red-200' :
                                                isNext ? 'bg-white border-[#00A3E0]/30 shadow-md ring-1 ring-[#00A3E0]/10' :
                                                    'bg-[#F8FAFC] border-[#0B1F38]/5 opacity-80 hover:opacity-100'
                                            }`}>
                                            {(enRetard || jalon.non_tenable) && (
                                                <p className="text-[10px] font-bold text-red-600 mb-1.5 flex items-center gap-1">
                                                    <AlertTriangle size={11} />
                                                    {jalon.non_tenable
                                                        ? "Ne tient pas dans le délai restant"
                                                        : "En retard"}
                                                </p>
                                            )}
                                            <div className="flex justify-between items-start gap-4">
                                                <div>
                                                    {editingJalonIndex === idx ? (
                                                        <div className="space-y-2">
                                                            <input
                                                                value={editingJalon?.label || ''}
                                                                onChange={e => setEditingJalon(prev => prev ? { ...prev, label: e.target.value } : null)}
                                                                className="w-full px-3 py-1.5 rounded-lg border border-[#00A3E0]/30 text-sm font-bold text-[#0B1F38]"
                                                                placeholder="Libellé"
                                                            />
                                                            <input
                                                                type="date"
                                                                value={editingJalon?.date || ''}
                                                                onChange={e => setEditingJalon(prev => prev ? { ...prev, date: e.target.value } : null)}
                                                                className="w-full px-3 py-1.5 rounded-lg border border-[#00A3E0]/30 text-sm font-medium text-[#0B1F38]"
                                                            />
                                                            {/* Responsable et statut : la fiche les demandait éditables,
                                                                seuls le libellé et la date l'étaient. */}
                                                            <select
                                                                value={editingJalon?.responsable || ''}
                                                                onChange={e => setEditingJalon(prev => prev ? { ...prev, responsable: e.target.value } : null)}
                                                                aria-label="Responsable du jalon"
                                                                className="w-full px-3 py-1.5 rounded-lg border border-[#00A3E0]/30 text-sm font-medium text-[#0B1F38] bg-white"
                                                            >
                                                                <option value="">Responsable — non attribué</option>
                                                                {groupementMembers.filter(m => !m.deleted).map(m => (
                                                                    <option key={m.email} value={m.email}>{m.name || m.email}</option>
                                                                ))}
                                                            </select>
                                                            <select
                                                                value={editingJalon?.statut || 'a_faire'}
                                                                onChange={e => setEditingJalon(prev => prev ? { ...prev, statut: e.target.value } : null)}
                                                                aria-label="Statut du jalon"
                                                                className="w-full px-3 py-1.5 rounded-lg border border-[#00A3E0]/30 text-sm font-medium text-[#0B1F38] bg-white"
                                                            >
                                                                <option value="a_faire">À faire</option>
                                                                <option value="fait">Fait</option>
                                                            </select>
                                                            <div className="flex gap-2 mt-2">
                                                                <button
                                                                    onClick={() => {
                                                                        if (!editingJalon) return;
                                                                        const nouveaux = [...jalons];
                                                                        const realIdx = jalons.findIndex((j: any) => j.label === jalon.label && j.date === jalon.date);
                                                                        if (realIdx !== -1) {
                                                                            nouveaux[realIdx] = { ...jalon, ...editingJalon };
                                                                            onJalonsChange(nouveaux);
                                                                        }
                                                                        setEditingJalonIndex(null);
                                                                        setEditingJalon(null);
                                                                    }}
                                                                    className="px-3 py-1.5 bg-[#00A3E0] text-white text-xs font-bold rounded-lg"
                                                                >
                                                                    Sauvegarder
                                                                </button>
                                                                <button
                                                                    onClick={() => { setEditingJalonIndex(null); setEditingJalon(null); }}
                                                                    className="px-3 py-1.5 bg-gray-100 text-[#0B1F38]/60 text-xs font-bold rounded-lg"
                                                                >
                                                                    Annuler
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <h4 className="font-bold text-[#0B1F38] mb-1">{jalon.label}</h4>
                                                            <div className="flex items-center gap-3 flex-wrap">
                                                                <span className="flex items-center gap-1.5">
                                                                    <CalendarIcon size={12} className="text-[#0B1F38]/40" />
                                                                    <span className="text-xs font-bold text-[#0B1F38]/60">
                                                                        {new Date(jalon.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                                    </span>
                                                                </span>
                                                                {/* Sans affichage, attribuer un responsable ne servirait à rien. */}
                                                                {jalon.responsable && (
                                                                    <span className="flex items-center gap-1.5" title={`Responsable : ${jalon.responsable}`}>
                                                                        <UserCheck size={12} className="text-[#0B1F38]/40" />
                                                                        <span className="text-xs font-bold text-[#0B1F38]/60 truncate max-w-[160px]">
                                                                            {groupementMembers.find(m => m.email === jalon.responsable)?.name || jalon.responsable}
                                                                        </span>
                                                                    </span>
                                                                )}
                                                                {jalon.statut === 'fait' && (
                                                                    <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded">Fait</span>
                                                                )}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                                {isOwner && editingJalonIndex !== idx && (
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => {
                                                                setEditingJalonIndex(idx);
                                                                setEditingJalon({ label: jalon.label, date: jalon.date });
                                                            }}
                                                            className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-white rounded-lg transition-all"
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                        {/* Un jalon obligatoire structure le rétroplanning : le
                                                            retirer viderait le calendrier et les rappels de leur
                                                            sens. `editable === false` couvre les jalons créés
                                                            avant l'ajout du drapeau `obligatoire`. */}
                                                        {(jalon.obligatoire || jalon.editable === false) ? (
                                                            <span
                                                                title="Jalon obligatoire, non supprimable"
                                                                className="p-2 text-[#0B1F38]/15 cursor-default"
                                                            >
                                                                <ShieldAlert size={14} />
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    if (!confirm("Supprimer ce jalon ?")) return;
                                                                    onJalonsChange(jalons.filter((j: any) => !(j.label === jalon.label && j.date === jalon.date)));
                                                                }}
                                                                className="p-2 text-[#0B1F38]/30 hover:text-red-500 hover:bg-white rounded-lg transition-all"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-12 bg-[#F8FAFC] rounded-3xl border-2 border-dashed border-[#0B1F38]/5">
                                <p className="text-sm text-[#0B1F38]/40 italic">Aucun jalon défini pour le moment.</p>
                            </div>
                        )}

                        {isOwner && (
                            <div className="ml-14 mt-4">
                                {showAddJalonForm ? (
                                    <div className="p-6 bg-[#00A3E0]/5 border-2 border-dashed border-[#00A3E0]/20 rounded-3xl space-y-4 animate-in slide-in-from-top-2 duration-300">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-[#00A3E0] uppercase tracking-wider mb-1.5 block">Libellé du jalon</label>
                                                <input
                                                    value={newJalon.label}
                                                    onChange={e => setNewJalon(prev => ({ ...prev, label: e.target.value }))}
                                                    placeholder="Ex: Réunion de lancement"
                                                    className="w-full px-4 py-2.5 rounded-xl border border-[#00A3E0]/20 bg-white focus:ring-2 focus:ring-[#00A3E0] focus:outline-none text-sm font-semibold text-[#0B1F38]"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-[#00A3E0] uppercase tracking-wider mb-1.5 block">Date prévue</label>
                                                <input
                                                    type="date"
                                                    value={newJalon.date}
                                                    onChange={e => setNewJalon(prev => ({ ...prev, date: e.target.value }))}
                                                    className="w-full px-4 py-2.5 rounded-xl border border-[#00A3E0]/20 bg-white focus:ring-2 focus:ring-[#00A3E0] focus:outline-none text-sm font-semibold text-[#0B1F38]"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-3 pt-2">
                                            <button
                                                onClick={() => {
                                                    if (!newJalon.label || !newJalon.date) {
                                                        showToast("Veuillez remplir le libellé et la date.", "warning");
                                                        return;
                                                    }
                                                    onJalonsChange([...(jalons || []), { ...newJalon, color: '#00A3E0', source: 'Manuel', editable: true }]);
                                                    setNewJalon({ label: '', date: '' });
                                                    setShowAddJalonForm(false);
                                                }}
                                                className="px-6 py-2.5 bg-[#00A3E0] text-white font-bold rounded-xl shadow-lg shadow-[#00A3E0]/10 hover:bg-[#008CC1] transition-all flex items-center gap-2 text-sm"
                                            >
                                                <CheckCircle size={16} /> Enregistrer
                                            </button>
                                            <button
                                                onClick={() => setShowAddJalonForm(false)}
                                                className="px-6 py-2.5 bg-white border border-[#0B1F38]/10 text-[#0B1F38]/60 font-bold rounded-xl hover:bg-gray-50 transition-all text-sm"
                                            >
                                                Annuler
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setShowAddJalonForm(true)}
                                        className="flex items-center gap-2 py-4 px-8 border-2 border-dashed border-[#0B1F38]/10 rounded-2xl text-[#0B1F38]/40 hover:text-[#00A3E0] hover:border-[#00A3E0]/30 hover:bg-[#00A3E0]/5 transition-all text-sm font-bold w-full group"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-[#0B1F38]/5 flex items-center justify-center group-hover:bg-[#00A3E0]/10 group-hover:text-[#00A3E0] transition-colors">
                                            <Plus size={18} />
                                        </div>
                                        Ajouter une échéance clé
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-8 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                    <button onClick={onFermer} className="px-10 py-3.5 bg-[#0B1F38] text-white font-extrabold rounded-2xl hover:bg-[#00A3E0] transition-all shadow-xl shadow-[#0B1F38]/10 tracking-wide text-sm">
                        Fermer
                    </button>
                </div>
            </div>
        </div>
    );
};

export const RetroplanningModal = memo(RetroplanningModalBase);
