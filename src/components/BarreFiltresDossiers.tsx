import React, { memo } from 'react';
import {
    AlertCircle, ArrowUpDown, Briefcase, CheckCircle2, Clock, Frown, LayoutGrid,
    Search, SlidersHorizontal, TrendingUp, Trophy, Users,
} from 'lucide-react';
import { MARKET_TYPES, SECTORS, STATUSES } from '../config';

/**
 * Barre de filtres de la liste des appels d'offres : statut, catégorie,
 * secteur, rôle, tri, et les deux bascules « invitations » et « toute
 * l'entreprise ».
 *
 * POURQUOI CE FICHIER
 * `renderList` faisait plus de 500 lignes. Plutôt que d'en faire un composant
 * à 38 props, on suit ses coutures internes : cette barre en est une, cohérente
 * et refermée sur elle-même.
 *
 * Aucun état ne descend : les filtres pilotent la liste, que le parent calcule
 * (`filtrerEtTrierDossiers`). Les descendre couperait la barre de ce qu'elle
 * commande.
 */
export interface BarreFiltresDossiersProps {
    filterStatus: string;
    setFilterStatus: (v: string) => void;
    filterCategory: string;
    setFilterCategory: (v: string) => void;
    filterDomain: string;
    setFilterDomain: (v: string) => void;
    filterRole: string;
    setFilterRole: (v: string) => void;
    sortOption: string;
    setSortOption: (v: string) => void;

    /** Vue « invitations en attente » plutôt que « mes dossiers ». */
    showInvitationsOnly: boolean;
    setShowInvitationsOnly: (v: boolean) => void;
    /** Afficher aussi les dossiers portés par des collègues. */
    voirToutEntreprise: boolean;
    setVoirToutEntreprise: (v: boolean) => void;
    /** Nombre de dossiers de collègues, pour justifier la bascule. */
    nbDossiersCollegues: number;

    /** Menus déroulants : ouverture pilotée par le parent, qui gère aussi le
     *  clic à l'extérieur. */
    isFilterMenuOpen: boolean;
    setIsFilterMenuOpen: (v: boolean) => void;
    isSortMenuOpen: boolean;
    setIsSortMenuOpen: (v: boolean) => void;
    /** Nombre de filtres avancés actifs, affiché en pastille. */
    activeAdvancedFilters: number;

    /** Compteurs de l'en-tête (dont les urgents). */
    stats: Record<string, any>;
    /** Nombre de dossiers urgents : le filtre n'apparaît que s'il y en a. */
    urgents: number;
    /** Invitations en attente, affichées en pastille sur la bascule. */
    pendingInvitationsCount: number;
    /** Conteneur du menu de tri, pour la fermeture au clic extérieur. */
    sortMenuRef: React.RefObject<HTMLDivElement>;
}

const BarreFiltresDossiersBase: React.FC<BarreFiltresDossiersProps> = ({
    filterStatus, setFilterStatus, filterCategory, setFilterCategory,
    filterDomain, setFilterDomain, filterRole, setFilterRole,
    sortOption, setSortOption,
    showInvitationsOnly, setShowInvitationsOnly,
    voirToutEntreprise, setVoirToutEntreprise, nbDossiersCollegues,
    isFilterMenuOpen, setIsFilterMenuOpen, isSortMenuOpen, setIsSortMenuOpen,
    activeAdvancedFilters, stats, urgents, pendingInvitationsCount, sortMenuRef,
}) => {
    return (
        <div className="px-6 py-3 border-b border-white/30 flex flex-wrap items-center justify-between gap-4 shrink-0 bg-white/10">
          <div className="flex flex-wrap gap-3 items-center flex-1">
            {/* Invitations Toggle Moved Here */}
            <button
                onClick={() => {
                  const next = !showInvitationsOnly;
                  setShowInvitationsOnly(next);
                  if (next) setFilterStatus('Tous');
                }}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all relative border ${
                  showInvitationsOnly 
                  ? "bg-[#00A3E0] text-white border-[#00A3E0] shadow-md scale-105" 
                  : "bg-white/60 text-[#0B1F38]/70 border-white/80 hover:bg-white/90"
                }`}
              >
                <Users size={14} />
                <span>Invitations</span>
                {pendingInvitationsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#FF8575] text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
                    {pendingInvitationsCount}
                  </span>
                )}
              </button>

            {/* Bascule « toute l'entreprise ».
                Masquée s'il n'y a rien à basculer : un bouton qui ne change
                jamais rien apprend à l'ignorer. */}
            {nbDossiersCollegues > 0 && !showInvitationsOnly && (
              <button
                onClick={() => setVoirToutEntreprise(v => !v)}
                title={voirToutEntreprise
                  ? "Revenir à vos dossiers uniquement"
                  : `Afficher aussi les ${nbDossiersCollegues} dossier${nbDossiersCollegues > 1 ? 's' : ''} portés par vos collègues`}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
                  voirToutEntreprise
                  ? "bg-[#00A3E0] text-white border-[#00A3E0] shadow-md"
                  : "bg-white/60 text-[#0B1F38]/70 border-white/80 hover:bg-white/90"
                }`}
              >
                <Briefcase size={14} />
                <span>{voirToutEntreprise ? "Toute l'entreprise" : 'Mes dossiers'}</span>
              </button>
            )}

            <div className="h-6 w-px bg-[#0B1F38]/10 mx-1" />

            {/* Compact Status Filter */}
            <div className="flex items-center gap-1 bg-white/60 border border-white/80 rounded-xl p-1 shadow-sm overflow-x-auto max-w-full">
              <button 
                onClick={() => setFilterStatus('Tous')} 
                className={`flex items-center px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${filterStatus === 'Tous' ? 'bg-[#00A3E0] text-white shadow-sm' : 'text-[#0B1F38]/60 hover:text-[#0B1F38] hover:bg-white/50'}`}
              >
                Tous
              </button>

              {/* Filtre « Urgents » : conditionnel — n'apparaît que s'il existe
                  des AO dont l'échéance est proche (< 7 j), et jamais en vue
                  invitations. Transverse au statut. */}
              {!showInvitationsOnly && stats.urgents > 0 && (
                <button
                  onClick={() => setFilterStatus('Urgents')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${filterStatus === 'Urgents' ? 'bg-[#FF8575] text-white shadow-sm' : 'text-[#FF8575] hover:bg-[#FF8575]/10'}`}
                  title="Échéance dans moins de 7 jours"
                >
                  <AlertCircle size={12} className={filterStatus === 'Urgents' ? 'text-white' : 'text-[#FF8575]'} />
                  Urgents ({stats.urgents})
                </button>
              )}
              
              {(!showInvitationsOnly 
                ? [STATUSES.on, STATUSES.submitted, STATUSES.won, STATUSES.lost] 
                : ["En attente", "Refusé"]).map(st => {
                let Icon = Clock;
                if (st === STATUSES.won) Icon = Trophy;
                if (st === STATUSES.lost || st === "Refusé") Icon = Frown;
                if (st === STATUSES.submitted) Icon = CheckCircle2;
                if (st === 'En attente') Icon = Users;

                return (
                  <button 
                    key={st} 
                    onClick={() => setFilterStatus(st)} 
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${filterStatus === st ? 'bg-white text-[#00A3E0] shadow-sm ring-1 ring-[#00A3E0]/20' : 'text-[#0B1F38]/60 hover:text-[#0B1F38] hover:bg-white/50'}`}
                  >
                    <Icon size={12} className={filterStatus === st ? "text-[#00A3E0]" : "opacity-40"} />
                    {st}
                  </button>
                );
              })}
            </div>

            <div className="h-6 w-px bg-[#0B1F38]/10 mx-1 hidden min-[1100px]:block" />

            {/* Filtres avancés regroupés (Catégorie / Secteur / Rôle) dans un
                popover : la barre restait lisible avec Statut + Invitations en
                accès direct, les selects secondaires débordaient sinon. */}
            <div className="relative filter-container shrink-0">
              <button
                onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all relative border ${
                  isFilterMenuOpen || activeAdvancedFilters > 0
                    ? "bg-[#00A3E0] text-white border-[#00A3E0] shadow-md"
                    : "bg-white/60 text-[#0B1F38]/70 border-white/80 hover:bg-white/90"
                }`}
              >
                <SlidersHorizontal size={14} />
                <span>Filtres</span>
                {activeAdvancedFilters > 0 && (
                  <span className="flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-[#FF8575] text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
                    {activeAdvancedFilters}
                  </span>
                )}
              </button>

              {isFilterMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-white/95 backdrop-blur-xl border border-white/60 rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 origin-top-right space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#0B1F38] uppercase tracking-wide">Filtres</span>
                    {activeAdvancedFilters > 0 && (
                      <button
                        onClick={() => { setFilterCategory('Tous'); setFilterDomain('Tous'); setFilterRole('Tous'); }}
                        className="text-[11px] font-bold text-[#00A3E0] hover:underline"
                      >
                        Réinitialiser
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#0B1F38]/60 mb-1.5"><LayoutGrid size={12} /> Catégorie</label>
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      className="w-full bg-white border border-gray-200 text-[#0B1F38]/80 text-xs font-medium rounded-xl px-3 py-2.5 outline-none cursor-pointer focus:ring-2 focus:ring-[#00A3E0]/20"
                    >
                      <option value="Tous">Toutes les catégories</option>
                      {MARKET_TYPES.map(cat => (<option key={cat.value} value={cat.value}>{cat.label}</option>))}
                    </select>
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#0B1F38]/60 mb-1.5"><Briefcase size={12} /> Secteur</label>
                    <select
                      value={filterDomain}
                      onChange={(e) => setFilterDomain(e.target.value)}
                      className="w-full bg-white border border-gray-200 text-[#0B1F38]/80 text-xs font-medium rounded-xl px-3 py-2.5 outline-none cursor-pointer focus:ring-2 focus:ring-[#00A3E0]/20"
                    >
                      <option value="Tous">Tous les secteurs</option>
                      {SECTORS.map(sec => (<option key={sec.value} value={sec.value}>{sec.label}</option>))}
                    </select>
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#0B1F38]/60 mb-1.5"><Users size={12} /> Rôle</label>
                    <select
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value as 'Tous' | 'Portés' | 'Rejoints')}
                      className="w-full bg-white border border-gray-200 text-[#0B1F38]/80 text-xs font-medium rounded-xl px-3 py-2.5 outline-none cursor-pointer focus:ring-2 focus:ring-[#00A3E0]/20"
                    >
                      <option value="Tous">Tous les rôles</option>
                      <option value="Portés">Portés</option>
                      <option value="Rejoints">Rejoints</option>
                    </select>
                    <p className="text-[10px] text-[#0B1F38]/40 mt-1.5">Les dossiers rejoints ne consomment pas votre quota.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="relative sort-container shrink-0" ref={sortMenuRef}>
            <button 
                onClick={() => setIsSortMenuOpen(!isSortMenuOpen)} 
                className={`p-2.5 rounded-xl border border-white/50 text-[#0B1F38] transition-colors ${isSortMenuOpen ? 'bg-[#00A3E0] text-white border-[#00A3E0]' : 'bg-white/40 hover:bg-white/60'}`}
            >
                <ArrowUpDown size={18} />
            </button>
            {isSortMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-56 bg-white/95 backdrop-blur-xl border border-white/60 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 origin-top-right">
                <button onClick={() => { setSortOption('date_asc'); setIsSortMenuOpen(false); }} className={`w-full text-left px-5 py-2.5 text-xs hover:bg-[#00A3E0]/10 transition-colors flex items-center gap-2 ${sortOption === 'date_asc' ? 'text-[#00A3E0] font-bold' : 'text-[#0B1F38]'}`}><Clock size={14} /> Échéance proche</button>
                <button onClick={() => { setSortOption('date_desc'); setIsSortMenuOpen(false); }} className={`w-full text-left px-5 py-2.5 text-xs hover:bg-[#00A3E0]/10 transition-colors flex items-center gap-2 ${sortOption === 'date_desc' ? 'text-[#00A3E0] font-bold' : 'text-[#0B1F38]'}`}><Clock size={14} /> Échéance lointaine</button>
                <button onClick={() => { setSortOption('titre_asc'); setIsSortMenuOpen(false); }} className={`w-full text-left px-5 py-2.5 text-xs hover:bg-[#00A3E0]/10 transition-colors flex items-center gap-2 ${sortOption === 'titre_asc' ? 'text-[#00A3E0] font-bold' : 'text-[#0B1F38]'}`}><Search size={14} /> Ordre alphabétique</button>
                <button onClick={() => { setSortOption('score_desc'); setIsSortMenuOpen(false); }} className={`w-full text-left px-5 py-2.5 text-xs hover:bg-[#00A3E0]/10 transition-colors flex items-center gap-2 ${sortOption === 'score_desc' ? 'text-[#00A3E0] font-bold' : 'text-[#0B1F38]'}`}><TrendingUp size={14} /> Score de succès</button>
              </div>
            )}
          </div>
        </div>
    );
};

export const BarreFiltresDossiers = memo(BarreFiltresDossiersBase);
