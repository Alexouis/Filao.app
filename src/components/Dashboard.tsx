import React, { useState, useEffect, useMemo } from 'react';
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
import { chargerForfaits, forfait, illimite } from '@/helpers/planLimits';
import { canCreateTender } from '@/helpers/planHelpers';
import { getEffectiveStatus, isActive, isUrgent } from '@/helpers/tenderHelpers';
import { GLASS_STYLE } from '../lib/styles';
import { Plus, Clock, TrendingUp, TrendingDown, Minus, Lock, Briefcase, FileText, Rocket, Users } from 'lucide-react';
import { LimitReachedModal } from './LimitReachedModal';
import { ErrorState } from './ui/StateViews';

interface DashboardProps {
  onNavigate: (tab: any, id?: string | null) => void;
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
  // Échec du chargement : évite un tableau de bord vide trompeur.
  const [loadError, setLoadError] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);

  const [stats, setStats] = useState<{ winRate: number; winRateTrend: number | null }>({
    winRate: 0,
    winRateTrend: null,
  });

  // Validité des documents de l'entreprise — chiffres réels, plus de mock.
  // Source : `documents_candidature_view`, qui expose `statut_effectif`
  // (valide / expire recalculé depuis date_expiration). L'état « bientôt
  // expiré » n'existe pas en base — on le dérive ici d'une fenêtre de 30 jours
  // sur date_expiration, seule interprétation cohérente avec le schéma.
  const [docStats, setDocStats] = useState({ valid: 0, expiring: 0, expired: 0, total: 0 });
  // Catégories administratives attendues (mêmes clés que documents_candidature).
  const STANDARD_DOC_CATEGORIES = ['kbis', 'attestation_honneur', 'attestation_assurance', 'presentation_societe'];
  // Catégories standard absentes → documents à fournir.
  const [missingDocs, setMissingDocs] = useState<string[]>([]);
  // Activité récente : vraies notifications de l'utilisateur (source unique,
  // partagée avec le centre de notifications), plutôt qu'une reconstruction
  // approximative depuis le statut des dossiers.
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  // --- 1. FETCH ACTIVE TENDERS COUNT (Plan Limit Logic) ---
  // Décompte de référence, calculé en base via `dossiers_portes_entreprise` :
  // il porte sur l'ENTREPRISE (pas sur l'utilisateur) et ne compte que les
  // dossiers « En cours » non verrouillés — donc il n'inclut PAS les déposés,
  // qui restent suivis mais ne consomment plus de quota. C'est la même source
  // que BillingTab. La version précédente comptait côté client sur
  // `createur_id === userProfile.id` avec `isActive`, ce qui (a) ignorait les
  // dossiers portés par un collègue de l'entreprise et (b) incluait les
  // déposés : le compteur divergeait alors du quota réellement appliqué.
  useEffect(() => {
    if (!userProfile?.entreprise_id) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('dossiers_portes_entreprise', {
        p_entreprise_id: userProfile.entreprise_id,
      });
      if (cancelled) return;
      if (!error && typeof data === 'number') {
        setActiveTendersCount(data);
      } else if (error) {
        console.error('dossiers_portes_entreprise:', error);
      }
    })();

    return () => { cancelled = true; };
  }, [userProfile?.entreprise_id, tenders]);

  // --- 1b. FETCH DOCUMENT VALIDITY STATS (pièces réellement déposées) ---
  useEffect(() => {
    if (!userProfile?.entreprise_id) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('documents_candidature_view')
        .select('statut_effectif, date_expiration_effective, categorie')
        .eq('entreprise_id', userProfile.entreprise_id);

      if (cancelled) return;
      if (error) {
        console.error('documents_candidature_view:', error);
        return;
      }

      const rows = data || [];
      const SOON_MS = 30 * 24 * 60 * 60 * 1000; // fenêtre « bientôt expiré »
      const now = Date.now();

      let valid = 0, expiring = 0, expired = 0;
      for (const d of rows as any[]) {
        if (d.statut_effectif === 'expire') {
          expired++;
        } else if (d.statut_effectif === 'valide') {
          const exp = d.date_expiration_effective ? new Date(d.date_expiration_effective).getTime() : null;
          if (exp !== null && exp - now <= SOON_MS) expiring++;
          else valid++;
        }
        // 'en_attente' / autres : pas une pièce valide déposée, exclu des compteurs.
      }

      setDocStats({ valid, expiring, expired, total: valid + expiring + expired });

      // Documents administratifs manquants : catégories standard attendues
      // absentes de documents_candidature (aucune ligne, quel que soit le statut).
      const presentes = new Set((rows as any[]).map(d => d.categorie));
      const manquants = STANDARD_DOC_CATEGORIES.filter(c => !presentes.has(c));
      setMissingDocs(manquants);
    })();

    return () => { cancelled = true; };
  }, [userProfile?.entreprise_id]);

  // --- 1c. FETCH RECENT ACTIVITY (vraies notifications) ---
  useEffect(() => {
    if (!userProfile?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('utilisateurs')
        .select('notifications')
        .eq('id', userProfile.id)
        .single();
      if (cancelled) return;
      if (error) {
        console.error('recent activity:', error);
        return;
      }
      const notifs = (data?.notifications as any[]) || [];
      const sorted = [...notifs].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setRecentActivity(sorted.slice(0, 5));
    })();
    return () => { cancelled = true; };
  }, [userProfile?.id]);
  useEffect(() => {
    // `userProfile` arrive de façon asynchrone : au premier rendu il vaut null,
    // et les deux branches ci-dessous le déréférencent sans garde. L'effet se
    // rejoue de toute façon dès qu'il est chargé, il figure dans les
    // dépendances.
    if (!userProfile) return;

    if (cachedTenders) {
      // Filter out refused tenders even from cache
      const visible = cachedTenders.filter(t => {
        // La clause `entreprise.membres` a été retirée : elle ne détectait que
        // les membres que la policy `utilisateurs` (075) laisse voir, et
        // doublonnait la comparaison d'entreprise, seule condition fiable.
        const myGroupement = t.groupements?.find((g: any) =>
          userProfile.entreprise_id && g.entreprise_id === userProfile.entreprise_id
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
      setLoadError(false);
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
        // Voir la note plus haut : `entreprise.membres` est vide depuis la 070.
        const myGroupement = t.groupements?.find((g: any) =>
          userProfile.entreprise_id && g.entreprise_id === userProfile.entreprise_id
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
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (tendersData: Tender[]) => {
    const won = tendersData.filter(t => t.statut === STATUSES.won).length;
    const lost = tendersData.filter(t => t.statut === STATUSES.lost).length;
    const total = won + lost;
    const winRate = total > 0 ? Math.round((won / total) * 100) : 0;

    // Tendance du taux de succès : win rate des dossiers clôturés sur les 90
    // derniers jours vs. les 90 jours précédents. On situe la clôture avec
    // `date_decision` (migration 052), qui fige la date du verdict. Repli sur
    // `modified_at` puis `created_at` pour les dossiers clôturés avant la
    // migration, encore à NULL. Si l'une des deux fenêtres n'a aucun dossier
    // clôturé, la tendance n'est pas calculable : winRateTrend reste null et
    // l'UI affiche « --% ».
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const closedAt = (t: Tender) =>
      new Date(t.date_decision || t.modified_at || t.created_at).getTime();
    const closed = tendersData.filter(t => t.statut === STATUSES.won || t.statut === STATUSES.lost);

    const rateOver = (from: number, to: number): number | null => {
      const bucket = closed.filter(t => {
        const ts = closedAt(t);
        return ts > from && ts <= to;
      });
      if (bucket.length === 0) return null;
      const w = bucket.filter(t => t.statut === STATUSES.won).length;
      return (w / bucket.length) * 100;
    };

    const recent = rateOver(now - 90 * DAY_MS, now);
    const previous = rateOver(now - 180 * DAY_MS, now - 90 * DAY_MS);
    const winRateTrend =
      recent !== null && previous !== null ? Math.round(recent - previous) : null;

    setStats({ winRate, winRateTrend });
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
    // Ouverture par l'URL dans tous les cas (`?tab=wizard&id=...`), y compris
    // pour les brouillons. L'ancien détour par sessionStorage naviguait vers
    // « Mes AO » puis ouvrait l'AO hors de l'URL : l'ouverture n'était donc pas
    // empilée dans l'historique et le retour sautait des niveaux.
    if (status === STATUSES.draft && onEditDraft) {
      onEditDraft(tenderId);
    } else {
      onNavigate('wizard', tenderId);
    }
  };

  // --- HELPERS ---

  // Filter for display list: Only show dossiers that are actively in progress
  // (En cours + deadline not yet passed). Expired/closed dossiers go to Mes AO list.
  const displayTenders = tenders.filter(t =>
    t.statut === STATUSES.draft || isActive(t)
  );

  // AO urgents (échéance < 7 j) — définition partagée avec Mes AO via isUrgent.
  const urgentCount = tenders.filter(isUrgent).length;

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
  // Quota lu dans `plan_limits`, et non dans `PLANS_CONFIG`.
  //
  // Les deux divergent depuis la migration 048, qui a fixé `partenaire` à 0
  // dossier en base alors que la constante du front en annonce toujours 1.
  // L'écran affichait donc « 0/1 » et proposait de créer un dossier que le
  // déclencheur `verifier_quota_avant_creation` refusait ensuite — sans que
  // rien n'explique le refus. `canCreateTender` avait déjà été bascul   é sur la
  // table (`planLimits.ts`) ; cet affichage était resté en arrière.
  //
  // `chargerForfaits` n'est appelé qu'une fois, dans `AuthContext`, sans
  // provoquer de nouveau rendu : un écran monté avant la fin du chargement
  // garderait le repli codé en dur, c'est-à-dire l'ancienne valeur fausse. On
  // s'abonne donc explicitement à sa résolution. L'appel est idempotent.
  const [forfaitsCharges, setForfaitsCharges] = useState(false);
  useEffect(() => {
    let annule = false;
    chargerForfaits().finally(() => { if (!annule) setForfaitsCharges(true); });
    return () => { annule = true; };
  }, []);

  const offre = useMemo(
    () => forfait(userProfile?.plan),
    [userProfile?.plan, forfaitsCharges]
  );
  const sansLimite = illimite(offre);
  const tenderLimit = offre.maxAoSimultanes ?? 0;
  /** Le forfait Réseau ne permet de porter aucun dossier : on ne rejoint que
   *  des groupements. C'est un cas distinct d'un quota atteint. */
  const aucunDossierPermis = !sansLimite && tenderLimit === 0;
  const isLimitReached = !sansLimite && activeTendersCount >= tenderLimit;

  // Generate Recent Activity
  // Styles — using shared GLASS_STYLE for uniform shadow across all pages

  // Validité des documents : un point = un document réel (plus de waffle
  // proportionnel sur une grille fixe, qui affichait 24 points pour 4 documents
  // et faussait la lecture). Le nombre de points égale donc docStats.total.

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

  if (loadError) {
    return (
      <div className="animate-fade-in p-2 md:p-4 flex items-center justify-center min-h-[400px]">
        <ErrorState
          title="Impossible de charger votre tableau de bord"
          description="Les données n'ont pas pu être récupérées. Vérifiez votre connexion puis réessayez."
          onRetry={fetchTenders}
        />
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
                  {aucunDossierPermis
                    ? `L'offre ${offre.nomCommercial} ne permet pas de porter de dossier`
                    : `${activeTendersCount}/${sansLimite ? '∞' : tenderLimit} dossiers actifs (Plan ${offre.nomCommercial})`}
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

              {/* Bande d'alerte : AO urgents + documents manquants. Chaque
                  élément est conditionnel et cliquable — la bande disparaît
                  entièrement s'il n'y a rien à signaler. */}
              {(urgentCount > 0 || missingDocs.length > 0) && (
                <div className="px-6 pb-2 flex flex-wrap gap-2 shrink-0">
                  {urgentCount > 0 && (
                    <button
                      onClick={() => onNavigate('tenders', 'urgents')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FF8575]/10 text-[#FF8575] hover:bg-[#FF8575]/20 transition-colors"
                      title="Échéance dans moins de 7 jours"
                    >
                      <Clock size={12} />
                      {urgentCount} AO urgent{urgentCount > 1 ? 's' : ''}
                    </button>
                  )}
                  {missingDocs.length > 0 && (
                    <button
                      onClick={() => onNavigate('company', 'docs')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                      title="Compléter les pièces administratives"
                    >
                      <FileText size={12} />
                      {missingDocs.length} document{missingDocs.length > 1 ? 's' : ''} manquant{missingDocs.length > 1 ? 's' : ''}
                    </button>
                  )}
                </div>
              )}

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
                            <div className="flex items-center gap-2">
                              <h3 className="text-xl font-bold text-[#0B1F38] transition-colors line-clamp-1">{tender.titre}</h3>
                              {/* Même repère que dans « Mes AO » et l'en-tête du dossier :
                                  les trois écrans montrent les mêmes AO, un partenaire
                                  identifié sur l'un et pas sur l'autre entretiendrait le
                                  doute plutôt que de le lever. */}
                              {tender.createur_id !== userProfile?.id && (
                                <span
                                  className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-100 uppercase tracking-tight flex items-center gap-1 shrink-0"
                                  title="Ce dossier est piloté par une autre entreprise. Vous y participez comme partenaire."
                                >
                                  <Users size={10} /> Partenaire
                                </span>
                              )}
                            </div>
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
                {(aucunDossierPermis || activeTendersCount >= tenderLimit - 1) && !sansLimite && (
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
                        {aucunDossierPermis
                          ? <>L'offre {offre.nomCommercial} permet de rejoindre des groupements, mais pas de <span className="text-[#0B1F38] font-bold">porter vos propres dossiers</span>.</>
                          : <>Votre plan actuel est limité à <span className="text-[#0B1F38] font-bold">{tenderLimit} AO actifs simultanés</span>.</>}
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
                  {recentActivity.length > 0 ? recentActivity.map((item) => (
                    <li key={item.id} className="p-4 hover:bg-white/80 rounded-2xl transition-colors flex gap-4 group border-l-2 border-transparent hover:border-[#00A3E0]">
                      <div className="mt-1"><div className="text-[#007AA8] opacity-100"><Clock size={14} /></div></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#0B1F38]/90">
                          {item.sender_name && <span className="font-bold text-[#0B1F38]">{item.sender_name} </span>}
                          {item.titre || item.message}
                        </p>
                        {item.related_tender_titre && <p className="text-xs text-[#26367F] mt-0.5 font-medium truncate">{item.related_tender_titre}</p>}
                        <p className="text-[10px] text-[#0B1F38]/50 mt-1">{item.date ? new Date(item.date).toLocaleDateString() : ''}</p>
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
                  {(() => {
                    const trend = stats.winRateTrend;
                    // Tendance non calculable (pas assez d'historique clôturé
                    // sur les deux fenêtres) : on garde le neutre « --% ».
                    if (trend === null) {
                      return (
                        <div className="flex items-center text-[#0B1F38]/40 text-xs font-bold bg-white/60 px-2 py-1 rounded-lg border border-white/60 shadow-sm" title="Tendance indisponible : historique insuffisant sur les 6 derniers mois">
                          <Minus size={14} className="mr-1" /> --%
                        </div>
                      );
                    }
                    const up = trend > 0;
                    const flat = trend === 0;
                    const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
                    const color = flat ? 'text-[#0B1F38]/50' : up ? 'text-[#00A3E0]' : 'text-[#D95D4E]';
                    return (
                      <div className={`flex items-center ${color} text-xs font-bold bg-white/60 px-2 py-1 rounded-lg border border-white/60 shadow-sm`} title="Évolution du taux de succès sur 90 jours vs. les 90 jours précédents">
                        <Icon size={14} className="mr-1" /> {trend > 0 ? '+' : ''}{trend}%
                      </div>
                    );
                  })()}
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
                  {docStats.total > 0 ? (
                    <div className="flex flex-wrap gap-2 justify-start content-start mb-4">
                      {[...Array(docStats.valid)].map((_, i) => <div key={`valid-${i}`} className="w-4 h-4 rounded-full bg-[#00A3E0] shadow-sm"></div>)}
                      {[...Array(docStats.expiring)].map((_, i) => <div key={`expiring-${i}`} className="w-4 h-4 rounded-full bg-[#FF8D6D] shadow-sm"></div>)}
                      {[...Array(docStats.expired)].map((_, i) => <div key={`expired-${i}`} className="w-4 h-4 rounded-full bg-[#94A3B8] shadow-sm"></div>)}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-4 text-[#0B1F38]/40">
                      <FileText size={16} />
                      <span className="text-xs font-medium">Aucun document déposé</span>
                    </div>
                  )}
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
        // Même source que le reste de l'écran : `PLANS_CONFIG` reste en repli,
        // mais ne doit plus servir de référence d'affichage.
        planLabel={offre.nomCommercial}
        message={canCreateTender(userProfile, tenders).message}
      />
    </div>
  );
};