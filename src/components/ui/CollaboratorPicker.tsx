import React, { useState, useMemo } from 'react';
import { CheckCircle, X, Search, Filter, ArrowUpDown, Check, Plus } from "lucide-react";
import { GROUPEMENT_STATUSES } from '../../config';
import { GLASS_MODAL_STYLE } from '../../lib/styles';

export const CollaboratorPicker = ({
  currentMembers,
  knownCollaborators,
  onClose,
  onUpdateMembers
}: {
  currentMembers: any[],
  knownCollaborators: any[],
  onClose: (val: boolean) => void,
  onUpdateMembers: (members: any[]) => void
}) => {

  // --- Local State for Filters ---
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('Tous');
  const [filterStatus, setFilterStatus] = useState<'Tous' | 'Ajouté' | 'Non ajouté'>('Tous');
  const [sortOption, setSortOption] = useState<'name_asc' | 'date_desc'>('date_desc');
  const [showFilters, setShowFilters] = useState(false);

  // --- Filtering Logic ---
  const processedCollaborators = useMemo(() => {
    let result = [...knownCollaborators];

    // 1. Search (Name, Email, Company)
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(c =>
        (c.name?.toLowerCase().includes(lowerQuery)) ||
        (c.email.toLowerCase().includes(lowerQuery)) ||
        ((c.company || c.entreprise_nom)?.toLowerCase().includes(lowerQuery))
      );
    }

    // 2. Filter by Role
    if (filterRole !== 'Tous') {
      result = result.filter(c => (c.role || c.role_groupement) === filterRole);
    }

    // 3. Filter by Status (Added / Not Added)
    if (filterStatus !== 'Tous') {
      result = result.filter(c => {
        const isActive = currentMembers.some(
          current => current.email === c.email && !current.deleted
        );
        return filterStatus === 'Ajouté' ? isActive : !isActive;
      });
    }

    // 4. Sort
    result.sort((a, b) => {
      if (sortOption === 'name_asc') {
        return (a.name || a.email).localeCompare(b.name || b.email);
      }
      return 0;
    });

    return result;
  }, [knownCollaborators, searchQuery, filterRole, filterStatus, sortOption, currentMembers]);

  const availableRoles = ['Tous', ...Array.from(new Set(knownCollaborators.map(c => c.role || c.role_groupement).filter(Boolean)))];

  const handleToggleCollaborator = (collab: any) => {
    if (collab.status === GROUPEMENT_STATUSES.accepte) return;
    // Usually we don't block toggle unless it's strictly locked. 
    // Ideally we allow removing even approved ones (marking them deleted).

    const existingIndex = currentMembers.findIndex(c => c.email === collab.email);
    const newMembers = [...currentMembers];

    if (existingIndex >= 0) {
      // Toggle deleted
      if (newMembers[existingIndex].deleted) {
        newMembers[existingIndex] = { ...newMembers[existingIndex], deleted: false, status: 'pending' };
      } else {
        newMembers[existingIndex] = { ...newMembers[existingIndex], deleted: true };
      }
    } else {
      // Add new
      newMembers.push({ ...collab, status: 'pending', deleted: false });
    }

    onUpdateMembers(newMembers);
  };

  // --- STYLES (Matching TenderWizard/Dashboard) ---
  // glassStyle now imported from styles.ts as GLASS_MODAL_STYLE
  const inputClass = "w-full pl-10 pr-4 py-3 rounded-xl border border-[#0B1F38]/10 bg-white/50 focus:bg-white focus:ring-2 focus:ring-[#00A3E0] focus:outline-none transition-all text-sm font-medium text-[#0B1F38] placeholder-[#0B1F38]/40";
  const labelStyle = "text-[10px] font-bold text-[#0B1F38]/40 mb-1.5 block uppercase tracking-wider";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#0B1F38]/20 backdrop-blur-md animate-in fade-in duration-300">
      <div className={`${GLASS_MODAL_STYLE} p-8 max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-300`}>

        {/* Header */}
        <div className="flex justify-between items-start mb-8 shrink-0">
          <div>
            <h3 className="text-2xl font-extrabold text-[#0B1F38] tracking-tight">Collaborateurs précédents</h3>
            <p className="text-[#0B1F38]/60 text-sm font-medium mt-1">Sélectionnez les membres à ajouter à ce projet</p>
          </div>
          <button
            onClick={() => onClose(false)}
            className="text-[#0B1F38]/40 hover:text-[#0B1F38] bg-[#0B1F38]/5 hover:bg-[#0B1F38]/10 p-2.5 rounded-full transition-all hover:rotate-90"
          >
            <X size={20} />
          </button>
        </div>

        {/* Toolbar: Search & Toggle Filters */}
        <div className="flex gap-3 mb-6 shrink-0">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#0B1F38]/30" />
            <input
              type="text"
              placeholder="Rechercher par nom, email ou entreprise..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-3 rounded-xl border transition-all flex items-center justify-center shrink-0 ${showFilters
              ? 'bg-[#00A3E0] text-white border-[#00A3E0] shadow-lg shadow-[#00A3E0]/20'
              : 'bg-white border-[#0B1F38]/10 text-[#0B1F38]/60 hover:bg-[#0B1F38]/5'
              }`}
          >
            <Filter size={20} />
          </button>
        </div>

        {/* Expandable Filters Section */}
        {showFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-5 bg-[#0B1F38]/5 rounded-2xl shrink-0 animate-in slide-in-from-top-4 duration-300 border border-[#0B1F38]/5">

            {/* Filter: Role */}
            <div>
              <label className={labelStyle}>Rôle professionnel</label>
              <div className="relative">
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="w-full bg-white text-[#0B1F38] text-sm font-semibold rounded-xl px-3 py-2.5 outline-none border border-[#0B1F38]/10 focus:border-[#00A3E0] appearance-none transition-colors"
                >
                  {availableRoles.map(role => (
                    <option key={role || 'none'} value={role || 'Tous'}>{role || 'Tous'}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none">
                  <ArrowUpDown size={14} />
                </div>
              </div>
            </div>

            {/* Filter: Status */}
            <div>
              <label className={labelStyle}>État de sélection</label>
              <div className="relative">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="w-full bg-white text-[#0B1F38] text-sm font-semibold rounded-xl px-3 py-2.5 outline-none border border-[#0B1F38]/10 focus:border-[#00A3E0] appearance-none transition-colors"
                >
                  <option value="Tous">Tous</option>
                  <option value="Ajouté">Déjà séléctionnés</option>
                  <option value="Non ajouté">Non sélectionnés</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none">
                  <ArrowUpDown size={14} />
                </div>
              </div>
            </div>

            {/* Sort */}
            <div>
              <label className={labelStyle}>Ordre d'affichage</label>
              <div className="flex bg-white rounded-xl p-1 border border-[#0B1F38]/10">
                <button
                  onClick={() => setSortOption('date_desc')}
                  className={`flex-1 text-[11px] py-1.5 rounded-lg font-bold uppercase tracking-wider transition-all ${sortOption === 'date_desc' ? 'bg-[#00A3E0] text-white shadow-sm' : 'text-[#0B1F38]/40 hover:text-[#0B1F38]/60'}`}
                >
                  Récents
                </button>
                <button
                  onClick={() => setSortOption('name_asc')}
                  className={`flex-1 text-[11px] py-1.5 rounded-lg font-bold uppercase tracking-wider transition-all ${sortOption === 'name_asc' ? 'bg-[#00A3E0] text-white shadow-sm' : 'text-[#0B1F38]/40 hover:text-[#0B1F38]/60'}`}
                >
                  A-Z
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar-dark">
          {processedCollaborators.length === 0 ? (
            <div className="text-center py-16 flex flex-col items-center animate-in fade-in zoom-in duration-500">
              <div className="w-20 h-20 bg-[#0B1F38]/5 rounded-full flex items-center justify-center mb-6 text-[#0B1F38]/20">
                <Search size={40} />
              </div>
              <p className="text-[#0B1F38]/60 font-bold text-lg">Aucun résultat trouvé</p>
              <p className="text-[#0B1F38]/30 text-sm mt-1">Essayez d'ajuster vos filtres de recherche.</p>
              {(searchQuery || filterRole !== 'Tous' || filterStatus !== 'Tous') && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterRole('Tous'); setFilterStatus('Tous'); }}
                  className="mt-6 text-sm font-bold text-[#00A3E0] hover:text-[#26367F] px-5 py-2 rounded-full border border-[#00A3E0]/20 hover:bg-[#00A3E0]/5 transition-all"
                >
                  Réinitialiser
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {processedCollaborators.map((collab, idx) => {
                const selectedEntry = currentMembers.find(c => c.email === collab.email);
                const isSelected = selectedEntry && !selectedEntry.deleted;
                const isDeleted = selectedEntry && selectedEntry.deleted;

                return (
                  <div
                    key={collab.email || idx}
                    onClick={() => handleToggleCollaborator(collab)}
                    className={`group relative p-4 rounded-2xl border transition-all duration-300 cursor-pointer flex items-center justify-between overflow-hidden ${isSelected
                      ? 'bg-[#00A3E0]/5 border-[#00A3E0] shadow-md shadow-[#00A3E0]/10'
                      : 'bg-white/60 border-white/80 hover:bg-white hover:border-[#00A3E0]/30 hover:shadow-lg hover:shadow-[#0B1F38]/5'
                      }`}
                  >
                    {isSelected && <div className="absolute inset-0 bg-[#00A3E0]/5 pointer-events-none" />}

                    <div className="flex items-center gap-4 relative z-10">
                      {/* Avatar */}
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm transition-all duration-300 shrink-0 ${isSelected
                        ? 'bg-[#00A3E0] text-white rotate-3 scale-105'
                        : 'bg-gradient-to-br from-white to-[#F8FAFC] border border-[#0B1F38]/5 text-[#0B1F38]/40 group-hover:border-[#00A3E0]/20 group-hover:text-[#00A3E0]'
                        }`}>
                        {collab.photo_url ? (
                          <img src={collab.photo_url} alt="" className="w-full h-full rounded-xl object-cover" />
                        ) : (
                          (collab.name?.charAt(0) || collab.email.charAt(0)).toUpperCase()
                        )}
                      </div>

                      <div className="min-w-0">
                        <h4 className={`font-bold text-sm truncate transition-colors ${isSelected ? 'text-[#00A3E0]' : 'text-[#0B1F38]'}`}>
                          {collab.name || collab.email}
                        </h4>
                        <div className="flex items-center gap-2 mt-1">
                          {collab.role && (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-[#0B1F38]/5 text-[#0B1F38]/60 rounded-md uppercase tracking-tight">
                              {collab.role || collab.role_groupement}
                            </span>
                          )}
                          <span className="text-xs text-[#0B1F38]/40 truncate">{collab.email}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status Indicator */}
                    <div className="shrink-0 flex items-center ml-4 relative z-10">
                      {isSelected ? (
                        <div className="flex items-center gap-2 text-[#00A3E0] bg-white px-3 py-1.5 rounded-xl border border-[#00A3E0]/20 shadow-sm animate-in zoom-in duration-300">
                          <Check size={16} strokeWidth={3} />
                          <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline-block">Ajouté</span>
                        </div>
                      ) : isDeleted ? (
                        <div className="flex items-center gap-1.5 text-red-400 bg-red-50 px-3 py-1.5 rounded-xl border border-red-100">
                          <span className="text-[10px] font-bold uppercase tracking-widest">Retiré</span>
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl border-2 border-[#0B1F38]/5 flex items-center justify-center text-[#0B1F38]/20 group-hover:border-[#00A3E0]/30 group-hover:bg-[#00A3E0] group-hover:text-white transition-all bg-white/40">
                          <Plus size={20} strokeWidth={2.5} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-8 pt-5 border-t border-[#0B1F38]/5 flex justify-between items-center text-[10px] font-bold text-[#0B1F38]/30 uppercase tracking-[0.2em]">
          <span>
            {processedCollaborators.length} RÉSULTAT{processedCollaborators.length > 1 ? 'S' : ''}
          </span>
          <div className="flex items-center gap-1.5 text-[#00A3E0]/60">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00A3E0]/40 animate-pulse"></div>
            FILAO NETWORK
          </div>
        </div>

      </div>
    </div>
  );
};