import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useToast } from './ui/Toast';
import { reparerEncodage } from '../helpers/boampHelpers';
import { ErrorState } from './ui/StateViews';
import { estDossierDunCollegue as estCollegue, estEnLectureSeule as estLectureSeule } from '../helpers/accesDossier';
import {
  CheckCircle2, AlertCircle, ArrowUpDown, Search, Users,
  Pencil, Trash2, X, Plus,
  MoreVertical, Eye, Archive, Lock, LayoutGrid, List, Trophy, Frown,
  Clock, TrendingUp, Briefcase, FileText, SlidersHorizontal
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { Tender } from '../types';
import {
  SECTORS, MARKET_TYPES, STATUSES,
  UserProfile,
  PLANS_CONFIG, PlanType, PLANS_TYPES
} from '../config';
import { canCreateTender } from '@/helpers/planHelpers';
import { BandeauQuotaDepasse } from './BandeauQuotaDepasse';
import { getEffectiveStatus, isUrgent } from '@/helpers/tenderHelpers';
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
  /** Filtre statut initial (ex. 'Urgents' depuis un lien du tableau de bord). */
  initialFilter?: string;
}


// --- MAIN COMPONENT ---

export const Tenders: React.FC<TendersProps> = ({
  onAddTender, cachedTenders, onTendersLoad, onTenderUpdate,
  cachedCollaborators, onCollaboratorsLoad, onEditDraft, userProfile,
  onNavigate, initialFilter
}) => {
  const { showToast } = useToast();
  const userId = userProfile?.id;

  // State
  const [tenders, setTenders] = useState<Tender[]>(cachedTenders || []);
  const [collaborators, setCollaborators] = useState<any[]>(cachedCollaborators || []);
  const [existingCollaborators, setExistingCollaborators] = useState<any[]>([]);

  const [loading, setLoading] = useState(!cachedTenders);
  // Échec du chargement : distingue « aucun dossier » de « impossible de charger ».
  const [loadError, setLoadError] = useState(false);

  // Action Menu State
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState(initialFilter || 'Tous');
  const [outcomeConfirm, setOutcomeConfirm] = useState<{ id: string; type: 'won' | 'lost' } | null>(null);
  const [filterCategory, setFilterCategory] = useState('Tous');
  const [filterDomain, setFilterDomain] = useState('Tous');
  // Filtre de rôle : Tous | Portés (créés par l'entreprise) | Rejoints (invité).
  const [filterRole, setFilterRole] = useState<'Tous' | 'Portés' | 'Rejoints'>('Tous');
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

  /**
   * Dossiers portés par des collègues.
   *
   * Depuis la migration 092, un dossier de l'entreprise remonte à tous ses
   * membres, mais son CONTENU (groupement, échanges, pièces) reste réservé au
   * porteur, aux cotraitants et — depuis les 093/094 — à l'administrateur.
   *
   * Deux conséquences pour cet écran :
   *   - le filtre de visibilité ci-dessous les écartait, il faut les garder ;
   *   - un membre ordinaire qui en ouvrirait un tomberait sur une coquille
   *     vide. On les distingue donc à l'affichage.
   */
  const [estAdmin, setEstAdmin] = useState(false);
  /** Bascule demandée : par défaut mes dossiers, au besoin ceux de l'entreprise. */
  const [voirToutEntreprise, setVoirToutEntreprise] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data } = await supabase.rpc('est_admin_entreprise');
      if (!annule) setEstAdmin(!!data);
    })();
    return () => { annule = true; };
  }, [userProfile?.entreprise_id]);

  /**
   * Le dossier est-il porté par un collègue ?
   *
   * On s'appuie sur `reponses_ao.entreprise_id` (colonne figée par la 092) et
   * non sur la ligne de groupement : celle du mandataire porte l'entreprise du
   * porteur, donc un administrateur qui la voit désormais (094) serait classé
   * « participant » et badgé « Mandataire » sur le dossier d'un autre.
   */
  const estDossierDunCollegue = React.useCallback(
    (t: any) => estCollegue(t, userProfile),
    [userProfile?.id, userProfile?.entreprise_id]
  );

  /** Sert à n'afficher la bascule que si elle a un effet. */
  const nbDossiersCollegues = useMemo(
    () => tenders.filter(estDossierDunCollegue).length,
    [tenders, estDossierDunCollegue]
  );


  // Rating Modal State
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  const [selectedTenderForRating, setSelectedTenderForRating] = useState<Tender | null>(null);

  // --- DERIVED STATE ---
  const creationCheck = useMemo(() => canCreateTender(userProfile, tenders), [userProfile, tenders]);
  const selectedTender = tenders.find(t => t.id === selectedTenderId);

  const stats = useMemo(() => {
    const won = tenders.filter(t => t.statut === STATUSES.won).length;
    const lost = tenders.filter(t => t.statut === STATUSES.lost).length;
    // « En cours » et « Déposés » sont deux états distincts : les afficher
    // séparément évite l'ambiguïté d'un compteur « En cours » qui incluait les
    // déposés (isActive regroupe les deux). getEffectiveStatus tranche le
    // statut réel (En cours vs Déposé).
    const enCours = tenders.filter(t => getEffectiveStatus(t) === STATUSES.on).length;
    const deposes = tenders.filter(t => getEffectiveStatus(t) === STATUSES.submitted).length;
    const urgents = tenders.filter(isUrgent).length;
    const active = enCours + deposes; // conservé pour compat éventuelle
    const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;
    return { won, lost, active, enCours, deposes, urgents, winRate };
  }, [tenders]);

  // Nombre de filtres « avancés » actifs (ceux regroupés dans le popover
  // Filtres : Catégorie, Secteur, Rôle). Sert au badge du bouton.
  const activeAdvancedFilters = useMemo(() => {
    let n = 0;
    if (filterCategory !== 'Tous') n++;
    if (filterDomain !== 'Tous') n++;
    if (filterRole !== 'Tous') n++;
    return n;
  }, [filterCategory, filterDomain, filterRole]);

  // Si le filtre « Urgents » est actif mais qu'il n'y a plus d'AO urgent (le
  // chip disparaît alors), on revient à « Tous » pour ne pas laisser une liste
  // vide sans filtre visible pour en sortir.
  useEffect(() => {
    if (filterStatus === 'Urgents' && stats.urgents === 0) {
      setFilterStatus('Tous');
    }
  }, [filterStatus, stats.urgents]);
 
  const pendingInvitationsCount = useMemo(() => {
    return tenders.filter(t => {
      const myGroupement = t.groupements?.find((g: any) => 
        userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id
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

  // Nettoyage d'une éventuelle clé résiduelle : l'ouverture d'un AO depuis le
  // tableau de bord passe désormais par l'URL (`?tab=wizard&id=...`), plus par
  // sessionStorage. Une session ouverte avant la mise à jour pourrait encore en
  // porter une ; on la purge pour éviter toute ouverture inattendue.
  useEffect(() => {
    sessionStorage.removeItem('openTenderId');
  }, []);

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

      // Même correctif que `fetchCollaborators` : la jointure `membres` est
      // vide depuis la migration 070, on résout les référents par entreprise
      // via `utilisateurs_publics`.
      const idsEnt = Array.from(new Set(
        (data || []).map((g: any) => g.entreprise_id).filter(Boolean)
      ));
      const referentParEnt = new Map<string, any>();
      if (idsEnt.length > 0) {
        const { data: profils } = await supabase
          .from('utilisateurs_publics')
          .select('id, prenom, nom, photo_url, email, entreprise_id')
          .in('entreprise_id', idsEnt);
        (profils || []).forEach((p: any) => {
          if (p.entreprise_id && !referentParEnt.has(p.entreprise_id)) {
            referentParEnt.set(p.entreprise_id, p);
          }
        });
      }

      const distinctCollabs = new Map<string, any>();
      data?.forEach((g: any) => {
        const ref = g.entreprise?.membres?.[0] || referentParEnt.get(g.entreprise_id);
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
      setLoadError(false);
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

      // Profils des porteurs.
      //
      // La requête ci-dessus imbrique `createur:utilisateurs!createur_id`, mais
      // depuis la migration 070 `utilisateurs` n'est lisible que par soi-même :
      // la jointure ne renvoie donc quelque chose QUE sur ses propres dossiers.
      // Sur ceux d'un partenaire ou d'un collègue, `createur` est null, et la
      // carte perdait l'avatar du porteur sans que rien ne le signale.
      //
      // `utilisateurs_publics` est le canal prévu pour les profils d'autrui
      // (migration 070). C'est une VUE : PostgREST ne sait pas l'imbriquer faute
      // de clé étrangère détectable, on la charge donc à part et on fusionne —
      // même motif que `CompanyTab`.
      const idsPorteurs = Array.from(new Set(
        validTenders.map((t: any) => t.createur_id).filter(Boolean)
      ));
      if (idsPorteurs.length > 0) {
        const { data: porteurs } = await supabase
          .from('utilisateurs_publics')
          .select('id, prenom, nom, photo_url, email')
          .in('id', idsPorteurs);

        const parId = new Map((porteurs || []).map((p: any) => [p.id, p]));
        validTenders.forEach((t: any) => {
          if (!t.createur) t.createur = parId.get(t.createur_id) || null;
        });
      }

      // Keep all non-refused tenders (both accepted and pending)
      const visibleTenders = validTenders.filter(t => {
        const myGroupement = t.groupements?.find((g: any) => 
          userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id
        );
        const myInvitation = t.invitations?.find((i: any) => i.email === userProfile?.email);

        const isRefused = myGroupement?.statut === 'refuse' || myInvitation?.status === 'refused';
        // Les dossiers des collègues sont désormais conservés : la RLS les
        // remonte (092) et les jeter ici reviendrait à annuler côté client la
        // visibilité d'entreprise qu'on vient d'ouvrir côté serveur.
        return myGroupement || myInvitation || t.createur_id === userId
          || estDossierDunCollegue(t);
      });

      setTenders(visibleTenders);
      await fetchCollaborators(visibleTenders, user.email);

      if (onTendersLoad) {
        onTendersLoad(visibleTenders);
      }
    } catch (error) {
      console.error('Error fetching tenders:', error);
      // Sans état d'erreur explicite, un échec de chargement affichait l'état
      // vide (« Aucun appel d'offres trouvé »), message trompeur : l'utilisateur
      // croyait n'avoir aucun dossier alors que la requête avait échoué.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchCollaborators = async (tendersData: Tender[], userEmail: string | null) => {
    try {
      // Référents des entreprises partenaires.
      //
      // Cette liste alimente la page Réseau. Elle se construisait sur
      // `g.entreprise.membres[0]`, jointure vide depuis la migration 070
      // (`utilisateurs` refermé sur son propre compte) : le réseau était donc
      // systématiquement vide, sans erreur ni message.
      //
      // `utilisateurs_publics` est le canal prévu. Une seule requête pour
      // toutes les entreprises rencontrées, plutôt qu'une par dossier.
      const idsEntreprises = Array.from(new Set(
        tendersData.flatMap((t: any) =>
          Array.isArray(t.groupements)
            ? t.groupements.map((g: any) => g.entreprise_id).filter(Boolean)
            : []
        )
      ));

      const referentParEntreprise = new Map<string, any>();
      if (idsEntreprises.length > 0) {
        const { data: profils } = await supabase
          .from('utilisateurs_publics')
          .select('id, prenom, nom, photo_url, email, entreprise_id')
          .in('entreprise_id', idsEntreprises);

        (profils || []).forEach((p: any) => {
          if (p.entreprise_id && !referentParEntreprise.has(p.entreprise_id)) {
            referentParEntreprise.set(p.entreprise_id, p);
          }
        });
      }

      const uniqueCollabs = new Map<string, any>();
      tendersData.forEach((tender: any) => {
        const groupements = tender.groupements;
        if (!Array.isArray(groupements)) return;

        groupements.forEach((g: any) => {
          const ref = g.entreprise?.membres?.[0]
            || referentParEntreprise.get(g.entreprise_id);
          // L'e-mail peut être NULL hors dossier partagé (migration 070) : on
          // écarte donc son propre référent par l'entreprise, pas par l'adresse.
          if (!ref) return;
          if (ref.email === userEmail) return;
          if (userProfile?.entreprise_id && g.entreprise_id === userProfile.entreprise_id) return;

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
    // Un membre ordinaire voit la ligne du dossier d'un collègue et la
    // composition du groupement (092, 095), mais ni les échanges ni les pièces.
    // Le wizard suppose qu'on écrit : on ouvre un panneau de consultation, qui
    // n'affiche que ce que la RLS accorde réellement à ce profil.
    // `onEditDraft` remonte à `App.ouvrirDossier`, qui tranche entre l'éditeur
    // et le panneau de consultation. Décider ici aussi dupliquerait la règle,
    // et c'est précisément cette duplication qui avait laissé le calendrier,
    // le tableau de bord et les notifications sans garde-fou.
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
        userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id
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

      // Filter by role: Porté = je suis le porteur (créateur) ; Rejoint = sinon.
      // Aligné sur le badge de rôle affiché sur la carte (jeSuisPorteur).
      if (filterRole !== 'Tous') {
        const jeSuisPorteur = t.createur_id === userId;
        if (filterRole === 'Portés' && !jeSuisPorteur) return false;
        if (filterRole === 'Rejoints' && jeSuisPorteur) return false;
      }

      // Bascule « toute l'entreprise ». Par défaut on n'affiche que ses propres
      // dossiers : une secrétaire qui suit dix chefs de projet noierait sinon
      // les siens sous ceux des autres.
      if (!voirToutEntreprise && estDossierDunCollegue(t)) return false;

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

        // Filtre « Urgents » : échéance proche, transverse au statut (défini par isUrgent).
        if (filterStatus === 'Urgents') return isUrgent(t);
        // Filter by main status only when not in invitations view
        if (filterStatus !== 'Tous' && getEffectiveStatus(t) !== filterStatus) return false;
        return true;
      }
    });
    
    result.sort((a, b) => {
      if (showInvitationsOnly) {
         const aGroupement = a.groupements?.find((g: any) => userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id);
         const aInvitation = a.invitations?.find((i: any) => i.email === userProfile?.email);
         const aIsRefused = aGroupement?.statut === 'refuse' || aInvitation?.status === 'refused';
         
         const bGroupement = b.groupements?.find((g: any) => userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id);
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
  }, [tenders, searchQuery, filterStatus, filterCategory, filterDomain, filterRole, sortOption, showInvitationsOnly, userId, userProfile?.email, userProfile?.entreprise_id,
      voirToutEntreprise, estDossierDunCollegue]);


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

  /**
   * Réponse à une invitation depuis la liste, sans ouvrir le dossier.
   *
   * Passe par la même fonction serveur que l'écran Équipe (`accept-invitation`,
   * en service_role) : elle met à jour `invitations` et `groupements` et notifie
   * le mandataire. Dupliquer la logique ici la ferait diverger au premier
   * changement de règle.
   */
  const [repondInvitation, setRepondInvitation] = useState<string | null>(null);

  const handleInvitationResponse = async (e: React.MouseEvent, tenderId: string, accept: boolean) => {
    e.stopPropagation();
    setActiveActionMenu(null);
    setRepondInvitation(tenderId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!session || !supabaseUrl) throw new Error('Session expirée');

      const response = await fetch(`${supabaseUrl}/functions/v1/accept-invitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tenderId, accept }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Erreur lors de la réponse à l'invitation");

      showToast(
        accept ? "Vous avez rejoint l'équipe !" : "Vous avez refusé l'invitation.",
        accept ? 'success' : 'info'
      );
      // Rechargement : le statut conditionne l'affichage de la carte et les
      // compteurs d'invitations en attente.
      await fetchTenders();
    } catch (err: any) {
      console.error('Réponse à invitation échouée', err);

      // Même traitement que dans le détail d'un AO : sans fiche entreprise,
      // `accept-invitation` ne peut pas créer la ligne de groupement (c'est
      // `entreprise_id` qui porte tout le cloisonnement). On explique et on
      // emmène l'utilisateur là où il peut agir, plutôt que d'afficher un
      // message d'erreur technique devant lequel il ne peut rien faire.
      const messageServeur = err?.message || '';
      if (!userProfile?.entreprise_id || messageServeur.includes('entreprise')) {
        showToast("Renseignez d'abord votre entreprise pour rejoindre ce groupement.", 'warning');
        try {
          sessionStorage.setItem('invitationEnAttente', tenderId);
        } catch { /* stockage indisponible : on redirige quand même */ }
        setTimeout(() => onNavigate?.('company'), 1200);
      } else {
        showToast(messageServeur || "Impossible de répondre à l'invitation.", 'error');
      }
    } finally {
      setRepondInvitation(null);
    }
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
        
        <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/40 p-3 rounded-2xl border border-white/60 flex flex-col">
                <span className="text-2xl font-bold text-[#0B1F38]">{stats.enCours}</span>
                <span className="text-[10px] font-medium text-[#0B1F38]/50 uppercase">En cours</span>
            </div>
            <div className="bg-white/40 p-3 rounded-2xl border border-white/60 flex flex-col">
                <span className="text-2xl font-bold text-[#0B1F38]">{stats.deposes}</span>
                <span className="text-[10px] font-medium text-[#0B1F38]/50 uppercase">Déposés</span>
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

        {/* Tender Grid/List */}
        <div className="flex-1 overflow-auto custom-scrollbar-dark p-6">
          {/* Dossiers au-delà du quota. Placé au-dessus de la liste et non dans
              un écran de facturation : c'est ici que l'utilisateur constate qu'un
              dossier ne répond plus, donc ici que l'explication doit se trouver.
              Le composant ne s'affiche pas s'il n'y a aucun dépassement. */}
          <BandeauQuotaDepasse
            userProfile={userProfile}
            tenders={tenders}
            onChange={fetchTenders}
          />

          {loadError ? (
            <ErrorState
              title="Impossible de charger vos appels d'offres"
              description="La liste n'a pas pu être récupérée. Vérifiez votre connexion puis réessayez."
              onRetry={fetchTenders}
            />
          ) : processedTenders.length === 0 ? (
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
                    <button onClick={() => { setSearchQuery(''); setFilterStatus('Tous'); setFilterCategory('Tous'); setFilterDomain('Tous'); setFilterRole('Tous'); }} className="text-xs font-bold text-[#00A3E0] hover:underline px-4 py-2 bg-[#00A3E0]/10 rounded-xl transition-colors">Réinitialiser les filtres</button>
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
                // Clé = identifiant stable, et non l'e-mail.
                //
                // `utilisateurs_publics` renvoie `email = NULL` hors partenaires
                // d'un dossier commun (migration 070) : indexer par e-mail
                // faisait collapser tous ces profils sur une même clé `null`, et
                // un seul avatar survivait.
                const uniqueTeam = new Map<string, { photo?: string; name?: string; email?: string; isPending?: boolean }>();

                // Le porteur, puis UNE entrée par entreprise du groupement.
                //
                // L'ancienne version prenait `g.entreprise.membres[0]`, un
                // salarié quelconque de l'entreprise partenaire. Depuis la
                // migration 070 cette jointure revient systématiquement vide :
                // aucun cotraitant n'apparaissait, seul le porteur restait.
                //
                // On représente désormais chaque partenaire par SON ENTREPRISE —
                // logo, ou initiales de sa raison sociale. C'est aussi plus
                // juste : un groupement est composé d'entreprises, pas de
                // personnes, et le salarié affiché n'était de toute façon pas
                // celui qui travaillait sur le dossier.
                if (creator) uniqueTeam.set(`u:${creator.id || creator.email}`, { photo: creator.photo_url, name: `${creator.prenom || ''} ${creator.nom || ''}`.trim() || creator.email, email: creator.email });
                else if (tender.createur_id === userId && userProfile) uniqueTeam.set(`u:${userProfile.id}`, { photo: userProfile.photo_url, name: `${userProfile.prenom || ''} ${userProfile.nom || ''}`.trim(), email: userProfile.email });

                groupementsArr
                  ?.filter((g: any) => g.statut === 'accepte')
                  // La ligne du mandataire porte l'entreprise du porteur, déjà
                  // représenté ci-dessus : l'inclure le compterait deux fois.
                  .filter((g: any) => (g.role_groupement || '') !== 'Mandataire')
                  .forEach((g: any) => {
                    const cle = `e:${g.entreprise_id}`;
                    if (!g.entreprise_id || uniqueTeam.has(cle)) return;
                    uniqueTeam.set(cle, {
                      photo: g.entreprise?.logo_url || undefined,
                      name: g.entreprise?.nom || 'Partenaire',
                    });
                  });

                invitationsArr?.filter((i: any) => i.status === 'pending').forEach((i: any) => { const cle = `i:${i.email}`; if (!uniqueTeam.has(cle)) uniqueTeam.set(cle, { email: i.email, isPending: true }); });

                const membresEquipe = Array.from(uniqueTeam.values());
                const teamAvatars = membresEquipe.map(m => ({
                  src: m.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.name || m.email || 'U')}&background=${m.isPending ? 'F06A50' : '0B1F38'}&color=fff`,
                  // Sans infobulle, un logo d'entreprise inconnu n'apprend rien.
                  libelle: m.isPending
                    ? `${m.email} — invitation en attente`
                    : (m.name || m.email || 'Membre'),
                })).slice(0, 3);
                const totalTeamSize = uniqueTeam.size;
                const myGroupement = groupementsArr.find((g: any) => 
                  userProfile?.entreprise_id && g.entreprise_id === userProfile?.entreprise_id
                );
                const myInvitation = invitationsArr.find((i: any) => i.email === userProfile?.email);
                
                const isPending = myGroupement?.statut === 'invite' || myInvitation?.status === 'pending';
                const isRefused = myGroupement?.statut === 'refuse' || myInvitation?.status === 'refused';
                
                // Un dossier que l'on porte et un dossier que l'on a rejoint
                // n'appellent ni les mêmes actions ni la même lecture. Rien ne
                // les distinguait à l'écran : le rôle s'affichait dans le même
                // gris discret pour tout le monde.
                const jeSuisPorteur = tender.createur_id === userId;
                const dossierCollegue = estDossierDunCollegue(tender);
                const lectureSeuleTender = estLectureSeule(tender, userProfile, estAdmin);
                const porteurNom = [tender.createur?.prenom, tender.createur?.nom]
                  .filter(Boolean).join(' ').trim();
                // Un dossier de collègue n'est ni « Mandataire » (ce n'est pas le
                // mien) ni « Collaborateur » (je n'y participe pas) : il lui faut
                // son propre libellé, sans quoi la liste laisse croire à une
                // participation.
                const myRoleBadge = jeSuisPorteur
                  ? 'Mandataire'
                  : dossierCollegue
                    ? (porteurNom || 'Collègue')
                    : (myGroupement || myInvitation) ? (myGroupement?.role_groupement || myInvitation?.role || 'Collaborateur') : 'Collaborateur';
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
                  <div key={tender.id} onClick={() => handleOpenTender(tender.statut, tender.id)} className={`group p-5 bg-white/40 hover:bg-white/95 border border-white/60 rounded-3xl transition-all cursor-pointer shadow-sm hover:shadow-lg relative flex flex-col gap-4 ${activeActionMenu === tender.id ? 'z-50' : ''}`}>
                    {/* Background decoration - Contained */}
                    <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-[#00A3E0]/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </div>
                    
                    <div className="flex justify-between items-start gap-4 relative z-10">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-[#0B1F38] line-clamp-2 leading-tight group-hover:text-[#00A3E0] transition-colors">{reparerEncodage(tender.titre)}</h3>
                        <div className="flex items-center gap-2 mt-2">
                            {(tender.success_score || 0) > 0 && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-100 uppercase tracking-tight">Probabilité: {tender.success_score}%</span>}
                            {jeSuisPorteur ? (
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-widest">{myRoleBadge}</span>
                            ) : dossierCollegue ? (
                                /* Dossier de l'entreprise, porté par quelqu'un d'autre.
                                   Le badge « Partenaire » ci-dessous serait faux : il
                                   n'y a pas de groupement, c'est la maison. */
                                <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tight flex items-center gap-1 ${
                                        lectureSeuleTender
                                            ? 'bg-gray-100 text-gray-500 border-gray-200'
                                            : 'bg-[#EFF4F8] text-[#0B1F38]/70 border-[#00A3E0]/20'
                                    }`}
                                    title={lectureSeuleTender
                                        ? `Dossier porté par ${porteurNom || 'un collègue'}. Vous en voyez l'existence, pas le contenu.`
                                        : `Dossier porté par ${porteurNom || 'un collègue'} de votre entreprise.`}
                                >
                                    {lectureSeuleTender ? <Lock size={10} /> : <Users size={10} />}
                                    {lectureSeuleTender ? 'Équipe · lecture seule' : `Équipe · ${myRoleBadge}`}
                                </span>
                            ) : (
                                /* Le partenaire est signalé explicitement : sans repère,
                                   on croit piloter un dossier que l'on a seulement rejoint. */
                                <span
                                    className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-100 uppercase tracking-tight flex items-center gap-1"
                                    title={`Vous participez à ce dossier en tant que ${myRoleBadge.toLowerCase()}. Il est piloté par une autre entreprise.`}
                                >
                                    <Users size={10} /> Partenaire · {myRoleBadge}
                                </span>
                            )}
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
                            <span className="truncate">{reparerEncodage(tender.organisme_acheteur)}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-3">
                           <div className="flex items-center gap-2">
                             <div className="flex -space-x-2" onClick={(e) => handleOpenTeam(e, tender)}>
                               {teamAvatars.length > 0 ? teamAvatars.map((a, i) => <img key={i} src={a.src} alt={a.libelle} title={a.libelle} className="w-7 h-7 rounded-full border-2 border-white object-cover shadow-sm transition-transform group-hover:scale-110 bg-white" style={{ transitionDelay: `${i * 50}ms` }} />) : <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center"><Users size={12} /></div>}
                               {totalTeamSize > 3 && <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-[10px] font-bold">+{totalTeamSize - 3}</div>}
                             </div>
                             <span className="text-[10px] font-bold text-[#0B1F38]/30 uppercase tracking-widest">Équipe</span>
                           </div>
                        </div>
                      </div>
                      
                      {/* Actions et menu sur UNE SEULE ligne : le conteneur des
                          boutons était au-dessus du « ⋮ », qui se retrouvait
                          rejeté à la ligne suivante. */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isPending && !jeSuisPorteur && (
                          <>
                            <button
                              onClick={(e) => handleInvitationResponse(e, tender.id, true)}
                              disabled={repondInvitation === tender.id}
                              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
                            >
                              {repondInvitation === tender.id
                                ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                : <CheckCircle2 size={13} />}
                              Accepter
                            </button>
                            <button
                              onClick={(e) => handleInvitationResponse(e, tender.id, false)}
                              disabled={repondInvitation === tender.id}
                              className="px-3 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold rounded-xl transition-colors disabled:opacity-50 shrink-0"
                            >
                              Refuser
                            </button>
                          </>
                        )}

                        <div className="relative">
                        <button onClick={(e) => handleActionMenuClick(e, tender.id)} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors text-[#0B1F38]/40 hover:text-[#0B1F38]"><MoreVertical size={20} /></button>
                        {activeActionMenu === tender.id && (
                          <div className="absolute right-0 bottom-full mb-3 w-48 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 py-2 z-[100] animate-in slide-in-from-bottom-2 duration-200 origin-bottom-right">
                            {/* Accepter / Refuser ne sont pas repris ici : ils
                                sont déjà visibles sur la carte, les dupliquer
                                allongeait le menu sans rien apporter. */}
                            <button onClick={(e) => { e.stopPropagation(); handleOpenTender(tender.statut, tender.id); setActiveActionMenu(null); }} className="w-full text-left px-5 py-3 text-xs font-bold text-[#0B1F38] hover:bg-[#00A3E0]/10 flex items-center gap-3 transition-colors"><Eye size={16} className="text-[#00A3E0]" /> Voir le dossier</button>
                            {/* Modifier : le créateur, et l'administrateur de
                                l'entreprise porteuse (migration 093) — sans quoi
                                le droit accordé côté serveur resterait sans
                                aucun accès dans l'interface.
                                Supprimer reste au seul créateur, comme la RLS :
                                proposer un bouton que la base refuse serait pire
                                que de ne pas le proposer. */}
                            {(tender.createur_id === userId || (dossierCollegue && estAdmin)) && (
                              <button onClick={(e) => handleEditTender(e, tender)} className="w-full text-left px-5 py-3 text-xs font-bold text-[#0B1F38] hover:bg-[#00A3E0]/10 flex items-center gap-3 transition-colors"><Pencil size={16} className="text-amber-500" /> Modifier</button>
                            )}
                            {tender.createur_id === userId && (
                              <>
                                <div className="h-px bg-gray-100 my-1"></div>
                                <button onClick={(e) => { e.stopPropagation(); setSelectedTenderId(tender.id); setIsDeleteModalOpen(true); setActiveActionMenu(null); }} className="w-full text-left px-5 py-3 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"><Trash2 size={16} /> Supprimer</button>
                              </>
                            )}
                          </div>
                        )}
                        </div>
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