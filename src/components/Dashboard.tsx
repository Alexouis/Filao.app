import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Tender, Groupement } from '../types';
import {
  STATUSES,
  UserProfile,
  PLANS_CONFIG,
  PLANS_TYPES,
  PlanType,
  REQUIRED_DOCS_BY_ROLE // <--- Added this import
} from '../config';
import { canCreateTender } from '@/helpers/planHelpers';
import { getEffectiveStatus, isActive } from '@/helpers/tenderHelpers';
import { GLASS_STYLE } from '../lib/styles';
import { Plus, Clock, TrendingUp, CheckCircle, MessageSquare, Upload, UserCheck, Lock, Briefcase, FileText, Rocket } from 'lucide-react';
import { LimitReachedModal } from './LimitReachedModal';

interface DashboardProps {
  onNavigate: (tab: any) => void;
  cachedTenders?: Tender[];
  onTendersLoad?: (tenders: Tender[]) => void;
  cachedCollaborators?: any[]; // Legacy, kept for prop compatibility
  onCollaboratorsLoad?: (collaborators: any[]) => void;
  userProfile: UserProfile;
  onEditDraft?: (id: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  onNavigate,
  cachedTenders,
  onTendersLoad,
  cachedCollaborators,
  onCollaboratorsLoad,
  userProfile,
  onEditDraft
}) => {
  const [tenders, setTenders] = useState<Tender[]>(cachedTenders || []);
  const [activeTendersCount, setActiveTendersCount] = useState(0);
  const [loading, setLoading] = useState(!cachedTenders);
  const [showLimitModal, setShowLimitModal] = useState(false);

  const [stats, setStats] = useState({
    winRate: 0,
  });

  // --- 1. FETCH ACTIVE TENDERS COUNT (Plan Limit Logic) ---
  useEffect(() => {
    if (!userProfile || !tenders) return;

    // Use exactly the same logic as planHelpers.ts for consistency
    const activeCount = tenders.filter(t =>
      t.createur_id === userProfile.id &&
      isActive(t)
    ).length;

    setActiveTendersCount(activeCount);
  }, [userProfile, tenders]);

  // --- 2. DATA FETCHING ---
  useEffect(() => {
    // `userProfile` arrive de façon asynchrone : au premier rendu il vaut null,
    // et les deux branches ci-dessous le déréférencent sans garde. L'effet se
    // rejoue de toute façon dès qu'il est chargé, il figure dans les
    // dépendances.
    if (!userProfile) return;

    if (cachedTenders) {
      // Filter out refused tenders even from cache
      const visible = cachedTenders.filter(t => {
        const myGroupement = t.groupements?.find((g: any) => 
          (userProfile.entreprise_id && g.entreprise_id === userProfile.entreprise_id) ||
          (g.entreprise?.membres?.some((m: any) => m.id === userProfile.id))
        );
        if (myGroupement?.statut === 'refuse') return false;

        const myInvitation = t.invitations?.find((i: any) => i.email === userProfile.email);
        if (myInvitation?.status === 'refused') return false;

        // NEW: Hide pending invitations from Dashboard
        const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
        if (isPending) return false;

        return true;
      });

      setTenders(visible);
      calculateStats(visible);
      setLoading(false);
    } else {
      fetchTenders();
    }
  }, [cachedTenders, cachedCollaborators, userProfile]);

  const fetchTenders = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || !user.email) {
        console.error('No user/email logged in');
        setLoading(false);
        return;
      }

      // 1. Fetch Tenders with their Groupements
      // RLS policies on 'reponses_ao' automatically filter visible tenders:
      // - Creator sees everything
      // - Partners see if they are in 'groupements' with status 'accepte'

      // Fetch tenders with their groupements (company + members info for avatars)
      // RLS on reponses_ao and groupements ensures only authorized tenders are returned
      const { data, error } = await supabase
        .from('reponses_ao')
        .select(`
          *,
          createur:utilisateurs!createur_id (id, nom, prenom, email, photo_url),
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

      // 2. Client-side filter to hide tenders where user has 'refuse' status
      const visibleTenders = (data as unknown as Tender[] || []).filter(t => {
        // Check groupements
        const myGroupement = t.groupements?.find((g: any) => 
          (userProfile.entreprise_id && g.entreprise_id === userProfile.entreprise_id) ||
          (g.entreprise?.membres?.some((m: any) => m.id === user.id))
        );
        if (myGroupement?.statut === 'refuse') return false;

        // Check email invitations
        const myInvitation = t.invitations?.find((i: any) => i.email === userProfile.email);
        if (myInvitation?.status === 'refused') return false;

        // NEW: Hide pending invitations from Dashboard
        const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
        if (isPending) return false;

        return true;
      });

      // Sort by last modified
      visibleTenders.sort((a, b) => new Date(b.modified_at || b.created_at).getTime() - new Date(a.modified_at || a.created_at).getTime());


      setTenders(visibleTenders);
      calculateStats(visibleTenders);

      if (onTendersLoad) {
        onTendersLoad(visibleTenders);
      }

    } catch (error) {
      console.error('Error fetching tenders:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (tendersData: Tender[]) => {
    const won = tendersData.filter(t => t.statut === STATUSES.won).length;
    const lost = tendersData.filter(t => t.statut === STATUSES.lost).length;
    const total = won + lost;
    const winRate = total > 0 ? Math.round((won / total) * 100) : 0;

    setStats({ winRate });
  };

  // --- ACTIONS ---

  const handleAddTenderClick = () => {
    const check = canCreateTender(userProfile, tenders);
    if (!check.allowed) {
      setShowLimitModal(true);
      return;
    }
    onNavigate('wizard');
  };

  const handleTenderClick = (tenderId: string, status: string) => {
    if (status === STATUSES.draft && onEditDraft) {
      onEditDraft(tenderId);
    } else {
      sessionStorage.setItem('openTenderId', tenderId);
      onNavigate('tenders');
    }
  };

  // --- HELPERS ---

  // Filter for display list: Only show dossiers that are actively in progress
  // (En cours + deadline not yet passed). Expired/closed dossiers go to Mes AO list.
  const displayTenders = tenders.filter(t =>
    t.statut === STATUSES.draft || isActive(t)
  );

  const getDaysRemaining = (dateString: string) => {
    if (!dateString) return 0;
    const today = new Date();
    const deadline = new Date(dateString);
    const diffTime = deadline.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getDeadlineColor = (days: number) => {
    if (days < 0) return "text-gray-400 bg-gray-100 border-gray-200 border";
    if (days < 5) return "text-red-500 bg-red-50 border-red-200 border";
    if (days < 10) return "text-[#FF8D6D] bg-[#FF8D6D]/[0.04] border-[#FF8D6D] border";
    return "text-[#00A3E0] bg-[#00A3E0]/[0.04] border-[#00A3E0] border";
  };

  // --- PROGRESS LOGIC (UPDATED) ---
  const getProgress = (tender: Tender) => {
    // 1. Helper to get doc count for a role
    const getCountForRole = (role: string) => (REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || []).length;

    // 3. Collaborators docs (from Groupements)
    let collabsDocsCount = 0;

    if (tender.groupements && Array.isArray(tender.groupements)) {
      tender.groupements.forEach((g: Groupement) => {
        // Skip if role is missing or if it's the creator's own company (already counted as Mandataire?)
        // Actually, if creator is in groupements as 'Mandataire', we might double count if we aren't careful.
        // But usually creator isn't in groupements table in legacy data? 
        // In v3.1 creator IS in groupements table as Mandataire.

        // If v3.1: Creator is in groupements.
        // If we count "Mandataire" from groupements, we should NOT add "myDocsCount" separately relative to userProfile.
        // OR we just iterate groupements.

        // Let's rely on groupements if present.
        if (g.role_groupement) {
          collabsDocsCount += getCountForRole(g.role_groupement);
        }
      });
    }

    // If groupements is empty (legacy or not yet migrated fetch?), fallback to simple Mandataire count for creator
    if (!tender.groupements || tender.groupements.length === 0) {
      collabsDocsCount = getCountForRole("Mandataire");
    }

    // Total is sum of all groupement requirements
    // Note: We removed the separate "myDocsCount" to avoid double counting if I am in groupements
    const totalExpected = collabsDocsCount;

    // 4. Calculate Total Received Files
    // Important: We use the DB counter here, not tenderFiles.length (unavailable in dashboard view)
    // Ensure your handleFileUpload/delete updates this column in the DB
    const totalReceived = (tender as any).nb_fichiers_recus || 0;

    // 5. Calculate Percentage
    if (totalExpected === 0) return 0;
    return Math.min(100, Math.round((totalReceived / totalExpected) * 100));
  };

  // --- DYNAMIC DATA ---
  let currentPlanKey = (userProfile?.plan as PlanType) || PLANS_TYPES.free;
  // If the user has a plan that doesn't exist in config (e.g. old data), fallback to free
  if (!PLANS_CONFIG[currentPlanKey]) {
    currentPlanKey = PLANS_TYPES.free;
  }
  const currentPlanConfig = PLANS_CONFIG[currentPlanKey];
  const tenderLimit = currentPlanConfig.limits.activeTenders;
  const isLimitReached = tenderLimit !== 9999 && activeTendersCount >= tenderLimit;

  // Generate Recent Activity
  const dynamicActivity = tenders.slice(0, 5).map(t => {
    let action = "a mis à jour";
    let icon = <Clock size={14} />;
    let color = "text-[#007AA8]";

    if (t.statut === STATUSES.won) { action = "a remporté"; icon = <CheckCircle size={14} />; color = "text-green-600"; }
    else if (t.statut === STATUSES.draft) { action = "a créé le brouillon"; icon = <FileText size={14} />; color = "text-[#D95D4E]"; }

    return {
      id: t.id,
      user: "Vous",
      action: action,
      target: t.titre,
      time: new Date(t.modified_at || t.created_at).toLocaleDateString(),
      icon,
      color
    };
  });

  // Styles — using shared GLASS_STYLE for uniform shadow across all pages

  // Waffle Chart Mock Data
  const docStats = { valid: 12, expiring: 3, expired: 2, total: 17 };
  const totalGridPoints = 24;
  const validPointsCount = Math.round((docStats.valid / docStats.total) * totalGridPoints);
  const expiringPointsCount = Math.round((docStats.expiring / docStats.total) * totalGridPoints);
  const expiredPointsCount = totalGridPoints - validPointsCount - expiringPointsCount;

  if (loading) {
    return (
      <div className="animate-fade-in p-2 md:p-4 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-filao-primary"></div>
          <p className="mt-4 text-filao-dark/70">Chargement des données...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10">
      <main className="flex-1 bg-transparent overflow-hidden  flex flex-col z-10">
        <div className="w-full p-4 mx-auto h-full flex flex-col gap-6">

          <div className="flex-[2.5] min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* --- MAIN TENDER LIST SECTION --- */}
            <section className={`lg:col-span-2 ${GLASS_STYLE} rounded-3xl flex flex-col h-full overflow-hidden`}>
              <div className="p-6 flex justify-between items-center shrink-0 gap-4">
                <p className={`text-sm font-medium ${isLimitReached ? 'text-red-500' : 'text-[#0B1F38]/60'}`}>
                  {activeTendersCount}/{tenderLimit === 9999 ? '∞' : tenderLimit} dossiers actifs (Plan {currentPlanConfig.label})
                </p>
                <button
                  onClick={handleAddTenderClick}
                  className={`flex justify-center items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all transform shadow-lg shrink-0 ${!isLimitReached
                    ? 'bg-[#FF8575] hover:bg-[#ff715e] text-white shadow-[#FF8575]/20 hover:scale-[1.02]'
                    : 'bg-gray-200 text-gray-400 group' // Removed cursor-not-allowed to encourage click, or keep it consistent? Tenders has it.
                    }`}
                >
                  {!isLimitReached ? <Plus size={18} strokeWidth={3} /> : <Lock size={14} className="mr-1" />}
                  Répondre à un AO
                </button>
              </div>

              <div className="px-6 pb-6 space-y-4 flex-1 overflow-y-auto custom-scrollbar-dark">
                {displayTenders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-[#0B1F38]/40">
                    <Briefcase size={40} className="mb-2 opacity-50" />
                    <p>Aucun dossier en cours</p>
                  </div>
                ) : (
                  displayTenders.map((tender) => {
                    const daysLeft = getDaysRemaining(tender.date_limite);
                    const progress = getProgress(tender);

                    return (
                      <div
                        key={tender.id}
                        onClick={() => handleTenderClick(tender.id, tender.statut)}
                        className="group p-5 rounded-2xl border border-white/60 bg-white/40 hover:bg-white/95 hover:border-white/80 transition-all relative cursor-pointer shadow-sm hover:shadow-md"
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h3 className="text-xl font-bold text-[#0B1F38] transition-colors line-clamp-1">{tender.titre}</h3>
                            <p className="text-sm text-[#0B1F38]/60 font-medium mt-1">
                              {tender.organisme_acheteur} • {tender.montant_estime ? `${tender.montant_estime}€` : 'N/C'}
                              {tender.type_groupement && (
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${tender.type_groupement === 'solidaire' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                  {tender.type_groupement}
                                </span>
                              )}
                            </p>
                          </div>
                          <span className={`px-3 py-1.5 rounded-xl text-xs font-extrabold ${getDeadlineColor(daysLeft)} flex items-center gap-1.5 shrink-0 whitespace-nowrap`}>
                            <Clock size={14} /> {daysLeft >= 0 ? `J-${daysLeft}` : `+${Math.abs(daysLeft)}j`}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <div className="flex justify-between text-xs mb-2">
                              <span className="font-semibold text-[#00A3E0] uppercase tracking-wide">{getEffectiveStatus(tender)}</span>
                              <span className="font-bold text-[#0B1F38]">
                                {/* Display percentage */}
                                {progress}%
                              </span>
                            </div>
                            <div className="w-full bg-[#0B1F38]/10 rounded-full h-2.5 overflow-hidden">
                              <div
                                className={`h-2.5 rounded-full transition-all duration-1000 shadow-sm ${progress === 100 ? 'bg-green-500' : 'bg-[#00A3E0]'}`}
                                style={{ width: `${progress}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Upsell Banner - Fixed visual and alignment */}
                {activeTendersCount >= tenderLimit - 1 && tenderLimit !== 9999 && (
                  <div
                    onClick={() => onNavigate('pricing')}
                    className="p-5 rounded-2xl border border-[#0B1F38]/10 bg-gradient-to-br from-white/60 to-white/40 flex flex-col items-center justify-center text-center gap-3 group hover:bg-white/90 hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl"></div>

                    <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center border border-white/60 shadow-sm relative z-10 group-hover:scale-110 transition-transform duration-300">
                      <Rocket size={20} className="text-[#00A3E0]" />
                    </div>

                    <div className="relative z-10">
                      <h3 className="font-bold text-[#0B1F38]">Débloquer plus de dossiers</h3>
                      <p className="text-xs text-[#0B1F38]/60 mt-1 max-w-xs mx-auto">
                        Votre plan actuel est limité à <span className="text-[#0B1F38] font-bold">{tenderLimit} AO actifs simultanés</span>.
                      </p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigate('pricing');
                      }}
                      className="relative z-10 text-xs font-bold text-white bg-[#0B1F38] px-5 py-2.5 rounded-xl hover:bg-[#26367F] transition-colors shadow-lg shadow-[#0B1F38]/10 mt-1"
                    >
                      Voir les offres
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* --- ACTIVITY FEED SECTION --- */}
            <section className={`lg:col-span-1 ${GLASS_STYLE} rounded-3xl flex flex-col h-full overflow-hidden`}>
              <div className="px-4 pb-4 pt-6 flex-1 overflow-y-auto custom-scrollbar-dark">
                <h3 className="px-2 text-sm font-bold text-[#0B1F38]/50 uppercase tracking-wider mb-4">Activité Récente</h3>
                <ul className="space-y-1">
                  {dynamicActivity.length > 0 ? dynamicActivity.map((item) => (
                    <li key={item.id} className="p-4 hover:bg-white/80 rounded-2xl transition-colors flex gap-4 group border-l-2 border-transparent hover:border-[#00A3E0]">
                      <div className="mt-1">{item.icon && <div className={`${item.color} opacity-100`}>{item.icon}</div>}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#0B1F38]/90"><span className="font-bold text-[#0B1F38]">{item.user}</span> {item.action}</p>
                        <p className="text-xs text-[#26367F] mt-0.5 font-medium truncate">{item.target}</p>
                        <p className="text-[10px] text-[#0B1F38]/50 mt-1">{item.time}</p>
                      </div>
                    </li>
                  )) : (
                    <li className="p-4 text-center text-[#0B1F38]/40 text-sm italic">Aucune activité récente</li>
                  )}
                </ul>
              </div>
            </section>
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* --- SUCCESS RATE STATS --- */}
            <section className={`${GLASS_STYLE} rounded-3xl flex flex-col h-full overflow-hidden lg:col-span-2`}>
              <div className="p-6 flex flex-col justify-between h-full relative z-10">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-7xl font-bold text-[#00A3E0] tracking-tighter drop-shadow-sm leading-none">
                      {stats.winRate}%
                    </p>
                    <p className="text-sm text-[#0B1F38]/80 font-medium mt-1">Taux de succès</p>
                  </div>
                  <div className="flex items-center text-[#00A3E0] text-xs font-bold bg-white/60 px-2 py-1 rounded-lg border border-white/60 shadow-sm">
                    <TrendingUp size={14} className="mr-1" /> --%
                  </div>
                </div>
                <div className="flex flex-col gap-2 mt-4">
                  <div className="flex gap-1 h-10 w-full items-end">
                    {[...Array(40)].map((_, i) => (
                      <div key={i} className={`flex-1 rounded-sm transition-all duration-500 ${i < Math.round(stats.winRate / 2.5) ? 'bg-[#00A3E0] shadow-sm' : 'bg-[#0B1F38]/10'}`} style={{ height: '100%' }}></div>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-[#0B1F38]/60 font-medium px-1"><span>0%</span><span>50%</span><span>100%</span></div>
                </div>
              </div>
            </section>

            {/* --- DOCUMENT STATS --- */}
            <section className={`${GLASS_STYLE} rounded-3xl flex flex-col h-full overflow-hidden`}>
              <div className="flex-1 flex flex-col justify-between p-6 z-10">
                <div>
                  <div className="flex flex-wrap gap-2 justify-start content-start mb-4">
                    {[...Array(validPointsCount)].map((_, i) => <div key={`valid-${i}`} className="w-4 h-4 rounded-full bg-[#00A3E0] shadow-sm"></div>)}
                    {[...Array(expiringPointsCount)].map((_, i) => <div key={`expiring-${i}`} className="w-4 h-4 rounded-full bg-[#FF8D6D] shadow-sm"></div>)}
                    {[...Array(expiredPointsCount)].map((_, i) => <div key={`expired-${i}`} className="w-4 h-4 rounded-full bg-[#94A3B8] shadow-sm"></div>)}
                  </div>
                  <p className="text-sm text-[#0B1F38]/80 font-medium">Validité des documents ({docStats.total})</p>
                </div>
                <div className="flex flex-wrap gap-3 w-full">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#00A3E0]"></div><span className="text-[10px] font-bold text-[#0B1F38]/70">Valides ({docStats.valid})</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#FF8D6D]"></div><span className="text-[10px] font-bold text-[#0B1F38]/70">Bientôt exp. ({docStats.expiring})</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[#94A3B8]"></div><span className="text-[10px] font-bold text-[#0B1F38]/70">Expirés ({docStats.expired})</span></div>
                </div>
              </div>
            </section>
          </div>

        </div>
      </main>
      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onUpgrade={() => {
          setShowLimitModal(false);
          if (onNavigate) onNavigate('pricing');
        }}
        limitType="activeTenders"
        planLabel={PLANS_CONFIG[(userProfile?.plan as PlanType) || PLANS_TYPES.free]?.label || 'Gratuit'}
        message={canCreateTender(userProfile, tenders).message}
      />
    </div>
  );
};