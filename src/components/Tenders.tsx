import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useToast } from './ui/Toast';
import {
  CheckCircle2, AlertCircle, ArrowUpDown, Search, Users,
  Pencil, Trash2, X, Plus,
  MoreVertical, Eye, Archive, Lock, LayoutGrid, List, Trophy, Frown,
  Clock, TrendingUp, Briefcase, FileText
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { Tender } from '../types';
import {
  SECTORS, MARKET_TYPES, STATUSES,
  UserProfile,
  PLANS_CONFIG, PlanType, PLANS_TYPES
} from '../config';
import { canCreateTender } from '@/helpers/planHelpers';
import { getEffectiveStatus, isActive } from '@/helpers/tenderHelpers';
import { GLASS_STYLE } from '../lib/styles';
import { LimitReachedModal } from './LimitReachedModal';
import { RatePartnersModal } from './RatePartnersModal';
import { notifyTenderWon, notifyTenderLost } from '../helpers/notificationHelpers';

// --- TYPES ---

export interface TendersProps {
  onAddTender: () => void;
  cachedTenders?: Tender[];
  onTendersLoad?: (tenders: Tender[]) => void;
  onTenderUpdate?: () => void;
  cachedCollaborators?: any[];
  onCollaboratorsLoad?: (collaborators: any[]) => void;
  onEditDraft?: (id: string) => void;
  userProfile: UserProfile;
  onNavigate?: (tab: string) => void;
}


// --- MAIN COMPONENT ---

export const Tenders: React.FC<TendersProps> = ({
  onAddTender, cachedTenders, onTendersLoad, onTenderUpdate,
  cachedCollaborators, onCollaboratorsLoad, onEditDraft, userProfile,
  onNavigate
}) => {
  const { showToast } = useToast();
  const userId = userProfile?.id;

  // State
  const [tenders, setTenders] = useState<Tender[]>(cachedTenders || []);
  const [collaborators, setCollaborators] = useState<any[]>(cachedCollaborators || []);
  const [existingCollaborators, setExistingCollaborators] = useState<any[]>([]);

  const [loading, setLoading] = useState(!cachedTenders);

  // Action Menu State
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('Tous');
  const [outcomeConfirm, setOutcomeConfirm] = useState<{ id: string; type: 'won' | 'lost' } | null>(null);
  const [filterCategory, setFilterCategory] = useState('Tous');
  const [filterDomain, setFilterDomain] = useState('Tous');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [sortOption, setSortOption] = useState<'date_asc' | 'date_desc' | 'titre_asc' | 'score_desc'>('date_asc');
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

  // Forms
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState<string | null>(null);
  const [showInvitationsOnly, setShowInvitationsOnly] = useState(false);


  // Rating Modal State
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [selectedTenderForRating, setSelectedTenderForRating] = useState<Tender | null>(null);

  // --- DERIVED STATE ---
  const creationCheck = useMemo(() => canCreateTender(userProfile, tenders), [userProfile, tenders]);
  const selectedTender = tenders.find(t => t.id === selectedTenderId);

  const stats = useMemo(() => {
    const won = tenders.filter(t => t.statut === STATUSES.won).length;
    const lost = tenders.filter(t => t.statut === STATUSES.lost).length;
    const active = tenders.filter(t => isActive(t)).length;
    const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    return { won, lost, active, winRate };
  }, [tenders]);
 
  const pendingInvitationsCount = useMemo(() => {
    return tenders.filter(t => {
      const myGroupement = t.groupements?.find((g: any) => 
        (userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id) ||
        (g.entreprise?.membres?.some((m: any) => m.id === userId))
      );
      const myInvitation = t.invitations?.find((i: any) => i.email === userProfile?.email);
      
      const isRefused = myGroupement?.statut === 'refuse' || myInvitation?.status === 'refused';
      const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
      return isPending && !isRefused;
    }).length;
  }, [tenders, userProfile?.entreprise_id, userProfile?.email, userId]);


  const recentActivity = useMemo(() => {
    return [...tenders]
      .sort((a, b) => new Date(b.modified_at || b.created_at).getTime() - new Date(a.modified_at || a.created_at).getTime())
      .slice(0, 10);
  }, [tenders]);


  // --- EFFECTS ---

  useEffect(() => {
    // If cache is present and NOT empty, use it. 
    // If it's empty (refreshed by parent) or undefined, we fetch.
    if (cachedTenders && cachedTenders.length > 0 && cachedCollaborators && cachedCollaborators.length > 0) {
      loadExistingCollaborators(userProfile?.id)
      setTenders(cachedTenders);
      setCollaborators(cachedCollaborators);
      setLoading(false);
    } else if (cachedTenders && cachedTenders.length > 0 && !cachedCollaborators) {
      loadExistingCollaborators(userProfile?.id)
      setTenders(cachedTenders);
      fetchCurrentUserAndCollaborators(cachedTenders);
    } else {
      loadExistingCollaborators(userProfile?.id);
      fetchTenders();
    }
  }, [cachedTenders, cachedCollaborators, userProfile?.id]);

  // Session storage check for deep linking
  useEffect(() => {
    const tenderIdToOpen = sessionStorage.getItem('openTenderId');
    if (tenderIdToOpen && tenders.length > 0) {
      const tenderExists = tenders.find(t => t.id === tenderIdToOpen);
      if (tenderExists) {
        if (onEditDraft) onEditDraft(tenderIdToOpen);
      }
      sessionStorage.removeItem('openTenderId');
    }
  }, [tenders, onEditDraft]);

  // --- LOGIC: FETCHING ---
  const fetchCurrentUserAndCollaborators = async (tendersData: Tender[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await fetchCollaborators(tendersData, user.email || null);
    }
    setLoading(false);
  };

  const loadExistingCollaborators = async (uId: string) => {
    try {
      const userResult = await supabase
        .from('utilisateurs')
        .select('entreprise_id')
        .eq('id', uId)
        .single();

      if (!userResult.data?.entreprise_id) {
        setExistingCollaborators([]);
        return;
      }

      const { data, error } = await supabase
        .from('groupements')
        .select(`
          id,
          role_groupement,
          statut,
          entreprise_id,
          projet_id,
          entreprise:entreprises (
            id,
            nom,
            logo_url,
            membres:utilisateurs!utilisateurs_entreprise_id_fkey (id, email, nom, prenom, photo_url)
          )
        `)
        .in('projet_id', (
          await supabase.from('reponses_ao').select('id').eq('createur_id', uId)
        ).data?.map(t => t.id) || []);

      if (error) throw error;

      const distinctCollabs = new Map<string, any>();
      data?.forEach((g: any) => {
        const ref = g.entreprise?.membres?.[0];
        if (!ref || ref.id === uId) return;
        if (!distinctCollabs.has(ref.id)) {
          distinctCollabs.set(ref.id, {
            email: ref.email,
            nom: ref.nom || '',
            prenom: ref.prenom || '',
            photo_url: ref.photo_url,
            company: g.entreprise?.nom,
            role: g.role_groupement,
            id: ref.id
          });
        }
      });

      setExistingCollaborators(Array.from(distinctCollabs.values()));
    } catch (error) {
      console.error('Error loading collaborators:', error);
    }
  };

  const fetchTenders = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || !user.email) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('reponses_ao')
        .select(`
          *,
          createur:utilisateurs!createur_id (id, email, nom, prenom, photo_url),
          groupements (
            id,
            role_groupement,
            statut,
            entreprise_id,
            entreprise:entreprises (
              id,
              nom,
              logo_url,
              membres:utilisateurs!utilisateurs_entreprise_id_fkey (id, email, nom, prenom, photo_url)
            )
          ),
          invitations (
            id,
            email,
            status
          )
        `);

      if (error) throw error;

      const validTenders = (data as unknown as Tender[]) || [];
      validTenders.sort((a, b) => {
        const dateA = new Date(a.date_limite || 0).getTime();
        const dateB = new Date(b.date_limite || 0).getTime();
        return dateA - dateB;
      });

      // Keep all non-refused tenders (both accepted and pending)
      const visibleTenders = validTenders.filter(t => {
        const myGroupement = t.groupements?.find((g: any) => 
          (userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id) ||
          (g.entreprise?.membres?.some((m: any) => m.id === userId))
        );
        const myInvitation = t.invitations?.find((i: any) => i.email === userProfile?.email);

        const isRefused = myGroupement?.statut === 'refuse' || myInvitation?.status === 'refused';
        return myGroupement || myInvitation || t.createur_id === userId;
      });

      setTenders(visibleTenders);
      await fetchCollaborators(visibleTenders, user.email);

      if (onTendersLoad) {
        onTendersLoad(visibleTenders);
      }
    } catch (error) {
      console.error('Error fetching tenders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCollaborators = async (tendersData: Tender[], userEmail: string | null) => {
    try {
      const uniqueCollabs = new Map<string, any>();
      tendersData.forEach((tender: any) => {
        const groupements = tender.groupements;
        if (!Array.isArray(groupements)) return;

        groupements.forEach((g: any) => {
          const ref = g.entreprise?.membres?.[0];
          if (!ref || ref.email === userEmail) return;

          if (!uniqueCollabs.has(ref.id)) {
            uniqueCollabs.set(ref.id, {
              id: ref.id,
              email: ref.email,
              nom: ref.nom || '',
              prenom: ref.prenom || '',
              photo_url: ref.photo_url,
              company: g.entreprise?.nom,
              role: g.role_groupement,
              tenders: [{ id: tender.id, titre: tender.titre }],
              firstSeen: tender.created_at
            });
          } else {
            const existing = uniqueCollabs.get(ref.id);
            existing.tenders.push({ id: tender.id, titre: tender.titre });
          }
        });
      });

      const finalCollaborators = Array.from(uniqueCollabs.values());
      setCollaborators(finalCollaborators);

      if (onCollaboratorsLoad) {
        onCollaboratorsLoad(finalCollaborators);
      }
    } catch (error) {
      console.error('Error fetching collaborators:', error);
      setCollaborators([]);
    }
  };

  const OutcomeConfirmationModal = () => {
    if (!outcomeConfirm) return null;
    const isWon = outcomeConfirm.type === 'won';
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-sm" onClick={() => setOutcomeConfirm(null)}></div>
        <div className="relative bg-white rounded-[2rem] p-10 max-w-md w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${isWon ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
            {isWon ? <Trophy size={40} /> : <Frown size={40} />}
          </div>
          <h2 className="text-2xl font-bold text-[#0B1F38] mb-4 font-outfit">
            {isWon ? "Félicitations !" : "Résultat du marché"}
          </h2>
          <p className="text-[#0B1F38]/60 mb-8 font-medium">
            {isWon
              ? "Confirmez-vous que vous avez remporté ce marché ?"
              : "Confirmez-vous que ce marché est perdu ?"}
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => setOutcomeConfirm(null)}
              className="flex-1 py-3 px-4 border border-[#0B1F38]/10 rounded-xl font-bold text-[#0B1F38] hover:bg-gray-50 transition-all font-outfit"
            >
              Annuler
            </button>
            <button
              onClick={executeOutcome}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-white transition-all shadow-lg font-outfit ${isWon ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
            >
              Confirmer
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleOpenTender = (statut: string, id: string) => {
    if (onEditDraft) onEditDraft(id);
  };

  const handleOpenTeam = (e: React.MouseEvent, tender: Tender) => {
    e.stopPropagation();
    if (onEditDraft) onEditDraft(tender.id);
  };

  const handleDelete = async (tenderId: string) => {
    if (!selectedTenderId || !selectedTender) return;

    try {
      setLoading(true);
      // La suppression passe par une fonction serveur : les pièces d'un AO
      // vivent dans le dossier de chaque déposant, et la policy DELETE ne
      // couvre que le dossier de l'appelant et celui de son entreprise
      // (migration 037). Le repérage côté client retirait la ligne en base et
      // laissait les fichiers des autres membres derrière lui, sans erreur.
      const { data: purge, error: purgeError } = await supabase.functions.invoke(
        'delete-tender-documents',
        { body: { tenderId: selectedTenderId } }
      );

      if (purgeError || purge?.error) {
        // On n'interrompt pas la suppression du dossier pour autant : mieux
        // vaut des fichiers orphelins qu'un AO à moitié supprimé.
        console.error('Purge des pièces incomplète', purgeError ?? purge?.error);
      }

      const totalSizeFreed = Number(purge?.octetsLiberes ?? 0);
      if (totalSizeFreed > 0) {
        await supabase.rpc('increment_storage_usage', {
          user_id: userProfile?.id,
          bytes_added: -totalSizeFreed
        });
      }

      try {
        await supabase.functions.invoke('sync-google-calendar', {
          body: { action: 'delete_tender', tenderId: selectedTenderId }
        });
      } catch (calErr) {
        console.error("Failed to delete from Google Calendar:", calErr);
      }

      const { error: deleteDbError } = await supabase
        .from('reponses_ao')
        .delete()
        .eq('id', selectedTenderId);

      if (deleteDbError) throw deleteDbError;

      setIsDeleteModalOpen(false);
      if (onTenderUpdate) onTenderUpdate();

      if (userProfile && totalSizeFreed > 0) {
        userProfile.storage_used = Math.max(0, (userProfile.storage_used || 0) - totalSizeFreed);
      }

      fetchTenders();
      setSelectedTenderId(null);
      showToast("Appel d'offres supprimé avec succès.", 'success');

    } catch (error) {
      console.error('Error deleting tender:', error);
      showToast('Erreur lors de la suppression.', 'error');
    } finally {
      setLoading(false);
    }
  };  const handleOutcome = async (e: React.MouseEvent, tenderId: string, outcome: 'won' | 'lost') => {
    e.stopPropagation();
    setOutcomeConfirm({ id: tenderId, type: outcome });
  };

  const executeOutcome = async () => {
    if (!outcomeConfirm) return;
    const { id: tenderId, type: outcome } = outcomeConfirm;
    const newStatus = outcome === 'won' ? STATUSES.won : STATUSES.lost;

    try {
      setLoading(true);
      const { error } = await supabase
        .from('reponses_ao')
        .update({ statut: newStatus })
        .eq('id', tenderId);

      if (error) throw error;

      const tender = tenders.find(t => t.id === tenderId);
      showToast(outcome === 'won' ? "Félicitations pour cette victoire !" : "Statut mis à jour.", 'success');
      setOutcomeConfirm(null);
      fetchTenders();
      if (onTenderUpdate) onTenderUpdate();

      // Notifications
      if (outcome === 'won') {
        await notifyTenderWon(userProfile?.id, tenderId, tender?.titre || 'Appel d\'offres', tender?.montant_estime || 0);
      } else {
        await notifyTenderLost(userProfile?.id, tenderId, tender?.titre || 'Appel d\'offres');
      }
    } catch (error) {
      console.error("Error updating outcome:", error);
      showToast("Erreur lors de la mise à jour.", 'error');
    } finally {
      setLoading(false);
    }
  };

  const processedTenders = useMemo(() => {
    let result = [...tenders];

    // 1. Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(t =>
        (t.titre && t.titre.toLowerCase().includes(query)) ||
        (t.organisme_acheteur && t.organisme_acheteur.toLowerCase().includes(query)) ||
        (t.statut && t.statut.toLowerCase().includes(query))
      );
    }

    // 2. Filter by status, category, domain AND REFUSAL
    result = result.filter(t => {
      // Hide tenders where I refused the invitation
      // Check in groupements
      const myGroupement = t.groupements?.find((g: any) => 
        (userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id) ||
        (g.entreprise?.membres?.some((m: any) => m.id === userId))
      );

      // Check in email invitations
      const myInvitation = t.invitations?.find((i: any) => i.email === userProfile?.email);

      // Filter by category
      if (filterCategory !== 'Tous') {
        const matchesCat = Array.isArray(t.type_marche) ? t.type_marche.includes(filterCategory) : t.type_marche === filterCategory;
        if (!matchesCat) return false;
      }

      // Filter by domain
      if (filterDomain !== 'Tous' && t.secteur_activite !== filterDomain) return false;

      // Handle pending/accepted visibility consistently
      const isRefused = myGroupement?.statut === 'refuse' || myInvitation?.status === 'refused';
      const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';

      if (showInvitationsOnly) {
        if (!isPending && !isRefused) return false;
        
        if (filterStatus === 'En attente' && !isPending) return false;
        if (filterStatus === 'Refusé' && !isRefused) return false;
        return true;
      } else {
        if (isPending || isRefused) return false;
        
        // Filter by main status only when not in invitations view
        if (filterStatus !== 'Tous' && getEffectiveStatus(t) !== filterStatus) return false;
        return true;
      }
    });
    
    result.sort((a, b) => {
      if (showInvitationsOnly) {
         const aGroupement = a.groupements?.find((g: any) => (userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id) || (g.entreprise?.membres?.some((m: any) => m.id === userId)));
         const aInvitation = a.invitations?.find((i: any) => i.email === userProfile?.email);
         const aIsRefused = aGroupement?.statut === 'refuse' || aInvitation?.status === 'refused';
         
         const bGroupement = b.groupements?.find((g: any) => (userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id) || (g.entreprise?.membres?.some((m: any) => m.id === userId)));
         const bInvitation = b.invitations?.find((i: any) => i.email === userProfile?.email);
         const bIsRefused = bGroupement?.statut === 'refuse' || bInvitation?.status === 'refused';
         
         if (aIsRefused && !bIsRefused) return 1;
         if (!aIsRefused && bIsRefused) return -1;
      }

      if (sortOption === 'date_asc') return new Date(a.date_limite || 0).getTime() - new Date(b.date_limite || 0).getTime();
      if (sortOption === 'date_desc') return new Date(b.date_limite || 0).getTime() - new Date(a.date_limite || 0).getTime();
      if (sortOption === 'titre_asc') return (a.titre || '').localeCompare(b.titre || '');
      if (sortOption === 'score_desc') return (b.success_score || 0) - (a.success_score || 0);
      return 0;
    });
    return result;
  }, [tenders, searchQuery, filterStatus, filterCategory, filterDomain, sortOption, showInvitationsOnly, userId, userProfile?.email, userProfile?.entreprise_id]);


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (actionMenuRef.current && !actionMenuRef.current.contains(target)) setActiveActionMenu(null);
      if (isFilterMenuOpen && !target.closest('.filter-container')) setIsFilterMenuOpen(false);
      if (isSortMenuOpen && !target.closest('.sort-container')) setIsSortMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFilterMenuOpen, isSortMenuOpen, activeActionMenu]);

  const handleActionMenuClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveActionMenu(activeActionMenu === id ? null : id);
  };

  const handleEditTender = (e: React.MouseEvent, tender: Tender) => {
    e.stopPropagation();
    setSelectedTenderId(tender.id);
    if (onEditDraft) onEditDraft(tender.id);
    setActiveActionMenu(null);
  };

  const getDaysRemaining = (dateString: string) => {
    const deadline = new Date(dateString);
    return Math.ceil((deadline.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case STATUSES.won: return "bg-green-100 text-green-700 border-green-200";
      case STATUSES.lost: return "bg-red-50 text-red-600 border-red-100";
      case STATUSES.on: return "bg-[#00A3E0]/10 text-[#00A3E0] border-[#00A3E0]/20";
      case STATUSES.expired: return "bg-amber-50 text-amber-600 border-amber-200";
      case STATUSES.submitted: return "bg-blue-100 text-blue-700 border-blue-200";
      case STATUSES.draft: return "bg-gray-100 text-gray-600 border-gray-200";
      default: return "bg-[#0B1F38]/5 text-[#0B1F38]/70 border-[#0B1F38]/10";
    }
  };

  const getCountBadgeStyle = (status: string) => {
    if (status === STATUSES.on) return "bg-[#00A3E0]/20 text-[#007AA8]";
    if (status === STATUSES.won) return "bg-green-100 text-green-700";
    if (status === STATUSES.lost) return "bg-red-50 text-red-600";
    if (status === STATUSES.expired) return "bg-amber-100 text-amber-600";
    if (status === STATUSES.submitted) return "bg-blue-100 text-blue-700";
    return "bg-gray-200 text-gray-600";
  };

  const DeleteConfirmationModal = () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-sm" onClick={() => setIsDeleteModalOpen(false)}></div>
      <div className="relative bg-white rounded-[2rem] p-10 max-w-sm w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6 text-red-500">
          <Trash2 size={32} />
        </div>
        <h3 className="text-xl font-bold text-[#0B1F38] mb-4">Supprimer le dossier ?</h3>
        <p className="text-[#0B1F38]/60 mb-8 text-sm leading-relaxed">
          Cette action est irréversible. Toutes les données associées seront définitivement supprimées.
        </p>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsDeleteModalOpen(false)}
            className="flex-1 py-3 text-sm font-bold text-[#0B1F38]/40 hover:bg-gray-50 rounded-xl transition-all border border-[#0B1F38]/10"
          >
            Annuler
          </button>
          <button 
            onClick={handleDelete}
            className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-bold text-sm rounded-xl transition-all shadow-lg"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );

  const renderSidebar = () => (
    <div className="flex flex-col gap-6 h-full overflow-visible">
      {/* Stats Summary */}
      <div className={`${GLASS_STYLE} rounded-3xl p-6 flex flex-col gap-4`}>
        <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-[#0B1F38]/50 uppercase tracking-wider">Performance</h3>
            <div className="flex items-center text-[#00A3E0] text-[10px] font-bold bg-white/60 px-2 py-0.5 rounded-lg border border-white/60 shadow-sm">
                <TrendingUp size={12} className="mr-1" /> {stats.winRate}%
            </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/40 p-3 rounded-2xl border border-white/60 flex flex-col">
                <span className="text-2xl font-bold text-[#0B1F38]">{stats.active}</span>
                <span className="text-[10px] font-medium text-[#0B1F38]/50 uppercase">En cours</span>
            </div>
            <div className="bg-green-50/40 p-3 rounded-2xl border border-green-100 flex flex-col">
                <span className="text-2xl font-bold text-green-600">{stats.won}</span>
                <span className="text-[10px] font-medium text-green-600/50 uppercase">Gagnés</span>
            </div>
        </div>
        
        <div className="pt-2">
            <div className="flex justify-between text-[10px] mb-1.5 font-bold text-[#0B1F38]/60 px-0.5 uppercase tracking-tighter">
                <span>Taux de succès</span>
                <span>{stats.winRate}%</span>
            </div>
            <div className="w-full bg-[#0B1F38]/10 rounded-full h-1.5 overflow-hidden">
                <div 
                    className="h-full bg-[#00A3E0] rounded-full transition-all duration-1000"
                    style={{ width: `${stats.winRate}%` }}
                ></div>
            </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className={`${GLASS_STYLE} rounded-3xl p-6 flex-1 flex flex-col min-h-0 overflow-hidden`}>
        <h3 className="text-sm font-bold text-[#0B1F38]/50 uppercase tracking-wider mb-4">Activité Récente</h3>
        <div className="flex-1 overflow-y-auto custom-scrollbar-dark pr-2">
            <ul className="space-y-4">
                {recentActivity.map(t => {
                    let icon = <Clock size={14} />;
                    let actionLabel = "Mis à jour";
                    let color = "text-[#00A3E0]";

                    if (t.statut === STATUSES.won) {
                        icon = <Trophy size={14} />;
                        actionLabel = "Remporté";
                        color = "text-green-600";
                    } else if (t.statut === STATUSES.lost) {
                        icon = <Frown size={14} />;
                        actionLabel = "Perdu";
                        color = "text-red-500";
                    }

                    return (
                        <li key={t.id} className="flex gap-3 group cursor-pointer" onClick={() => handleOpenTender(t.statut, t.id)}>
                            <div className={`mt-1 h-7 w-7 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm border border-gray-100 ${color}`}>
                                {icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs text-[#0B1F38]/90 font-medium">
                                    <span className={`font-bold ${color}`}>{actionLabel}</span>
                                </p>
                                <p className="text-[11px] text-[#0B1F38] truncate font-bold mt-0.5">{t.titre}</p>
                                <p className="text-[10px] text-[#0B1F38]/40 mt-0.5">{new Date(t.modified_at || t.created_at).toLocaleDateString()}</p>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
      </div>
    </div>
  );

  const renderList = () => (
    <div className={`flex-1 ${GLASS_STYLE} rounded-3xl flex flex-col overflow-hidden h-full animate-in fade-in slide-in-from-bottom-4 duration-500`}>
        {/* Header Section */}
        <div className={`p-6 border-b border-white/30 flex flex-col ${isSidebarOpen ? 'xl:flex-row' : 'md:flex-row'} justify-between items-start ${isSidebarOpen ? 'xl:items-center' : 'md:items-center'} gap-4 shrink-0 transition-all`}>
          <div>
            <h1 className={`font-bold text-[#00A3E0] transition-all ${isSidebarOpen ? 'text-xl' : 'text-3xl'}`}>
               {showInvitationsOnly ? "Invitations en attente" : "Mes appels d'offres"}
            </h1>
            {!isSidebarOpen && <p className="text-sm text-[#0B1F38]/60 mt-1">
              {showInvitationsOnly ? "Répondez aux invitations pour rejoindre des groupements" : "Gerez et suivez vos candidatures"}
            </p>}
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="flex bg-white/40 border border-white/50 rounded-xl p-1 shrink-0">
              <button 
                onClick={() => setViewMode('list')} 
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-[#00A3E0] text-white shadow-sm' : 'text-[#0B1F38]/40 hover:text-[#0B1F38]'}`}
                title="Mode Liste"
              >
                <List size={18} />
              </button>
              <button 
                onClick={() => setViewMode('grid')} 
                className={`p-1.5 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-[#00A3E0] text-white shadow-sm' : 'text-[#0B1F38]/40 hover:text-[#0B1F38]'}`}
                title="Mode Grille"
              >
                <LayoutGrid size={18} />
              </button>
            </div>
            <div className="relative group flex-1 md:w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 group-focus-within:text-[#00A3E0] transition-colors" size={18} />
              <input 
                type="text" 
                value={searchQuery} 
                onChange={(e) => setSearchQuery(e.target.value)} 
                placeholder="Rechercher..." 
                className="w-full bg-white/40 border border-white/50 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A3E0] transition-all" 
              />
            </div>
            <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
                className={`p-2.5 rounded-xl transition-all border flex items-center justify-center gap-2 ${isSidebarOpen ? 'bg-[#007AA8] text-white border-[#007AA8] shadow-lg shadow-[#007AA8]/20' : 'bg-white/40 text-[#0B1F38]/70 border-white/50 hover:bg-white/60'}`}
                title={isSidebarOpen ? "Fermer le panneau" : "Ouvrir les statistiques"}
            >
                <TrendingUp size={18} />
                {!isSidebarOpen && <span className="text-[10px] font-bold uppercase tracking-widest hidden xl:inline">Stats</span>}
            </button>
            <button 
                onClick={() => creationCheck.allowed ? onAddTender() : setShowLimitModal(true)} 
                className={`flex justify-center items-center gap-2 ${isSidebarOpen ? 'p-2.5' : 'px-5 py-2.5'} rounded-xl font-bold text-sm transition-all shadow-lg ${creationCheck.allowed ? "bg-[#FF8575] text-white shadow-[#FF8575]/20 hover:scale-[1.02] active:scale-95" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
                title="Nouveau"
            >
                <Plus size={18} strokeWidth={3} />
                {!isSidebarOpen && <span className="hidden sm:inline">Nouveau</span>}
            </button>
          </div>
        </div>

        {/* Filter Bar */}
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

            <div className="h-6 w-px bg-[#0B1F38]/10 mx-1" />

            {/* Compact Status Filter */}
            <div className="flex items-center gap-1 bg-white/60 border border-white/80 rounded-xl p-1 shadow-sm overflow-x-auto max-w-full">
              <button 
                onClick={() => setFilterStatus('Tous')} 
                className={`flex items-center px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${filterStatus === 'Tous' ? 'bg-[#00A3E0] text-white shadow-sm' : 'text-[#0B1F38]/60 hover:text-[#0B1F38] hover:bg-white/50'}`}
              >
                Tous
              </button>
              
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

            {/* Redesigned Selects */}
            <div className="flex items-center gap-2">
              <div className="relative group">
                <select 
                  value={filterCategory} 
                  onChange={(e) => setFilterCategory(e.target.value)} 
                  className="bg-white/70 border border-white/90 text-[#0B1F38]/80 text-[11px] font-bold rounded-xl pl-9 pr-6 py-2.5 outline-none appearance-none hover:bg-white/95 hover:border-[#00A3E0]/30 transition-all cursor-pointer shadow-sm focus:ring-2 focus:ring-[#00A3E0]/20"
                >
                  <option value="Tous">Toutes Catégories</option>
                  {MARKET_TYPES.map(cat => (<option key={cat.value} value={cat.value}>{cat.label}</option>))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#00A3E0] pointer-events-none opacity-60 group-hover:opacity-100 transition-opacity">
                  <LayoutGrid size={14} />
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ArrowUpDown size={10} className="rotate-90" />
                </div>
              </div>

              <div className="relative group">
                <select 
                  value={filterDomain} 
                  onChange={(e) => setFilterDomain(e.target.value)} 
                  className="bg-white/70 border border-white/90 text-[#0B1F38]/80 text-[11px] font-bold rounded-xl pl-9 pr-6 py-2.5 outline-none appearance-none hover:bg-white/95 hover:border-[#00A3E0]/30 transition-all cursor-pointer shadow-sm focus:ring-2 focus:ring-[#00A3E0]/20"
                >
                  <option value="Tous">Tous Secteurs</option>
                  {SECTORS.map(sec => (<option key={sec.value} value={sec.value}>{sec.label}</option>))}
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#00A3E0] pointer-events-none opacity-60 group-hover:opacity-100 transition-opacity">
                  <Briefcase size={14} />
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ArrowUpDown size={10} className="rotate-90" />
                </div>
              </div>
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

        {/* Tender Grid/List */}
        <div className="flex-1 overflow-auto custom-scrollbar-dark p-6">
          {processedTenders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[#0B1F38]/40 gap-4">
                {showInvitationsOnly ? (
                  <>
                    <Users size={64} strokeWidth={1} className="opacity-20" />
                    <p className="text-sm font-bold uppercase tracking-widest">Aucune invitation en attente</p>
                    <p className="text-xs text-center max-w-xs">Vous n'avez pas d'invitation à rejoindre un groupement pour le moment.</p>
                  </>
                ) : (
                  <>
                    <Briefcase size={64} strokeWidth={1} className="opacity-20" />
                    <p className="text-sm font-bold uppercase tracking-widest">Aucun appel d'offres trouvé</p>
                    <button onClick={() => { setSearchQuery(''); setFilterStatus('Tous'); setFilterCategory('Tous'); setFilterDomain('Tous'); }} className="text-xs font-bold text-[#00A3E0] hover:underline px-4 py-2 bg-[#00A3E0]/10 rounded-xl transition-colors">Réinitialiser les filtres</button>
                  </>
                )}
            </div>
          ) : (
            <div className={viewMode === 'list' ? "space-y-4" : "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6"}>
              {processedTenders.map(tender => {
                const daysLeft = getDaysRemaining(tender.date_limite);
                const groupementsArr: any[] = (tender as any).groupements || [];
                const invitationsArr: any[] = (tender as any).invitations || [];
                const creator = (tender as any).createur;
                const uniqueTeam = new Map<string, { photo?: string; name?: string; email: string; isPending?: boolean }>();

                // Team avatars logic
                if (creator) uniqueTeam.set(creator.email, { photo: creator.photo_url, name: `${creator.prenom || ''} ${creator.nom || ''}`.trim() || creator.email, email: creator.email });
                else if (tender.createur_id === userId && userProfile) uniqueTeam.set(userProfile.email, { photo: userProfile.photo_url, name: `${userProfile.prenom || ''} ${userProfile.nom || ''}`.trim(), email: userProfile.email });
                groupementsArr?.filter((g: any) => g.statut === 'accepte').forEach((g: any) => {
                  const ref = g.entreprise?.membres?.[0];
                  if (ref && !uniqueTeam.has(ref.email)) uniqueTeam.set(ref.email, { photo: ref.photo_url, name: `${ref.prenom || ''} ${ref.nom || ''}`.trim() || g.entreprise?.nom || ref.email, email: ref.email });
                });
                invitationsArr?.filter((i: any) => i.status === 'pending').forEach((i: any) => { if (!uniqueTeam.has(i.email)) uniqueTeam.set(i.email, { email: i.email, isPending: true }); });

                const teamAvatars = Array.from(uniqueTeam.values()).map(m => m.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name || m.email || 'U')}&background=${m.isPending ? 'F06A50' : '0B1F38'}&color=fff`).slice(0, 3);
                const totalTeamSize = uniqueTeam.size;
                const myGroupement = groupementsArr.find((g: any) => 
                  (userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id) ||
                  (g.entreprise?.membres?.some((m: any) => m.id === userId))
                );
                const myInvitation = invitationsArr.find((i: any) => i.email === userProfile?.email);
                
                const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
                const isRefused = myGroupement?.statut === 'refuse' || myInvitation?.status === 'refused';
                
                const myRoleBadge = tender.createur_id === userId ? 'Mandataire' : (myGroupement || myInvitation) ? (myGroupement?.role_groupement || myInvitation?.role || 'Collaborateur') : 'Collaborateur';
                const effectiveStatus = getEffectiveStatus(tender);
                
                let displayStatus = effectiveStatus;
                let displayStatusStyle = getStatusStyle(effectiveStatus);
                if (showInvitationsOnly) {
                   if (isRefused) {
                      displayStatus = "Refusé";
                      displayStatusStyle = "bg-red-50 text-red-600 border-red-100";
                   } else if (isPending) {
                      displayStatus = "En attente";
                      displayStatusStyle = "bg-orange-50 text-orange-600 border-orange-100";
                   }
                }

                return (
                  <div key={tender.id} onClick={() => handleOpenTender(tender.statut, tender.id)} className="group p-5 bg-white/40 hover:bg-white/95 border border-white/60 rounded-3xl transition-all cursor-pointer shadow-sm hover:shadow-lg relative flex flex-col gap-4">
                    {/* Background decoration - Contained */}
                    <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-[#00A3E0]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </div>
                    
                    <div className="flex justify-between items-start gap-4 relative z-10">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-[#0B1F38] line-clamp-2 leading-tight group-hover:text-[#00A3E0] transition-colors">{tender.titre}</h3>
                        <div className="flex items-center gap-2 mt-2">
                            {(tender.success_score || 0) > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-100 uppercase tracking-tight">Probabilité: {tender.success_score}%</span>}
                            <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-widest">{myRoleBadge}</span>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <span className={`px-4 py-1.5 rounded-2xl text-[10px] font-extrabold border uppercase tracking-wider ${displayStatusStyle}`}>{displayStatus}</span>
                        <div className={`px-3 py-1 rounded-xl text-[10px] font-bold border flex items-center gap-1.5 whitespace-nowrap ${daysLeft < 10 ? 'bg-red-50 text-red-500 border-red-100' : 'bg-[#0B1F38]/5 text-[#0B1F38]/60 border-[#0B1F38]/10'}`}>
                            <Clock size={12} /> {daysLeft >= 0 ? `J-${daysLeft}` : `Exp. ${Math.abs(daysLeft)}j`}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-end relative z-10 pt-2 border-t border-[#0B1F38]/5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium text-[#0B1F38]/60">
                            <span className="truncate">{tender.organisme_acheteur}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-3">
                           <div className="flex items-center gap-2">
                             <div className="flex -space-x-2" onClick={(e) => handleOpenTeam(e, tender)}>
                               {teamAvatars.length > 0 ? teamAvatars.map((img, i) => <img key={i} src={img} className="w-7 h-7 rounded-full border-2 border-white object-cover shadow-sm transition-transform group-hover:scale-110" style={{ transitionDelay: `${i * 50}ms` }} />) : <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center"><Users size={12} /></div>}
                               {totalTeamSize > 3 && <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-[10px] font-bold">+{totalTeamSize - 3}</div>}
                             </div>
                             <span className="text-[10px] font-bold text-[#0B1F38]/30 uppercase tracking-widest">Équipe</span>
                           </div>
                        </div>
                      </div>
                      
                      <div className="relative">
                        <button onClick={(e) => handleActionMenuClick(e, tender.id)} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors text-[#0B1F38]/40 hover:text-[#0B1F38]"><MoreVertical size={20} /></button>
                        {activeActionMenu === tender.id && (
                          <div className="absolute right-0 bottom-full mb-3 w-48 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 py-2 z-[100] animate-in slide-in-from-bottom-2 duration-200 origin-bottom-right">
                            <button onClick={(e) => { e.stopPropagation(); handleOpenTender(tender.statut, tender.id); setActiveActionMenu(null); }} className="w-full text-left px-5 py-3 text-xs font-bold text-[#0B1F38] hover:bg-[#00A3E0]/10 flex items-center gap-3 transition-colors"><Eye size={16} className="text-[#00A3E0]" /> Voir le dossier</button>
                            {tender.createur_id === userId && (
                              <>
                                <button onClick={(e) => handleEditTender(e, tender)} className="w-full text-left px-5 py-3 text-xs font-bold text-[#0B1F38] hover:bg-[#00A3E0]/10 flex items-center gap-3 transition-colors"><Pencil size={16} className="text-amber-500" /> Modifier</button>
                                <div className="h-px bg-gray-100 my-1"></div>
                                <button onClick={(e) => { e.stopPropagation(); setSelectedTenderId(tender.id); setIsDeleteModalOpen(true); setActiveActionMenu(null); }} className="w-full text-left px-5 py-3 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"><Trash2 size={16} /> Supprimer</button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </div>
  );

  return (
    <div className="w-full h-full p-4 overflow-y-auto custom-scrollbar-dark">
      <div className="flex flex-col lg:flex-row gap-8 h-fit lg:h-full items-start lg:items-stretch overflow-visible">
        {/* Main Section */}
        <div className={`transition-all duration-500 ease-in-out h-full overflow-visible flex-1 ${isSidebarOpen ? 'w-full lg:w-[calc(100%-350px)]' : 'w-full'}`}>
            {renderList()}
        </div>

        {/* Sidebar Section */}
        {isSidebarOpen && (
          <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-6 h-fit lg:h-full animate-in slide-in-from-right-10 fade-in duration-500 overflow-visible">
              {renderSidebar()}
          </aside>
        )}
      </div>

      {isDeleteModalOpen && <DeleteConfirmationModal />}
      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onUpgrade={() => { setShowLimitModal(false); if (onNavigate) onNavigate('pricing'); }}
        limitType="activeTenders"
        planLabel={PLANS_CONFIG[(userProfile?.plan as PlanType) || PLANS_TYPES.free]?.label || 'Gratuit'}
        message={creationCheck.message}
      />
      {isRateModalOpen && selectedTenderForRating && (
        <RatePartnersModal
          isOpen={isRateModalOpen}
          onClose={() => {
            setIsRateModalOpen(false);
            setSelectedTenderForRating(null);
          }}
          tenderTitle={selectedTenderForRating.titre}
          partners={selectedTenderForRating.groupements?.filter(g => g.statut === 'accepte' && g.entreprise_id !== userProfile?.entreprise_id).map(g => ({
            id: g.entreprise_id,
            nom: g.entreprise?.nom || 'Partenaire'
          })) || []}
        />
      )}
      {OutcomeConfirmationModal()}
    </div>
  );
};