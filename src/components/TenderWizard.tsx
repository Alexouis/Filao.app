import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from './ui/Toast';
import { CollaboratorPicker } from './ui/CollaboratorPicker';

import { LimitReachedModal } from './LimitReachedModal';
import { SkillInput } from './ui/SkillInput';
import {
    Calendar as CalendarIcon, MapPin, Briefcase, Link, Users, UploadCloud,
    CheckCircle, FileText, X, Search, ArrowRight, ArrowLeft, ChevronDown,
    Loader2, Plus, Trash2, Euro, Globe, FileInput, PenTool,
    Target, AlertTriangle, AlertCircle, Sparkles, XCircle, Mail, Network, Building,
    Info, CalendarCheck, Download, UserPlus, FolderOpen,
    Files, Save, Send, ShieldAlert, MessageSquare, RefreshCw,
    UserCheck, Crown, LogOut, Trophy, Frown, Pencil, Lock,
    Eye,
    Building2
} from 'lucide-react';
import { ChatDrawer } from './chat/ChatDrawer';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { genererCodeAcces } from '../helpers/inviteCodeHelpers';
import { estEnRetard } from '../helpers/jalonHelpers';
import { deposerFichier } from '../helpers/uploadHelpers';
import { telechargerDocument, ouvrirDocument } from '../helpers/storageHelpers';
import { nomPieceCollaborateur, lirePieceCollaborateur, clePieceCollaborateur } from '../helpers/documentNaming';
import { emailValide, nettoyerTexteLibre, contientBalise } from '../helpers/validationHelpers';
import { detecterType, OCTETS_A_LIRE, type TypeFichier } from '../helpers/fileValidation';
import { cpvLisible, libelleCpv } from '../helpers/cpvLabels';
import { notifyCollaboratorInvited, notifyDocumentReminder, notifyTenderWon, notifyTenderLost, notifyCollaborationRejected, notifyCollaborationAccepted } from '../helpers/notificationHelpers';
import {
    extractCpvCodes,
    extractCriteresAttribution,
    extractReferenceMarche,
    normaliserPoids,
    formatCpv,
    avisEncoreOuvert,
    dedoublonnerAvis,
    type CriteresAttribution
} from '../helpers/boampHelpers';
import {
    coerceModePassation,
    coerceSecteurActivite,
    coerceStatut,
    deduireSecteurDepuisCpv,
    suggererDomainesDepuisCpv,
    versTableau,
    champsManquants,
    messageErreurBase
} from '../helpers/tenderEnums';
import { CommentsView } from './ui/CommentsView';
import { supabase } from '../lib/supabaseClient';
import { DEPARTEMENTS, SECTORS, SECTORS_LABELS, MARKET_TYPES, MARKET_TYPES_LABELS, HANDOVER_TYPES, HANDOVER_TYPES_LABELS, BOAMP_BaseUrl, REQUIRED_DOCS_BY_ROLE, ROLES, SKILLS, DEPARTEMENTS_OBJ, STATUSES, GROUPEMENT_STATUSES, PLANS_CONFIG, PlanType, PLANS_TYPES } from '../config';
import { UIGroupementMember, TenderFormData, Groupement, StatutGroupement } from '../types';
import { GLASS_MODAL_STYLE } from '../lib/styles';
import { useChat } from '../context/ChatContext';

// --- STYLES ---

/**
 * Extension de fichier à partir du type détecté dans le contenu.
 *
 * Sert à nommer les pièces de l'export ZIP. Le mimetype déclaré étant souvent
 * absent ou inconnu, s'y fier produisait des « .bin » que l'acheteur public ne
 * peut pas ouvrir.
 */
const EXTENSIONS_PAR_TYPE: Partial<Record<TypeFichier, string>> = {
    pdf: 'pdf', png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp',
    docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', doc: 'doc', xls: 'xls',
    odt: 'odt', ods: 'ods', zip: 'zip',
};

/** Repli sur le mimetype déclaré quand la signature n'est pas reconnue. */
const EXTENSIONS_PAR_MIME: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt', 'text/csv': 'csv',
};

const inputGlass = "w-full pl-10 pr-4 py-3 rounded-xl border border-white/60 bg-white/50 focus:bg-white focus:ring-2 focus:ring-[#00A3E0] focus:outline-none transition-all text-sm font-medium text-[#0B1F38] placeholder-[#0B1F38]/40";
// Variante sans `pl-10` : cette réserve de 40px sert à loger une icône absolue.
// Sur un champ sans icône elle repousse le texte hors de la zone visible dès que
// la largeur est contrainte. Pas de `w-full` non plus, pour laisser le conteneur
// (flex/grid) décider de la largeur sans conflit de spécificité.
const inputGlassPlain = "px-4 py-3 rounded-xl border border-white/60 bg-white/50 focus:bg-white focus:ring-2 focus:ring-[#00A3E0] focus:outline-none transition-all text-sm font-medium text-[#0B1F38] placeholder-[#0B1F38]/40";
const labelStyle = "text-xs font-bold text-[#0B1F38]/50 mb-1.5 block uppercase tracking-wide";

const REQUIRED_SKILLS: string[] = [];

interface TenderWizardProps {
    onCancel: (target?: string) => void;
    onFinish: () => void;
    initialTenderId: string | null;
    onTenderUpdate?: () => void;
    onNavigate?: (tab: string) => void;
    isSidebarCollapsed?: boolean;
    setIsSidebarCollapsed?: (collapsed: boolean) => void;
}

const isValidUUID = (id: any): id is string => {
    if (typeof id !== 'string') return false;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
};

import { TenderCreationWizard } from './TenderCreationWizard';

// --- SUB-COMPONENTS ---
const AddManualPartnerModal = ({ onClose, onAdd, requiredSkills }: { onClose: () => void, onAdd: (data: any) => void, requiredSkills: string[] }) => {
    const [newCollaborator, setNewCollaborator] = useState({
        name: '',
        role: 'Co-traitant' as 'Mandataire' | 'Co-traitant' | 'Sous-traitant',
        email: '',
        skills: [] as string[],
        company: ''
    });

    // Le message d'erreur n'apparaît qu'une fois quelque chose saisi : le
    // signaler sur un champ encore vide est du bruit.
    const emailSaisiInvalide = newCollaborator.email.trim().length > 0
        && !emailValide(newCollaborator.email);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-[#0B1F38]/10 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-[#0B1F38] flex items-center gap-2"><UserPlus size={20} className="text-[#00A3E0]" /> Ajouter un partenaire</h3>
                    <button onClick={onClose}><X size={20} className="text-[#0B1F38]/40 hover:text-[#0B1F38]" /></button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Name */}
                    <div>
                        <label className="block text-xs font-bold text-[#0B1F38]/60 mb-1 uppercase">Nom du partenaire <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            value={newCollaborator.name}
                            onChange={(e) => setNewCollaborator(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Ex: Agence Lambda"
                            className="w-full bg-[#f4f6f9] border-none rounded-xl px-4 py-3 text-sm font-bold text-[#0B1F38] focus:ring-2 focus:ring-[#00A3E0]"
                        />
                    </div>

                    {/* Role */}
                    <div>
                        <label className="block text-xs font-bold text-[#0B1F38]/60 mb-1 uppercase">Rôle <span className="text-red-500">*</span></label>
                        <div className="grid grid-cols-3 gap-2">
                            {['Mandataire', 'Co-traitant', 'Sous-traitant'].map(role => (
                                <div
                                    key={role}
                                    onClick={() => setNewCollaborator(prev => ({ ...prev, role: role as any }))}
                                    className={`cursor-pointer text-center py-2 rounded-lg text-[10px] sm:text-xs font-bold border transition-all ${newCollaborator.role === role ? 'bg-[#00A3E0] text-white border-[#00A3E0]' : 'bg-white text-[#0B1F38]/60 border-[#0B1F38]/10 hover:border-[#00A3E0]/30'}`}
                                >
                                    {role}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-xs font-bold text-[#0B1F38]/60 mb-1 uppercase">Adresse Mail <span className="text-red-500">*</span></label>
                        <input
                            type="email"
                            value={newCollaborator.email}
                            onChange={(e) => setNewCollaborator(prev => ({ ...prev, email: e.target.value }))}
                            placeholder="contact@partenaire.com"
                            aria-invalid={emailSaisiInvalide}
                            className={`w-full bg-[#f4f6f9] border rounded-xl px-4 py-3 text-sm font-bold text-[#0B1F38] focus:ring-2 focus:ring-[#00A3E0] ${emailSaisiInvalide ? 'border-red-400' : 'border-transparent'}`}
                        />
                        {/* `type="email"` ne valide rien ici : le champ n'est pas dans
                            un <form>, la validation native du navigateur ne se
                            déclenche jamais. D'où ce contrôle explicite. */}
                        {emailSaisiInvalide && (
                            <p className="text-[11px] text-red-600 mt-1">Adresse e-mail invalide.</p>
                        )}
                    </div>

                    {/* Skills */}
                    <div>
                        <label className="block text-xs font-bold text-[#0B1F38]/60 mb-2 uppercase">Compétences</label>
                        <SkillInput
                            selectedSkills={newCollaborator.skills}
                            availableSkills={requiredSkills}
                            isAdmin={true}
                            variant="light"
                            onAdd={(skill) => setNewCollaborator(prev => ({ ...prev, skills: [...prev.skills, skill] }))}
                            onRemove={(skill) => setNewCollaborator(prev => ({ ...prev, skills: prev.skills.filter(s => s !== skill) }))}
                        />
                    </div>
                </div>

                <div className="p-4 bg-[#f4f6f9] flex justify-end gap-3 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-[#0B1F38]/60 hover:text-[#0B1F38]">Annuler</button>
                    <button
                        disabled={!newCollaborator.name.trim() || !emailValide(newCollaborator.email)}
                        onClick={() => onAdd({
                            ...newCollaborator,
                            // Balises et caractères de contrôle retirés dès la saisie :
                            // ce nom repart dans l'e-mail d'invitation, où il serait
                            // interprété comme du HTML.
                            name: nettoyerTexteLibre(newCollaborator.name),
                            email: newCollaborator.email.trim().toLowerCase(),
                        })}
                        className="px-6 py-2 bg-[#00A3E0] text-white font-bold text-sm rounded-xl hover:bg-[#008CC1] disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                    >
                        Ajouter le partenaire
                    </button>
                </div>
            </div>
        </div>
    );
};

export const TenderWizard: React.FC<TenderWizardProps> = ({
    onCancel,
    onFinish,
    initialTenderId,
    onTenderUpdate,
    onNavigate,
    isSidebarCollapsed,
    setIsSidebarCollapsed
}) => {
    const { showToast } = useToast();
    const { unreadCounts } = useChat();
    // --- STATE MANAGEMENT ---
    // Views: 'start' (Search) -> 'results' -> 'wizard_steps' -> 'decision' (Go/NoGo) -> 'verification' (Screenshot 2) -> 'team' (Screenshot 1)
    const [currentView, setCurrentView] = useState<'start' | 'results' | 'wizard_steps' | 'decision' | 'verification' | 'team' | 'manual'>(initialTenderId ? 'decision' : 'start');

    // --- EFFECTS ---
    useEffect(() => {
        const timer = setInterval(() => {
            setCarouselIndex(prev => prev + 1);
        }, 5000);
        return () => clearInterval(timer);
    }, []);

    // Data & Logic
    const [loading, setLoading] = useState(false);
    const [isInitializing, setIsInitializing] = useState(!!initialTenderId);
    const [showChatDrawer, setShowChatDrawer] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [userProfile, setUserProfile] = useState<any>(null);
    const [tenderId, setTenderId] = useState<string | null>(initialTenderId);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [existingCollaborators, setExistingCollaborators] = useState<any[]>([]);
    const [groupementMembers, setGroupementMembers] = useState<UIGroupementMember[]>([]);
    const [showCollabPicker, setShowCollabPicker] = useState(false);
    const [selectedMemberIndex, setSelectedMemberIndex] = useState<number | null>(null);
    const [showAddManualModal, setShowAddManualModal] = useState(false);

    // Search Inputs
    const [searchKeywords, setSearchKeywords] = useState('');
    const [searchMarketType, setSearchMarketType] = useState('');
    const [searchHandoverType, setSearchHandoverType] = useState('');
    const [searchDeadline, setSearchDeadline] = useState('');
    const [searchLocation, setSearchLocation] = useState('');
    const [searchOffset, setSearchOffset] = useState(0);
    const [hasMoreResults, setHasMoreResults] = useState(false);

    const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
    // UI States
    const [showDocDetails, setShowDocDetails] = useState(false);
    const [showContextEditModal, setShowContextEditModal] = useState(false);
    const [showCriteresModal, setShowCriteresModal] = useState(false);
    /**
     * Brouillon d'édition des critères, séparé de formData.
     *
     * Indispensable : une ligne vierge (« Ajouter un critère ») n'a pas sa place
     * dans la donnée persistée, mais doit exister à l'écran le temps de la
     * saisie. Dériver les lignes affichées de formData faisait disparaître
     * toute ligne vide dès sa création — le bouton semblait inopérant.
     */
    const [criteresDraft, setCriteresDraft] = useState<{ libelle: string; poids?: number }[]>([]);
    const [showDCEPiecesModal, setShowDCEPiecesModal] = useState(false);
    const [showRetroplanningModal, setShowRetroplanningModal] = useState(false);
    const [previousView, setPreviousView] = useState<'results' | 'manual'>('results');


    // Filters
    const [filesTab, setFilesTab] = useState<'personal' | 'team'>('personal');
    const [docModalSearch, setDocModalSearch] = useState('');
    const [docModalFilterStatus, setDocModalFilterStatus] = useState<'all' | 'received' | 'missing'>('all');
    const [docModalFilterCollab, setDocModalFilterCollab] = useState<string>('all');

    // INVITATION STATE
    const [invitationStatus, setInvitationStatus] = useState<'none' | 'pending' | 'refused'>('none');
    const [showStorageLimitModal, setShowStorageLimitModal] = useState(false);
    const [showCompanyDocPicker, setShowCompanyDocPicker] = useState(false);
    const [targetDocType, setTargetDocType] = useState<string | null>(null);
    const [companyDocs, setCompanyDocs] = useState<any>(null);
    const [companyCustomDocs, setCompanyCustomDocs] = useState<any[]>([]);
    const [companyDocSearch, setCompanyDocSearch] = useState('');
    const [isCopyingDoc, setIsCopyingDoc] = useState(false);
    const [isUploadingDCE, setIsUploadingDCE] = useState(false);
    const [showSuccessorPicker, setShowSuccessorPicker] = useState<{ memberIdx: number; newRole: string } | null>(null);
    const [showPromotionPicker, setShowPromotionPicker] = useState<{ targetMemberIdx: number } | null>(null);

    // Skills Taxonomy
    const [showSkillsModal, setShowSkillsModal] = useState(false);
    const [refDomains, setRefDomains] = useState<any[]>([]);
    const [refSpecialties, setRefSpecialties] = useState<any[]>([]);
    const [loadingRef, setLoadingRef] = useState(false);
    const [selectedNature, setSelectedNature] = useState<string | null>(null);
    const [skillQuery, setSkillQuery] = useState("");
    const [dropOpen, setDropOpen] = useState(false);
    const searchRef = React.useRef<HTMLDivElement>(null);

    // Retroplanning inline edit state
    const [editingJalonIndex, setEditingJalonIndex] = useState<number | null>(null);
    const [editingJalon, setEditingJalon] = useState<{ label: string, date: string } | null>(null);
    const [showAddJalonForm, setShowAddJalonForm] = useState(false);
    const [newJalon, setNewJalon] = useState({ label: '', date: '' });
    const [carouselIndex, setCarouselIndex] = useState(0);

    // Form Data
    const [formData, setFormData] = useState<TenderFormData>({
        titre: '',
        organisme_acheteur: '',
        lieu_execution: [],
        type_marche: [],
        secteur_activite: '',
        mode_passation: '',
        description: '',
        date_publication: '',
        date_limite: '',
        date_depot_souhaitee: '',
        montant_estime: 0,
        lien_telechargement: '',
        lien_depot: '',
        cpv_codes: [],
        criteres_attribution: null,
        reference_marche: '',
        // collaborateurs removed
        required_skills: [],
        required_specialty_ids: [],
        documents: [],
        jalons: [],
        dce_documents: []
    });

    const [siretQuery, setSiretQuery] = useState('');
    const [siretLoading, setSiretLoading] = useState(false);
    const [siretError, setSiretError] = useState('');

    const [dumeConnected, setDumeConnected] = useState(false);

    // Modals


    const [resentInvitations, setResentInvitations] = useState<Record<string, number>>({});
    const [showDeleteTenderModal, setShowDeleteTenderModal] = useState(false);
    const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);

    // Dynamic states
    const isLocked = formData.statut === STATUSES.submitted || formData.statut === STATUSES.won || formData.statut === STATUSES.lost;
    const isOwner = formData.createur_id ? formData.createur_id === userProfile?.id : !tenderId;

    // --- LOGIC: DELETE TENDER ---
    const handleDeleteTender = async () => {
        if (!tenderId) return;
        setLoading(true);
        try {
            // Delete from reponses_ao (cascade handles groupements/invitations if configured, but let's be explicit if not)
            const { error } = await supabase
                .from('reponses_ao')
                .delete()
                .eq('id', tenderId);

            if (error) throw error;

            showToast('Dossier supprimé avec succès.', 'success');
            if (onTenderUpdate) onTenderUpdate();
            onCancel(); // Use onCancel to go back to list
        } catch (error) {
            console.error('Error deleting tender:', error);
            showToast('Erreur lors de la suppression.', 'error');
        } finally {
            setLoading(false);
            setShowDeleteTenderModal(false);
        }
    };

    const renderDeleteTenderModal = () => {
        if (!showDeleteTenderModal) return null;
        return (
            <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-sm" onClick={() => setShowDeleteTenderModal(false)}></div>
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
                            onClick={() => setShowDeleteTenderModal(false)}
                            className="flex-1 py-3 text-sm font-bold text-[#0B1F38]/40 hover:bg-gray-50 rounded-xl transition-all border border-[#0B1F38]/10"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={handleDeleteTender}
                            className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-bold text-sm rounded-xl transition-all shadow-lg"
                        >
                            Supprimer
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    const renderFinalizeConfirmModal = () => {
        if (!showFinalizeConfirm) return null;
        return (
            <div className="fixed inset-0 z-[160] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-sm" onClick={() => setShowFinalizeConfirm(false)}></div>
                <div className="relative bg-white rounded-[2rem] p-10 max-w-md w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
                    <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-6 text-amber-500">
                        <ShieldAlert size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-[#0B1F38] mb-4">Finaliser le dossier ?</h3>
                    <p className="text-[#0B1F38]/60 mb-8 text-sm leading-relaxed">
                        Attention : une fois finalisé, le dossier sera <strong>verrouillé</strong>.
                        Il ne sera plus possible d'ajouter de membres ou de modifier les documents déposés.
                    </p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setShowFinalizeConfirm(false)}
                            className="flex-1 py-3 text-sm font-bold text-[#0B1F38]/40 hover:bg-gray-50 rounded-xl transition-all border border-[#0B1F38]/10"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={async () => {
                                setShowFinalizeConfirm(false);
                                await handleFinalize();
                            }}
                            className="flex-1 py-3 bg-[#0B1F38] hover:bg-[#0B1F38]/90 text-white font-bold text-sm rounded-xl transition-all shadow-lg"
                        >
                            Confirmer
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const [invitations, setInvitations] = useState<any[]>([]);
    const [showGroupementTypeModal, setShowGroupementTypeModal] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState<{ index: number, name: string } | null>(null);
    const [showOutcomeModal, setShowOutcomeModal] = useState<'won' | 'lost' | null>(null);

    useEffect(() => {
        if (tenderId) {
            fetchInvitations();
        }
    }, [tenderId]);

    const fetchInvitations = async () => {
        if (!tenderId) return;
        try {
            const { data, error } = await supabase
                .from('invitations')
                .select('*')
                .eq('tender_id', tenderId);

            if (error) throw error;
            setInvitations(data || []);
        } catch (err) {
            console.error('Error fetching invitations:', err);
        }
    };

    const fetchCompanyDocuments = async () => {
        if (!userProfile?.entreprise_id) return;
        try {
            // Fetch profile for standard docs
            const { data: profile } = await supabase
                .from('utilisateurs')
                .select('kbis_url, presentation_societe_url, attestation_honneur_url, attestation_assurance_url')
                .eq('id', userProfile.id)
                .single();

            if (profile) {
                setCompanyDocs({
                    "Kbis / Extrait D1": profile.kbis_url,
                    "Statuts": profile.presentation_societe_url,
                    "Attestation sur l'honneur": profile.attestation_honneur_url,
                    "Attestation Assurance": profile.attestation_assurance_url,
                });
            }

            // Fetch custom docs
            const { data: customDocs } = await supabase
                .from('documents_candidature')
                .select('*')
                .eq('entreprise_id', userProfile.entreprise_id);

            setCompanyCustomDocs(customDocs || []);
        } catch (err) {
            console.error('Error fetching company docs:', err);
        }
    };

    const handleSelectCompanyDoc = async (docUrl: string, label: string) => {
        if (!docUrl || !targetDocType || !userProfile) return;

        try {
            setIsCopyingDoc(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No user');

            let currentTenderId = tenderId;
            if (!currentTenderId) {
                showToast("Dossier non initialisé.", 'error');
                return;
            }

            // Determine collabId (me)
            const currentUserCollab = groupementMembers.find(c => c.id === userProfile.id) || (isOwner ? groupementMembers[0] : null);
            const currentUserIdx = groupementMembers.findIndex(c => c === currentUserCollab);
            const collabId = currentUserCollab?.id || currentUserIdx.toString();

            const fileName = nomPieceCollaborateur({
                docType: targetDocType,
                collabId,
                tenderId: currentTenderId,
            });
            const targetPath = `${user.email}/${fileName}`;

            // Le coffre-fort stocke désormais un CHEMIN, plus une URL publique
            // (le bucket est privé). `new URL()` échouait donc sur ces valeurs.
            // Les lignes antérieures à la migration 039a contiennent encore une
            // URL : les deux formes sont acceptées.
            let sourcePath: string;
            if (/^https?:\/\//i.test(docUrl)) {
                const pathParts = new URL(docUrl).pathname.split('/documents/');
                if (pathParts.length < 2) throw new Error("Format d'URL de document invalide");
                sourcePath = decodeURIComponent(pathParts[1]);
            } else {
                sourcePath = docUrl;
            }

            // La copie passe par une fonction serveur : elle exige un droit
            // d'écriture sur le bucket, que la migration 037 a retiré au client.
            // L'appel direct échouait avec « Object not found », message
            // trompeur — la source existe, c'est la création de la destination
            // qui est refusée.
            const { data: copie, error: copyError } = await supabase.functions.invoke('copy-document', {
                body: { source: sourcePath, nomCible: fileName },
            });

            if (copyError || copie?.error) {
                let detail = copie?.error ?? copyError?.message ?? 'Copie impossible.';
                try {
                    const reponse = (copyError as any)?.context;
                    if (reponse && typeof reponse.json === 'function') {
                        const corps = await reponse.json();
                        if (corps?.error) detail = corps.error;
                    }
                } catch { /* corps illisible */ }
                throw new Error(detail);
            }

            // Le chemin est mémorisé : l'export ZIP le relit ici plutôt que de
            // le reconstruire, la pièce copiée vivant dans le dossier de celui
            // qui l'a rattachée.
            setUploadedFilePaths(prev => ({ ...prev, [`${targetDocType}-${collabId}`]: copie?.chemin ?? targetPath }));

            // Update local state
            const fakeFile = new File([], label);
            setUploadedFiles(prev => ({ ...prev, [`${targetDocType}-${collabId}`]: fakeFile }));
            setUploadProgress(prev => ({ ...prev, [`${targetDocType}-${collabId}`]: 100 }));

            // Update DB file count
            await supabase.rpc('update_tender_file_count', {
                tender_id: currentTenderId,
                increment_by: 1
            });

            showToast("Document récupéré avec succès", 'success');
            setShowCompanyDocPicker(false);
            setTargetDocType(null);
        } catch (err: any) {
            console.error('Error copying company doc:', err);
            // Le message du serveur nomme la cause : document introuvable,
            // n'appartenant pas à l'appelant, ou copie refusée.
            showToast(err?.message || "Erreur lors de la récupération du document", 'error');
        } finally {
            setIsCopyingDoc(false);
        }
    };

    const [uploadedFiles, setUploadedFiles] = useState<{ [key: string]: File }>({});
    const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
    /**
     * Chemin réel de chaque pièce dans le bucket, par clé de correspondance.
     *
     * Le listage parcourt le dossier de chaque membre, mais ne conservait que le
     * nom du fichier : l'export ZIP reconstruisait ensuite le chemin en
     * `{email_du_membre}/{nom}`. Or une pièce déposée PAR LE MANDATAIRE pour un
     * membre atterrit dans le dossier du mandataire — le téléchargement échouait
     * alors sans bruit, et l'archive sortait vide.
     */
    const [uploadedFilePaths, setUploadedFilePaths] = useState<{ [key: string]: string }>({});



    // Dynamic document progress calculation
    const docProgress = useMemo(() => {
        // Global progress for the Coordination Documentaire modal header:
        // must aggregate ALL active members, not just the current user
        const activeMembers = groupementMembers.filter(m => !m.deleted);
        let total = 0;
        let uploaded = 0;
        activeMembers.forEach(member => {
            const role = member.role || 'Co-traitant';
            const reqDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
            const collabId = member.id || '';
            total += reqDocs.length;
            uploaded += reqDocs.filter(docDef => !!uploadedFiles[`${docDef.value}-${collabId}`]).length;
        });
        const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;
        return { uploaded, total, percent };
    }, [groupementMembers, uploadedFiles]);

    const validateTenderContext = () => {
        const mandatoryFields = [
            { key: 'titre', label: 'Titre' },
            { key: 'organisme_acheteur', label: "Organisme acheteur" },
            { key: 'lieu_execution', label: "Lieu d'exécution" },
            { key: 'type_marche', label: 'Type de marché' },
            { key: 'secteur_activite', label: 'Secteur d\'activité' },
            { key: 'mode_passation', label: 'Mode de passation' },
            { key: 'date_publication', label: 'Date de publication' },
            { key: 'date_limite', label: 'Date limite' },
            { key: 'date_depot_souhaitee', label: 'Date de dépôt souhaitée' }
        ];

        const missing = mandatoryFields.filter(f => {
            const val = (formData as any)[f.key];
            if (Array.isArray(val)) return val.length === 0;
            return !val;
        });

        if (missing.length > 0) {
            showToast(`Veuillez remplir les champs obligatoires suivants : ${missing.map(m => m.label).join(', ')}`, 'warning');
            return false;
        }
        return true;
    };

    const draftCheckLock = React.useRef(false);
    const goToView = (view: 'start' | 'results' | 'decision' | 'verification' | 'team') => {
        setCurrentView(view);
    };

    // --- HELPERS: DOCUMENT PROGRESS ---
    const getDocCountForRole = (role: string) => REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE]?.length || 0;
    const totalExpectedDocs = groupementMembers.reduce((acc, c) => acc + getDocCountForRole(c.role || 'Co-traitant'), 0);
    const totalReceivedDocs = Object.keys(uploadedFiles).length;
    const globalPercent = totalExpectedDocs > 0 ? Math.round((totalReceivedDocs / totalExpectedDocs) * 100) : 0;

    // --- HELPERS: FILE OPERATIONS ---
    const handleDownloadFile = async (path: string, fileName: string) => {
        try {
            const { data, error } = await supabase.storage.from('documents').download(path);
            if (error) throw error;
            saveAs(data, fileName);
        } catch (error) {
            console.error('Error downloading file:', error);
            showToast('Erreur lors du téléchargement', 'error');
        }
    };

    const handleDownloadAllFiles = async (targetMember?: UIGroupementMember) => {
        if (!isOwner || !tenderId) return;
        setLoading(true);
        try {
            const zip = new JSZip();
            // Pièces attendues mais introuvables, signalées à la fin plutôt que
            // de laisser croire à un export complet.
            const manquants: string[] = [];

            // Targets: specific member or whole team
            const targets = targetMember ? [targetMember] : groupementMembers.filter(m => !m.deleted);

            const downloadTasks = targets.flatMap(member => {
                const role = member.role || (groupementMembers[0] === member ? 'Mandataire' : 'Co-traitant');
                const docs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];

                return docs.map(async (docDef) => {
                    const collabId = member.id || groupementMembers.indexOf(member).toString();
                    const fileKey = `${docDef.value}-${collabId}`;
                    const fileObj = uploadedFiles[fileKey];

                    // Chemin réel relevé au listage. Le reconstruire depuis
                    // l'e-mail du membre échouait dès qu'un tiers avait déposé la
                    // pièce à sa place : l'archive sortait alors vide.
                    const path = uploadedFilePaths[fileKey]
                        ?? (member.email ? `${member.email.toLowerCase().trim()}/${fileObj?.name}` : null);

                    if (fileObj && path) {
                        const { data: fileData, error: dlError } = await supabase.storage.from('documents').download(path);
                        if (dlError || !fileData) {
                            // Sans ce journal, une pièce absente de l'archive ne
                            // laissait aucune trace : l'export « réussissait » vide.
                            console.warn('Pièce absente de l\'export ZIP', { path, docType: docDef.value, membre: member.email, dlError });
                            manquants.push(`${member.name || member.email} — ${docDef.label}`);
                        }
                        if (!dlError && fileData) {
                            const folderName = nettoyerTexteLibre(member.name || member.email, 60) || 'Membre';

                            // L'extension est déduite du CONTENU, pas du mimetype
                            // déclaré. Ce dernier valait souvent vide ou une valeur
                            // inconnue, et le repli produisait un « .bin » — un
                            // fichier que l'acheteur public ne peut pas ouvrir, alors
                            // que le critère de recette porte précisément sur la
                            // lisibilité de l'archive.
                            const debut = new Uint8Array(await fileData.slice(0, OCTETS_A_LIRE).arrayBuffer());
                            const type = detecterType(debut);
                            const ext = EXTENSIONS_PAR_TYPE[type] ?? EXTENSIONS_PAR_MIME[fileObj.type] ?? '';

                            // Nom lisible par un acheteur : « 02 - Attestation URSSAF.pdf ».
                            // Le numéro d'ordre préserve l'ordre de la checklist, qu'un
                            // tri alphabétique casserait.
                            const rang = String(docs.indexOf(docDef) + 1).padStart(2, '0');
                            const libelle = nettoyerTexteLibre(docDef.label, 60).replace(/[\\/:*?"<>|]/g, '-');
                            zip.file(`${folderName}/${rang} - ${libelle}${ext ? '.' + ext : ''}`, fileData);
                        }
                    }
                });
            });

            await Promise.all(downloadTasks);

            const zipContent = await zip.generateAsync({ type: 'blob' });
            const zipName = targetMember
                ? `Docs_${targetMember.name || targetMember.email}_${formData.titre.substring(0, 15)}.zip`
                : `Dossier_Complet_${formData.titre.substring(0, 15)}_${new Date().toISOString().split('T')[0]}.zip`;

            const nbFichiers = Object.keys(zip.files).filter(n => !zip.files[n].dir).length;
            if (nbFichiers === 0) {
                // Une archive vide n'est pas un succès : le critère de recette
                // porte précisément sur son contenu.
                showToast("Aucune pièce à exporter : aucun document n'a encore été déposé.", 'warning');
                return;
            }

            saveAs(zipContent, zipName.replace(/\s+/g, '_'));
            showToast(
                manquants.length > 0
                    ? `${nbFichiers} pièce(s) exportée(s), ${manquants.length} introuvable(s).`
                    : `${nbFichiers} pièce(s) exportée(s).`,
                manquants.length > 0 ? 'warning' : 'success'
            );
        } catch (error) {
            console.error('Error batch downloading:', error);
            showToast('Erreur lors du téléchargement groupé', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleRelancer = async (member: UIGroupementMember) => {
        if (!isOwner || !member.email) return;

        const normalizedEmail = member.email.trim().toLowerCase();
        const now = Date.now();
        const lastSent = resentInvitations[normalizedEmail] || 0;

        // Anti-spam: check if sent in the last 60 minutes
        if (now - lastSent < 3600000) {
            showToast('Relance déjà envoyée récemment. Veuillez patienter une heure.', 'warning');
            return;
        }

        // Lock immediately to prevent spamming
        setResentInvitations(prev => ({ ...prev, [normalizedEmail]: now }));
        setLoading(true);

        try {
            const { error } = await supabase.functions.invoke('send-reminder', {
                body: {
                    tenderId: tenderId,
                    tenderTitle: formData.titre,
                    email: normalizedEmail,
                    senderName: `${userProfile?.prenom} ${userProfile?.nom}`,
                    senderUserId: userProfile?.id
                }
            });

            if (error) throw error;
            
            showToast(`Relance envoyée à ${member.name || member.email}`, 'success');
        } catch (error: any) {
            console.error('Error sending reminder:', error);
            showToast(error.message || 'Erreur lors de l\'envoi de la relance', 'error');
        } finally {
            setLoading(false);
        }
    };


    const handleResendInvitation = async (email: string, role: string, accessCode: string, entrepriseId?: string) => {
        if (!tenderId || !userProfile) return;

        const normalizedEmail = email.trim().toLowerCase();
        // Anti-spam: check if sent in the last 60 minutes
        const now = Date.now();
        const lastSent = resentInvitations[normalizedEmail] || 0;
        if (now - lastSent < 3600000) {
            showToast('Invitation déjà renvoyée récemment. Veuillez patienter une heure.', 'warning');
            return;
        }

        // Lock immediately to prevent spamming while the request is in flight
        setResentInvitations(prev => ({ ...prev, [normalizedEmail]: now }));

        setLoading(true);
        try {
            const inviterName = `${userProfile.prenom || ''} ${userProfile.nom || ''}`.trim() || userProfile.email || "Un administrateur";

            const { data, error } = await supabase.functions.invoke('send-invitation', {
                body: {
                    tenderId,
                    email: normalizedEmail,
                    entrepriseId,
                    tenderTitle: formData.titre,
                    senderName: inviterName,
                    senderUserId: userProfile.id,
                    role,
                    // Ne jamais fabriquer un code ici : il serait envoyé à
                    // l'invité sans être enregistré, donc invalide à la saisie.
                    accessCode,
                    message: undefined,
                }
            });

            if (error) throw error;

            showToast('Invitation renvoyée avec succès !', 'success');
        } catch (err: any) {
            console.error('Resend error:', err);
            showToast(err.message || 'Erreur lors de l\'envoi de l\'invitation.', 'error');
        } finally {
            setLoading(false);
        }
    };



    // --- INITIALIZATION ---
    useEffect(() => {
        const init = async () => {
            const profile = await fetchUserProfile();
            if (initialTenderId) {
                await fetchTenderFromDB(initialTenderId, profile);
            }
            loadTaxonomy();
        };
        init();
    }, [initialTenderId]);

    /**
     * Suivi en temps réel des réponses aux invitations.
     *
     * Le critère de recette demande que le refus d'un partenaire soit « visible
     * immédiatement par le mandataire ». Sans souscription, la réponse n'était
     * connue qu'au prochain rechargement : le mandataire pouvait relancer
     * quelqu'un qui venait de refuser, ou attendre une pièce qui n'arriverait
     * jamais.
     *
     * On écoute `invitations` et `groupements` : la première porte la réponse
     * d'un invité sans compte, la seconde celle d'une entreprise déjà inscrite.
     */
    useEffect(() => {
        if (!tenderId) return;

        const rafraichir = () => {
            // Rechargement complet plutôt que mise à jour ponctuelle : statut,
            // rôle et composition du groupement se recalculent ensemble, et ce
            // cas reste rare — quelques réponses par dossier.
            fetchTenderFromDB(tenderId, userProfile);
        };

        const canal = supabase
            .channel(`ao-${tenderId}-reponses`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'invitations', filter: `tender_id=eq.${tenderId}` },
                rafraichir)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'groupements', filter: `projet_id=eq.${tenderId}` },
                rafraichir)
            .subscribe();

        return () => { supabase.removeChannel(canal); };
    }, [tenderId, userProfile?.id]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setDropOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const loadTaxonomy = async () => {
        setLoadingRef(true);
        try {
            const [doms, specs] = await Promise.all([
                supabase.from('ref_domains').select('id, label, natures').order('label'),
                supabase.from('ref_specialties').select('id, domain_id, label').not('label', 'ilike', 'Autre%').order('label'),
            ]);
            if (doms.data) setRefDomains(doms.data);
            if (specs.data) setRefSpecialties(specs.data);
        } catch (error) {
            console.error('Error loading taxonomy:', error);
        } finally {
            setLoadingRef(false);
        }
    };

    /**
     * Archive de toutes les pièces du marché.
     *
     * Le bloc DCE n'offrait qu'un téléchargement pièce par pièce. Sur un dossier
     * réel — RC, CCAP, CCTP, DPGF, AE, annexes — cela fait autant de clics et
     * autant de fichiers éparpillés dans le dossier de téléchargements.
     */
    const [zipDCEEnCours, setZipDCEEnCours] = useState(false);

    const telechargerToutLeDCE = async () => {
        const pieces = formData.dce_documents || [];
        if (pieces.length === 0) {
            showToast('Aucune pièce du marché à télécharger.', 'warning');
            return;
        }

        setZipDCEEnCours(true);
        try {
            const zip = new JSZip();
            const manquantes: string[] = [];

            for (const [index, doc] of pieces.entries()) {
                const { data, error } = await supabase.storage.from('documents').download(doc.path);
                if (error || !data) {
                    // Une pièce absente ne doit pas faire échouer l'archive
                    // entière : on la signale et on poursuit.
                    console.warn('Pièce du marché introuvable', { chemin: doc.path, error });
                    manquantes.push(doc.name || doc.path);
                    continue;
                }

                // Extension déduite du contenu, comme pour l'export du dossier :
                // le nom d'origine peut ne pas en porter.
                const debut = new Uint8Array(await data.slice(0, OCTETS_A_LIRE).arrayBuffer());
                const type = detecterType(debut);
                const ext = EXTENSIONS_PAR_TYPE[type] ?? '';
                const base = nettoyerTexteLibre(doc.name || `piece-${index + 1}`, 60)
                    .replace(/[\\/:*?"<>|]/g, '-')
                    .replace(/\.[A-Za-z0-9]{1,8}$/, '');
                const rang = String(index + 1).padStart(2, '0');
                zip.file(`${rang} - ${base}${ext ? '.' + ext : ''}`, data);
            }

            const nbFichiers = Object.keys(zip.files).filter(n => !zip.files[n].dir).length;
            if (nbFichiers === 0) {
                showToast("Aucune pièce n'a pu être récupérée.", 'error');
                return;
            }

            const contenu = await zip.generateAsync({ type: 'blob' });
            const nomArchive = `DCE_${(formData.titre || 'marche').slice(0, 40)}_${new Date().toISOString().split('T')[0]}.zip`;
            saveAs(contenu, nomArchive.replace(/\s+/g, '_'));

            showToast(
                manquantes.length > 0
                    ? `${nbFichiers} pièce(s) téléchargée(s), ${manquantes.length} introuvable(s).`
                    : `${nbFichiers} pièce(s) téléchargée(s).`,
                manquantes.length > 0 ? 'warning' : 'success'
            );
        } catch (err) {
            console.error('Archive DCE:', err);
            showToast("La préparation de l'archive a échoué.", 'error');
        } finally {
            setZipDCEEnCours(false);
        }
    };

    const handleDCEFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (refuserSiNonMandataire('ajouter une pièce du marché')) return;
        const file = e.target.files?.[0];
        if (!file || !tenderId) return;

        setIsUploadingDCE(true);
        try {
            const fileName = file.name;
            // Le dépôt passe par l'edge function : le nom final est décidé
            // côté serveur (nettoyage), on ne le devine pas ici.
            const { chemin: filePath, erreur } = await deposerFichier(file, {
                dossier: `tenders/dce/${tenderId}`,
                point: 'dce',
            });
            if (erreur || !filePath) throw new Error(erreur || 'Dépôt refusé.');

            const newDoc = {
                id: crypto.randomUUID(),
                name: fileName,
                path: filePath,
                type: file.type.split('/')[1]?.toUpperCase() || 'DOC',
                size: file.size,
                uploaded_at: new Date().toISOString()
            };

            const updatedDocs = [...(formData.dce_documents || []), newDoc];

            // Update DB
            const { error: dbError } = await supabase
                .from('reponses_ao')
                .update({ dce_documents: updatedDocs })
                .eq('id', tenderId);

            if (dbError) throw dbError;

            setFormData(prev => ({ ...prev, dce_documents: updatedDocs }));
            showToast('Document ajouté avec succès', 'success');
        } catch (error) {
            console.error('Error uploading DCE document:', error);
            showToast('Erreur lors du téléchargement', 'error');
        } finally {
            setIsUploadingDCE(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleDCEFileDelete = async (doc: any) => {
        if (!tenderId) return;
        if (!confirm(`Supprimer "${doc.name}" ? Cette action est irréversible.`)) return;
        try {
            await supabase.storage.from('documents').remove([doc.path]);
            const updatedDocs = (formData.dce_documents || []).filter((d: any) => d.id !== doc.id);
            await supabase.from('reponses_ao').update({ dce_documents: updatedDocs }).eq('id', tenderId);
            setFormData(prev => ({ ...prev, dce_documents: updatedDocs }));
            showToast(`"${doc.name}" supprimé.`, 'success');
        } catch (err) {
            console.error('Error deleting DCE doc:', err);
            showToast('Erreur lors de la suppression.', 'error');
        }
    };

    const handleDCEFileReplace = async (e: React.ChangeEvent<HTMLInputElement>, doc: any) => {
        const file = e.target.files?.[0];
        if (!file || !tenderId) return;
        setIsUploadingDCE(true);
        try {
            const { erreur } = await deposerFichier(file, {
                // On réécrit à l'emplacement existant : le dossier est celui du
                // document remplacé, sans son nom de fichier.
                dossier: doc.path.split('/').slice(0, -1).join('/'),
                point: 'dce',
                upsert: true,
            });
            if (erreur) throw new Error(erreur);
            const updatedDoc = { ...doc, name: file.name, type: file.type.split('/')[1]?.toUpperCase() || 'DOC', size: file.size, uploaded_at: new Date().toISOString() };
            const updatedDocs = (formData.dce_documents || []).map((d: any) => d.id === doc.id ? updatedDoc : d);
            await supabase.from('reponses_ao').update({ dce_documents: updatedDocs }).eq('id', tenderId);
            setFormData(prev => ({ ...prev, dce_documents: updatedDocs }));
            showToast(`"${file.name}" mis à jour.`, 'success');
        } catch (err) {
            console.error('Error replacing DCE doc:', err);
            showToast('Erreur lors du remplacement.', 'error');
        } finally {
            setIsUploadingDCE(false);
            if (e.target) e.target.value = '';
        }
    };

    const loadUploadedFiles = async (tId: string, membersOverride?: UIGroupementMember[]) => {
        try {
            const members = membersOverride || groupementMembers;
            // 1. Get all unique emails from the team members (including guests)
            // `filter(Boolean)` ne restreint pas le type, et l'inférence se perd
            // au passage par `Array.from(new Set(...))` avec la lib TS configurée
            // ici — d'où le prédicat explicite ET l'annotation.
            const teamEmails: string[] = Array.from(new Set(
                members
                    .map(m => m.email?.toLowerCase().trim())
                    .filter((e): e is string => Boolean(e))
            ));

            // Also include current user just in case
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email && !teamEmails.includes(user.email)) {
                teamEmails.push(user.email);
            }

            if (teamEmails.length === 0) return;

            // 2. Fetch files from each user's folder
            let allFiles: { [key: string]: File } = {};
            let allProgress: { [key: string]: number } = {};
            let allPaths: { [key: string]: string } = {};

            // Un appel de listage par membre. Ils partent en parallèle via
            // Promise.all, mais chacun est une requête réseau distincte : sur un
            // groupement fourni, c'est le premier suspect du gel signalé.
            const debutListage = performance.now();
            const listPromises = teamEmails.map(async (email) => {
                const { data, error } = await supabase.storage
                    .from('documents')
                    .list(email);

                if (error) {
                    console.warn(`Could not list files for ${email}:`, error);
                    return;
                }

                data?.forEach(fileData => {
                    // Convention partagée : voir helpers/documentNaming.
                    const piece = lirePieceCollaborateur(fileData.name, tId);
                    if (!piece) return;

                    // Clé de correspondance, mimetype conservé pour l'export ZIP.
                    const primaryKey = clePieceCollaborateur(piece.docType, piece.collabId);
                    const mimetype = fileData.metadata?.mimetype || '';
                    allFiles[primaryKey] = new File([], fileData.name, { type: mimetype });
                    allProgress[primaryKey] = 100;
                    // Le dossier réellement parcouru, pas celui du membre : les
                    // deux diffèrent dès que le dépôt a été fait par un tiers.
                    allPaths[primaryKey] = `${email}/${fileData.name}`;
                });
            });

            await Promise.all(listPromises);

            // 3. Robust Identity Sync: Map files to all current member keys to prevent flickering on identity changes
            const syncedFiles: { [key: string]: File } = { ...allFiles };
            const syncedProgress: { [key: string]: number } = { ...allProgress };
            const syncedPaths: { [key: string]: string } = { ...allPaths };

            if (members) {
                members.forEach(m => {
                    const gid = m.groupement_id;
                    const uid = m.id;
                    const email = m.email?.toLowerCase().trim();
                    const indices = [members.indexOf(m).toString()];

                    // Possible identities for this member
                    const identities = new Set<string>();
                    if (isValidUUID(gid)) identities.add(gid);
                    if (isValidUUID(uid)) identities.add(uid);
                    if (email) identities.add(email);
                    indices.forEach(i => identities.add(i));

                    // Derive ALL possible doc types from REQUIRED_DOCS_BY_ROLE dynamically
                    // (previously hardcoded to only 5 types, missing sous-traitant / co-traitant specific docs)
                    const allDocTypes = Array.from(
                        new Set(Object.values(REQUIRED_DOCS_BY_ROLE).flat().map((d: any) => d.value))
                    );

                    // For each document type, if we have a file for ANY identity, sync it to ALL identities
                    allDocTypes.forEach(t => {
                        let foundFile: File | null = null;
                        let foundPath: string | null = null;
                        identities.forEach(id => {
                            if (allFiles[`${t}-${id}`]) {
                                foundFile = allFiles[`${t}-${id}`];
                                foundPath = allPaths[`${t}-${id}`] ?? foundPath;
                            }
                        });

                        if (foundFile) {
                            identities.forEach(id => {
                                syncedFiles[`${t}-${id}`] = foundFile!;
                                syncedProgress[`${t}-${id}`] = 100;
                                if (foundPath) syncedPaths[`${t}-${id}`] = foundPath;
                            });
                        }
                    });
                });
            }

            if (perfActif()) {
                console.log(`     ↳ listage de ${teamEmails.length} dossier(s) : ${(performance.now() - debutListage).toFixed(0)} ms`);
            }

            setUploadedFiles(syncedFiles);
            setUploadProgress(syncedProgress);
            setUploadedFilePaths(syncedPaths);
        } catch (error) {
            console.error('Error loading files:', error);
        }
    };


    // SMART SKILLS: Generate required skills based on tender data
    useEffect(() => {
        if (!formData.titre && !formData.description) return;

        const txt = `${formData.titre} ${formData.description} ${formData.secteur_activite}`.toLowerCase();
        const newRequired: string[] = [];

        const potentialSkills = [
            // BTP - Gros Oeuvre & Structure
            { key: ["mur", "façade", "béton", "ingénieur structure", "gros oeuvre", "fondation", "ferraillage", "maçonnerie", "charpente", "coffrage", "dalle", "poteau", "poutre"], val: "Gros Oeuvre" },
            { key: ["architecte", "maitrise d'oeuvre", "conception", "plans", "permis", "esquisse", "aps", "apd"], val: "Architecture" },
            { key: ["bim", "revit", "maquette numérique", "ifc"], val: "BIM" },

            // Second Oeuvre
            { key: ["menuiserie", "fenêtre", "porte", "châssis", "baie vitrée", "vitrage", "pvc", "alu"], val: "Menuiserie" },
            { key: ["plâtrerie", "cloison", "doublage", "placo", "placoplatre", "staff"], val: "Plâtrerie" },
            { key: ["serrurerie", "métallerie", "garde-corps", "escalier métallique", "grille", "portail"], val: "Serrurerie" },
            { key: ["revêtement", "carrelage", "faïence", "sol souple", "pvc", "linoleum", "parquet", "moquette", "chape"], val: "Finition" },
            { key: ["peinture", "enduit", "ravalement", "toile de verre", "papier peint"], val: "Peinture" },

            // VRD & Extérieurs
            { key: ["vrd", "voirie", "réseau", "terrassement", "assainissement", "route", "chaussée", "pavage", "dallage", "bordure", "trottoir", "canalisations", "eau potable", "pluviales"], val: "VRD" },
            { key: ["paysage", "espaces verts", "plantation", "jardin", "élagage", "arrosage", "débroussaillage", "clôture", "cloture", "engazonnement"], val: "Paysagisme" },

            // Fluides
            { key: ["électricité", "électricite", "cfo", "cfa", "éclairage", "tension", "courant", "basse tension", "tableau électrique", "armoire", "onduleur", "photovoltaïque", "vdi"], val: "Électricité" },
            { key: ["plomberie", "cvc", "chauffage", "ventilation", "sanitaire", "clim", "climatisation", "chaudière", "vmc", "pac", "pompe à chaleur", "radiateur", "eau chaude", "ecs", "traitement d'air"], val: "CVC" },

            // Sécurité & Technique
            { key: ["amiante", "démolition", "déconstruction", "curage", "désamiantage", "diagnostic amiante", "plomb"], val: "Désamiantage" },
            { key: ["sécurité", "sps", "coordination", "protection", "incendie", "ssi", "alarme", "extincteur", "sprinkler", "désenfumage", "vidéosurveillance", "controle d'acces", "contrôle d'accès"], val: "Sécurité" },
            { key: ["maintenance", "entretien", "exploitation", "curatif", "préventif", "dépannage"], val: "Maintenance" },
            { key: ["nettoyage", "propreté", "lavage", "vitres", "locaux", "bureaux", "hygiène"], val: "Nettoyage" },

            // IT & Digital
            { key: ["informatique", "logiciel", "saas", "développement", "site web", "application", "app", "maintenance info", "support technique", "infogérance", "helpdesk"], val: "Réseaux informatiques" },
            { key: ["cloud", "hébergement", "data center", "serveur", "aws", "azure", "google cloud"], val: "Cloud Computing" },
            { key: ["fibre", "ftth", "cuivre", "téléphonie", "standard", "réseau", "ip", "switch", "routeur"], val: "Fibre optique" },
            { key: ["cybersécurité", "firewall", "pare-feu", "antivirus", "intrusion", "pentest", "audit sécurité"], val: "Cybersécurité" },

            // Restauration & Services
            { key: ["restauration", "repas", "cantine", "cuisine", "traiteur", "catering", "liaison froide", "denrées", "alimentaire", "haccp"], val: "Restauration" },
            { key: ["blanchisserie", "linge", "vêtements", "lavage industriel", "pressing"], val: "Blanchisserie" },
            { key: ["accueil", "conciergerie", "réception", "standard téléphonique"], val: "Conciergerie" },

            // Logistique & Transport
            { key: ["déménagement", "transfert", "manutention", "cartons", "mobilier"], val: "Déménagement" },
            { key: ["transport", "navette", "bus", "véhicule", "chauffeur", "vlc", "vsl", "ambulance"], val: "Transport de personnes" },
            { key: ["logistique", "stockage", "entreposage", "flux", "supply chain"], val: "Logistique" },
            { key: ["livraison", "colis", "courrier", "portage", "distribution"], val: "Livraison" },

            // Conseil & Communication
            { key: ["juridique", "droit", "avocat", "contentieux", "conseil", "réglementation"], val: "Conseil juridique" },
            { key: ["rh", "ressources humaines", "recrutement", "formation", "paie", "coaching", "compétences"], val: "Recrutement" },
            { key: ["communication", "événement", "evenement", "graphisme", "logo", "signalétique", "publicité", "marketing", "digital"], val: "Communication & Marketing" },

            // Environnement
            { key: ["déchets", "recyclage", "tri", "benne", "collecte", "valorisation", "compost"], val: "Gestion des déchets" },
            { key: ["eau", "station d'épuration", "step", "assainissement", "potable", "hydro", "hydraulique"], val: "Traitement des eaux" },

            // Fournitures
            { key: ["mobilier", "bureau", "chaise", "table", "armoire", "aménagement", "mobilier urbain"], val: "Mobilier de bureau" },
            { key: ["fournitures", "papeterie", "consommables", "toner", "papier"], val: "Fournitures de bureau" },
            { key: ["médical", "santé", "hôpital", "dispositifs médicaux", "pansements", "seringues", "materiel medical"], val: "Matériel médical" },

            // Gestion & Études
            { key: ["étude", "diagnostic", "audit", "expertise", "préconisation", "conseil technique"], val: "Études techniques" },
            { key: ["amo", "assistance à maîtrise d'ouvrage", "accompagnement", "conseil stratégique"], val: "AMO" },
            { key: ["opc", "pilotage", "coordination", "planification", "ordonnancement", "planning"], val: "OPC" },
            { key: ["economiste", "chiffrage", "devis", "estimation", "métré", "dpgf", "bpu"], val: "Économiste" }
        ];

        potentialSkills.forEach(ps => {
            if (ps.key.some(k => txt.includes(k))) {
                newRequired.push(ps.val);
            }
        });

        // Add sector defaults if no skills found but sector is defined
        if (newRequired.length === 0 && formData.secteur_activite) {
            if (formData.secteur_activite.includes("BTP")) newRequired.push("Gros Oeuvre", "Gestion de projet");
            else if (formData.secteur_activite.includes("Informatique")) newRequired.push("Réseaux informatiques", "Gestion de projet");
            else if (formData.secteur_activite.includes("Transport")) newRequired.push("Logistique");
            else if (formData.secteur_activite.includes("Services")) newRequired.push("Maintenance", "Nettoyage");
            else if (formData.secteur_activite.includes("Industrie")) newRequired.push("Maintenance", "Ingénierie structure");
        }

        // Default if absolute none found
        if (newRequired.length === 0) newRequired.push("Gestion de projet");
        setRequiredSkills(Array.from(new Set(newRequired)));
    }, [formData.titre, formData.description]);

    const fetchUserProfile = async (): Promise<any> => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data, error } = await supabase.from('utilisateurs').select('*').eq('id', user.id).single();
            if (error) throw error;
            setUserProfile(data);
            // Return profile for callers who need it immediately (before React re-render)
            const fetchedProfile = data;

            if (groupementMembers.length === 0) {
                const me: UIGroupementMember = {
                    id: user.id,
                    name: `${data.prenom} ${data.nom}`,
                    role: 'Mandataire',
                    email: data.email,
                    company: data.entreprise || "Mon Entreprise",
                    photo_url: data.photo_url,
                    status: GROUPEMENT_STATUSES.accepte,
                    entreprise_id: data.entreprise_id
                };
                setGroupementMembers([me]);
            } else {
                // Update self if present
                setGroupementMembers(prev => prev.map(m => m.id === user.id ? {
                    ...m,
                    name: `${data.prenom} ${data.nom}`,
                    email: data.email,
                    company: data.entreprise || "Mon Entreprise",
                    photo_url: data.photo_url,
                    entreprise_id: data.entreprise_id
                } : m));
            }
            await loadExistingCollaborators(user.id);
            return fetchedProfile;
        } catch (error) { console.error('Error fetching profile:', error); return null; }
    };

    const loadExistingCollaborators = async (userId: string) => {
        try {
            // Get user's company
            const { data: userData } = await supabase.from('utilisateurs').select('entreprise_id').eq('id', userId).single();
            if (!userData?.entreprise_id) return;
            const myCompanyId = userData.entreprise_id;

            // 1. Fetch active network connections (same logic as Collaborators.tsx "Mon réseau")
            const { data: activeConnections, error: netErr } = await supabase
                .from('reseau_entreprises')
                .select('statut, entreprise_cible_id, entreprise_cible:entreprises!entreprise_cible_id(*)')
                .eq('entreprise_origine_id', myCompanyId)
                .neq('statut', 'bloque');

            if (netErr) throw netErr;

            const companies = activeConnections?.map((c: any) => c.entreprise_cible) || [];
            if (companies.length === 0) {
                setExistingCollaborators([]);
                return;
            }

            // 2. Fetch Referent Users for these companies
            const referentIds = Array.from(new Set(companies.map(c => c.created_by).filter(Boolean)));
            const { data: referentsData } = await supabase
                .from('utilisateurs')
                .select('id, email, nom, prenom, photo_url, entreprise_id')
                .in('id', referentIds);

            const referentsMap = new Map();
            referentsData?.forEach(r => referentsMap.set(r.id, r));

            // 3. Map to UIGroupementMember format
            const allCollabs: UIGroupementMember[] = companies.map(company => {
                const referent = company.created_by ? referentsMap.get(company.created_by) : null;
                const email = referent?.email || `${company.id}@placeholder`;

                return {
                    id: referent?.id || '',
                    name: company.nom,
                    email: email,
                    role: 'Co-traitant',
                    company: company.nom,
                    entreprise_id: company.id,
                    status: GROUPEMENT_STATUSES.invite,
                    photo_url: company.logo_url
                };
            });

            setExistingCollaborators(allCollabs);
        } catch (error) { console.error('Error loading network collaborators:', error); }
    };

    /**
     * Chronométrage du chargement d'un dossier.
     *
     * Un gel d'une trentaine de secondes est signalé sur cet écran. Plutôt que
     * d'optimiser au jugé, on mesure : `fetchTenderFromDB` enchaîne une dizaine
     * de requêtes, dont certaines en série et d'autres par membre du
     * groupement. Ces marqueurs disent laquelle coûte.
     *
     * Activation sans recompilation, depuis la console :
     *     localStorage.setItem('filao:perf', '1')
     * puis rechargement. Les mesures apparaissent sous « ⏱ AO ».
     *
     * Désactivé par défaut : ces relevés n'ont aucun intérêt pour un
     * utilisateur et encombreraient la console.
     */
    const perfActif = () => {
        try { return localStorage.getItem('filao:perf') === '1'; } catch { return false; }
    };

    const chrono = (() => {
        let debutGlobal = 0;
        let dernier = 0;
        return {
            demarrer: (libelle: string) => {
                if (!perfActif()) return;
                debutGlobal = performance.now();
                dernier = debutGlobal;
                console.group(`⏱ AO — ${libelle}`);
            },
            etape: (libelle: string) => {
                if (!perfActif()) return;
                const maintenant = performance.now();
                const duree = maintenant - dernier;
                dernier = maintenant;
                // Au-delà de 300 ms une étape mérite l'attention : on la
                // distingue visuellement pour ne pas avoir à lire les chiffres.
                const marque = duree > 1000 ? '🔴' : duree > 300 ? '🟠' : '  ';
                console.log(`${marque} ${libelle.padEnd(38)} ${duree.toFixed(0).padStart(6)} ms`);
            },
            terminer: () => {
                if (!perfActif()) return;
                console.log(`   ${'TOTAL'.padEnd(38)} ${(performance.now() - debutGlobal).toFixed(0).padStart(6)} ms`);
                console.groupEnd();
            },
        };
    })();

    const fetchTenderFromDB = async (id: string, profileOverride?: any) => {
        chrono.demarrer(`chargement du dossier ${id.slice(0, 8)}`);
        if (!id || id === 'null' || id === 'undefined' || id === '') return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('reponses_ao')
                .select(`
                    *,
                    createur:utilisateurs!createur_id (
                        id, nom, prenom, email, photo_url, entreprise, entreprise_id
                    )
                `)
                .eq('id', id)
                .single();


            if (error) throw error;
            chrono.etape('reponses_ao (dossier + jointures)');

            if (data) {
                setTenderId(id);


                // Set form data FIRST to ensure UI displays even if groupements fail
                // 0. Fetch associated specialty IDs for this tender
                const { data: specData } = await supabase
                    .from('reponses_ao_specialties')
                    .select('specialty_id')
                    .eq('reponse_ao_id', id);
                const specialtyIds = specData?.map(s => s.specialty_id) || [];

                setFormData({
                    createur_id: data.createur_id,
                    titre: data.titre || '',
                    organisme_acheteur: data.organisme_acheteur || '',
                    lieu_execution: data.lieu_execution || [],
                    type_marche: data.type_marche || [],
                    secteur_activite: data.secteur_activite || 'Autres',
                    mode_passation: data.mode_passation || '',
                    description: data.description || '',
                    date_publication: data.date_publication ? data.date_publication.split('T')[0] : '',
                    date_limite: data.date_limite ? data.date_limite.split('T')[0] : '',
                    date_depot_souhaitee: data.date_depot_souhaitee ? data.date_depot_souhaitee.split('T')[0] : '',
                    montant_estime: data.montant_estime || 0,
                    lien_telechargement: data.lien_telechargement || '',
                    lien_depot: data.lien_depot || '',
                    cpv_codes: data.cpv_codes || [],
                    criteres_attribution: data.criteres_attribution || null,
                    reference_marche: data.reference_marche || '',
                    required_skills: data.required_skills || [],
                    required_specialty_ids: specialtyIds,
                    type_groupement: data.type_groupement || undefined,
                    statut: data.statut || STATUSES.on,
                    jalons: data.jalons || [],
                    dce_documents: data.dce_documents || [],
                    documents: []
                });
                setCurrentView('decision');

                chrono.etape('mapping formData');

                // 1. Fetch groupements with relations
                const { data: grpData, error: grpErr } = await supabase
                    .from('groupements')
                    .select(`
                        id, role_groupement, statut, entreprise_id,
                        entreprise:entreprises (
                            id, nom, logo_url, created_by,
                            membres:utilisateurs!utilisateurs_entreprise_id_fkey (id, email, nom, prenom, photo_url)
                        )
                    `)
                    .eq('projet_id', id);
                if (grpErr) console.error('Groupements fetch error:', grpErr);

                chrono.etape('groupements + entreprises + membres');

                // 2. Fetch standard email invitations
                const { data: invData, error: invErr } = await supabase
                    .from('invitations')
                    .select('*')
                    .eq('tender_id', id);
                if (invErr) console.error('Invitations fetch error:', invErr);

                const groupementsData = grpData || [];
                const invitationsData = invData || [];

                chrono.etape('invitations');

                // 5. Fetch Specialties for all companies in groupement
                const companyIds = groupementsData.map((g: any) => g.entreprise_id).filter(Boolean);
                let specialtiesMap: Record<string, { id: string, label: string }[]> = {};
                if (companyIds.length > 0) {
                    const { data: specsData } = await supabase
                        .from('company_specialties')
                        .select('entreprise_id, ref_specialties(id, label)')
                        .in('entreprise_id', companyIds);

                    specsData?.forEach((s: any) => {
                        if (!specialtiesMap[s.entreprise_id]) specialtiesMap[s.entreprise_id] = [];
                        if (s.ref_specialties) {
                            specialtiesMap[s.entreprise_id].push({
                                id: s.ref_specialties.id,
                                label: s.ref_specialties.label
                            });
                        }
                    });
                }

                chrono.etape('company_specialties (toutes entreprises)');

                // 3. Map groupements to UI format
                const mappedGroupements: UIGroupementMember[] = groupementsData.map((g: any) => {
                    const ent = g.entreprise;
                    const referent = ent?.membres?.[0];
                    const memberSpecs = specialtiesMap[g.entreprise_id] || [];
                    // `name` désigne le CONTACT, `company` l'entreprise — c'est la
                    // convention de `addCollaborator` et de la construction du
                    // créateur plus bas. Mettre le nom de l'entreprise dans `name`
                    // faisait basculer la carte d'un libellé à l'autre après
                    // finalisation : la vue initiale venait de l'état local, la
                    // vue rechargée de cette fonction.
                    const nomReferent = referent
                        ? `${referent.prenom || ''} ${referent.nom || ''}`.trim()
                        : '';

                    return {
                        id: referent?.id || g.id,
                        groupement_id: g.id,
                        name: nomReferent || ent?.nom || 'Entreprise inconnue',
                        email: referent?.email || '',
                        role: g.role_groupement || 'Co-traitant',
                        company: ent?.nom || '',
                        entreprise_id: g.entreprise_id,
                        photo_url: referent?.photo_url || ent?.logo_url || null,
                        status: g.statut as StatutGroupement,
                        deleted: false,
                        skills: memberSpecs.map(s => s.label),
                        specialty_ids: memberSpecs.map(s => s.id),
                        is_owner: g.entreprise_id === userProfile?.entreprise_id || ent?.created_by === userProfile?.id,
                        hasAccount: !!referent
                    };
                });

                // 4. Map invitations to UI format
                const mappedInvitations: UIGroupementMember[] = invitationsData.map((inv: any) => ({
                    id: inv.id,
                    groupement_id: undefined,
                    name: inv.email.split('@')[0],
                    email: inv.email,
                    role: inv.role || 'Co-traitant',
                    company: '',
                    entreprise_id: undefined,
                    photo_url: null,
                    status: inv.status === 'accepted' ? 'accepte' : inv.status === 'refused' ? 'refuse' : 'invite',
                    deleted: false,
                    skills: [],
                    hasAccount: false,
                    access_code: inv.token,
                    is_owner: false
                }));

                // DEDUPLICATION: prefer groupements records over invitations records (groupements has the real role)
                // We process groupements FIRST, then skip invitations for already-seen emails/companies
                const combinedMembers = [...mappedGroupements, ...mappedInvitations];
                const seenEmails = new Set<string>();
                const seenEntreprises = new Set<string>();
                // groupements records are first in combinedMembers, so they take priority
                let deduplicatedFinal = combinedMembers.filter(m => {
                    const emailKey = m.email?.toLowerCase().trim();
                    const entKey = m.entreprise_id;
                    if (emailKey && seenEmails.has(emailKey)) return false;
                    if (entKey && seenEntreprises.has(entKey)) return false;
                    if (emailKey) seenEmails.add(emailKey);
                    if (entKey) seenEntreprises.add(entKey);
                    return true;
                });

                chrono.etape('mapping membres + invitations');

                // 7. Identify creator, mark as owner, but TRUST the DB role (don't hardcode Mandataire)
                const creatorInList = deduplicatedFinal.find(m =>
                    m.id === data.createur_id ||
                    (m.entreprise_id && data.entreprise_id && m.entreprise_id === data.entreprise_id) ||
                    (m.email && (data as any).createur?.email && m.email.toLowerCase() === (data as any).createur.email.toLowerCase())
                );

                if (creatorInList) {
                    creatorInList.is_owner = true;
                    // Only default to Mandataire when no groupement record exists (new tender)
                    // AND nobody else is already Mandataire (in case leadership was transferred)
                    if (!creatorInList.groupement_id) {
                        const anotherMandataire = deduplicatedFinal.find(
                            m => m !== creatorInList && m.role === 'Mandataire' && !m.deleted
                        );
                        if (!anotherMandataire) {
                            creatorInList.role = 'Mandataire';
                        }
                        // If someone else is Mandataire, trust their existing role
                    }
                    // If they have a groupement_id, their role comes from DB — leave it
                } else if (data.createur_id) {
                    const creatorSource = (data as any).createur;
                    if (creatorSource) {
                        let creatorSkills: string[] = [];
                        let creatorSpecIds: string[] = [];

                        if (creatorSource.entreprise_id) {
                            if (specialtiesMap[creatorSource.entreprise_id]) {
                                creatorSkills = specialtiesMap[creatorSource.entreprise_id].map((s: any) => s.label);
                                creatorSpecIds = specialtiesMap[creatorSource.entreprise_id].map((s: any) => s.id);
                            } else {
                                const { data: creatorSpecsData } = await supabase
                                    .from('company_specialties')
                                    .select('ref_specialties(id, label)')
                                    .eq('entreprise_id', creatorSource.entreprise_id);

                                creatorSpecsData?.forEach((s: any) => {
                                    if (s.ref_specialties) {
                                        creatorSkills.push(s.ref_specialties.label);
                                        creatorSpecIds.push(s.ref_specialties.id);
                                    }
                                });
                            }
                        }

                        deduplicatedFinal.unshift({
                            id: creatorSource.id,
                            groupement_id: undefined,
                            email: creatorSource.email || '',
                            name: `${creatorSource.prenom || ''} ${creatorSource.nom || ''}`.trim() || 'Mandataire',
                            company: creatorSource.entreprise || '',
                            role: 'Mandataire', // Default only when creator has NO groupement record
                            photo_url: creatorSource.photo_url || null,
                            status: 'accepte',
                            deleted: false,
                            entreprise_id: creatorSource.entreprise_id || undefined,
                            is_owner: true,
                            skills: creatorSkills,
                            specialty_ids: creatorSpecIds
                        });
                    }
                }

                chrono.etape('résolution du créateur');

                // 8. Final Sync: Ensure members and files are set together to avoid flickering
                await loadUploadedFiles(id, deduplicatedFinal);
                chrono.etape(`loadUploadedFiles (${deduplicatedFinal.length} membre(s))`);
                setGroupementMembers(deduplicatedFinal);
            }
            chrono.terminer();
        } catch (err) {
            console.error('Error in fetchTenderFromDB:', err);
            chrono.terminer();
        } finally {
            setLoading(false);
            setIsInitializing(false);
        }
    };

    const saveCollaboratorsAndInvite = async (updatedMembers?: UIGroupementMember[]) => {
        if (!tenderId) return;
        setLoading(true);
        try {
            const membersToSave = updatedMembers || groupementMembers;

            // Validate
            const invalid = membersToSave.find(c => !c.deleted && (!c.email?.trim() || !c.role?.trim()));
            if (invalid) {
                showToast('Veuillez remplir email et rôle pour tous les membres.', 'warning');
                setLoading(false); return;
            }

            // Start of Migration 006: Use groupements table

            // 1. Prepare data for the edge function
            const deletions = membersToSave.filter(m => m.deleted && m.groupement_id).map(m => m.groupement_id);
            const invitationDeletions = membersToSave.filter(m => m.deleted && !m.groupement_id && m.email).map(m => m.email);
            const upsertGroupements: any[] = [];
            const insertInvitations: any[] = []; // Explicitly empty, send-invitation handles insertions to avoid duplicates
            const newInvitationsNotify: UIGroupementMember[] = [];

            // Get existing state to avoid duplicates
            const { data: existingGroups } = await supabase.from('groupements').select('entreprise_id').eq('projet_id', tenderId);
            const existingCompanyIds = new Set(existingGroups?.map(g => g.entreprise_id) || []);
            const { data: existingInvs } = await supabase.from('invitations').select('email').eq('tender_id', tenderId);
            const existingEmails = new Set(existingInvs?.map(i => i.email) || []);

            const upsertInvitations: any[] = [];
            const processedEmails = new Set<string>();
            const processedCompanyIds = new Set<string>();

            for (const member of membersToSave) {
                if (member.deleted) continue;

                const isOwner = member.id === userProfile?.id || member.is_owner || (member.email?.toLowerCase() === userProfile?.email?.toLowerCase());

                if (member.entreprise_id) {
                    const payload: any = {
                        projet_id: tenderId,
                        role_groupement: member.role,
                        statut: isOwner ? 'accepte' : ((member.status === 'invite' || member.status === 'pending') ? 'invite' : member.status),
                        entreprise_id: member.entreprise_id,
                    };

                    if (isValidUUID(member.groupement_id)) {
                        payload.id = member.groupement_id;
                    }

                    upsertGroupements.push(payload);

                    if (!isOwner && !member.groupement_id && !existingCompanyIds.has(member.entreprise_id) && !processedCompanyIds.has(member.entreprise_id)) {
                        newInvitationsNotify.push(member);
                        processedCompanyIds.add(member.entreprise_id);
                    }
                } else if (member.email && !isOwner) {
                    // It's an invitation-based member (and NOT the owner)
                    if (member.groupement_id || (member.id && !member.id.startsWith('collab-'))) {
                        // Existing invitation: update role
                        upsertInvitations.push({
                            id: member.groupement_id || member.id,
                            role: member.role
                        });
                    } else if (!existingEmails.has(member.email) && !processedEmails.has(member.email)) {
                        // New invitation: collect for notification
                        newInvitationsNotify.push(member);
                        processedEmails.add(member.email);
                    }
                }
            }

            // 2. Call manage-team edge function
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const { data: { session: teamSession } } = await supabase.auth.getSession();
            if (!teamSession || !supabaseUrl) throw new Error("Session expirée");

            const resp = await fetch(`${supabaseUrl}/functions/v1/manage-team`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${teamSession.access_token}`,
                },
                body: JSON.stringify({
                    tenderId,
                    upsertGroupements,
                    upsertInvitations,
                    insertInvitations,
                    deletions,
                    invitationDeletions
                }),
            });

            if (!resp.ok) {
                const errorText = await resp.text();
                throw new Error(`Erreur manage-team: ${errorText}`);
            }

            // Manage-team insertedInvitations block removed because send-invitation now handles it

            // 4. Refetch to sync state
            await fetchTenderFromDB(tenderId);
            if (onTenderUpdate) onTenderUpdate();

            // --- NOTIFY new invitations (in-app + email via edge function) ---
            const inviterName = userProfile ? `${userProfile.prenom} ${userProfile.nom}` : "Un administrateur";

            for (const invitee of newInvitationsNotify) {
                // Dedicated invitation email with access link (Edge function handles both email and in-app notification)
                if (invitee.email || invitee.entreprise_id) {
                    try {
                        const { data: { session } } = await supabase.auth.getSession();
                        if (session && supabaseUrl) {
                            await fetch(`${supabaseUrl}/functions/v1/send-invitation`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${session.access_token}`,
                                },
                                body: JSON.stringify({
                                    tenderId,
                                    email: invitee.email,
                                    entrepriseId: invitee.entreprise_id,
                                    tenderTitle: formData.titre,
                                    senderName: inviterName,
                                    senderUserId: userProfile?.id,
                                    role: invitee.role,
                                    // Idem : un code fabriqué ici ne serait pas
                                    // celui stocké sur l'invitation.
                                    accessCode: invitee.access_code,
                                    message: '',
                                }),
                            });
                        }
                    } catch (emailErr) {
                        console.error('Error sending invitation email:', emailErr);
                    }
                }
            }

            showToast('Partenaires mis à jour !', 'success');

        } catch (error) {
            console.error(error);
            showToast('Erreur lors de la sauvegarde des partenaires.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const saveRequiredSkills = async () => {
        if (refuserSiNonMandataire('modifier les compétences requises')) return;
        if (!tenderId) return;
        setLoading(true);
        try {
            // 1. Update specialty junction table
            const { error: delError } = await supabase
                .from('reponses_ao_specialties')
                .delete()
                .eq('reponse_ao_id', tenderId);

            if (delError) throw delError;

            if (formData.required_specialty_ids.length > 0) {
                const specEntries = formData.required_specialty_ids.map(sid => ({
                    reponse_ao_id: tenderId,
                    specialty_id: sid
                }));
                const { error: insError } = await supabase
                    .from('reponses_ao_specialties')
                    .insert(specEntries);
                if (insError) throw insError;
            }

            // 2. Update required_skills list in main table
            const { error: updError } = await supabase
                .from('reponses_ao')
                .update({
                    required_skills: formData.required_skills,
                    modified_at: new Date().toISOString()
                })
                .eq('id', tenderId);

            if (updError) throw updError;

            showToast("Compétences mises à jour", "success");
            if (onTenderUpdate) onTenderUpdate();
        } catch (err) {
            console.error("Error saving skills:", err);
            showToast("Erreur lors de la sauvegarde des compétences", "error");
        } finally {
            setLoading(false);
        }
    };

    /**
     * @param overrides valeurs à écrire en priorité sur celles de formData.
     *   setFormData étant asynchrone, un appelant qui vient de modifier un champ
     *   doit transmettre la nouvelle valeur ici plutôt que de compter sur le
     *   state, qui serait encore périmé au moment de la requête.
     */
    /**
     * Refuse une écriture sur le dossier à qui n'en est pas le mandataire.
     *
     * Matrice de permissions : seul le créateur modifie le contexte, le
     * rétroplanning, les compétences requises, les pièces du marché et le cycle
     * de vie. Un co-traitant a une vue en lecture.
     *
     * Ces fonctions ne s'appuyaient que sur le masquage des boutons. La RLS de
     * `reponses_ao` refuse déjà l'UPDATE (`createur_id = auth.uid()`), mais
     * l'échec était silencieux : l'état local était mis à jour, l'écriture
     * rejetée, et l'écran affichait une modification qui n'existait pas en base
     * jusqu'au rechargement.
     */
    const refuserSiNonMandataire = (action: string): boolean => {
        if (isOwner) return false;
        console.warn('Écriture refusée : rôle insuffisant', { action });
        showToast("Seul le mandataire du dossier peut effectuer cette action.", 'warning');
        return true;
    };

    const saveTenderContext = async (overrides?: Partial<TenderFormData>) => {
        if (refuserSiNonMandataire('modifier le contexte')) return;
        if (!tenderId) return;
        const data = { ...formData, ...overrides };

        // `date_limite` est NOT NULL en base : envoyer null ferait échouer
        // l'UPDATE entier, y compris les champs correctement remplis.
        if (!data.date_limite) {
            showToast("La date limite est obligatoire.", "warning");
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase
                .from('reponses_ao')
                .update({
                    titre: data.titre,
                    organisme_acheteur: data.organisme_acheteur,
                    lieu_execution: versTableau(data.lieu_execution),
                    type_marche: versTableau(data.type_marche),
                    secteur_activite: coerceSecteurActivite(data.secteur_activite),
                    mode_passation: coerceModePassation(data.mode_passation),
                    date_publication: data.date_publication || null,
                    date_limite: data.date_limite || null,
                    date_depot_souhaitee: data.date_depot_souhaitee || null,
                    montant_estime: data.montant_estime || 0,
                    lien_telechargement: data.lien_telechargement || '',
                    lien_depot: data.lien_depot || '',
                    cpv_codes: data.cpv_codes || [],
                    criteres_attribution: data.criteres_attribution ?? null,
                    reference_marche: data.reference_marche || null,
                    description: data.description || '',
                    modified_at: new Date().toISOString()
                })
                .eq('id', tenderId);

            if (error) throw error;

            showToast("Informations mises à jour", "success");
            if (onTenderUpdate) onTenderUpdate();
        } catch (err) {
            console.error("Error saving context:", err);
            showToast(messageErreurBase(err) ?? "Erreur lors de la sauvegarde", "error");
        } finally {
            setLoading(false);
        }
    };



    // --- INVITATION RESPONSE HANDLER ---

    const handleInvitationResponse = async (accept: boolean) => {
        if (!tenderId || !userProfile) return;
        setLoading(true);
        try {
            // Use the accept-invitation edge function which uses service role key to bypass RLS
            // This handles: updating invitations/groupements tables + notifying the mandataire
            const { data: { session } } = await supabase.auth.getSession();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

            if (!session || !supabaseUrl) throw new Error("Session expirée");

            const response = await fetch(`${supabaseUrl}/functions/v1/accept-invitation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ tenderId, accept }),
            });

            const result = await response.json();

            if (!response.ok) {
                console.error('accept-invitation error:', result);
                throw new Error(result.error || "Erreur lors de la réponse à l'invitation");
            }

            // Update UI state
            if (accept) {
                setInvitationStatus('none');
                setGroupementMembers(prev => prev
                    // Remove the pending invitation entry
                    .filter(m => !(m.email === userProfile.email && m.status === 'invite' && !m.groupement_id))
                    // Mark the groupement entry as accepted (if present)
                    .map(m => m.email === userProfile.email ? { ...m, status: 'accepte' } : m)
                );
                showToast('Vous avez rejoint l\'équipe !', 'success');
            } else {
                setInvitationStatus('refused');
                showToast('Vous avez refusé l\'invitation.', 'info');
                // Redirect on refusal as user is no longer authorized to see this tender
                setTimeout(() => onCancel(), 1500);
            }

            // Refetch to get clean state if accepted
            if (accept && tenderId) await fetchTenderFromDB(tenderId);
            if (onTenderUpdate) onTenderUpdate();

        } catch (error) {
            console.error("Invitation response error:", error);
            showToast("Erreur lors de la réponse à l'invitation.", 'error');
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: QUIT GROUPEMENT (for accepted collaborators) ---
    const handleQuitGroupement = async () => {
        if (!tenderId || !userProfile) return;
        setLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            if (!session || !supabaseUrl) throw new Error('Session expirée');

            const myEntry = groupementMembers.find(m => m.id === userProfile.id || m.email === userProfile.email);

            // 1. Delete groupements row (member can delete their own entry)
            if (myEntry?.groupement_id) {
                const { error: grpErr } = await supabase
                    .from('groupements')
                    .delete()
                    .eq('id', myEntry.groupement_id);
                if (grpErr) throw grpErr;
            }

            // 2. Mark any invitation as refused (best-effort, may not exist)
            await supabase
                .from('invitations')
                .update({ status: 'refused', refused_at: new Date().toISOString() })
                .eq('tender_id', tenderId)
                .eq('email', userProfile.email);

            // 3. Notify mandataire via notify-user edge function (bypasses RLS)
            const mandataire = groupementMembers.find(m => m.is_owner);
            if (mandataire?.id) {
                const collaboratorName = [userProfile.prenom, userProfile.nom].filter(Boolean).join(' ') || userProfile.email;
                const collaboratorAvatar = userProfile.photo_url || '';
                fetch(`${supabaseUrl}/functions/v1/notify-user`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                        userId: mandataire.id,
                        notification: {
                            type: 'collaboration_left',
                            titre: 'Départ du groupement',
                            message: 'a quitté le groupement pour',
                            sender_name: collaboratorName,
                            sender_avatar: collaboratorAvatar,
                            related_tender_id: tenderId,
                            related_tender_titre: formData.titre,
                        },
                    }),
                }).catch(console.error);
            }

            showToast('Vous avez quitté le groupement.', 'success');
            onCancel(); // Use the existing prop to redirect back to the tenders list / search
            setInvitationStatus('refused');
            setGroupementMembers(prev => prev.filter(m => m.id !== userProfile.id && m.email !== userProfile.email));
            await fetchTenderFromDB(tenderId);
        } catch (error) {
            console.error('Quit groupement error:', error);
            showToast("Erreur lors de la sortie du groupement.", 'error');
        } finally {
            setLoading(false);
        }
    };

    // Draft and saveDraft logic removed — AO is saved as 'En cours' immediately on creation.

    // --- LOGIC: SIRET SEARCH ---
    const handleSiretSearch = async () => {
        if (!siretQuery.trim()) return;
        setSiretLoading(true);
        setSiretError('');
        try {
            const query = encodeURIComponent(siretQuery.trim());
            const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${query}`);
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                const company = data.results[0];
                setFormData(prev => ({
                    ...prev,
                    organisme_acheteur: company.nom_complet || company.nom_raison_sociale || prev.organisme_acheteur,
                    lieu_execution: company.siege?.commune ? [company.siege.commune] : prev.lieu_execution
                }));
                showToast("Coordonnées de l'acheteur récupérées avec succès", 'success');
            } else {
                setSiretError("Aucune entreprise trouvée pour ce SIRET/Nom");
            }
        } catch (err) {
            console.error(err);
            setSiretError("Erreur lors de la recherche SIREN");
        } finally {
            setSiretLoading(false);
        }
    };

    // --- LOGIC: SEARCH ---
    const handleSearch = async (loadMore = false) => {
        try {
            setSearchLoading(true);
            const baseUrl = BOAMP_BaseUrl;
            let whereParts = [];
            if (searchMarketType) {
                whereParts.push(`type_marche:"${searchMarketType}"`);
            }
            if (searchHandoverType) {
                whereParts.push(`type_procedure:"${searchHandoverType}"`);
            }
            if (searchLocation) {
                const code = Object.entries(DEPARTEMENTS_OBJ).find(([c, name]) => name === searchLocation)?.[0];
                if (code) {
                    whereParts.push(`code_departement="${code}"`);
                }
            }
            if (searchKeywords) {
                const keywords = searchKeywords.split(' ').filter(k => k.trim());
                whereParts.push(`search("${keywords.join(' ')}")`);
            }
            // Plancher toujours appliqué. La version précédente le remplaçait
            // par la date choisie par l'utilisateur : une date passée faisait
            // donc disparaître toute borne, et la recherche remontait des avis
            // clos depuis des mois.
            const today = new Date().toISOString().split('T')[0];
            const plancher = searchDeadline && searchDeadline > today ? searchDeadline : today;
            whereParts.push(`datelimitereponse >= "${plancher}"`);

            const whereParam = whereParts.length > 0 ? '&where=' + encodeURIComponent(whereParts.join(' AND ')) : '';
            const newOffset = loadMore ? searchOffset + 20 : 0;
            const url = `${baseUrl}?${whereParam}&limit=20&offset=${newOffset}`;

            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 429) {
                    showToast('Quota API atteint. Veuillez réessayer plus tard.', 'error');
                } else {
                    showToast(`Erreur API: ${response.status}`, 'error');
                }
                setSearchResults([]);
                return;
            }

            const data = await response.json();

            if (!data.results || data.results.length === 0) {
                if (!loadMore) {
                    showToast("Aucun appel d'offres trouvé pour ces critères.", 'info');
                    setSearchResults([]);
                }
                setHasMoreResults(false);
            } else {
                // Le filtre de l'API porte sur une date, la valeur est un
                // horodatage : un avis dont la remise était fixée ce matin
                // passait encore toute la journée.
                const ouverts = data.results.filter((a: any) => avisEncoreOuvert(a));

                // Dédoublonnage après concaténation : la pagination par offset
                // renvoie des avis déjà vus dès qu'une publication s'intercale,
                // et un même marché peut avoir plusieurs avis (rectificatifs).
                const cumul = loadMore ? [...searchResults, ...ouverts] : ouverts;
                const nettoyes = dedoublonnerAvis(cumul);

                if (nettoyes.length === 0 && !loadMore) {
                    showToast("Aucun appel d'offres encore ouvert pour ces critères.", 'info');
                    setSearchResults([]);
                    setHasMoreResults(false);
                    return;
                }

                setSearchResults(nettoyes);
                setSearchOffset(newOffset);
                // On se fie au nombre renvoyé par l'API, pas au nombre retenu :
                // une page entièrement filtrée ne signifie pas la fin des
                // résultats.
                setHasMoreResults(data.results.length === 20);
                setCurrentView('results');
            }
        } catch (error) {
            console.error('Error searching tenders:', error);
            showToast('Erreur lors de la recherche', 'error');
        } finally {
            setSearchLoading(false);
        }
    };

    const selectTenderFromSearch = (tender: any) => {
        // Robust Mapping
        let departments = [];
        const depts = Array.isArray(tender.code_departement) ? tender.code_departement : [tender.code_departement];
        for (let d of depts) {
            // Map code to Name if possible, e.g. "75" -> "Paris"
            const name = DEPARTEMENTS_OBJ[String(d).padStart(2, '0')] || d;
            departments.push(name);
        }

        // Les CPV, critères et référence vivent dans `tender.donnees`, une chaîne
        // JSON issue du XML BOAMP — d'où le passage par un parseur dédié plutôt
        // qu'un accès direct aux propriétés.
        const cpvCodes = extractCpvCodes(tender).map(c => c.code);

        setFormData(prev => ({
            ...prev,
            titre: tender.objet || '',
            organisme_acheteur: tender.nomacheteur || 'Anonyme',
            lieu_execution: departments || [],
            // Colonne ARRAY NOT NULL : une valeur scalaire ou nulle ferait
            // échouer l'insert.
            type_marche: versTableau(tender.type_marche),
            // `type_procedure` est null sur une partie des avis BOAMP, et ''
            // n'est pas une valeur de mode_passation_enum : l'insert échouait.
            mode_passation: coerceModePassation(tender.type_procedure),
            date_publication: tender.dateparution || new Date().toISOString(),
            date_limite: tender.datelimitereponse ? new Date(tender.datelimitereponse).toISOString() : '',
            date_depot_souhaitee: tender.datefindiffusion || tender.datelimitereponse || new Date().toISOString(),
            montant_estime: tender.montant || 0,
            // Le secteur était écrit en dur à « Autres », ce qui neutralisait au
            // passage l'inférence des compétences requises (qui teste le libellé
            // du secteur). Les CPV donnent une déduction correcte dans la
            // plupart des cas ; l'utilisateur reste libre de la corriger.
            secteur_activite: deduireSecteurDepuisCpv(cpvCodes) ?? 'Autres',
            lien_telechargement: tender.url_avis || '',
            description: tender.objet || '',
            cpv_codes: cpvCodes,
            criteres_attribution: extractCriteresAttribution(tender),
            reference_marche: extractReferenceMarche(tender),
            // collaborators removed
            documents: []
        }));

        // Initialize groupementMembers with current user as Mandataire initially
        setGroupementMembers([{
            id: userProfile?.id,
            name: `${userProfile?.prenom || ''} ${userProfile?.nom || ''}`.trim() || 'Moi',
            email: userProfile?.email || '',
            role: 'Mandataire',
            company: userProfile?.entreprise || "Mon Entreprise",
            skills: [],
            hasAccount: true,
            photo_url: userProfile?.photo_url,
            status: GROUPEMENT_STATUSES.accepte,
            entreprise_id: userProfile?.entreprise_id,
            is_owner: true // Mark as true owner explicitly if we haven't already
        }]);

        setPreviousView('results');
        setCurrentView('wizard_steps');
    };

    // --- LOGIC: DECISION -> VERIFICATION (Creates Draft) ---
    const handleGoToVerification = async (typeOverride?: 'solidaire' | 'conjoint', updatedMembers?: UIGroupementMember[]) => {
        const activeMembers = groupementMembers.filter(m => !m.deleted);

        // Contrairement à handleManualSubmit, ce chemin n'avait aucune garde.
        // Or plusieurs colonnes écrites ici sont NOT NULL : un champ vide
        // faisait échouer l'insert en base, sans indication de la cause côté UI.
        const manquants = champsManquants(formData);
        if (manquants.length > 0) {
            showToast(`Champs obligatoires à renseigner : ${manquants.join(', ')}.`, 'warning');
            setShowContextEditModal(true);
            return;
        }

        // If "Réponse individuelle" (only 1 member), we skip the modal and proceed with null type.
        // We only show the modal if multiple members and type is not set.
        let type = typeOverride || formData.type_groupement;

        if (activeMembers.length > 1 && !type) {
            setShowGroupementTypeModal(true);
            return;
        }

        // If it was solo, type will be undefined/null, which is correct for reponses_ao.type_groupement

        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const newId = tenderId || crypto.randomUUID();
            setTenderId(newId);

            // Update formData state for consistency (though we use 'type' var for payload)
            if (typeOverride) {
                setFormData(prev => ({ ...prev, type_groupement: typeOverride }));
            }

            const draftData = {
                id: newId,
                createur_id: user.id,
                titre: formData.titre,
                description: formData.description,
                organisme_acheteur: formData.organisme_acheteur,
                lieu_execution: versTableau(formData.lieu_execution),
                secteur_activite: coerceSecteurActivite(formData.secteur_activite),
                type_marche: versTableau(formData.type_marche),
                mode_passation: coerceModePassation(formData.mode_passation),
                date_publication: formData.date_publication || null, // Send null if empty
                date_limite: formData.date_limite || null,
                date_depot_souhaitee: formData.date_depot_souhaitee || null,
                type_groupement: type, // PERSISTED FIELD
                montant_estime: formData.montant_estime || 0,
                // Liens du marché — doivent être persistés dès la création du brouillon.
                // Sans cela, l'URL récupérée du BOAMP (selectTenderFromSearch) ne vivait
                // qu'en state local et disparaissait au premier rechargement.
                lien_telechargement: formData.lien_telechargement || '',
                lien_depot: formData.lien_depot || '',
                cpv_codes: formData.cpv_codes || [],
                criteres_attribution: formData.criteres_attribution ?? null,
                reference_marche: formData.reference_marche || null,
                nb_collaborateurs: groupementMembers.filter(m => !m.deleted).length, // Map count from active members only
                nombre_pj_attendues: 0, // Default or calc
                // collaborateurs: formData.collaborateurs, // Removed
                required_skills: formData.required_skills,
                jalons: formData.jalons,
                dce_documents: formData.dce_documents,
                success_score: (() => {
                    const covered = Array.from(new Set(groupementMembers.flatMap(c => c.skills || [])));
                    const req = formData.required_skills.length;
                    if (req === 0) return 85;
                    const coveredCount = formData.required_skills.filter(s => covered.includes(s)).length;
                    return Math.round(40 + (coveredCount / req) * 55);
                })(),
                statut: coerceStatut('En cours'),
                etape: 2,
                modified_at: new Date().toISOString()
            };

            // Update local state immediately to avoid "restricted view" issue
            setFormData(prev => ({
                ...prev,
                ...draftData,
                id: newId,
                createur_id: user.id
            }));

            const { error: upsertError } = await supabase.from('reponses_ao').upsert(draftData);
            if (upsertError) {
                console.error('RLS or DB Error on reponses_ao upsert:', upsertError);
                throw upsertError;
            }

            // 1.5 Update specialties junction table
            if (formData.required_specialty_ids?.length > 0) {
                // Delete existing
                await supabase.from('reponses_ao_specialties').delete().eq('reponse_ao_id', newId);
                // Insert new entries
                const specEntries = formData.required_specialty_ids.map(sid => ({
                    reponse_ao_id: newId,
                    specialty_id: sid
                }));
                const { error: specError } = await supabase.from('reponses_ao_specialties').insert(specEntries);
                if (specError) console.error("Error saving tender specialties:", specError);
            }

            // Also save groupement members
            await saveCollaboratorsAndInvite(updatedMembers);

            // Notify parent to invalidate cache if this is a new tender
            if (onTenderUpdate) onTenderUpdate();
        } catch (error) {
            console.error('Final Catch in handleGoToVerification:', error);
            // « Voir console » n'est actionnable pour personne. Les erreurs
            // d'enum et de NOT NULL désignent précisément un champ : on le dit.
            showToast(
                messageErreurBase(error) ?? "Erreur lors de l'initialisation du dossier.",
                'error'
            );
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: FINALIZE ---
    const handleFinalize = async () => {
        if (isLocked) return;
        setLoading(true);
        try {
            // VALIDATION: Check for empty fields
            if (!formData.titre || !formData.organisme_acheteur || !formData.date_limite) {
                showToast('Veuillez remplir les informations obligatoires (Titre, Acheteur, Date Limite).', 'warning');
                setLoading(false);
                return;
            }

            // VALIDATION: Check collaborators
            const incompleteCollabs = groupementMembers.filter(c => !c.name || !c.email || !c.role);
            if (incompleteCollabs.length > 0) {
                showToast(`Veuillez compléter les informations pour : ${incompleteCollabs.map(c => c.name || 'Collaborateur').join(', ')}`, 'warning');
                setLoading(false);
                return;
            }

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Save collaborators one last time to ensure everything is up to date
            await saveCollaboratorsAndInvite();
            setLoading(true);
            if (!tenderId) throw new Error("Aucun dossier en cours — impossible de finaliser");

            // Calculate required documents based on collaborator roles
            const getRequiredDocuments = () => {
                const allDocs: string[] = [];
                // Add mandataire documents
                REQUIRED_DOCS_BY_ROLE["Mandataire"]?.forEach(doc => {
                    if (!allDocs.includes(doc.value)) allDocs.push(doc.value);
                });
                // Add collaborator documents based on their roles
                groupementMembers.forEach(collab => {
                    const role = collab.role as keyof typeof REQUIRED_DOCS_BY_ROLE;
                    if (REQUIRED_DOCS_BY_ROLE[role]) {
                        REQUIRED_DOCS_BY_ROLE[role].forEach(doc => {
                            if (!allDocs.includes(doc.value)) allDocs.push(doc.value);
                        });
                    }
                });
                return allDocs;
            };

            // Update Tender status
            const { error } = await supabase.from('reponses_ao')
                .update({
                    statut: STATUSES.submitted,
                    nb_collaborateurs: groupementMembers.filter(m => !m.deleted).length,
                    nombre_pj_attendues: getRequiredDocuments().length
                })
                .eq('id', tenderId);

            if (error) throw error;

            // Send Invitations for pending members
            const inviterName = userProfile ? `${userProfile.prenom} ${userProfile.nom}` : "Un administrateur";
            for (const member of groupementMembers) {
                if (member.status === GROUPEMENT_STATUSES.invite && member.id && member.id !== userProfile?.id) { // Only send if pending, user ID is known, and not self
                    await notifyCollaboratorInvited(
                        member.id,
                        inviterName,
                        userProfile?.photo_url || '',
                        tenderId,
                        formData.titre
                    );
                }
                // For members without an account (no member.id), a separate email sending mechanism would be needed.
            }

            // --- GOOGLE CALENDAR SYNC ---
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const { data: integrations } = await supabase
                    .from('user_integrations')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('provider', 'google')
                    .single();

                if (integrations && session) {
                    // Call the Edge Function to push the tender
                    await supabase.functions.invoke('sync-google-calendar', {
                        body: {
                            action: 'push_tender',
                            tender: {
                                id: tenderId,
                                titre: formData.titre,
                                description: formData.description,
                                organisme_acheteur: formData.organisme_acheteur,
                                date_limite: formData.date_limite
                            }
                        }
                    });
                    console.log("Successfully pushed tender to Google Calendar");
                }
            } catch (syncError) {
                console.error("Failed to sync tender to Google Calendar:", syncError);
            }

            setFormData(prev => ({ ...prev, statut: STATUSES.submitted }));
            showToast('Dossier finalisé avec succès !', 'success');
            if (onTenderUpdate) onTenderUpdate();
        } catch (error) {
            console.error("Error finalizing:", error);
            showToast('Erreur lors de la finalisation.', 'error');
        } finally {
            setLoading(false);
        }
    };




    // --- TEAM MANAGEMENT ---
    // --- LOGIC: VALIDATE AND GO TO TEAM ---
    const validateAndGoToTeam = () => {
        const requiredFields = [
            { key: 'titre', label: "Nom de l'appel d'offres" },
            { key: 'organisme_acheteur', label: "Nom de l'organisme acheteur" },
            { key: 'lieu_execution', label: "Lieu d'exécution", isArray: true },
            { key: 'type_marche', label: "Type de marché", isArray: true },
            { key: 'secteur_activite', label: "Secteur d'activité" },
            { key: 'mode_passation', label: "Mode de passation" },
            { key: 'date_publication', label: "Date de publication" },
            { key: 'date_limite', label: "Date limite de réponse" },
            { key: 'date_depot_souhaitee', label: "Date de dépot souhaitée" }
        ];

        const missing = requiredFields.filter(field => {
            const val = (formData as any)[field.key];
            if (field.isArray) {
                return !val || val.length === 0 || (val.length === 1 && !val[0]);
            }
            return !val;
        });

        if (missing.length > 0) {
            showToast(`Veuillez remplir les champs obligatoires suivants : ${missing.map(m => m.label).join(', ')}`, 'warning');
            return;
        }

        // Auto-navigate to team view
        setCurrentView('team');
    };

    const addCollaborator = (manualData?: any, newMembers?: UIGroupementMember[]) => {
        if (manualData && manualData.name) {
            const newCollab: UIGroupementMember = {
                id: `collab-${Date.now()}`, // Temporary ID for UI
                name: manualData.name,
                role: manualData.role || 'Co-traitant',
                email: manualData.email,
                photo_url: null,
                skills: manualData.skills || [],
                specialty_ids: manualData.specialty_ids || [],
                status: GROUPEMENT_STATUSES.invite, // En attente
                hasAccount: false, // Will be resolved later
                company: manualData.company || 'Société externe',
                // Seul secret protégeant l'espace invité depuis la fermeture
                // de la RLS (migration 034) : tirage cryptographique.
                access_code: genererCodeAcces(),
                entreprise_id: null // Will be resolved later
            };

            const next = [...groupementMembers, newCollab];
            setGroupementMembers(next);
            setShowAddManualModal(false);

            // Handle Leadership Transition if added as Mandataire
            if (manualData.role === 'Mandataire') {
                const existingMandataire = groupementMembers.find(m => m.role === 'Mandataire' && !m.deleted);
                if (existingMandataire) {
                    const newIdx = next.length - 1;
                    setShowPromotionPicker({ targetMemberIdx: newIdx });
                    return; // Promotion picker will handle the save
                }
            }

            if (tenderId) {
                saveCollaboratorsAndInvite(next);
            }
        } else if (newMembers && newMembers.length > 0) {
            const next = [...groupementMembers, ...newMembers];
            setGroupementMembers(next);
            if (tenderId) {
                saveCollaboratorsAndInvite(next);
            }
            setShowCollabPicker(false);
        } else {
            // Fallback for direct add (deprecated but safe)
            const newCollab: UIGroupementMember = {
                id: `collab-${Date.now()}`,
                name: 'Nouveau Partenaire',
                role: 'Co-traitant',
                email: '',
                skills: [],
                company: 'Société externe',
                hasAccount: false,
                status: GROUPEMENT_STATUSES.invite,
                entreprise_id: null
            };
            const next = [...groupementMembers, newCollab];
            setGroupementMembers(next);
            if (tenderId) {
                saveCollaboratorsAndInvite(next);
            }
        }
    };

    const removeCollaborator = async (index: number) => {
        const member = groupementMembers[index];
        if (!member || member.is_owner) return;

        // 1. Optimisticaly update locally
        const updated = groupementMembers.map((c, i) => i === index ? { ...c, deleted: true } : c);
        setGroupementMembers(updated);

        // 2. Persist to DB using manage-team edge function
        if (isOwner) {
            try {
                await saveCollaboratorsAndInvite(updated);
                showToast('Membre retiré du groupement.', 'success');
                if (onTenderUpdate) onTenderUpdate();
            } catch (err) {
                console.error('Error removing collaborator:', err);
                // Revert locally on failure
                setGroupementMembers(prev => prev.map((c, i) => i === index ? { ...c, deleted: false } : c));
                showToast('Erreur lors du retrait du membre.', 'error');
            }
        } else {
            // New unsaved member? Remove physically
            if (!member.groupement_id && !member.id) {
                setGroupementMembers(prev => prev.filter((_, i) => i !== index));
            }
        }
    };

    const updateCollaborator = (index: number, field: string, value: any) => {
        setGroupementMembers(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
    };

    const addSkill = (index: number, skill: string) => {
        if (!skill.trim()) return;
        const currentSkills = groupementMembers[index].skills || [];
        if (!currentSkills.includes(skill)) {
            updateCollaborator(index, 'skills', [...currentSkills, skill]);
        }
    };

    const removeSkill = (index: number, skillToDelete: string) => {
        const currentSkills = groupementMembers[index].skills || [];
        updateCollaborator(index, 'skills', currentSkills.filter(s => s !== skillToDelete));
    };

    // getRequiredDocuments moved to handleFinalize

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, docType: string, member: UIGroupementMember) => {
        if (isLocked) {
            showToast("Le dossier est déjà finalisé. Les modifications ne sont plus possibles.", 'warning');
            return;
        }
        const file = event.target.files?.[0];
        if (!file || !tenderId) return;

        const collabId = member.id || member.email;
        if (!collabId) return;

        try {
            const key = `${docType}-${collabId}`;
            setUploadProgress(prev => ({ ...prev, [key]: 0 }));

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('No user');

            const fileName = nomPieceCollaborateur({ docType, collabId, tenderId: tenderId as string });
            const folderPath = user.email; // We store in owner's folder or member's? 
            // Standard: each user stores in their own folder, but owner can read if they share the path
            // For now, let's stick to the current logic: the user who uploads stores in THEIR folder.
            const fullPath = `${folderPath}/${fileName}`;

            // Check Quota Logic
            const { data: existingFiles } = await supabase.storage.from('documents').list(folderPath, { search: fileName });
            const oldFileSize = existingFiles?.find(f => f.name === fileName)?.metadata?.size || 0;
            const delta = file.size - oldFileSize;

            let currentPlanKey = (userProfile?.plan as PlanType) || PLANS_TYPES.free;
            if (!PLANS_CONFIG[currentPlanKey]) currentPlanKey = PLANS_TYPES.free;
            const planConfig = PLANS_CONFIG[currentPlanKey];
            const currentUsage = userProfile?.storage_used || 0;

            if (delta > 0 && (currentUsage + delta > planConfig.limits.storage)) {
                setShowStorageLimitModal(true);
                setUploadProgress(prev => { const n = { ...prev }; delete n[key]; return n; });
                return;
            }

            // Upload — validé côté serveur (type réel, taille, destination).
            const { erreur: erreurDepot } = await deposerFichier(file, {
                dossier: folderPath as string,
                point: 'candidature',
                upsert: true,
            });
            if (erreurDepot) throw new Error(erreurDepot);

            // Increment Usage
            if (delta !== 0) {
                await supabase.rpc('increment_storage_usage', { user_id: user.id, bytes_added: delta });
                setUserProfile((prev: any) => ({ ...prev, storage_used: (prev?.storage_used || 0) + delta }));
            }

            const isNewFile = oldFileSize === 0;
            setUploadedFiles(prev => ({ ...prev, [key]: file }));
            setUploadProgress(prev => ({ ...prev, [key]: 100 }));

            if (isNewFile) {
                const { error: countError } = await supabase.rpc('update_tender_file_count', {
                    tender_id: tenderId,
                    increment_by: 1
                });
                if (countError) console.error("Error updating file count:", countError);
            }

            showToast(`Document "${docType}" mis à jour.`, 'success');
        } catch (error) {
            console.error('Error uploading file:', error);
            showToast(`Erreur lors de l'upload.`, 'error');
        }
    };

    /**
     * Fermeture des modales par la touche Échap.
     *
     * Aucune ne le permettait : seule la croix fonctionnait. C'est le
     * comportement attendu de toute boîte de dialogue, et le premier réflexe
     * d'un utilisateur au clavier.
     *
     * L'écouteur est posé une seule fois et ferme la modale ouverte la plus
     * « intérieure » : sans cet ordre, fermer la modale d'édition d'un jalon
     * fermerait aussi la vue qui la contient.
     */
    useEffect(() => {
        const surEchap = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (showCompanyDocPicker) { setShowCompanyDocPicker(false); return; }
            if (showCriteresModal) { setShowCriteresModal(false); return; }
            if (showContextEditModal) { setShowContextEditModal(false); return; }
            if (showDocDetails) { setShowDocDetails(false); return; }
            if (showSkillsModal) { setShowSkillsModal(false); return; }
        };
        document.addEventListener('keydown', surEchap);
        return () => document.removeEventListener('keydown', surEchap);
    }, [showCompanyDocPicker, showCriteresModal, showContextEditModal, showDocDetails, showSkillsModal]);

    // --- MODAL: DOCUMENT DETAILS ---
    const renderDocDetailsModal = () => {
        if (!showDocDetails || !isOwner) return null;

        const activeMembers = groupementMembers.filter(m => !m.deleted);

        return (
            <div
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[#0B1F38]/60 backdrop-blur-sm animate-in fade-in duration-200"
                // Clic sur le fond uniquement : `currentTarget` écarte les clics
                // propagés depuis l'intérieur de la modale, qui la fermeraient
                // en plein remplissage de formulaire.
                onClick={(e) => { if (e.target === e.currentTarget) setShowDocDetails(false); }}
                role="dialog"
                aria-modal="true"
                aria-label="Coordination documentaire"
            >
                <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                    {/* Header */}
                    <div className="p-6 border-b border-[#0B1F38]/10 flex justify-between items-center bg-gray-50/50 shrink-0">
                        <div>
                            <h3 className="text-xl font-bold text-[#0B1F38]">Coordination Documentaire</h3>
                            <p className="text-sm text-[#0B1F38]/60">Suivi global des pièces du groupement</p>
                        </div>
                        <button onClick={() => setShowDocDetails(false)} className="p-2 hover:bg-[#0B1F38]/5 rounded-full text-[#0B1F38]/40 hover:text-[#0B1F38] transition-colors">
                            <X size={24} />
                        </button>
                    </div>

                    {/* Progress Global */}
                    <div className="px-6 pt-5 pb-3 shrink-0">
                        <div className="bg-[#0B1F38]/5 p-4 rounded-xl border border-[#0B1F38]/10">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-bold text-[#0B1F38]">Progression globale du groupement</span>
                                <span className="text-sm font-bold text-[#00A3E0]">{docProgress.percent}%</span>
                            </div>
                            <div className="w-full h-2.5 bg-[#0B1F38]/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-[#00A3E0] to-[#26367F] transition-all duration-700 ease-out shadow-[0_0_10px_rgba(38,54,127,0.3)]"
                                    style={{ width: `${docProgress.percent}%` }}
                                />
                            </div>
                            <div className="flex justify-between items-center mt-2">
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-widest">{docProgress.uploaded} / {docProgress.total} documents validés</span>
                            </div>
                        </div>
                    </div>

                    {/* Member Accordions */}
                    <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3 custom-scrollbar-dark mt-2">
                        {activeMembers.map((member, mIdx) => {
                            const role = member.role || 'Co-traitant';
                            const reqDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
                            const collabId = member.id || mIdx.toString();

                            const memberUploaded = reqDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length;
                            const memberPercent = reqDocs.length > 0 ? Math.round((memberUploaded / reqDocs.length) * 100) : 0;
                            const isAllDone = memberPercent === 100 && reqDocs.length > 0;

                            return (
                                <details key={mIdx} className="group border border-[#0B1F38]/10 rounded-2xl overflow-hidden bg-white hover:border-[#00A3E0]/30 transition-all shadow-sm">
                                    <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50/80 list-none font-bold text-[#0B1F38] select-none">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold transition-all shadow-md overflow-hidden ${isAllDone ? 'bg-green-500' : 'bg-gradient-to-br from-[#0B1F38] to-[#1B2533]'}`}>
                                                    {isAllDone ? (
                                                        <CheckCircle size={20} />
                                                    ) : member.photo_url ? (
                                                        <img src={member.photo_url} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        (member.name || member.email || 'M').charAt(0).toUpperCase()
                                                    )}
                                                </div>
                                                {memberPercent > 0 && !isAllDone && (
                                                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center border-2 border-[#F4F6F9] shadow-sm">
                                                        <div className="text-[8px] font-black text-[#00A3E0] leading-none">{memberPercent}%</div>
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-black tracking-tight">{member.name || member.email}</span>
                                                    {member.role === 'Mandataire' && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[8px] font-black rounded uppercase">Mandataire</span>}
                                                </div>
                                                <p className="text-[10px] text-[#0B1F38]/40 font-medium">{role}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right hidden sm:block">
                                                <p className={`text-xs font-black ${isAllDone ? 'text-green-500' : 'text-[#0B1F38]/70'}`}>{memberUploaded}/{reqDocs.length}</p>
                                            </div>
                                            <ChevronDown size={18} className="text-[#0B1F38]/20 transition-transform duration-300 group-open:rotate-180" />
                                        </div>
                                    </summary>

                                    <div className="px-4 pb-4 bg-gray-50/50 space-y-2 border-t border-[#0B1F38]/5 pt-4 animate-in slide-in-from-top-2 duration-300">
                                        {reqDocs.map((doc, dIdx) => {
                                            const fileKey = `${doc.value}-${collabId}`;
                                            const fileObj = uploadedFiles[fileKey];
                                            const isSelf = member.id === userProfile.id;

                                            return (
                                                <div key={dIdx} className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#0B1F38]/5 group/item transition-all hover:shadow-sm">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-1.5 rounded-lg ${fileObj ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-500'}`}>
                                                            {fileObj ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                                                        </div>
                                                        <span className="text-xs font-bold text-[#0B1F38]/70">{doc.label}</span>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {fileObj && member.email && (
                                                            <button
                                                                onClick={() => handleDownloadFile(`${member.email?.toLowerCase().trim()}/${fileObj.name}`, `${doc.label}.${fileObj.name.split('.').pop()}`)}
                                                                className="p-1.5 text-[#00A3E0] hover:bg-[#00A3E0] hover:text-white rounded-lg transition-all shadow-sm bg-white border border-[#00A3E0]/10"
                                                                title="Voir/Télécharger"
                                                            >
                                                                <Download size={14} />
                                                            </button>
                                                        )}
                                                        {isSelf && (
                                                            <label className="cursor-pointer">
                                                                <div className={`px-3 py-1 bg-[#0B1F38] text-white text-[10px] font-black rounded-lg hover:bg-[#00A3E0] transition-all`}>
                                                                    {fileObj ? "Update" : "Import"}
                                                                </div>
                                                                <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, doc.value, member)} />
                                                            </label>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {reqDocs.length === 0 && <p className="text-xs text-center text-gray-400 py-4 italic">Aucune pièce requise pour ce membre.</p>}

                                        {!isAllDone && (
                                            <button
                                                onClick={() => handleRelancer(member)}
                                                className="w-full mt-2 py-2 text-[10px] font-black text-[#0B1F38]/40 hover:text-[#0B1F38] border-2 border-dashed border-[#0B1F38]/10 rounded-xl hover:bg-white hover:border-[#0B1F38]/20 transition-all flex items-center justify-center gap-2"
                                            >
                                                <Mail size={12} /> ENVOYER UN RAPPEL
                                            </button>
                                        )}
                                    </div>
                                </details>
                            );
                        })}
                    </div>

                    {/* Footer - Global Actions */}
                    <div className="p-6 border-t border-[#0B1F38]/10 bg-gray-50/80 shrink-0">
                        <button
                            onClick={() => handleDownloadAllFiles()}
                            disabled={loading || docProgress.uploaded === 0}
                            className="w-full py-4 bg-[#0B1F38] hover:bg-[#1B2533] text-white font-black rounded-2xl shadow-xl shadow-[#0B1F38]/20 flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale"
                        >
                            {loading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                            <div className="text-left">
                                <p className="text-sm font-black leading-none">TÉLÉCHARGER LE DOSSIER COMPLET</p>
                                <p className="text-[10px] text-white/50 mt-1 uppercase tracking-widest">{docProgress.uploaded} fichiers archivés (.zip)</p>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ==========================================
    //              RENDER VIEWS
    const handleDumeConnect = async () => {
        setLoading(true);
        // Simulate API call
        await new Promise(r => setTimeout(r, 1500));
        setDumeConnected(true);
        setLoading(false);
        showToast('Connexion Service DUME réussie ! Les attestations disponibles ont été récupérées.', 'success');

        // Auto-fill some docs mock
        setUploadProgress(prev => ({
            ...prev,
            'dc1': 100,
            'dc2': 100,
            'attestation_assurance': 100
        }));
    };

    const renderCompanyDocPicker = () => {
        if (!showCompanyDocPicker) return null;

        return (
            /* z-[130] : ce sélecteur s'ouvre DEPUIS la modale « détail membre »
               (z-[100]) et depuis la coordination documentaire (z-[60]). En
               z-[70] il passait derrière la première, donc invisible au moment
               précis où on venait de le demander. Il doit dominer toute modale
               susceptible de l'ouvrir. */
            <div
                className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-[#0B1F38]/60 backdrop-blur-md animate-in fade-in duration-200"
                onClick={(e) => { if (e.target === e.currentTarget) setShowCompanyDocPicker(false); }}
                role="dialog"
                aria-modal="true"
                aria-label="Documents de l'entreprise"
            >
                <div className="bg-white rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                    <div className="p-6 border-b border-[#0B1F38]/10 flex justify-between items-center shrink-0">
                        <div>
                            <h3 className="text-xl font-bold text-[#0B1F38]">Documents de l'entreprise</h3>
                            <p className="text-sm text-[#0B1F38]/60">Sélectionnez un document à importer</p>
                        </div>
                        <button onClick={() => { setShowCompanyDocPicker(false); setCompanyDocSearch(''); }} className="p-2 hover:bg-[#0B1F38]/5 rounded-full text-[#0B1F38]/40 hover:text-[#0B1F38]">
                            <X size={24} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar-dark space-y-6">
                        {/* Standard Legal Docs */}
                        <section>
                            <h4 className="text-xs font-bold text-[#0B1F38]/40 uppercase tracking-widest mb-3">Documents légaux obligatoires</h4>
                            <div className="space-y-2">
                                {companyDocs ? Object.entries(companyDocs).map(([label, url]) => (
                                    <button
                                        key={label}
                                        disabled={!url || isCopyingDoc}
                                        onClick={() => url && handleSelectCompanyDoc(url as string, label)}
                                        className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${url ? 'hover:bg-gray-50 border-gray-100' : 'opacity-40 cursor-not-allowed border-dashed bg-gray-50/50'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-[#00A3E0]/5 text-[#00A3E0] rounded-lg">
                                                <ShieldAlert size={18} />
                                            </div>
                                            <span className="text-sm font-bold text-[#0B1F38]">{label}</span>
                                        </div>
                                        {isCopyingDoc && targetDocType === label ? (
                                            <Loader2 size={16} className="animate-spin text-[#00A3E0]" />
                                        ) : url ? (
                                            <ArrowRight size={16} className="text-[#0B1F38]/20" />
                                        ) : (
                                            <span className="text-[10px] font-bold text-[#0B1F38]/30 italic uppercase">Non renseigné</span>
                                        )}
                                    </button>
                                )) : (
                                    <div className="flex justify-center p-4"><Loader2 size={24} className="animate-spin text-[#00A3E0]/40" /></div>
                                )}
                            </div>
                        </section>

                        {/* Custom Docs */}
                        <section>
                            <h4 className="text-xs font-bold text-[#0B1F38]/40 uppercase tracking-widest mb-3">Autres documents</h4>
                            {companyCustomDocs.length > 0 && (
                                <div className="relative mb-3">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/30 pointer-events-none" />
                                    <input
                                        type="text"
                                        placeholder="Rechercher..."
                                        value={companyDocSearch}
                                        onChange={(e) => setCompanyDocSearch(e.target.value)}
                                        className="w-full pl-8 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#00A3E0] focus:border-[#00A3E0] transition-colors"
                                    />
                                </div>
                            )}
                            <div className="space-y-2">
                                {companyCustomDocs.length > 0 ? (
                                    companyCustomDocs
                                        .filter(doc => !companyDocSearch || doc.label?.toLowerCase().includes(companyDocSearch.toLowerCase()) || doc.categorie?.toLowerCase().includes(companyDocSearch.toLowerCase()))
                                        .map((doc) => (
                                            <button
                                                key={doc.id}
                                                disabled={isCopyingDoc}
                                                onClick={() => handleSelectCompanyDoc(doc.url, doc.label)}
                                                className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-all text-left"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="p-2 bg-gray-100 text-[#0B1F38]/40 rounded-lg">
                                                        <FileText size={18} />
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-[#0B1F38] block leading-tight">{doc.label}</span>
                                                        <span className="text-[10px] text-[#0B1F38]/40 italic">{doc.categorie || 'Autres'}</span>
                                                    </div>
                                                </div>
                                                <ArrowRight size={16} className="text-[#0B1F38]/20" />
                                            </button>
                                        ))
                                ) : companyDocs && (
                                    <p className="text-center text-[#0B1F38]/30 text-xs italic py-4">Aucun document personnalisé trouvé.</p>
                                )}
                            </div>
                        </section>
                    </div>

                    <div className="p-4 border-t border-[#0B1F38]/10 bg-gray-50/50 shrink-0">
                        <button onClick={() => { setShowCompanyDocPicker(false); setCompanyDocSearch(''); }} className="w-full py-3 bg-[#0B1F38] text-white font-bold text-sm rounded-xl hover:bg-[#0B1F38]/90 transition-all">
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    const addComp = (s: { id: string, label: string }) => {
        if (!formData.required_specialty_ids.includes(s.id)) {
            setFormData(prev => ({
                ...prev,
                required_specialty_ids: [...prev.required_specialty_ids, s.id],
                required_skills: [...prev.required_skills, s.label]
            }));
        }
    };

    const removeComp = (sid: string) => {
        const spec = refSpecialties.find(x => x.id === sid);
        const label = spec?.label;

        setFormData(prev => ({
            ...prev,
            required_specialty_ids: prev.required_specialty_ids.filter(id => id !== sid),
            required_skills: prev.required_skills.filter(s => s !== label)
        }));
    };

    const handleManualSubmit = async () => {
        // Garde alignée sur les colonnes NOT NULL de reponses_ao — la version
        // précédente omettait lieu_execution, également NOT NULL.
        const manquants = champsManquants(formData);
        if (manquants.length > 0) {
            showToast(`Champs obligatoires à renseigner : ${manquants.join(', ')}.`, "warning");
            return;
        }

        if (groupementMembers.length === 0 && userProfile) {
            setGroupementMembers([{
                id: userProfile.id,
                name: `${userProfile.prenom || ''} ${userProfile.nom || ''}`.trim() || 'Moi',
                email: userProfile.email || '',
                role: 'Mandataire',
                company: userProfile.entreprise || "Mon Entreprise",
                skills: [],
                hasAccount: true,
                photo_url: userProfile.photo_url,
                status: GROUPEMENT_STATUSES.accepte,
                entreprise_id: userProfile.entreprise_id,
                is_owner: true
            }]);
        }

        setPreviousView('manual');
        setCurrentView('wizard_steps');
    };

    const renderManualView = () => (
        <div className="w-full h-full flex flex-col animate-in slide-in-from-right-4 duration-500 overflow-hidden">

            {/* HEADER - fixed, won't scroll */}
            <div className="flex items-center gap-4 px-8 py-4 border-b border-white/30 bg-white/40 backdrop-blur-sm shrink-0">
                <button onClick={() => setCurrentView('start')} className="p-2 bg-white/50 hover:bg-white rounded-xl transition-all text-[#0B1F38]/60 hover:text-[#00A3E0]">
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
                    <div className="bg-[#0B1F38]/5 rounded-xl p-3 flex items-center gap-3 mb-6">
                        <span className="text-xs font-bold text-[#0B1F38]/60 uppercase shrink-0">Recherche acheteur</span>
                        <div className="flex gap-2 flex-1">
                            <input value={siretQuery} onChange={e => setSiretQuery(e.target.value)} type="text" placeholder="SIRET, SIREN ou nom..." className={`${inputGlassPlain} w-full`} />
                            <button onClick={handleSiretSearch} disabled={siretLoading} className="px-4 py-2 bg-[#0B1F38] text-white rounded-xl hover:bg-[#00A3E0] font-bold shadow-sm transition-all shrink-0">
                                {siretLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                            </button>
                        </div>
                        {siretError && <p className="text-xs text-red-500 font-bold shrink-0">{siretError}</p>}
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
                <button onClick={() => setCurrentView('start')} className="px-6 py-2.5 font-bold text-[#0B1F38]/60 hover:text-[#0B1F38] bg-white border border-[#0B1F38]/10 hover:border-[#0B1F38]/20 transition-colors rounded-xl flex items-center gap-2">
                    <XCircle size={18} /> Annuler
                </button>
                <button onClick={handleManualSubmit} disabled={loading} className="px-8 py-2.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold rounded-xl shadow-lg transition-transform hover:scale-[1.02] active:scale-95 flex items-center gap-2">
                    {loading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={18} />} Convertir en dossier
                </button>
            </div>
        </div>
    );

    const renderDecisionView = () => {
        const activeMembers = groupementMembers.filter(m => !m.deleted);
        const allCoveredSpecialtyIds = Array.from(new Set(activeMembers.flatMap(m => m.specialty_ids || [])));
        const missingSpecialtyIds = formData.required_specialty_ids.filter(sid => !allCoveredSpecialtyIds.includes(sid));

        // Map missing IDs to labels
        const missingSpecialties = missingSpecialtyIds.map(sid => {
            const ref = refSpecialties.find(r => r.id === sid);
            return { id: sid, label: ref ? ref.label : "Profil expert" };
        });

        const successScore = (() => {
            const reqCount = formData.required_specialty_ids.length;
            if (reqCount === 0) return 85;
            const coveredCount = formData.required_specialty_ids.filter(sid => allCoveredSpecialtyIds.includes(sid)).length;
            return Math.round(40 + (coveredCount / reqCount) * 55);
        })();

        // Logic for potential gain per specialty
        const getPotentialGain = () => {
            const reqCount = formData.required_specialty_ids.length;
            if (reqCount <= 1) return 0; // If only one skill and it's missing, gain is already part of the delta to 85? 
            // Better: calculate how much one more covered skill adds
            return Math.round(55 / reqCount);
        };
        const potentialGain = getPotentialGain();

        // --- DYNAMIC INDICATORS ---
        const daysLeft = formData.date_limite
            ? Math.ceil((new Date(formData.date_limite).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            : null;

        // Detect if current user is a pending invitee
        const myGroupementEntry = groupementMembers.find(
            m => (m.id && m.id === userProfile?.id) || (m.email && m.email === userProfile?.email)
        );
        const isRefused = myGroupementEntry?.status === GROUPEMENT_STATUSES.refuse;
        const amIInvitee = !!tenderId && !!myGroupementEntry && !myGroupementEntry.is_owner
            && (myGroupementEntry.status === GROUPEMENT_STATUSES.invite || isRefused);

        // --- PROGRESS: global + per member ---
        const getMemberProgress = (member: UIGroupementMember, idx: number) => {
            const role = member.role || 'Co-traitant';
            const requiredDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
            const total = requiredDocs.length;
            const collabId = member.id || idx.toString();
            const received = requiredDocs.filter(docDef => !!uploadedFiles[`${docDef.value}-${collabId}`]).length;
            return { received, total, percent: total > 0 ? Math.round((received / total) * 100) : 0 };
        };

        // Global progress
        const globalProgress = (() => {
            let totalDocs = 0;
            let receivedDocs = 0;
            activeMembers.forEach((m, i) => {
                const p = getMemberProgress(m, i);
                totalDocs += p.total;
                receivedDocs += p.received;
            });
            return { received: receivedDocs, total: totalDocs, percent: totalDocs > 0 ? Math.round((receivedDocs / totalDocs) * 100) : 0 };
        })();

        // Count overdue pieces (placeholder: pieces with 0% on members who were invited > 3 days ago)
        const overduePieces = activeMembers.reduce((acc, m, i) => {
            const p = getMemberProgress(m, i);
            return acc + (p.total - p.received);
        }, 0);

        // Retroplanning milestones (derived from jalons or fallback to dates)
        const milestones = formData.jalons && formData.jalons.length > 0
            ? formData.jalons.map((j: any) => ({
                label: j.label,
                date: j.date,
                status: new Date(j.date) < new Date() ? 'done' :
                    Math.ceil((new Date(j.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) <= 3 ? 'danger' :
                        Math.ceil((new Date(j.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) <= 7 ? 'warning' : 'upcoming'
            }))
            : [
                formData.date_publication ? { label: 'Retrait DCE', date: formData.date_publication, status: new Date(formData.date_publication) < new Date() ? 'done' : 'upcoming' } : null,
                formData.date_depot_souhaitee ? { label: 'Dépôt souhaité', date: formData.date_depot_souhaitee, status: new Date(formData.date_depot_souhaitee) < new Date() ? 'done' : daysLeft !== null && daysLeft <= 7 ? 'warning' : 'upcoming' } : null,
                formData.date_limite ? { label: 'Date limite', date: formData.date_limite, status: daysLeft !== null && daysLeft < 0 ? 'done' : daysLeft !== null && daysLeft <= 3 ? 'danger' : 'upcoming' } : null,
            ].filter(Boolean) as { label: string; date: string; status: string }[];

        // Next milestone
        const nextMilestone = milestones.find(m => m.status !== 'done') || milestones[milestones.length - 1];

        // Deadline color
        const deadlineColor = daysLeft === null ? 'text-[#0B1F38]/50 bg-[#0B1F38]/5 border-[#0B1F38]/10'
            : daysLeft < 0 ? 'text-gray-400 bg-gray-50 border-gray-200'
                : daysLeft <= 5 ? 'text-red-600 bg-red-50 border-red-200'
                    : daysLeft <= 14 ? 'text-amber-600 bg-amber-50 border-amber-200'
                        : 'text-[#00A3E0] bg-[#00A3E0]/5 border-[#00A3E0]/20';

        // Effective status label for badge
        const statusLabel = formData.statut === STATUSES.on ? 'En préparation'
            : formData.statut === STATUSES.submitted ? 'Déposé'
                : formData.statut === STATUSES.won ? 'Gagné'
                    : formData.statut === STATUSES.lost ? 'Perdu'
                        : formData.statut === STATUSES.draft ? 'Brouillon'
                            : 'En cours';

        const statusColor = formData.statut === STATUSES.won ? 'bg-green-100 text-green-700 border-green-200'
            : formData.statut === STATUSES.lost ? 'bg-red-50 text-red-600 border-red-100'
                : formData.statut === STATUSES.submitted ? 'bg-blue-100 text-blue-700 border-blue-200'
                    : formData.statut === STATUSES.draft ? 'bg-gray-100 text-gray-600 border-gray-200'
                        : 'bg-[#00A3E0]/10 text-[#00A3E0] border-[#00A3E0]/20';

        // SVG Gauge helper
        const gaugeRadius = 40;
        const gaugeCircumference = 2 * Math.PI * gaugeRadius;
        const gaugeOffset = gaugeCircumference - (successScore / 100) * gaugeCircumference;
        const gaugeColor = successScore >= 70 ? '#10B981' : successScore >= 40 ? '#F59E0B' : '#EF4444';

        // Budget formatting
        const formatBudget = (val: number) => {
            if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M€`;
            if (val >= 1000) return `${Math.round(val / 1000)}k€`;
            return `${val}€`;
        };

        /**
         * Carte « Critères d'attribution ».
         *
         * Le BOAMP publie quatre formes distinctes et deux seulement sont
         * chiffrées, d'où les quatre rendus ci-dessous. Le cas le plus fréquent
         * n'est pas le plus riche : beaucoup d'acheteurs renvoient au règlement
         * de consultation sans rien publier de structuré.
         */
        const renderCriteresCard = () => {
            const crit = formData.criteres_attribution;
            const editable = isOwner && !isLocked;

            const Wrapper = ({ children }: { children: React.ReactNode }) => (
                <div
                    className={`bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all ${editable ? 'cursor-pointer' : ''}`}
                    onClick={editable ? openCriteresModal : undefined}
                >
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider">Critères d'attribution</p>
                        {editable && <PenTool size={10} className="text-[#0B1F38]/25" />}
                    </div>
                    {children}
                </div>
            );

            // Aucune donnée, ou renvoi au règlement de consultation.
            if (!crit || crit.kind === 'absent' || crit.kind === 'cctp') {
                return (
                    <Wrapper>
                        <p className="text-[11px] text-[#0B1F38]/50 leading-snug">
                            {crit?.kind === 'cctp'
                                ? "L'acheteur renvoie au règlement de consultation."
                                : 'Non communiqués dans l\'avis.'}
                        </p>
                        {editable && (
                            <p className="text-[9px] text-[#00A3E0] font-bold mt-1.5">Saisir les critères →</p>
                        )}
                    </Wrapper>
                );
            }

            // Texte libre : on affiche tel quel, tronqué.
            if (crit.kind === 'libre') {
                return (
                    <Wrapper>
                        <p className="text-[11px] text-[#0B1F38]/70 leading-snug line-clamp-4">{crit.texte}</p>
                    </Wrapper>
                );
            }

            // Critères classés sans pondération.
            if (crit.kind === 'priorites') {
                return (
                    <Wrapper>
                        <div className="space-y-1">
                            {crit.criteres.map((c, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                    <span className="text-[10px] font-bold text-[#00A3E0] shrink-0 mt-px">{c.ordre}.</span>
                                    <span className="text-[11px] text-[#0B1F38] leading-snug line-clamp-2">{c.libelle}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-[#0B1F38]/40 mt-1.5 italic">Classés par ordre d'importance, sans pondération publiée.</p>
                    </Wrapper>
                );
            }

            // Critères pondérés. ⚠️ Les poids ne somment pas toujours à 100 :
            // on normalise pour la barre, et on signale la conversion.
            const parts = normaliserPoids(crit.criteres);
            const palette = ['#00A3E0', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#0B1F38'];

            return (
                <Wrapper>
                    <div className="space-y-1.5">
                        {parts.map((p, i) => (
                            <div key={i} className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                                    <span className="text-[11px] font-medium text-[#0B1F38] truncate" title={p.libelle}>{p.libelle}</span>
                                </div>
                                <span className="text-xs font-bold text-[#0B1F38] shrink-0">{p.pourcentage}%</span>
                            </div>
                        ))}
                    </div>
                    {parts.length > 0 && (
                        <div className="flex rounded-full h-2 overflow-hidden mt-2">
                            {parts.map((p, i) => (
                                <div key={i} className="h-full" style={{ width: `${p.pourcentage}%`, background: palette[i % palette.length] }} />
                            ))}
                        </div>
                    )}
                    {!crit.poidsSontDesPourcentages && (
                        <p className="text-[9px] text-[#0B1F38]/40 mt-1.5 italic">
                            Coefficients publiés par l'acheteur, convertis en pourcentages.
                        </p>
                    )}
                </Wrapper>
            );
        };

        return (
            <div className="w-full h-full flex flex-col animate-in slide-in-from-right-4 duration-500 overflow-hidden">

                {/* Invitation Banner — shown only for pending invitees (not refused) */}
                {amIInvitee && !isRefused && (
                    <div className="mx-4 mt-4 p-5 bg-gradient-to-r from-[#0B1F38] to-[#1B5D7A] text-white rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 shrink-0 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-white/10 rounded-xl shrink-0"><Mail size={22} className="text-white" /></div>
                            <div>
                                <h3 className="font-bold text-base">Invitation à collaborer</h3>
                                <p className="text-white/75 text-sm">
                                    Vous avez été invité à travailler sur <strong>"{formData.titre}"</strong> en tant que <strong>{myGroupementEntry.role}</strong>.
                                    Acceptez pour accéder à l'ensemble du dossier.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3 shrink-0">
                            <button onClick={() => handleInvitationResponse(false)} disabled={loading} className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-bold text-sm transition-colors">Refuser</button>
                            <button onClick={() => handleInvitationResponse(true)} disabled={loading} className="px-5 py-2.5 bg-white text-[#0B1F38] font-bold rounded-xl hover:bg-gray-100 transition-colors shadow-lg text-sm flex items-center gap-2">
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <><UserCheck size={16} /> Accepter et rejoindre</>}
                            </button>
                        </div>
                    </div>
                )}

                {/* Refusal Reminder — shown for users who declined */}
                {isRefused && (
                    <div className="mx-4 mt-4 p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl flex items-center justify-between gap-4 shrink-0 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-100 rounded-lg shrink-0"><AlertTriangle size={20} className="text-amber-600" /></div>
                            <div>
                                <p className="text-sm font-bold">Collaboration refusée</p>
                                <p className="text-xs opacity-90">Vous avez refusé de collaborer sur ce dossier. Votre accès est limité au contexte du marché.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ============================== */}
                {/* ZONE 1 — HEADER                */}
                {/* ============================== */}
                <div className="px-5 pt-5 pb-3 shrink-0">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                            <button
                                onClick={() => onCancel()}
                                className="mt-1 p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors shrink-0"
                                title="Retour"
                            >
                                <ArrowLeft size={20} className="text-[#0B1F38]/60" />
                            </button>
                            <div className="min-w-0">
                                <div className="flex items-center gap-2.5 flex-wrap">
                                    <h1 className="text-xl font-bold text-[#0B1F38] leading-tight line-clamp-2">{formData.titre || 'Nouvel appel d\'offres'}</h1>
                                    {/* Repère permanent pour qui n'est pas le porteur du
                                        dossier. Les actions de pilotage sont déjà masquées,
                                        mais rien ne disait POURQUOI : on pouvait croire à une
                                        interface incomplète plutôt qu'à un rôle différent. */}
                                    {tenderId && !isOwner && (
                                        <span
                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 bg-violet-50 text-violet-700 border-violet-200 flex items-center gap-1"
                                            title="Ce dossier est piloté par une autre entreprise. Vous y participez comme partenaire : vous déposez vos pièces, sans action sur le cycle de vie du dossier."
                                        >
                                            <Users size={11} /> Partenaire
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[#0B1F38]/50">
                                    {tenderId && <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border shrink-0 ${statusColor}`}>{statusLabel}</span>}
                                    {formData.organisme_acheteur && (
                                        <span className="flex items-center gap-1 text-xs font-medium"><Building size={12} className="shrink-0" />{formData.organisme_acheteur}</span>
                                    )}
                                    {formData.lieu_execution.length > 0 && (
                                        <span className="flex items-center gap-1 text-xs font-medium"><MapPin size={12} className="shrink-0" />{formData.lieu_execution.slice(0, 2).join(', ')}{formData.lieu_execution.length > 2 ? ` +${formData.lieu_execution.length - 2}` : ''}</span>
                                    )}
                                    {formData.mode_passation && (
                                        <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-[#0B1F38]/5 border-[#0B1F38]/10 text-[#0B1F38]/60`}>
                                            {(HANDOVER_TYPES_LABELS as any)[formData.mode_passation] || formData.mode_passation}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                            {tenderId && !amIInvitee && (
                                <button
                                    onClick={() => {
                                        setIsSidebarCollapsed?.(true);
                                        setShowChatDrawer(true);
                                    }}
                                    className="p-2.5 bg-white/60 hover:bg-white rounded-xl transition-all shadow-sm border border-white/60 text-[#0B1F38]/60 hover:text-[#00A3E0] group relative"
                                    title="Ouvrir la messagerie"
                                >
                                    <MessageSquare size={20} className="group-hover:scale-110 transition-transform" />
                                    {tenderId && unreadCounts[tenderId] > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
                                            {unreadCounts[tenderId]}
                                        </span>
                                    )}
                                </button>
                            )}
                            {/* Date Limite Badge */}
                            {formData.date_limite && (
                                <div className={`shrink-0 rounded-2xl border px-5 py-3 text-center ${deadlineColor}`}>
                                    <p className="text-[9px] font-bold uppercase tracking-widest opacity-70">Date limite</p>
                                    <p className="text-2xl font-extrabold leading-tight">{daysLeft !== null ? (daysLeft >= 0 ? `${daysLeft}` : `+${Math.abs(daysLeft)}`) : '—'}<span className="text-sm font-bold ml-1">jours</span></p>
                                    <p className="text-[10px] font-medium opacity-60">{new Date(formData.date_limite).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* SCROLLABLE BODY                */}
                {/* ============================== */}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar-dark pb-2">
                    {/* ZONE 2 — INDICATEURS STRATÉGIQUES - Hidden if refused */}
                    {!isRefused && (
                        <div className="px-5 pb-3">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                {/* Carte 1 — Potentiel de succès */}
                                <div className="bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all">
                                    <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider mb-2">Potentiel de succès</p>
                                    <div className="flex items-center gap-3">
                                        <div className="relative shrink-0">
                                            <svg width="90" height="90" viewBox="0 0 100 100" className="transform -rotate-90">
                                                <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke="#0B1F38" strokeOpacity="0.06" strokeWidth="8" />
                                                <circle cx="50" cy="50" r={gaugeRadius} fill="none" stroke={gaugeColor} strokeWidth="8" strokeLinecap="round"
                                                    strokeDasharray={gaugeCircumference} strokeDashoffset={gaugeOffset}
                                                    className="transition-all duration-1000" />
                                            </svg>
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <span className="text-xl font-extrabold text-[#0B1F38]">{successScore}%</span>
                                            </div>
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] text-[#0B1F38]/50 leading-snug">Lieu, délai, compétences</p>
                                            {missingSpecialties.length > 0 && (
                                                <p className="text-[10px] font-bold text-[#00A3E0] mt-1 leading-snug">+{potentialGain}% via partenaire {missingSpecialties[carouselIndex % missingSpecialties.length].label}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Carte 2 — Budget et offre */}
                                <div className="bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all">
                                    <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider mb-2">Budget et offre</p>
                                    <p className="text-2xl font-extrabold text-[#0B1F38] leading-tight">
                                        {formData.montant_estime > 0 ? formatBudget(formData.montant_estime) : '—'}
                                    </p>
                                    <p className="text-[10px] text-[#0B1F38]/40 font-medium">Budget estimé (acheteur)</p>
                                    <div className="mt-2 pt-2 border-t border-[#0B1F38]/5">
                                        <div className="flex justify-between items-center">
                                            <span className="text-[10px] text-[#0B1F38]/50">Offre groupement</span>
                                            <span className="text-xs font-bold text-[#0B1F38]/30">— €</span>
                                        </div>
                                        <p className="text-[9px] text-[#0B1F38]/30 mt-1 italic">Se calcule via le DPGF</p>
                                    </div>
                                </div>

                                {/* Carte 3 — Critères d'attribution */}
                                {renderCriteresCard()}

                                {/* Carte 4 — Prochain jalon */}
                                <div className="bg-white/60 border border-white/60 rounded-2xl p-2 shadow-sm hover:shadow-md transition-all cursor-pointer" onClick={() => setShowRetroplanningModal(true)}>
                                    <p className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider mb-2">Prochain jalon</p>
                                    {nextMilestone ? (
                                        <div className="flex flex-col items-center text-center gap-1">
                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${nextMilestone.status === 'done' ? 'bg-green-100 text-green-600' :
                                                nextMilestone.status === 'danger' ? 'bg-red-100 text-red-500' :
                                                    nextMilestone.status === 'warning' ? 'bg-amber-100 text-amber-600' :
                                                        'bg-[#00A3E0]/10 text-[#00A3E0]'
                                                }`}>
                                                {nextMilestone.status === 'done' ? <CheckCircle size={20} /> : <CalendarIcon size={20} />}
                                            </div>
                                            <p className="text-sm font-bold text-[#0B1F38] leading-tight">{nextMilestone.label}</p>
                                            <p className="text-xs font-medium text-[#0B1F38]/60">{new Date(nextMilestone.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                            {nextMilestone.status === 'danger' && <p className="text-[10px] font-bold text-red-500">Urgent</p>}
                                            {nextMilestone.status === 'warning' && <p className="text-[10px] font-bold text-amber-500">Bientôt</p>}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-[#0B1F38]/40 italic">Aucun jalon défini</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ============================== */}
                    {/* ZONE 3 — ESPACE DE TRAVAIL     */}
                    {/* ============================== */}
                    <div className="px-5">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                            {/* === COLONNE GAUCHE : Équipe & Pièces === */}
                            <div className="lg:col-span-2 bg-white/60 border border-white/60 rounded-2xl shadow-sm flex flex-col overflow-hidden">
                                {/* Header */}
                                <div className="p-2 pb-3 shrink-0">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-base font-bold text-[#0B1F38] flex items-center gap-2">
                                            <Users size={18} className="text-[#00A3E0]" /> Équipe & pièces
                                            {formData.type_groupement && (
                                                <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${formData.type_groupement === 'solidaire' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                                    {formData.type_groupement === 'solidaire' ? 'Solidaire' : 'Conjoint'}
                                                </span>
                                            )}
                                            <span className="text-[11px] font-medium text-[#0B1F38]/40 ml-1">· {activeMembers.length} membre{activeMembers.length > 1 ? 's' : ''}</span>
                                        </h3>
                                        {isOwner && (
                                            <button
                                                onClick={() => setShowDocDetails(true)}
                                                className="text-[11px] font-bold text-[#00A3E0] hover:text-[#008BBF] transition-colors flex items-center gap-1"
                                            >
                                                Voir toutes les pièces <ArrowRight size={12} />
                                            </button>
                                        )}
                                    </div>

                                    {/* Global progress bar - Hidden if refused */}
                                    {!isRefused && (
                                        <div className="mb-2">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-xs font-medium text-[#0B1F38]/60">Avancement global du dossier</span>
                                                <span className="text-xs font-bold text-[#0B1F38]">{globalProgress.received} / {globalProgress.total} pièces — {globalProgress.percent}%</span>
                                            </div>
                                            <div className="w-full bg-[#0B1F38]/8 rounded-full h-2.5 overflow-hidden">
                                                <div className={`h-full rounded-full transition-all duration-700 ${globalProgress.percent === 100 ? 'bg-green-500' : 'bg-[#00A3E0]'}`} style={{ width: `${globalProgress.percent}%` }} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Skills Tags - Hidden if refused */}
                                    {!isRefused && (
                                        <div className="flex flex-wrap gap-1.5 items-center">
                                            <span className="text-[10px] font-bold text-[#0B1F38]/50 mr-0.5">Requis :</span>
                                            {formData.required_specialty_ids.map(sid => {
                                                const spec = refSpecialties.find(s => s.id === sid);
                                                const skill = spec?.label || "Compétence";
                                                const isCovered = allCoveredSpecialtyIds.includes(sid);
                                                return (
                                                    <span key={sid} className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 group/skill relative ${isOwner ? 'pr-5' : ''} cursor-default ${isCovered ? 'text-green-700 bg-green-100' : 'text-red-600 bg-red-100'}`}>
                                                        {isCovered ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                                                        {skill}
                                                        {isOwner && <button onClick={(e) => { e.stopPropagation(); removeComp(sid); }} className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/skill:opacity-100 hover:text-red-700 transition-opacity"><X size={10} /></button>}
                                                    </span>
                                                );
                                            })}

                                            {isOwner && (
                                                <button
                                                    onClick={() => setShowSkillsModal(true)}
                                                    className="text-[10px] font-bold bg-[#0B1F38]/5 text-[#0B1F38]/60 hover:bg-[#00A3E0] hover:text-white px-2 py-0.5 rounded flex items-center gap-1 transition-all"
                                                >
                                                    <Plus size={10} /> Ajouter
                                                </button>
                                            )}

                                        </div>
                                    )}
                                </div>

                                {/* Members List - Filtered if refused */}
                                <div className="flex-1 overflow-y-auto custom-scrollbar-dark px-5 pb-3 space-y-2">
                                    {activeMembers.filter(m => !isRefused || m.is_owner).map((c, i) => {
                                        const isMemberOwner = !!c.is_owner;
                                        const isCurrentUser = c.id === userProfile?.id;
                                        const hasAccount = c.hasAccount || !!c.id;
                                        const memberType: 'creator' | 'connected' | 'invited' = isMemberOwner ? 'creator' : hasAccount ? 'connected' : 'invited';
                                        const effectiveStatus = isMemberOwner ? GROUPEMENT_STATUSES.accepte : (c.status || GROUPEMENT_STATUSES.invite);
                                        const displayName = c.name && c.name.trim() ? c.name : c.email;
                                        const memberProgress = getMemberProgress(c, i);

                                        return (
                                            <div key={c.id || i} onClick={(amIInvitee || effectiveStatus === GROUPEMENT_STATUSES.refuse) ? undefined : () => setSelectedMemberIndex(i)} className={`group relative p-2 rounded-xl border transition-all duration-200 ${amIInvitee ? '' : 'cursor-pointer hover:border-[#00A3E0]/30 hover:shadow-md'} ${isMemberOwner
                                                ? 'bg-gradient-to-r from-[#0B1F38]/5 to-[#00A3E0]/5 border-[#0B1F38]/15'
                                                : 'bg-white border-[#0B1F38]/5'
                                                }`}>
                                                {/* Top row: avatar + info + status */}
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${isMemberOwner ? 'bg-[#0B1F38] text-white' : hasAccount ? 'bg-white border border-[#00A3E0]/20 text-[#00A3E0]' : 'bg-white border border-orange-200 text-orange-400'}`}>
                                                        {c.photo_url ? (
                                                            <img src={c.photo_url} alt="" className="w-full h-full rounded-lg object-cover" />
                                                        ) : (
                                                            (c.company || c.name || 'M').charAt(0).toUpperCase()
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-4 min-w-0">
                                                            <div className="flex items-center gap-2 min-w-0 shrink-0 max-w-[50%]">
                                                                <p className="font-bold text-[#0B1F38] text-[12px] leading-tight truncate">
                                                                    {c.company || displayName}
                                                                    {isCurrentUser && <span className="text-[#0B1F38]/40 text-[10px] font-normal ml-1">(Vous)</span>}
                                                                </p>
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${isMemberOwner ? 'bg-[#00A3E0] text-white' : 'bg-[#0B1F38]/5 text-[#0B1F38]/50'}`}>
                                                                    {c.role}
                                                                </span>
                                                            </div>

                                                            {/* Member Skills - Horizontal Scroll */}
                                                            {c.skills && c.skills.length > 0 && (
                                                                <div className="flex gap-1.5 overflow-x-auto custom-scrollbar-dark max-w-[280px] min-w-0 shrink">
                                                                    {c.skills.map((skill, sidx) => {
                                                                        const sId = c.specialty_ids?.[sidx];
                                                                        const isRequired = sId ? formData.required_specialty_ids.includes(sId) : formData.required_skills.includes(skill);

                                                                        return (
                                                                            <div
                                                                                key={sidx}
                                                                                className={`text-[9px] font-bold px-2 py-0.5 rounded-lg whitespace-nowrap shrink-0 border transition-all ${isRequired
                                                                                        ? 'bg-[#00A3E0]/10 text-[#00A3E0] border-[#00A3E0]/20'
                                                                                        : 'bg-[#0B1F38]/5 text-[#0B1F38]/40 border-transparent'
                                                                                    }`}
                                                                            >
                                                                                {skill}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>


                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[11px] text-[#0B1F38]/50 truncate">{displayName !== c.company ? displayName : ''}</span>
                                                            <p className="text-[10px] text-[#0B1F38]/40 truncate">({c.email})</p>
                                                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-0.5 shrink-0 ${memberType === 'creator' ? 'text-[#00A3E0] bg-[#00A3E0]/10' : memberType === 'connected' ? 'text-green-600 bg-green-50' : 'text-orange-500 bg-orange-50'}`}>
                                                                {memberType === 'creator' && <><Crown size={9} /> Admin</>}
                                                                {memberType === 'connected' && <><UserCheck size={9} /> Connecté</>}
                                                                {memberType === 'invited' && <><Mail size={9} /> Invité</>}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {/* Right side: status + actions */}
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        {(() => {
                                                            switch (effectiveStatus) {
                                                                case GROUPEMENT_STATUSES.accepte: return <CheckCircle size={16} className="text-green-500" />;
                                                                case GROUPEMENT_STATUSES.refuse: return <XCircle size={16} className="text-red-400" />;
                                                                case GROUPEMENT_STATUSES.invite:
                                                                default: return <div className="w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />;
                                                            }
                                                        })()}

                                                        {isOwner && !isLocked && (effectiveStatus === GROUPEMENT_STATUSES.invite) && !isMemberOwner && (
                                                            <button onClick={(e) => { e.stopPropagation(); handleResendInvitation(c.email || '', c.role, c.access_code || '', c.entreprise_id); }}
                                                                className="p-1 text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded transition-colors" title={effectiveStatus === GROUPEMENT_STATUSES.refuse ? 'Relancer' : 'Inviter'}>
                                                                <Mail size={14} />
                                                            </button>
                                                        )}

                                                        {/* Retrait possible tant que le partenaire n'a pas accepté.
                                                            Une fois l'accord donné, le groupement est constitué : le
                                                            mandataire ne peut plus en sortir quelqu'un unilatéralement.
                                                            Le partenaire garde, lui, la possibilité de le quitter
                                                            (bouton ci-dessous). */}
                                                        {isOwner && !isMemberOwner && effectiveStatus !== GROUPEMENT_STATUSES.accepte && (
                                                            <button onClick={(e) => { e.stopPropagation(); setShowRemoveConfirm({ index: i, name: c.name || c.company || c.email }); }}
                                                                className="p-1 text-[#0B1F38]/15 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Retirer du groupement">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        )}
                                                        {isOwner && !isMemberOwner && effectiveStatus === GROUPEMENT_STATUSES.accepte && (
                                                            <span
                                                                title="Ce partenaire a accepté : il ne peut plus être retiré du groupement"
                                                                className="p-1 text-[#0B1F38]/10 cursor-default"
                                                            >
                                                                <ShieldAlert size={13} />
                                                            </span>
                                                        )}

                                                        {isCurrentUser && !isMemberOwner && effectiveStatus === GROUPEMENT_STATUSES.accepte && (
                                                            <button onClick={(e) => { e.stopPropagation(); setShowRemoveConfirm({ index: i, name: 'Quitter le groupement' }); }}
                                                                className="p-1 text-orange-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Quitter le groupement">
                                                                <LogOut size={13} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Individual progress bar */}
                                                {(effectiveStatus !== GROUPEMENT_STATUSES.refuse) && <div className=" ml-12">
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 bg-[#0B1F38]/8 rounded-full h-1.5 overflow-hidden">
                                                            <div className={`h-full rounded-full transition-all duration-500 ${memberProgress.percent === 100 ? 'bg-green-500' : 'bg-[#00A3E0]'}`} style={{ width: `${memberProgress.percent}%` }} />
                                                        </div>
                                                        <span className="text-[10px] font-bold text-[#0B1F38]/50 shrink-0">{memberProgress.received}/{memberProgress.total} — {memberProgress.percent}%</span>
                                                    </div>
                                                </div>}


                                            </div>
                                        );
                                    })}

                                    {missingSpecialties.length > 0 && isOwner && !isLocked && (
                                        <div className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-[#00A3E0]/30 bg-[#00A3E0]/5 relative overflow-hidden group">
                                            {/* Progress indicator for carousel dots */}
                                            <div className="absolute bottom-1 left-0 right-0 flex justify-center gap-1">
                                                {missingSpecialties.map((_, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`w-1 h-1 rounded-full transition-all ${idx === (carouselIndex % missingSpecialties.length) ? 'bg-[#00A3E0] w-2' : 'bg-[#0B1F38]/10'}`}
                                                    />
                                                ))}
                                            </div>

                                            <div className="w-10 h-10 rounded-xl bg-white border border-[#00A3E0]/20 flex items-center justify-center shrink-0 shadow-sm text-[#00A3E0] animate-pulse">
                                                <UserPlus size={18} />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                {missingSpecialties.map((spec, idx) => {
                                                    const isCurrent = idx === (carouselIndex % missingSpecialties.length);
                                                    if (!isCurrent) return null;

                                                    return (
                                                        <div key={spec.id} className="animate-in fade-in slide-in-from-right-2 duration-500">
                                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <p className="text-[12px] font-bold text-[#0B1F38] truncate">Partenaire {spec.label} recherché</p>
                                                                    <p className="text-[10px] font-bold text-[#00A3E0] flex items-center gap-1.5 mt-0.5">
                                                                        <Sparkles size={11} className="shrink-0" />
                                                                        Potentiel +{potentialGain}% sur votre score global
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <button
                                                                        onClick={() => setShowCollabPicker(true)}
                                                                        className="px-2.5 py-1.5 bg-[#00A3E0] text-white font-bold text-[10px] rounded-lg hover:bg-[#008BBF] transition-all shadow-sm hover:shadow-md flex items-center gap-1.5"
                                                                    >
                                                                        <Network size={12} /> Réseau
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setShowAddManualModal(true)}
                                                                        className="px-2.5 py-1.5 bg-white border border-[#0B1F38]/10 text-[#0B1F38]/70 font-bold text-[10px] rounded-lg hover:bg-gray-50 transition-all flex items-center gap-1.5"
                                                                    >
                                                                        <Mail size={12} /> Email
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Add member button */}
                                {isOwner && !isLocked && (
                                    <div className="flex items-center gap-2 p-2 border-t border-[#0B1F38]/5 shrink-0">
                                        <button
                                            onClick={() => setShowAddManualModal(true)}
                                            className="w-full py-2 border border-dashed border-[#0B1F38]/15 rounded-xl text-[#0B1F38]/50 font-bold text-xs hover:border-[#00A3E0] hover:text-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all flex items-center justify-center gap-1.5"
                                        >
                                            <Plus size={14} /> Ajouter un membre
                                        </button>
                                        <button
                                            onClick={() => setShowCollabPicker(true)}
                                            className="w-full py-2 bg-[#00A3E0] text-white font-bold text-sm rounded-xl hover:bg-[#008BBF] transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-1.5"
                                        >
                                            <Network size={14} /> Réseau
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* === COLONNE DROITE : Panneaux de référence === */}
                            <div className="lg:col-span-1 flex flex-col gap-3">

                                {/* Panel 1 — Contexte de l'AO */}
                                <div className="bg-white/40 border border-white/60 rounded-2xl p-2 relative group">
                                    {isOwner && !isLocked && <button
                                        onClick={() => setShowContextEditModal(true)}
                                        className="absolute top-3 right-3 p-1.5 bg-[#0B1F38]/5 text-[#0B1F38]/40 hover:bg-[#00A3E0]/10 hover:text-[#00A3E0] rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                        title="Modifier">
                                        <PenTool size={12} />
                                    </button>}
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-sm font-bold text-[#0B1F38] flex items-center gap-1.5"><FileText size={14} className="text-[#00A3E0]" /> Contexte de l'AO</h4>
                                        <button onClick={() => setShowContextEditModal(true)} className="text-[10px] font-bold text-[#00A3E0] hover:underline">Voir tout →</button>
                                    </div>
                                    <div className="space-y-2 text-[11px]">
                                        {/* Référence : celle de l'acheteur si connue, sinon l'identifiant
                                            technique Filao en repli explicite. Indépendante du lien
                                            (les deux disparaissaient ensemble auparavant). */}
                                        {(formData.reference_marche || tenderId) && (
                                            <div className="flex justify-between">
                                                <span className="text-[#0B1F38]/40">Référence</span>
                                                {formData.reference_marche ? (
                                                    <span className="text-[#0B1F38] font-medium truncate ml-2 max-w-[140px]" title={formData.reference_marche}>{formData.reference_marche}</span>
                                                ) : (
                                                    <span className="text-[#0B1F38]/50 font-medium truncate ml-2 max-w-[140px]" title={`Identifiant Filao : ${tenderId}`}>
                                                        Réf. interne
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        {formData.date_publication && (
                                            <div className="flex justify-between"><span className="text-[#0B1F38]/40">Publication</span><span className="text-[#0B1F38] font-medium">{new Date(formData.date_publication).toLocaleDateString('fr-FR')}</span></div>
                                        )}
                                        {formData.date_depot_souhaitee && (
                                            <div className="flex justify-between"><span className="text-[#0B1F38]/40">Dépôt souhaité</span><span className="text-[#0B1F38] font-medium">{new Date(formData.date_depot_souhaitee).toLocaleDateString('fr-FR')}</span></div>
                                        )}
                                        {/* Le mode de passation est déjà affiché dans l'en-tête de
                                            l'AO ; cette ligne sert donc au secteur, qui n'apparaissait
                                            nulle part alors que la fiche le demande. Taille de carte
                                            inchangée. */}
                                        {formData.secteur_activite && (
                                            <div className="flex justify-between">
                                                <span className="text-[#0B1F38]/40">Secteur</span>
                                                <span className="text-[#0B1F38] font-medium truncate ml-2 max-w-[150px]">
                                                    {(SECTORS_LABELS as any)[formData.secteur_activite] || formData.secteur_activite}
                                                </span>
                                            </div>
                                        )}
                                        {/* Codes CPV — nomenclature européenne de l'objet du marché.
                                            Présenté comme les autres lignes du panneau : intitulé à
                                            gauche, valeur à droite. La version précédente occupait
                                            trois lignes (titre, pastilles, libellé) pour une seule
                                            information. */}
                                        {formData.cpv_codes?.length > 0 && (
                                            <div className="flex justify-between gap-2">
                                                <span className="text-[#0B1F38]/40 shrink-0">CPV</span>
                                                <span
                                                    className="text-[#0B1F38] font-medium truncate text-right"
                                                    // Le détail complet reste accessible au survol :
                                                    // un code par ligne, avec sa division.
                                                    title={formData.cpv_codes.map(c => cpvLisible(c, formatCpv(c))).join('\n')}
                                                >
                                                    <span className="font-mono">{formatCpv(formData.cpv_codes[0])}</span>
                                                    {libelleCpv(formData.cpv_codes[0]) && (
                                                        <span className="text-[#0B1F38]/50"> · {libelleCpv(formData.cpv_codes[0])}</span>
                                                    )}
                                                    {formData.cpv_codes.length > 1 && (
                                                        <span className="text-[#0B1F38]/40"> +{formData.cpv_codes.length - 1}</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {formData.lien_telechargement ? (
                                            <a href={formData.lien_telechargement} target="_blank" rel="noopener noreferrer" title={formData.lien_telechargement} className="flex items-center gap-1 text-[#00A3E0] font-bold hover:underline mt-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-[#00A3E0] rounded">
                                                <Link size={12} /> Lien vers l'appel d'offres →
                                            </a>
                                        ) : (
                                            /* Le lien doit être joignable "dans tous les cas" : si absent, on propose
                                               la saisie au lieu de masquer silencieusement la ligne. */
                                            <button
                                                onClick={() => setShowContextEditModal(true)}
                                                disabled={!isOwner || isLocked}
                                                className="flex items-center gap-1 text-[#0B1F38]/40 font-bold hover:text-[#00A3E0] hover:underline mt-1 text-[11px] disabled:hover:no-underline disabled:hover:text-[#0B1F38]/40 disabled:cursor-default"
                                            >
                                                <Link size={12} /> {(!isOwner || isLocked) ? "Aucun lien renseigné" : "Ajouter le lien vers l'appel d'offres"}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Panel 2 — Pièces du marché (DCE) - Hidden if refused */}
                                {!isRefused && (
                                    <div className={`bg-white/40 border border-white/60 rounded-2xl p-2 group ${amIInvitee ? 'opacity-80' : 'cursor-pointer'}`} onClick={amIInvitee ? undefined : () => setShowDCEPiecesModal(true)}>
                                        <div className="flex justify-between items-center">
                                            <h4 className="text-sm font-bold text-[#0B1F38] flex items-center gap-1.5"><FolderOpen size={14} className="text-[#00A3E0]" /> Pièces du marché</h4>
                                            {!amIInvitee && <button className="text-[10px] font-bold text-[#00A3E0] hover:underline group-hover:translate-x-0.5 transition-transform">Consulter →</button>}
                                        </div>
                                        <p className="text-[11px] text-[#0B1F38]/50 mt-1.5">{formData.dce_documents?.length || 0} document{formData.dce_documents?.length > 1 ? 's' : ''}</p>
                                    </div>
                                )}

                                {/* Panel 3 — Rétroplanning - Hidden if refused */}
                                {!isRefused && (
                                    <div className="bg-white/40 border border-white/60 rounded-2xl p-2 cursor-pointer group" onClick={() => setShowRetroplanningModal(true)}>
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="text-sm font-bold text-[#0B1F38] flex items-center gap-1.5"><CalendarCheck size={14} className="text-[#00A3E0]" /> Rétroplanning</h4>
                                            <button className="text-[10px] font-bold text-[#00A3E0] hover:underline group-hover:translate-x-0.5 transition-transform">Voir tout →</button>
                                        </div>
                                        <div className="space-y-2">
                                            {milestones.slice(0, 3).map((m, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full shrink-0 ${m.status === 'done' ? 'bg-green-500' : m.status === 'danger' ? 'bg-red-500' : m.status === 'warning' ? 'bg-amber-500' : 'bg-gray-300'}`} />
                                                    <span className="text-[11px] font-medium text-[#0B1F38]/60 shrink-0 w-20">{new Date(m.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                    <span className="text-[11px] text-[#0B1F38] font-medium">{m.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ============================== */}
                {/* FOOTER                         */}
                {/* ============================== */}
                <div className="px-5 py-3 border-t border-white/30 flex justify-between items-center shrink-0 bg-white/40 backdrop-blur-sm">
                    <div className="flex items-center gap-4">
                        {tenderId && isOwner && (
                            <button
                                onClick={() => setShowDeleteTenderModal(true)}
                                className="px-4 py-2.5 flex items-center gap-2 bg-red-50 text-red-500 hover:bg-red-100 rounded-xl transition-all border border-red-100 text-xs font-bold"
                                title="Supprimer le dossier"
                            >
                                <Trash2 size={14} /> Supprimer
                            </button>
                        )}
                        {!tenderId && <div className="flex items-center gap-4">
                            <div className="bg-[#0B1F38]/5 p-2 rounded-xl"><Target size={20} className="text-[#0B1F38]" /></div>
                            <div><h3 className="font-bold text-[#0B1F38] text-base">Décision finale</h3><p className="text-xs text-[#0B1F38]/60">Validez pour créer l'espace collaboratif</p></div>
                        </div>}
                    </div>

                    {!tenderId ? (
                        <div className="flex gap-3">
                            <button onClick={() => setCurrentView('results')} className="px-5 py-2.5 bg-white border-2 border-red-100 hover:border-red-200 text-red-500 font-bold text-sm rounded-xl shadow-sm transition-all flex items-center gap-2">
                                <XCircle size={18} /> NO GO
                            </button>
                            <button onClick={() => handleGoToVerification()} className="px-6 py-2.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center gap-2">
                                {loading ? <Loader2 className="animate-spin" /> : <><CheckCircle size={18} /> GO - CRÉER LE DOSSIER</>}
                            </button>
                        </div>
                    ) : isOwner ? (
                        <div className="flex gap-3">
                            {formData.statut === STATUSES.submitted ? (
                                <>
                                    <button onClick={() => setShowOutcomeModal('won')} className="px-6 py-2.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 font-bold text-sm rounded-xl transition-all shadow-sm flex items-center gap-2">
                                        <Trophy size={18} /> GAGNÉ
                                    </button>
                                    <button onClick={() => setShowOutcomeModal('lost')} className="px-6 py-2.5 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 font-bold text-sm rounded-xl transition-all shadow-sm flex items-center gap-2">
                                        <Frown size={18} /> PERDU
                                    </button>
                                </>
                            ) : formData.statut === STATUSES.on ? (
                                <button 
                                    onClick={() => {
                                        const hasMandataire = groupementMembers.some(m => m.role === 'Mandataire' && !m.deleted);
                                        if (!hasMandataire) {
                                            showToast("Action bloquée : Un Mandataire doit être désigné avant de finaliser le dossier.", "warning");
                                            return;
                                        }
                                        setShowFinalizeConfirm(true);
                                    }} 
                                    className="flex items-center gap-2 px-6 py-3 bg-[#0B1F38] text-white font-bold text-sm rounded-xl shadow-lg hover:bg-[#00A3E0] transition-all"
                                >
                                    {loading ? <Loader2 className="animate-spin" /> : <><CheckCircle size={16} /> Finaliser le dossier</>}
                                </button>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-xs text-[#0B1F38]/50 italic px-2">Seul le propriétaire du marché peut effectuer les actions de finalisation.</p>
                    )}
                </div>
            </div>
        );
    };



    // ==========================================
    //           CONTEXT EDIT MODAL
    // ==========================================
    /** Ouvre la modale en amorçant le brouillon depuis les données existantes. */
    const openCriteresModal = () => {
        const crit = formData.criteres_attribution;
        if (crit && (crit.kind === 'ponderes' || crit.kind === 'priorites') && crit.criteres.length > 0) {
            // Depuis la forme `priorites` on reprend les libellés sans inventer
            // de poids : l'acheteur ne les a pas publiés.
            setCriteresDraft(crit.criteres.map(c => ({ libelle: c.libelle, poids: c.poids })));
        } else {
            setCriteresDraft([{ libelle: '', poids: undefined }]);
        }
        setShowCriteresModal(true);
    };

    /** Convertit le brouillon en donnée persistable. */
    const buildCriteres = (lignes: { libelle: string; poids?: number }[]): CriteresAttribution => {
        const nettoyees = lignes
            .map(l => ({ libelle: l.libelle.trim(), poids: l.poids }))
            .filter(l => l.libelle.length > 0);
        const total = nettoyees.reduce((s, l) => s + (l.poids ?? 0), 0);
        return {
            kind: nettoyees.length > 0 ? 'ponderes' : 'absent',
            criteres: nettoyees,
            poidsSontDesPourcentages: Math.abs(total - 100) < 0.5,
            source: 'manuel'
        };
    };

    /**
     * Modale de saisie des critères d'attribution.
     *
     * Elle existe parce que la majorité des avis BOAMP ne publie pas de
     * pondération exploitable : l'utilisateur doit pouvoir reprendre à la main
     * ce qu'il lit dans le règlement de consultation.
     */
    const renderCriteresModal = () => {
        if (!showCriteresModal) return null;

        const crit = formData.criteres_attribution;
        const total = criteresDraft.reduce((s, l) => s + (l.poids ?? 0), 0);
        const editable = isOwner && !isLocked;

        const majLigne = (index: number, patch: Partial<{ libelle: string; poids?: number }>) =>
            setCriteresDraft(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));

        return (
            <div className="fixed inset-0 z-[115] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowCriteresModal(false)}></div>
                <div className="relative bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                    <div className="p-6 border-b border-[#0B1F38]/5 flex justify-between items-center shrink-0">
                        <div>
                            <h3 className="text-lg font-bold text-[#0B1F38]">Critères d'attribution</h3>
                            <p className="text-xs text-[#0B1F38]/50">Tels qu'annoncés dans le règlement de consultation.</p>
                        </div>
                        <button onClick={() => setShowCriteresModal(false)} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors">
                            <X size={20} className="text-[#0B1F38]/40" />
                        </button>
                    </div>

                    <div className="p-6 overflow-y-auto flex-1">
                        {crit?.kind === 'libre' && crit.texte && (
                            <div className="mb-5 p-4 rounded-2xl bg-[#0B1F38]/5 border border-[#0B1F38]/10">
                                <p className="text-[11px] font-bold text-[#0B1F38]/50 uppercase tracking-wider mb-1.5">Texte publié par l'acheteur</p>
                                <p className="text-[13px] text-[#0B1F38]/70 leading-relaxed">{crit.texte}</p>
                            </div>
                        )}
                        {crit?.kind === 'cctp' && (
                            <div className="mb-5 p-4 rounded-2xl bg-[#0B1F38]/5 border border-[#0B1F38]/10">
                                <p className="text-[13px] text-[#0B1F38]/70">
                                    L'acheteur renvoie au règlement de consultation. Reportez ici les critères qui y figurent.
                                </p>
                            </div>
                        )}

                        <fieldset disabled={!editable} className="border-0 p-0 m-0">
                            {/* En-têtes : sans eux, deux champs côte à côte dont l'un
                                attend un nombre ne s'expliquent pas d'eux-mêmes. */}
                            <div className="grid grid-cols-[1fr_7rem_2rem] gap-2 items-center px-1 mb-1.5">
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider">Critère</span>
                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase tracking-wider">Poids</span>
                                <span className="sr-only">Actions</span>
                            </div>
                            <div className="space-y-2">
                                {criteresDraft.map((ligne, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_7rem_2rem] gap-2 items-center">
                                        <input
                                            type="text"
                                            value={ligne.libelle}
                                            onChange={(e) => majLigne(i, { libelle: e.target.value })}
                                            placeholder="ex. Valeur technique"
                                            aria-label={`Intitulé du critère ${i + 1}`}
                                            className={`${inputGlassPlain} w-full min-w-0`}
                                        />
                                        <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            value={ligne.poids ?? ''}
                                            onChange={(e) => {
                                                const v = parseFloat(e.target.value);
                                                majLigne(i, { poids: Number.isFinite(v) ? v : undefined });
                                            }}
                                            placeholder="ex. 50"
                                            aria-label={`Poids du critère ${i + 1}`}
                                            className={`${inputGlassPlain} w-full min-w-0`}
                                        />
                                        {editable && criteresDraft.length > 1 ? (
                                            <button
                                                onClick={() => setCriteresDraft(prev => prev.filter((_, idx) => idx !== i))}
                                                aria-label={`Supprimer le critère ${i + 1}`}
                                                className="p-2 text-[#0B1F38]/30 hover:text-red-500 transition-colors justify-self-center"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        ) : <span />}
                                    </div>
                                ))}
                            </div>

                            {editable && (
                                <button
                                    onClick={() => setCriteresDraft(prev => [...prev, { libelle: '', poids: undefined }])}
                                    className="mt-3 w-full py-2.5 border border-dashed border-[#0B1F38]/15 rounded-xl text-[#0B1F38]/50 font-bold text-xs hover:border-[#00A3E0] hover:text-[#00A3E0] transition-all flex items-center justify-center gap-1.5"
                                >
                                    <Plus size={14} /> Ajouter un critère
                                </button>
                            )}
                        </fieldset>

                        {/* Le total n'a pas à valoir 100 : les acheteurs publient
                            indifféremment des pourcentages ou des coefficients. On
                            informe sans bloquer la saisie. */}
                        <div className="mt-4 flex items-start gap-2 text-[12px]">
                            <Info size={14} className="text-[#0B1F38]/40 shrink-0 mt-0.5" />
                            <span className="text-[#0B1F38]/60">
                                Total : <strong className="text-[#0B1F38]">{Math.round(total * 10) / 10}</strong>
                                {total === 0
                                    ? " — sans poids, les critères sont enregistrés sans pondération."
                                    : Math.abs(total - 100) < 0.5
                                        ? ' — interprété comme des pourcentages.'
                                        : " — interprété comme des coefficients, converti en % à l'affichage."}
                            </span>
                        </div>
                    </div>

                    {editable && (
                        <div className="p-6 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                            <button
                                onClick={async () => {
                                    const next = buildCriteres(criteresDraft);
                                    setFormData(prev => ({ ...prev, criteres_attribution: next }));
                                    setShowCriteresModal(false);
                                    // setFormData est asynchrone : on transmet la valeur
                                    // explicitement plutôt que de lire un state périmé.
                                    if (tenderId) await saveTenderContext({ criteres_attribution: next });
                                }}
                                className="px-8 py-3 bg-[#0B1F38] text-white font-bold rounded-xl hover:bg-[#00A3E0] transition-all shadow-lg"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Enregistrer'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderContextEditModal = () => {
        if (!showContextEditModal) return null;

        return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowContextEditModal(false)}></div>
                <div className="relative bg-white rounded-3xl w-full max-w-4xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

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
                        <button onClick={() => setShowContextEditModal(false)} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors">
                            <X size={20} className="text-[#0B1F38]/40" />
                        </button>
                    </div>

                    {/* Form Content */}
                    <div className="p-8 overflow-y-auto custom-scrollbar-dark flex-1">

                        {/* Lecture seule : le fieldset ci-dessous est désactivé, ce qui rendait la
                            modale muette (frappe ignorée, pas de bouton de validation). On explicite
                            la raison au lieu de laisser l'utilisateur croire à un bug de saisie. */}
                        {(!isOwner || isLocked) && (
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
                        {(!isOwner || isLocked) && formData.lien_telechargement && (
                            <div className="mb-6 flex items-center gap-2 text-[13px]">
                                <Link size={14} className="text-[#00A3E0] shrink-0" />
                                <a
                                    href={formData.lien_telechargement}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#00A3E0] font-bold hover:underline truncate focus:outline-none focus:ring-2 focus:ring-[#00A3E0] rounded"
                                >
                                    Ouvrir l'appel d'offres
                                </a>
                            </div>
                        )}

                        <fieldset disabled={!isOwner || isLocked} className="grid grid-cols-1 md:grid-cols-2 gap-6 border-0 p-0 m-0 min-w-0">
                            <div className="md:col-span-2">
                                <label className={labelStyle}>Nom de l'appel d'offres *</label>
                                <input
                                    type="text"
                                    value={formData.titre}
                                    onChange={(e) => setFormData({ ...formData, titre: e.target.value })}
                                    className={`${inputGlass} font-bold text-[#0B1F38] bg-[#F8FAFC]`}
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className={labelStyle}>Nom de l'organisme acheteur *</label>
                                <input
                                    type="text"
                                    value={formData.organisme_acheteur}
                                    onChange={(e) => setFormData({ ...formData, organisme_acheteur: e.target.value })}
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
                                            if (e.target.value && !formData.lieu_execution.includes(e.target.value)) {
                                                setFormData({ ...formData, lieu_execution: [...formData.lieu_execution, e.target.value] });
                                            }
                                        }}
                                        className={`${inputGlass} appearance-none cursor-pointer bg-[#F8FAFC]`}
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
                                                {(isOwner && !isLocked) && <X size={12} className="cursor-pointer" onClick={() => setFormData({ ...formData, lieu_execution: formData.lieu_execution.filter(l => l !== lieu) })} />}
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
                                            if (e.target.value && !formData.type_marche.includes(e.target.value)) {
                                                setFormData({ ...formData, type_marche: [...formData.type_marche, e.target.value] });
                                            }
                                        }}
                                        className={`${inputGlass} appearance-none cursor-pointer bg-[#F8FAFC]`}
                                    >
                                        <option value="">Sélectionnez les types...</option>
                                        {Object.entries(MARKET_TYPES_LABELS).map(([value, label]) => (
                                            <option key={value} value={value} disabled={formData.type_marche.includes(value)}>{label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                </div>
                                {formData.type_marche.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {formData.type_marche.map(type => (
                                            <span key={type} className="bg-[#F3E8FD] text-[#8B5CF6] text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 border border-[#8B5CF6]/10">
                                                {(MARKET_TYPES_LABELS as any)[type] || type}
                                                {(isOwner && !isLocked) && <X size={12} className="cursor-pointer" onClick={() => setFormData({ ...formData, type_marche: formData.type_marche.filter(t => t !== type) })} />}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className={labelStyle}>Secteur d'activité *</label>
                                <select
                                    value={formData.secteur_activite || 'Autres'}
                                    onChange={(e) => setFormData({ ...formData, secteur_activite: e.target.value })}
                                    className={`${inputGlass} font-bold text-[#0B1F38] cursor-pointer bg-[#F8FAFC]`}
                                >
                                    <option value="">Sélectionner...</option>
                                    {Object.keys(SECTORS_LABELS).map(k => <option key={k} value={k}>{(SECTORS_LABELS as any)[k]}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className={labelStyle}>Mode de passation *</label>
                                <select
                                    value={formData.mode_passation || ''}
                                    onChange={(e) => setFormData({ ...formData, mode_passation: e.target.value })}
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
                                    <input type="date" value={formData.date_publication} onChange={(e) => setFormData({ ...formData, date_publication: e.target.value })} className={`${inputGlassPlain} w-full`} />
                                </div>
                                <div>
                                    <label className={labelStyle}>Date limite *</label>
                                    <input type="date" value={formData.date_limite} onChange={(e) => setFormData({ ...formData, date_limite: e.target.value })} className={`${inputGlass} border-red-200 bg-red-50 text-red-600 font-bold`} />
                                </div>
                                <div>
                                    <label className={labelStyle}>Dépôt souhaité *</label>
                                    <input type="date" value={formData.date_depot_souhaitee} onChange={(e) => setFormData({ ...formData, date_depot_souhaitee: e.target.value })} className={`${inputGlass} border-[#00A3E0]/20 bg-[#00A3E0]/5 text-[#00A3E0] font-bold`} />
                                </div>
                            </div>

                            <div>
                                <label className={labelStyle}>Montant estimé</label>
                                <div className="relative">
                                    <Euro size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40" />
                                    <input type="number" value={formData.montant_estime} onChange={(e) => setFormData({ ...formData, montant_estime: parseFloat(e.target.value) || 0 })} className={`${inputGlass} bg-[#F8FAFC]`} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 md:col-span-2">
                                <div>
                                    <div className="flex items-baseline justify-between gap-2">
                                        <label htmlFor="tender-lien-telechargement" className={labelStyle}>Lien vers l'appel d'offres</label>
                                        {formData.lien_telechargement && (
                                            <a
                                                href={formData.lien_telechargement}
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
                                            value={formData.lien_telechargement}
                                            onChange={(e) => setFormData({ ...formData, lien_telechargement: e.target.value })}
                                            placeholder="https://..."
                                            className={inputGlass}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className={labelStyle}>Lien de dépôt</label>
                                    <div className="relative">
                                        <UploadCloud size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                        <input
                                            type="text"
                                            value={formData.lien_depot}
                                            onChange={(e) => setFormData({ ...formData, lien_depot: e.target.value })}
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
                                        value={formData.reference_marche || ''}
                                        onChange={(e) => setFormData({ ...formData, reference_marche: e.target.value })}
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
                                        defaultValue={(formData.cpv_codes || []).join(', ')}
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
                                            setFormData({ ...formData, cpv_codes: valides });
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
                                    {(formData.cpv_codes || []).length > 0 && (
                                        <ul className="mt-2 space-y-0.5">
                                            {formData.cpv_codes.map(code => (
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
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    className={`${inputGlass} text-[#0B1F38]/80 italic resize-none bg-[#F8FAFC]`}
                                />
                            </div>
                        </fieldset>
                    </div>

                    {/* Footer - Only visible if owner can edit */}
                    {(isOwner && !isLocked) && (
                        <div className="p-6 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                            <button
                                onClick={async () => {
                                    setShowContextEditModal(false);
                                    if (tenderId) await saveTenderContext();
                                }}
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

    const renderSkillsModal = () => {
        if (!showSkillsModal) return null;

        return (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowSkillsModal(false)}></div>
                <div className="relative bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                    {/* Header */}
                    <div className="p-3 border-b border-[#0B1F38]/5 flex justify-between items-center bg-[#0B1F38]/2 shrink-0">
                        <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0]">
                                <Target size={16} />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-[#0B1F38]">Compétences requises</h3>
                                <p className="text-[9px] text-[#0B1F38]/50">Définissez les spécialités d'expertises</p>
                            </div>
                        </div>
                        <button onClick={() => setShowSkillsModal(false)} className="p-1.5 hover:bg-[#0B1F38]/5 rounded-lg transition-colors">
                            <X size={16} className="text-[#0B1F38]/40" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="px-4 py-2.5 overflow-y-auto custom-scrollbar-dark flex-1">
                        {/* Nature Filter */}
                        <div className="flex gap-1 mb-2.5 overflow-x-auto pb-1 custom-scrollbar-horizontal">
                            {[
                                { id: 'travaux', label: 'Travaux' },
                                { id: 'services', label: 'Services' },
                                { id: 'fournitures', label: 'Fournitures' }
                            ].map(n => (
                                <button
                                    key={n.id}
                                    onClick={() => setSelectedNature(selectedNature === n.id ? null : n.id)}
                                    className={`px-2.5 py-1 rounded-full text-[9px] font-bold transition-all border ${selectedNature === n.id ? 'bg-[#00A3E0] text-white border-[#00A3E0]' : 'bg-white text-[#0B1F38]/40 border-[#0B1F38]/10 hover:border-[#00A3E0]/30'}`}
                                >
                                    {n.label}
                                </button>
                            ))}
                        </div>

                        {/* Search Input */}
                        <div className="relative mb-2.5" ref={searchRef}>
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/30" />
                            <input
                                type="text"
                                value={skillQuery}
                                onChange={(e) => { setSkillQuery(e.target.value); setDropOpen(true); }}
                                onFocus={() => setDropOpen(true)}
                                placeholder={loadingRef ? "Chargement..." : "Rechercher une spécialité..."}
                                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-[#0B1F38]/10 bg-[#F8FAFC] focus:bg-white focus:ring-2 focus:ring-[#00A3E0] outline-none transition-all text-[11px] font-bold text-[#0B1F38]"
                            />

                            {dropOpen && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#0B1F38]/10 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto custom-scrollbar-dark ring-4 ring-[#0B1F38]/2">
                                    {(() => {
                                        const domainesSuggeres = suggererDomainesDepuisCpv(formData.cpv_codes);
                                        const rangDe = (domainId: string) => {
                                            const i = domainesSuggeres.indexOf(domainId);
                                            return i === -1 ? Number.MAX_SAFE_INTEGER : i;
                                        };

                                        const filteredSpecs = refSpecialties
                                            .filter(s => {
                                                const domain = refDomains.find(d => d.id === s.domain_id);
                                                if (selectedNature && (!domain || !domain.natures.includes(selectedNature))) return false;
                                                if (!skillQuery) return true;
                                                return s.label.toLowerCase().includes(skillQuery.toLowerCase()) ||
                                                    (domain && domain.label.toLowerCase().includes(skillQuery.toLowerCase()));
                                            })
                                            // Tri avant troncature : sans cela, la limite de 50 rognait
                                            // les domaines suggérés au profit de l'ordre alphabétique.
                                            .sort((a, b) => rangDe(a.domain_id) - rangDe(b.domain_id))
                                            .slice(0, 50);

                                        if (filteredSpecs.length === 0) {
                                            return (
                                                <div className="p-6 text-center text-xs text-[#0B1F38]/40 italic">
                                                    Aucun résultat {selectedNature ? `pour ${selectedNature}` : ""}
                                                </div>
                                            );
                                        }

                                        // Groupement par domaine, domaines suggérés par les CPV en tête.
                                        const grouped: Record<string, typeof filteredSpecs> = {};
                                        const rangDomaine: Record<string, number> = {};
                                        filteredSpecs.forEach(s => {
                                            const d = refDomains.find(rd => rd.id === s.domain_id);
                                            const dName = d ? d.label : "Autre";
                                            if (!grouped[dName]) {
                                                grouped[dName] = [];
                                                const idx = d ? domainesSuggeres.indexOf(d.id) : -1;
                                                rangDomaine[dName] = idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
                                            }
                                            grouped[dName].push(s);
                                        });

                                        return Object.entries(grouped)
                                            .sort(([a], [b]) => rangDomaine[a] - rangDomaine[b])
                                            .map(([domainName, specs]) => (
                                            <div key={domainName}>
                                                <div className="px-3 py-1.5 bg-[#F8FAFC] text-[9px] font-bold text-[#0B1F38]/30 uppercase tracking-widest border-y border-[#0B1F38]/5 flex items-center justify-between gap-2">
                                                    <span>{domainName}</span>
                                                    {rangDomaine[domainName] !== Number.MAX_SAFE_INTEGER && (
                                                        <span className="text-[#00A3E0] shrink-0" title="Domaine suggéré d'après les codes CPV de l'avis">
                                                            suggéré
                                                        </span>
                                                    )}
                                                </div>
                                                {specs.map(s => {
                                                    const isSelected = formData.required_specialty_ids?.includes(s.id);
                                                    return (
                                                        <button
                                                            key={s.id}
                                                            disabled={isSelected}
                                                            onClick={() => addComp(s)}
                                                            className={`w-full text-left px-3 py-2 text-[11px] font-bold flex items-center justify-between hover:bg-[#00A3E0]/5 transition-colors ${isSelected ? 'opacity-40 cursor-default' : 'text-[#0B1F38]'}`}
                                                        >
                                                            {s.label}
                                                            {isSelected && <CheckCircle size={12} className="text-[#00A3E0]" />}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()}
                                </div>
                            )}
                        </div>

                        {/* Suggestions issues des codes CPV de l'avis.
                            Volontairement non présélectionnées : un CPV décrit l'objet
                            du marché, pas les compétences attendues. Les écrire d'office
                            polluerait reponses_ao_specialties et fausserait le score de
                            couverture, qui se calcule sur required_specialty_ids. */}
                        {(() => {
                            const domaines = suggererDomainesDepuisCpv(formData.cpv_codes).slice(0, 2);
                            if (domaines.length === 0) return null;

                            const proposees = refSpecialties
                                .filter(s => domaines.includes(s.domain_id))
                                .filter(s => !formData.required_specialty_ids?.includes(s.id))
                                .filter(s => {
                                    if (!selectedNature) return true;
                                    const d = refDomains.find(rd => rd.id === s.domain_id);
                                    return d?.natures.includes(selectedNature);
                                })
                                // Les domaines les plus probables d'abord, comme dans le sélecteur.
                                .sort((a, b) => domaines.indexOf(a.domain_id) - domaines.indexOf(b.domain_id))
                                .slice(0, 8);

                            if (proposees.length === 0) return null;

                            return (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-[9px] font-bold text-[#0B1F38]/30 uppercase tracking-wider">
                                            Suggéré d'après les codes CPV
                                        </p>
                                        <button
                                            onClick={() => proposees.forEach(addComp)}
                                            className="text-[9px] font-bold text-[#00A3E0] hover:underline shrink-0"
                                        >
                                            Tout ajouter
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {proposees.map(s => {
                                            const domaine = refDomains.find(rd => rd.id === s.domain_id);
                                            return (
                                                <button
                                                    key={s.id}
                                                    onClick={() => addComp(s)}
                                                    title={domaine ? `${domaine.label} — ajouter` : 'Ajouter'}
                                                    aria-label={`Ajouter la spécialité ${s.label}`}
                                                    className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-[#00A3E0]/40 text-[10px] font-bold text-[#0B1F38]/60 hover:bg-[#00A3E0]/5 hover:text-[#00A3E0] hover:border-solid transition-all"
                                                >
                                                    <Plus size={10} /> {s.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}

                        {/* Selected Skills List */}
                        <div className="space-y-1.5">
                            <p className="text-[9px] font-bold text-[#0B1F38]/30 uppercase tracking-wider mb-1">Spécialités sélectionnées ({formData.required_specialty_ids.length})</p>
                            <div className="flex flex-wrap gap-1.5">
                                {formData.required_specialty_ids.map(sid => {
                                    const spec = refSpecialties.find(s => s.id === sid);
                                    if (!spec) return null;
                                    return (
                                        <div key={sid} className="bg-[#00A3E0]/10 text-[#00A3E0] px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1.5 group">
                                            {spec.label}
                                            <button
                                                onClick={() => removeComp(sid)}
                                                className="p-0.5 hover:bg-[#00A3E0]/20 rounded transition-colors"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    );
                                })}
                                {formData.required_specialty_ids.length === 0 && (
                                    <p className="text-xs text-[#0B1F38]/40 italic p-3 bg-[#F8FAFC] rounded-xl w-full text-center">
                                        Aucune compétence sélectionnée.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-3 py-2 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-end shrink-0">
                        <button
                            onClick={async () => {
                                setShowSkillsModal(false);
                                if (tenderId) await saveRequiredSkills();
                            }}
                            className="px-4 py-1.5 bg-[#0B1F38] text-white font-bold text-xs rounded-lg hover:bg-[#00A3E0] transition-all shadow-md min-w-[80px]"
                        >
                            {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Valider"}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderRetroplanningModal = () => {
        if (!showRetroplanningModal) return null;

        const sortedJalons = [...(formData.jalons || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

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
                            <button onClick={() => setShowRetroplanningModal(false)} className="p-3 bg-white hover:bg-[#0B1F38]/5 text-[#0B1F38]/40 hover:text-[#0B1F38] rounded-xl transition-all shadow-sm">
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
                                    const isPast = estFait;
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
                                                                            const newJalons = [...formData.jalons];
                                                                            const realIdx = formData.jalons.findIndex((j: any) => j.label === jalon.label && j.date === jalon.date);
                                                                            if (realIdx !== -1) {
                                                                                newJalons[realIdx] = { ...jalon, ...editingJalon };
                                                                                setFormData(prev => ({ ...prev, jalons: newJalons }));
                                                                                if (tenderId && isOwner) supabase.from('reponses_ao').update({ jalons: newJalons }).eq('id', tenderId).then();
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
                                                                    onClick={async () => {
                                                                        if (!confirm("Supprimer ce jalon ?")) return;
                                                                        const newJalons = formData.jalons.filter((j: any) => !(j.label === jalon.label && j.date === jalon.date));
                                                                        setFormData(prev => ({ ...prev, jalons: newJalons }));
                                                                        if (tenderId && isOwner) await supabase.from('reponses_ao').update({ jalons: newJalons }).eq('id', tenderId);
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
                                                        const newJalons = [...(formData.jalons || []), { ...newJalon, color: '#00A3E0', source: 'Manuel', editable: true }];
                                                        setFormData(prev => ({ ...prev, jalons: newJalons }));
                                                        if (tenderId && isOwner) supabase.from('reponses_ao').update({ jalons: newJalons }).eq('id', tenderId).then();
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
                        <button onClick={() => setShowRetroplanningModal(false)} className="px-10 py-3.5 bg-[#0B1F38] text-white font-extrabold rounded-2xl hover:bg-[#00A3E0] transition-all shadow-xl shadow-[#0B1F38]/10 tracking-wide text-sm">
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ==========================================
    //           DCE PIECES MODAL
    // ==========================================
    const renderDCEPiecesModal = () => {
        if (!showDCEPiecesModal) return null;

        return (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowDCEPiecesModal(false)}></div>
                <div className="relative bg-white rounded-3xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                    {/* Header */}
                    <div className="p-6 border-b border-[#0B1F38]/5 flex justify-between items-center bg-[#0B1F38]/2 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#00A3E0]/10 flex items-center justify-center text-[#00A3E0]">
                                <Files size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-[#0B1F38]">Pièces du Marché (DCE)</h3>
                                <p className="text-xs text-[#0B1F38]/50">Documents extraits du dossier de consultation</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* Accessible à tous les membres du dossier, pas seulement
                                au mandataire : les pièces du marché sont communes. */}
                            {(formData.dce_documents || []).length > 0 && (
                                <button
                                    onClick={telechargerToutLeDCE}
                                    disabled={zipDCEEnCours}
                                    className="px-3 py-2 text-xs font-bold text-[#0B1F38] hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50"
                                    title="Télécharger toutes les pièces du marché"
                                >
                                    {zipDCEEnCours
                                        ? <><Loader2 size={16} className="animate-spin" /> Préparation…</>
                                        : <><Download size={16} /> Tout télécharger</>}
                                </button>
                            )}
                            <button onClick={() => setShowDCEPiecesModal(false)} className="p-2 hover:bg-[#0B1F38]/5 rounded-xl transition-colors">
                                <X size={20} className="text-[#0B1F38]/40" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto custom-scrollbar-dark flex-1">
                        <div className="bg-[#0B1F38]/5 p-4 rounded-xl mb-6 flex flex-col gap-4">
                            <div className="flex items-start gap-3">
                                <Info size={16} className="text-[#00A3E0] mt-0.5" />
                                <p className="text-xs text-[#0B1F38]/70 leading-relaxed">
                                    Les documents suivants ont été identifiés dans le DCE. Vous pouvez les consulter individuellement ou en ajouter de nouveaux.
                                </p>
                            </div>

                            {/* Upload Area */}
                            {isOwner && !isLocked && (
                                <div className="relative">
                                    <input
                                        type="file"
                                        id="dce-upload"
                                        className="hidden"
                                        // L'interface annonçait « PDF / DOCX / XLSX / ZIP » alors que
                                        // l'input n'en filtrait aucun. `accept` ne protège rien — il
                                        // ne fait que présélectionner dans la boîte de dialogue — la
                                        // validation qui compte est celle de l'edge function.
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip"
                                        onChange={handleDCEFileUpload}
                                        disabled={isUploadingDCE}
                                    />
                                    <label
                                        htmlFor="dce-upload"
                                        className={`flex flex-col items-center justify-center p-6 border-2 border-dashed border-[#0B1F38]/10 rounded-2xl hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all cursor-pointer ${isUploadingDCE ? 'opacity-50 cursor-wait' : ''}`}
                                    >
                                        {isUploadingDCE ? (
                                            <Loader2 size={24} className="animate-spin text-[#00A3E0] mb-2" />
                                        ) : (
                                            <UploadCloud size={24} className="text-[#0B1F38]/20 mb-2" />
                                        )}
                                        <span className="text-xs font-bold text-[#0B1F38]">
                                            {isUploadingDCE ? 'Envoi en cours...' : 'Ajouter une pièce au DCE'}
                                        </span>
                                        <span className="text-[10px] text-[#0B1F38]/40 mt-1">PDF, ZIP, DOCX (Max 50Mo)</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            {formData.dce_documents && formData.dce_documents.length > 0 ? (
                                formData.dce_documents.map((doc: any, i: number) => (
                                    <div key={doc.id || i} className="flex justify-between items-center p-4 bg-[#F8FAFC] border border-[#0B1F38]/5 rounded-2xl hover:border-[#00A3E0]/30 hover:bg-white transition-all group">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="p-2.5 bg-white rounded-xl border border-[#0B1F38]/5 text-[#00A3E0] shrink-0">
                                                <FileText size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <span className="text-sm font-bold text-[#0B1F38] block truncate">{doc.name}</span>
                                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase">
                                                    {doc.type} &bull; {doc.size ? (doc.size / 1024 / 1024).toFixed(2) : '0'} Mo
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-4">
                                            {/* Consultation sans téléchargement : critère de recette
                                                explicite. Le fichier s'ouvre dans un onglet, où le
                                                navigateur affiche nativement les PDF et les images. */}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); ouvrirDocument(doc.path); }}
                                                className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all"
                                                title="Consulter"
                                            >
                                                <Eye size={16} />
                                            </button>
                                            {/* Download */}
                                            {/* Une URL publique ne résoudra plus rien une fois le
                                                bucket privé : l'URL signée est demandée au clic. */}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); telechargerDocument(doc.path, doc.name || 'document'); }}
                                                className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all"
                                                title="Télécharger"
                                            >
                                                <Download size={16} />
                                            </button>
                                            {/* Re-upload + Delete (owner only, unlocked) */}
                                            {isOwner && !isLocked && (
                                                <>
                                                    <label
                                                        htmlFor={`dce-replace-${doc.id}`}
                                                        className="p-2 text-[#0B1F38]/30 hover:text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded-lg transition-all cursor-pointer"
                                                        title="Remplacer le fichier"
                                                    >
                                                        <RefreshCw size={16} />
                                                    </label>
                                                    <input
                                                        type="file"
                                                        id={`dce-replace-${doc.id}`}
                                                        className="hidden"
                                                        onChange={(e) => handleDCEFileReplace(e, doc)}
                                                        disabled={isUploadingDCE}
                                                    />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDCEFileDelete(doc); }}
                                                        className="p-2 text-[#0B1F38]/20 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                        title="Supprimer"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-10 bg-[#F8FAFC] rounded-2xl border-2 border-dashed border-[#0B1F38]/5">
                                    <p className="text-sm text-[#0B1F38]/40 italic">Aucun document importé pour le moment.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-[#0B1F38]/5 bg-[#F8FAFC] flex justify-between items-center shrink-0">
                        <div className="text-xs text-[#0B1F38]/40 font-medium">
                            Total : {formData.dce_documents?.length || 0} fichier{formData.dce_documents?.length > 1 ? 's' : ''} ({(formData.dce_documents?.reduce((acc: number, d: any) => acc + (d.size || 0), 0) / 1024 / 1024).toFixed(2)} Mo)
                        </div>
                        <button
                            onClick={async () => {
                                if (!formData.dce_documents || formData.dce_documents.length === 0) return;
                                // Simplified download trigger or logic
                            }}
                            className="px-6 py-2.5 bg-[#0B1F38] text-white font-bold rounded-xl hover:bg-[#00A3E0] transition-all flex items-center gap-2"
                        >
                            <Download size={16} /> Tout télécharger (.zip)
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ==========================================
    //           MEMBER DETAIL MODAL
    // ==========================================
    const renderMemberDetailModal = () => {
        if (selectedMemberIndex === null) return null;
        const activeMembers = groupementMembers.filter(m => !m.deleted);
        const member = activeMembers[selectedMemberIndex];
        const isSelf = member.id === userProfile?.id;
        if (!isOwner && !isSelf) return null; // Security check

        const role = member.role || 'Co-traitant';
        const requiredDocs = REQUIRED_DOCS_BY_ROLE[role as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
        const collabId = member.id || selectedMemberIndex.toString();

        const uploadedCount = requiredDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length;
        const totalDocs = requiredDocs.length;
        const missingCount = totalDocs - uploadedCount;
        const memberPercent = totalDocs > 0 ? Math.round((uploadedCount / totalDocs) * 100) : 0;
        const isAllDone = memberPercent === 100 && totalDocs > 0;

        // Categorization logic
        const docCategories = {
            'A': ['dc1', 'dc2', 'dc4', 'dossier_administratif', 'kbis', 'rib', 'attestation_sociale', 'attestation_fiscale', 'attestation_assurance', 'attestation_honneur'],
            'T': ['memoire_technique', 'planning', 'cv', 'references', 'note_methodologique', 'certifications', 'moyens_techniques']
        };

        const adminDocs = requiredDocs.filter(d => docCategories['A'].includes(d.value) || !docCategories['T'].includes(d.value));
        const technicalDocs = requiredDocs.filter(d => docCategories['T'].includes(d.value));

        const renderFileRow = (docDef: any) => {
            const fileKey = `${docDef.value}-${collabId}`;
            const fileObj = uploadedFiles[fileKey];

            /**
             * Matrice de permissions : un co-traitant voit l'avancement et
             * l'intitulé des pièces des autres membres, sans pouvoir les
             * consulter, les télécharger ni en déposer à leur place. Seuls le
             * mandataire et le membre concerné y accèdent.
             *
             * La RLS l'impose déjà (migration 039b) : la policy de lecture ne
             * couvre que son propre dossier, sauf pour le créateur de l'AO.
             * Proposer le bouton ici revenait à annoncer une action qui
             * échouerait — l'interface doit dire la même chose que la base.
             */
            const peutConsulter = isSelf || isOwner;

            return (
                <div key={docDef.value} className="flex items-center justify-between p-3 bg-white rounded-xl border border-[#0B1F38]/5 group transition-all hover:shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${fileObj ? 'bg-green-100 text-green-600' : 'bg-red-50 text-red-500'}`}>
                            {fileObj ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        </div>
                        <span className="text-xs font-medium text-[#0B1F38]">{docDef.label}</span>
                    </div>

                    <div className="flex items-center gap-2">
                        {fileObj && member.email && peutConsulter && (
                            <button
                                onClick={() => handleDownloadFile(`${member.email?.toLowerCase().trim()}/${fileObj.name}`, `${docDef.label}.${fileObj.name.split('.').pop()}`)}
                                title="Consulter la pièce"
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-500 hover:bg-[#00A3E0] hover:text-white transition-all shadow-sm"
                            >
                                <Eye size={14} />
                            </button>
                        )}
                        {fileObj && !peutConsulter && (
                            /* L'avancement reste visible — c'est ce qui permet de
                               savoir si le dossier avance — mais pas le contenu. */
                            <span
                                title="Pièce déposée. Seuls le mandataire et son propriétaire peuvent la consulter."
                                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#0B1F38]/20"
                            >
                                <Lock size={14} />
                            </span>
                        )}

                        {isSelf && (
                            <div className="flex items-center gap-1.5">
                                <label className="cursor-pointer">
                                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all shadow-sm ${fileObj ? 'bg-white border border-gray-200 text-gray-500 hover:text-[#00A3E0] hover:border-[#00A3E0]' : 'bg-[#0B1F38] text-white hover:bg-[#00A3E0]'}`}>
                                        {fileObj ? 'Mettre à jour' : 'Importer'}
                                    </div>
                                    <input type="file" className="hidden" onChange={(e) => handleFileUpload(e, docDef.value, member)} />
                                </label>
                                {!isLocked && (
                                    <button
                                        onClick={() => {
                                            setTargetDocType(docDef.value);
                                            fetchCompanyDocuments();
                                            setShowCompanyDocPicker(true);
                                        }}
                                        className="p-1.5 text-[#0B1F38]/40 hover:text-[#00A3E0] transition-colors bg-gray-50 rounded-lg border border-transparent hover:border-[#00A3E0]/20"
                                        title="Choisir depuis l'entreprise"
                                    >
                                        <FolderOpen size={16} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/40 backdrop-blur-sm" onClick={() => setSelectedMemberIndex(null)}></div>
                <div className="relative bg-[#F4F6F9] rounded-[2.5rem] w-full max-w-5xl max-h-[90vh] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">

                    {/* Top Identity Bar - Improved Layout */}
                    <div className="bg-white p-8 border-b border-[#0B1F38]/5 shrink-0 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00A3E0]/5 rounded-full -translate-y-1/2 translate-x-1/2"></div>

                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                            <div className="flex items-start gap-6">
                                <div className="relative group">
                                    <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#00A3E0] to-[#26367F] flex items-center justify-center text-white font-bold text-4xl shadow-2xl shadow-[#00A3E0]/20 overflow-hidden ring-4 ring-white">
                                        {member.photo_url ? (
                                            <img src={member.photo_url} alt={member.name} className="w-full h-full object-cover" />
                                        ) : (
                                            (member.name || member.email || 'M').charAt(0).toUpperCase()
                                        )}
                                    </div>
                                    <div className={`absolute -bottom-2 -right-2 px-3 py-1 rounded-full text-[10px] font-black border-2 border-white shadow-lg ${isAllDone ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'}`}>
                                        {memberPercent}%
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <h2 className="text-3xl font-black text-[#0B1F38] tracking-tight mb-2">{member.name || member.email}</h2>

                                    <div className="flex flex-wrap items-center gap-2">
                                        {isOwner ? (
                                            <div className="relative">
                                                <select
                                                    value={member.role}
                                                    onChange={async (e) => {
                                                        const newRole = e.target.value;
                                                        const oldRole = member.role;
                                                        if (oldRole === newRole) return;

                                                        // Mandatory Mandataire check
                                                        if (oldRole === 'Mandataire' && newRole !== 'Mandataire') {
                                                            const currentActiveMembers = groupementMembers.filter(m => !m.deleted);
                                                            const otherActiveMembers = currentActiveMembers.filter(m => (m.id || m.email) !== (member.id || member.email));
                                                            const potentialSuccessors = otherActiveMembers.filter(m => m.status === 'accepte');

                                                            if (otherActiveMembers.length === 0) {
                                                                showToast("Impossible de changer le rôle : un groupement doit comporter au moins un Mandataire.", "warning");
                                                                return;
                                                            }

                                                            if (potentialSuccessors.length === 0) {
                                                                showToast("Action bloquée : Vous ne pouvez pas rétrograder le Mandataire tant qu'un autre membre n'a pas accepté l'invitation pour prendre le relais.", "warning");
                                                                return;
                                                            }

                                                            // Trigger in-app picker
                                                            const mIdx = groupementMembers.findIndex(m => (m.id || m.email) === (member.id || member.email));
                                                            setShowSuccessorPicker({ memberIdx: mIdx, newRole: newRole });
                                                            return;
                                                        }

                                                        // LEADERSHIP TRANSITION CHECKS
                                                        if (member.role === 'Mandataire' && newRole !== 'Mandataire') {
                                                            // The MANDATAIRE is trying to change their role. 
                                                            // They MUST pick a successor first.
                                                            const memberIdx = groupementMembers.findIndex(m => (m.id || m.email) === (member.id || member.email));
                                                            setShowSuccessorPicker({ memberIdx, newRole });
                                                            return;
                                                        }

                                                        if (newRole === 'Mandataire' && member.role !== 'Mandataire') {
                                                            // Someone ELSE is being promoted to Mandataire
                                                            if (member.status !== 'accepte') {
                                                                showToast("Seuls les membres ayant accepté peuvent devenir Mandataire", "warning");
                                                                return;
                                                            }
                                                            const targetIdx = groupementMembers.findIndex(m => (m.id || m.email) === (member.id || member.email));
                                                            setShowPromotionPicker({ targetMemberIdx: targetIdx });
                                                            return;
                                                        }

                                                        // Regular role change (Co-traitant <-> Sous-traitant etc.)
                                                        const memberIdx = groupementMembers.findIndex(m => (m.id || m.email) === (member.id || member.email));
                                                        const reqDocs = REQUIRED_DOCS_BY_ROLE[newRole as keyof typeof REQUIRED_DOCS_BY_ROLE] || [];
                                                        const doSave = async () => {
                                                            const updated = [...groupementMembers];
                                                            updated[memberIdx] = { ...updated[memberIdx], role: newRole as any };
                                                            setGroupementMembers(updated);
                                                            await saveCollaboratorsAndInvite(updated);
                                                            showToast(`Rôle mis à jour : ${newRole}`, 'success');
                                                        };
                                                        if (uploadedCount > 0 && reqDocs.length < requiredDocs.length) {
                                                            if (confirm(`Changer le rôle en "${newRole}" pourrait masquer certains documents déjà importés. Confirmer le changement ?`)) {
                                                                await doSave();
                                                            }
                                                        } else {
                                                            await doSave();
                                                        }
                                                    }}
                                                    className="bg-[#00A3E0]/10 text-[#00A3E0] text-[10px] font-black px-4 py-2 rounded-xl border-none focus:ring-2 focus:ring-[#00A3E0] cursor-pointer appearance-none pr-10 uppercase tracking-widest shadow-sm hover:bg-[#00A3E0]/20 transition-all font-sans"
                                                >
                                                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#00A3E0] pointer-events-none" />
                                            </div>
                                        ) : (
                                            <span className="bg-[#00A3E0] text-white text-[10px] font-black px-4 py-2 rounded-xl uppercase tracking-widest shadow-lg shadow-[#00A3E0]/20">{role}</span>
                                        )}
                                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-[#0B1F38]/50 text-[10px] font-bold rounded-xl border border-gray-100 italic">
                                            <Building2 size={12} />
                                            {member.company || 'Entreprise partenaire'}
                                        </div>
                                    </div>

                                    {/* Skills Scrollable Area */}
                                    {member.skills && member.skills.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mt-4 max-w-2xl max-h-[52px] overflow-y-auto p-2">
                                            {member.skills.map((skill, si) => (
                                                <span key={si} className="px-3 py-1 bg-white text-[#0B1F38]/60 text-[9px] font-bold rounded-lg uppercase tracking-wider border border-gray-100 shadow-sm hover:border-[#00A3E0]/30 transition-colors">
                                                    {skill}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-6 mt-4 md:mt-0 p-4 bg-gray-50/50 rounded-2xl border border-gray-100">
                                <div className="text-center">
                                    <p className="text-[9px] font-black text-[#0B1F38]/30 uppercase tracking-[0.2em] mb-1">PROGRÈS</p>
                                    <span className="text-2xl font-black text-[#0B1F38]">{uploadedCount}/{totalDocs}</span>
                                </div>
                                <div className="w-px h-10 bg-gray-200"></div>
                                {missingCount > 0 ? (
                                    <div className="text-center">
                                        <p className="text-[9px] font-black text-red-400 uppercase tracking-[0.2em] mb-1">À TRAITER</p>
                                        <span className="text-2xl font-black text-red-500">{missingCount}</span>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <CheckCircle size={32} className="text-green-500 mx-auto" />
                                        <p className="text-[8px] font-black text-green-500 uppercase mt-1">COMPLET</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Content Columns */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar-dark grid grid-cols-1 md:grid-cols-2 gap-8 bg-gray-50/50">
                        {/* Admin & Financier */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-[#0B1F38]/5 pb-3">
                                <h4 className="font-black text-[#0B1F38] text-sm tracking-widest uppercase">ADMINISTRATIF & FINANCIER</h4>
                                <span className="text-xs text-[#0B1F38]/40 font-bold">{adminDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length}/{adminDocs.length}</span>
                            </div>
                            <div className="space-y-2">
                                {adminDocs.map(doc => renderFileRow(doc))}
                                {adminDocs.length === 0 && <p className="text-xs italic text-gray-400">Aucun document administratif requis.</p>}
                            </div>
                        </div>

                        {/* Technique */}
                        <div className="space-y-6">
                            <div className="flex items-center justify-between border-b border-[#0B1F38]/5 pb-3">
                                <h4 className="font-black text-[#0B1F38] text-sm tracking-widest uppercase">TECHNIQUE</h4>
                                <span className="text-xs text-[#0B1F38]/40 font-bold">{technicalDocs.filter(d => !!uploadedFiles[`${d.value}-${collabId}`]).length}/{technicalDocs.length}</span>
                            </div>
                            <div className="space-y-2">
                                {technicalDocs.map(doc => renderFileRow(doc))}
                                {technicalDocs.length === 0 && <p className="text-xs italic text-gray-400">Aucun document technique requis.</p>}
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions (Owner only) */}
                    {isOwner && (
                        <div className="p-6 border-t border-[#0B1F38]/5 bg-white flex justify-between items-center shrink-0">
                            {!isSelf && !isLocked && member.status === GROUPEMENT_STATUSES.accepte ? (
                                <button
                                    onClick={() => handleRelancer(member)}
                                    className="flex items-center gap-2 px-6 py-3 border-2 border-[#0B1F38]/10 text-[#0B1F38]/60 hover:text-[#0B1F38] hover:border-[#0B1F38]/20 font-bold rounded-2xl transition-all text-sm"
                                >
                                    <Mail size={18} /> Relancer ce membre
                                </button>
                            ) : <div></div>}
                            <div className="flex items-center gap-4">
                                <button onClick={() => setSelectedMemberIndex(null)} className="px-6 py-3 font-bold text-gray-400 hover:text-gray-600 transition-colors text-sm">Fermer</button>
                                {/* Même règle que pièce par pièce : un co-traitant ne
                                    récupère pas l'archive des pièces d'un autre membre. */}
                                {(isSelf || isOwner) && (
                                    <button
                                        onClick={() => handleDownloadAllFiles(member)}
                                        className="px-8 py-3 bg-[#0B1F38] hover:bg-[#1B2533] text-white font-bold rounded-2xl shadow-xl shadow-[#0B1F38]/20 transition-all active:scale-[0.98] text-sm flex items-center gap-2"
                                    >
                                        <Download size={18} /> Télécharger tout (.zip)
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ==========================================
    //        ADD MANUAL PARTNER MODAL
    // ==========================================
    const renderAddManualModal = () => {
        if (!showAddManualModal) return null;
        return (
            <AddManualPartnerModal
                onClose={() => setShowAddManualModal(false)}
                onAdd={addCollaborator}
                requiredSkills={REQUIRED_SKILLS}
            />
        );
    };

    const renderGroupementTypeModal = () => {
        if (!showGroupementTypeModal) return null;

        return (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowGroupementTypeModal(false)}></div>
                <div className="relative bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">

                    <div className="p-8 text-center pb-4">
                        <div className="w-16 h-16 bg-[#00A3E0]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#00A3E0]">
                            <Users size={32} />
                        </div>
                        <h2 className="text-2xl font-bold text-[#0B1F38]">Type de groupement</h2>
                        <p className="text-[#0B1F38]/60 mt-2 max-w-md mx-auto">
                            Cette information est obligatoire pour la constitution du dossier et ne pourra pas être modifiée ultérieurement.
                        </p>
                    </div>

                    <div className="p-8 pt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            onClick={() => {
                                setShowGroupementTypeModal(false);
                                handleGoToVerification('conjoint');
                            }}
                            className="group p-6 rounded-2xl border-2 border-[#0B1F38]/10 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all text-left flex flex-col gap-3 relative overflow-hidden"
                        >
                            <div className="absolute top-4 right-4 text-[#00A3E0] opacity-0 group-hover:opacity-100 transition-opacity">
                                <CheckCircle size={24} />
                            </div>
                            <div className="bg-white w-10 h-10 rounded-xl shadow-sm flex items-center justify-center text-[#0B1F38]">
                                <Briefcase size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-[#0B1F38] text-lg">Groupement Conjoint</h3>
                                <p className="text-xs text-[#0B1F38]/60 mt-1 leading-relaxed">
                                    Chaque membre du groupement s'engage à exécuter uniquement les prestations qui lui sont attribuées.
                                </p>
                            </div>
                        </button>

                        <button
                            onClick={() => {
                                setShowGroupementTypeModal(false);
                                handleGoToVerification('solidaire');
                            }}
                            className="group p-6 rounded-2xl border-2 border-[#0B1F38]/10 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all text-left flex flex-col gap-3 relative overflow-hidden"
                        >
                            <div className="absolute top-4 right-4 text-[#00A3E0] opacity-0 group-hover:opacity-100 transition-opacity">
                                <CheckCircle size={24} />
                            </div>
                            <div className="bg-white w-10 h-10 rounded-xl shadow-sm flex items-center justify-center text-[#0B1F38]">
                                <Users size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-[#0B1F38] text-lg">Groupement Solidaire</h3>
                                <p className="text-xs text-[#0B1F38]/60 mt-1 leading-relaxed">
                                    Chaque membre est engagé financièrement et techniquement pour la totalité du marché.
                                </p>
                            </div>
                        </button>
                    </div>

                    <div className="p-6 bg-[#F8FAFC] flex justify-center border-t border-[#0B1F38]/5">
                        <button onClick={() => setShowGroupementTypeModal(false)} className="text-[#0B1F38]/50 text-sm font-bold hover:text-[#0B1F38] transition-colors">
                            Annuler
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderRemoveConfirmModal = () => {
        if (!showRemoveConfirm) return null;
        const isQuit = showRemoveConfirm.name === 'Quitter le groupement';

        return (
            <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/40 backdrop-blur-sm" onClick={() => setShowRemoveConfirm(null)}></div>
                <div className="relative bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
                    <div className="p-6 text-center">
                        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                            <AlertCircle size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-[#0B1F38] mb-2">
                            {isQuit ? 'Quitter le groupement ?' : 'Retirer ce membre ?'}
                        </h3>
                        <p className="text-sm text-[#0B1F38]/60 leading-relaxed">
                            {isQuit
                                ? 'Êtes-vous sûr de vouloir quitter ce groupement ? le mandataire sera immédiatement notifié.'
                                : `Voulez-vous vraiment retirer ${showRemoveConfirm.name} du groupement ? Cette action est irréversible.`
                            }
                        </p>
                    </div>
                    <div className="flex border-t border-[#0B1F38]/5">
                        <button
                            onClick={() => setShowRemoveConfirm(null)}
                            className="flex-1 py-4 text-sm font-bold text-[#0B1F38]/40 hover:bg-gray-50 transition-colors border-r border-[#0B1F38]/5"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={() => {
                                if (isQuit) handleQuitGroupement();
                                else removeCollaborator(showRemoveConfirm.index);
                                setShowRemoveConfirm(null);
                            }}
                            className="flex-1 py-4 text-sm font-bold text-red-500 hover:bg-red-50 transition-colors"
                        >
                            {isQuit ? 'Quitter' : 'Retirer'}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderPromotionPicker = () => {
        if (!showPromotionPicker) return null;
        const target = groupementMembers[showPromotionPicker.targetMemberIdx];
        // Find the CURRENT Mandataire (they are the one being demoted)
        const currentMandataire = groupementMembers.find(m => m.role === 'Mandataire' && !m.deleted);
        const ownerIdx = groupementMembers.findIndex(m => m.role === 'Mandataire' && !m.deleted);

        const handlePromote = async (ownerNewRole: string) => {
            const updated = [...groupementMembers];
            // 1. Promote target
            updated[showPromotionPicker.targetMemberIdx] = { ...target, role: 'Mandataire' };
            // 2. Retrograde owner
            if (ownerIdx !== -1) {
                updated[ownerIdx] = { ...updated[ownerIdx], role: ownerNewRole as any };
            }
            setGroupementMembers(updated);
            setShowPromotionPicker(null);
            await saveCollaboratorsAndInvite(updated);
            showToast(`${target.name || target.email} est désormais le Mandataire.`, 'success');
        };

        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowPromotionPicker(null)}></div>
                <div className="relative bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl flex flex-col p-8 animate-in zoom-in-95 duration-200 text-center">
                    <div className="w-16 h-16 bg-[#00A3E0]/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-[#00A3E0]">
                        <Crown size={32} />
                    </div>
                    <h3 className="text-2xl font-black text-[#0B1F38] tracking-tight">Promouvoir un Mandataire</h3>
                    <p className="text-sm text-[#0B1F38]/50 mt-2 mb-8">
                        Vous avez choisi de nommer <strong>{target.name || target.email}</strong> comme nouveau Mandataire.
                        {currentMandataire && currentMandataire !== target && (
                            <> Quel doit être le nouveau rôle de <strong>{currentMandataire.name || currentMandataire.email}</strong> ? </>
                        )}
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => handlePromote('Co-traitant')}
                            className="p-6 rounded-2xl border-2 border-gray-100 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all group"
                        >
                            <div className="font-black text-[#0B1F38] group-hover:text-[#00A3E0] transition-colors">Co-traitant</div>
                            <div className="text-[10px] text-[#0B1F38]/40 uppercase mt-1">Soutien solidaire</div>
                        </button>
                        <button
                            onClick={() => handlePromote('Sous-traitant')}
                            className="p-6 rounded-2xl border-2 border-gray-100 hover:border-[#003B71] hover:bg-[#003B71]/5 transition-all group"
                        >
                            <div className="font-black text-[#0B1F38] group-hover:text-[#003B71] transition-colors">Sous-traitant</div>
                            <div className="text-[10px] text-[#0B1F38]/40 uppercase mt-1">Exécution technique</div>
                        </button>
                    </div>

                    <button
                        onClick={() => setShowPromotionPicker(null)}
                        className="mt-6 text-[#0B1F38]/30 hover:text-[#0B1F38] text-sm font-bold transition-colors"
                    >
                        Annuler
                    </button>
                </div>
            </div>
        );
    };

    const renderSuccessorPicker = () => {
        if (!showSuccessorPicker) return null;

        const { memberIdx, newRole } = showSuccessorPicker;
        const currentActive = groupementMembers.filter(m => !m.deleted);
        const me = groupementMembers[memberIdx];
        const potentialSuccessors = currentActive.filter(m => m.status === 'accepte' && (m.id || m.email) !== (me.id || me.email));

        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-md" onClick={() => setShowSuccessorPicker(null)}></div>
                <div className="relative bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl flex flex-col p-8 animate-in zoom-in-95 duration-200">
                    <div className="text-center mb-8">
                        <div className="w-16 h-16 bg-yellow-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-yellow-600">
                            <Crown size={32} />
                        </div>
                        <h3 className="text-2xl font-black text-[#0B1F38] tracking-tight">Désigner un successeur</h3>
                        <p className="text-sm text-[#0B1F38]/50 mt-2">
                            Le rôle de Mandataire est obligatoire. Veuillez choisir un collaborateur parmi ceux ayant déjà accepté l'invitation pour prendre le relais.
                        </p>
                    </div>

                    <div className="space-y-3 max-h-[40vh] overflow-y-auto px-1">
                        {potentialSuccessors.map((succ) => (
                            <button
                                key={succ.id || succ.email}
                                onClick={async () => {
                                    // Build the updated array directly (same pattern as promotion picker)
                                    // This avoids the React state race condition where updateCollaborator()
                                    // is async and saveCollaboratorsAndInvite() would read stale state.
                                    const succIdx = groupementMembers.findIndex(m => (m.id || m.email) === (succ.id || succ.email));
                                    const currentIdx = groupementMembers.findIndex(m => (m.id || m.email) === (me.id || me.email));
                                    const updated = [...groupementMembers];
                                    updated[succIdx] = { ...updated[succIdx], role: 'Mandataire' };
                                    updated[currentIdx] = { ...updated[currentIdx], role: newRole as any };
                                    setGroupementMembers(updated);
                                    setShowSuccessorPicker(null);
                                    await saveCollaboratorsAndInvite(updated);
                                    showToast(`${succ.name || succ.email} est désormais le Mandataire.`, 'success');
                                }}
                                className="w-full flex items-center gap-4 p-4 rounded-2xl border border-gray-100 hover:border-[#00A3E0] hover:bg-[#00A3E0]/5 transition-all group text-left"
                            >
                                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[#0B1F38] font-bold group-hover:bg-[#00A3E0] group-hover:text-white transition-colors overflow-hidden">
                                    {succ.photo_url ? (
                                        <img src={succ.photo_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        (succ.name || succ.email || 'M').charAt(0).toUpperCase()
                                    )}
                                </div>
                                <div>
                                    <p className="font-bold text-[#0B1F38]">{succ.name || succ.email}</p>
                                    <p className="text-[10px] text-[#0B1F38]/40 uppercase font-black tracking-widest">{succ.company || 'Entreprise'}</p>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="mt-8 flex gap-3">
                        <button
                            onClick={() => setShowSuccessorPicker(null)}
                            className="flex-1 px-6 py-3 border border-gray-200 rounded-2xl font-bold text-[#0B1F38]/50 hover:bg-gray-50 transition-all"
                        >
                            Annuler
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const executeOutcome = async (outcome: 'won' | 'lost') => {
        if (refuserSiNonMandataire("changer l'issue du dossier")) return;
        if (!tenderId) return;
        setLoading(true);
        try {
            const newStatus = outcome === 'won' ? STATUSES.won : STATUSES.lost;
            const { error } = await supabase
                .from('reponses_ao')
                .update({ statut: newStatus })
                .eq('id', tenderId);

            // 1. Update form data locally
            setFormData(prev => ({ ...prev, statut: newStatus }));
            showToast(outcome === 'won' ? "Félicitations pour cette victoire !" : "Statut mis à jour.", 'success');
            setShowOutcomeModal(null);
            if (onTenderUpdate) onTenderUpdate();

            // 2. Notifications to team members (only those with an account/ID)
            const teamIds = groupementMembers
                .filter(m => m.status === GROUPEMENT_STATUSES.accepte && m.id)
                .map(m => m.id as string);

            // Include Mandataire
            if (formData.createur_id) teamIds.push(formData.createur_id);

            // Ensure distinct
            const uniqueRecipients = Array.from(new Set(teamIds));

            for (const recipientId of uniqueRecipients) {
                if (outcome === 'won') {
                    await notifyTenderWon(recipientId as string, tenderId, formData.titre, formData.montant_estime || 0);
                } else {
                    await notifyTenderLost(recipientId as string, tenderId, formData.titre);
                }
            }
        } catch (error) {
            console.error("Error updating outcome:", error);
            showToast("Erreur lors de la mise à jour.", 'error');
        } finally {
            setLoading(false);
        }
    };

    const OutcomeConfirmationModal = () => {
        if (!showOutcomeModal) return null;
        const isWon = showOutcomeModal === 'won';
        return (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-[#0B1F38]/60 backdrop-blur-sm" onClick={() => setShowOutcomeModal(null)}></div>
                <div className="relative bg-white rounded-[2rem] p-10 max-w-md w-full text-center shadow-2xl animate-in zoom-in-95 duration-200">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${isWon ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {isWon ? <Trophy size={40} /> : <Frown size={40} />}
                    </div>
                    <h2 className="text-2xl font-bold text-[#0B1F38] mb-4">
                        {isWon ? "Félicitations !" : "Résultat du marché"}
                    </h2>
                    <p className="text-[#0B1F38]/60 mb-8 font-medium">
                        {isWon
                            ? "Confirmez-vous que vous avez remporté ce marché ?"
                            : "Confirmez-vous que ce marché est perdu ?"}
                    </p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setShowOutcomeModal(null)}
                            className="flex-1 py-3 px-4 border border-[#0B1F38]/10 rounded-xl font-bold text-[#0B1F38] hover:bg-gray-50 transition-all"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={() => executeOutcome(showOutcomeModal)}
                            className={`flex-1 py-3 px-4 rounded-xl font-bold text-white transition-all shadow-lg ${isWon ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
                        >
                            Confirmer
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ==========================================
    //               MAIN RENDER
    // ==========================================
    if (isInitializing) {
        return (
            <div className="w-full p-4 mx-auto h-full flex flex-col gap-6">
                <div className={`flex-1 ${GLASS_MODAL_STYLE} flex items-center justify-center overflow-hidden w-full h-full`}>
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="animate-spin text-[#00A3E0]" size={48} />
                        <p className="text-[#0B1F38]/60 font-medium animate-pulse">Chargement du dossier...</p>
                    </div>
                </div>
            </div>

        );
    }

    return (
        <div className="w-full p-4 mx-auto h-full flex flex-col gap-6">
            <div className={`flex-1 ${GLASS_MODAL_STYLE} flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 w-full mx-auto h-full relative`}>
                {loading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                        <Loader2 className="animate-spin text-[#0B1F38]" size={48} />
                    </div>
                )}
                {/* Top Bar / Header Logic - Only show on Start/Search */}
                {currentView === 'start' || currentView === 'results' ? (
                    <div className="p-6 border-b border-white/30 flex justify-between items-center bg-white/40 backdrop-blur-sm">
                        <div>
                            <h1 className="text-3xl font-bold text-[#00A3E0]">Nouveau dossier de réponse</h1>
                            <p className="text-sm text-[#0B1F38]/60 mt-1">Chercher, retrouver ou identifier votre prochain appel d'offres</p>
                        </div>
                        <button onClick={() => (initialTenderId || tenderId) ? onCancel() : setShowExitConfirm(true)} className="p-2 text-[#0B1F38]/50 hover:text-[#0B1F38] hover:bg-white/50 rounded-xl transition-all">
                            <X size={24} />
                        </button>
                    </div>
                ) : currentView === 'verification' ? (
                    <div className="p-6 flex justify-between items-start">
                        <div className="flex items-center gap-4">
                            <div>
                                <h1 className="text-2xl font-bold text-[#0B1F38]">{formData.titre}</h1>
                                <p className="text-sm text-[#0B1F38]/60 mt-1 flex items-center gap-2">
                                    <Building size={14} /> {formData.organisme_acheteur} <span className="w-1 h-1 rounded-full bg-[#0B1F38]/30"></span>
                                    <MapPin size={14} />
                                    {formData.lieu_execution.length > 0 ? (
                                        <>
                                            {DEPARTEMENTS_OBJ[String(formData.lieu_execution[0]).replace(/^0+/, '')] || formData.lieu_execution[1] || formData.lieu_execution[0]}
                                        </>
                                    ) : 'Lieu non spécifié'}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <span className="px-3 py-1.5 bg-[#00A3E0]/10 text-[#00A3E0] text-sm font-bold rounded-lg border border-[#00A3E0]/20">Rédaction</span>
                            <button onClick={() => setCurrentView('start')} className="flex items-center gap-2 px-4 py-2 bg-white text-red-500 font-bold text-sm rounded-xl shadow-sm hover:bg-red-50 transition-all border border-red-100">
                                <Trash2 size={16} /> Abandonner
                            </button>
                        </div>
                    </div>) : currentView === 'team' ? (
                        <div className="p-6 flex justify-between items-center">
                            <div className="flex items-center gap-4">
                                <button onClick={() => setCurrentView('verification')} className="p-2 bg-white hover:bg-[#00A3E0] hover:text-white rounded-xl transition-all text-[#0B1F38]/60 shadow-sm">
                                    <ArrowLeft size={20} />
                                </button>
                                <div>
                                    <h1 className="text-2xl font-bold text-[#0B1F38]">Renseignements de l'équipe</h1>
                                    <p className="text-sm text-[#0B1F38]/60 mt-1">Complétez les documents administratifs pour chaque membre.</p>
                                </div>
                            </div>

                        </div>) : null}

                {/* View Switcher */}
                <div className="flex-1 overflow-y-auto custom-scrollbar-dark relative">
                    {currentView === 'start' && (
                        <div className="p-8 pb-32">
                            <div className="w-full max-w-[1600px] grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch h-full mx-auto">
                                {/* SEARCH CARD */}
                                <div className="bg-white/60 border border-white/60 rounded-3xl p-8 flex flex-col shadow-xl group relative overflow-hidden h-full">
                                    <div className="absolute top-0 right-0 bg-[#00A3E0] text-white text-xs font-bold px-3 py-1 rounded-bl-xl shadow-sm z-10">Recommandé</div>
                                    <div className="flex items-center gap-4 mb-6">
                                        <div className="w-12 h-12 rounded-2xl bg-[#00A3E0]/10 flex items-center justify-center shrink-0">
                                            <Globe size={24} className="text-[#00A3E0]" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-bold text-[#0B1F38]">Trouver un marché</h3>
                                            <p className="text-sm text-[#0B1F38]/60">Recherche sur les plateformes (BOAMP, JOUE...)</p>
                                        </div>
                                    </div>
                                    <div className="space-y-4 flex-1">
                                        <div>
                                            <label className={labelStyle}>Mots-clés</label>
                                            <div className="relative">
                                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40" />
                                                <input value={searchKeywords} onChange={(e) => setSearchKeywords(e.target.value)} type="text" placeholder="Ex: Maîtrise d'oeuvre..." className={inputGlass} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelStyle}>Type de marché</label>
                                                <div className="relative">
                                                    <Briefcase size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                                    <select value={searchMarketType} onChange={(e) => setSearchMarketType(e.target.value)} className={`${inputGlass} appearance-none`}>
                                                        <option value="">Tous les types</option>
                                                        {MARKET_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                                    </select>
                                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className={labelStyle}>Procédure</label>
                                                <div className="relative">
                                                    <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                                    <select value={searchHandoverType} onChange={(e) => setSearchHandoverType(e.target.value)} className={`${inputGlass} appearance-none`}>
                                                        <option value="">Toutes les procédures</option>
                                                        {HANDOVER_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                                    </select>
                                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelStyle}>Localisation</label>
                                                <div className="relative">
                                                    <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                                    <select value={searchLocation} onChange={(e) => setSearchLocation(e.target.value)} className={`${inputGlass} appearance-none`}>
                                                        <option value="">Sélectionner</option>
                                                        {DEPARTEMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                                                    </select>
                                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40 pointer-events-none" />
                                                </div>
                                            </div>
                                            <div>
                                                <label className={labelStyle}>Date limite</label>
                                                <div className="relative">
                                                    <CalendarIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40" />
                                                    <input type="date" value={searchDeadline} onChange={(e) => setSearchDeadline(e.target.value)} className={inputGlass} />
                                                </div>
                                            </div>
                                        </div>
                                        <button onClick={() => handleSearch(false)} disabled={searchLoading} className="w-full py-3.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 mt-4">
                                            {searchLoading ? <Loader2 className="animate-spin" /> : <><Search size={18} /> Rechercher les avis</>}
                                        </button>
                                    </div>
                                </div>
                                {/* IMPORT & MANUAL */}
                                <div className="flex flex-col gap-6">
                                    <div className="bg-white/40 border border-white/50 rounded-3xl p-8 flex flex-col hover:bg-white/60 transition-all group flex-1">
                                        <div className="flex items-center gap-4 mb-6">
                                            <div className="w-12 h-12 rounded-2xl bg-[#0B1F38]/5 flex items-center justify-center shrink-0 group-hover:bg-[#00A3E0]/10 transition-colors">
                                                <UploadCloud size={24} className="text-[#0B1F38]/60 group-hover:text-[#00A3E0]" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-[#0B1F38]">Importer un dossier</h3>
                                                <p className="text-sm text-[#0B1F38]/60">Depuis un fichier DCE ou un lien direct</p>
                                            </div>
                                        </div>
                                        <div className="border-2 border-dashed border-[#0B1F38]/10 group-hover:border-[#00A3E0]/30 rounded-xl p-6 bg-white/30 hover:bg-white/60 transition-all cursor-pointer text-center h-32 flex flex-col items-center justify-center">
                                            <div className="flex flex-col items-center gap-2 text-[#0B1F38]/50 group-hover:text-[#00A3E0]">
                                                <FileInput size={24} />
                                                <span className="font-medium text-sm">Glisser-déposer un fichier (PDF, Zip)</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div onClick={() => setCurrentView('manual')} className="bg-white/30 border border-white/40 rounded-3xl p-6 flex items-center justify-between hover:bg-white/50 transition-all cursor-pointer group h-24">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-[#0B1F38]/5 flex items-center justify-center">
                                                <PenTool size={20} className="text-[#0B1F38]/60" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-[#0B1F38]">Saisie Manuelle</h3>
                                                <p className="text-xs text-[#0B1F38]/60">Remplir les informations soi-même</p>
                                            </div>
                                        </div>
                                        <ChevronDown size={20} className="-rotate-90 text-[#0B1F38]/40 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentView === 'results' && (
                        <div className="p-8 flex flex-col gap-6 w-full max-w-[1600px] mx-auto">
                            <div className="flex items-center gap-4">
                                <button onClick={() => setCurrentView('start')} className="p-2 bg-white/50 hover:bg-white rounded-xl transition-all text-[#0B1F38]/60 hover:text-[#00A3E0]">
                                    <ArrowLeft size={24} />
                                </button>
                                <div>
                                    <h2 className="text-2xl font-bold text-[#0B1F38]">Résultats de la recherche</h2>
                                    <p className="text-sm text-[#0B1F38]/60">{searchResults.length} avis correspondants trouvés</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                {searchResults.map((result, idx) => (
                                    <div key={idx} className="bg-white/60 hover:bg-white/90 border border-white/60 rounded-2xl p-6 transition-all group flex flex-col md:flex-row gap-6 items-start md:items-center relative overflow-hidden">
                                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#00A3E0] opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex gap-2 mb-2">
                                                <span className="px-2 py-0.5 rounded-md bg-[#00A3E0]/10 text-[#00A3E0] text-[10px] font-bold uppercase tracking-wide border border-[#00A3E0]/10">
                                                    {result.type_procedure || "Marché"}
                                                </span>
                                                {result.type_marche && (
                                                    <span className="px-2 py-0.5 rounded-md bg-[#0B1F38]/10 text-[#0B1F38] text-[10px] font-bold uppercase tracking-wide border border-[#0B1F38]/10">
                                                        {Array.isArray(result.type_marche) ? result.type_marche.join(", ") : result.type_marche}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="text-lg font-bold text-[#0B1F38] mb-1 group-hover:text-[#00A3E0] transition-colors">{result.objet}</h3>
                                            <div className="flex flex-wrap gap-4 text-sm text-[#0B1F38]/70">
                                                <div className="flex items-center gap-1.5"><Building size={14} className="text-[#0B1F38]/40" /><span className="font-medium">{result.nomacheteur}</span></div>
                                                <div className="flex items-center gap-1.5"><MapPin size={14} className="text-[#0B1F38]/40" /><span>{DEPARTEMENTS_OBJ[String(result.code_departement).padStart(2, '0')] || result.code_departement} ({result.code_departement})</span></div>
                                            </div>
                                        </div>
                                        <div className="flex flex-row md:flex-col items-center md:items-end gap-4 min-w-[180px]">
                                            <div className="text-right">
                                                <span className="text-[10px] font-bold text-[#0B1F38]/40 uppercase block mb-0.5">Date limite</span>
                                                <span className="text-sm font-bold text-[#FF8D6D] bg-[#FF8D6D]/10 px-2 py-1 rounded-lg border border-[#FF8D6D]/20 flex items-center gap-1.5">
                                                    <CalendarIcon size={14} /> {new Date(result.datelimitereponse).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <button onClick={() => selectTenderFromSearch(result)} className="px-5 py-2.5 bg-[#0B1F38] text-white font-bold rounded-xl shadow-lg hover:bg-[#00A3E0] transition-all transform active:scale-95 text-sm w-full md:w-auto">
                                                Sélectionner
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {hasMoreResults && (
                                <div className="flex justify-center mt-6">
                                    <button
                                        onClick={() => handleSearch(true)}
                                        disabled={searchLoading}
                                        className="px-6 py-3 bg-white/60 border border-white/60 text-[#0B1F38] font-bold rounded-xl shadow-sm hover:bg-white/80 transition-all flex items-center justify-center gap-2"
                                    >
                                        {searchLoading ? <Loader2 className="animate-spin" size={18} /> : <span>Afficher plus de résultats</span>}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {currentView === 'decision' && renderDecisionView()}
                    {currentView === 'manual' && renderManualView()}
                    {currentView === 'wizard_steps' && (
                        <TenderCreationWizard
                            formData={formData}
                            setFormData={setFormData}
                            onComplete={(groupementType, selectedRole) => {
                                // Map wizard roles to UI roles
                                const roleMap: Record<string, string> = {
                                    'mandataire': 'Mandataire',
                                    'cotraitant': 'Co-traitant',
                                    'soustraitant': 'Sous-traitant'
                                };
                                const role = selectedRole ? roleMap[selectedRole] : 'Mandataire';

                                // Update members for the current user
                                const updatedMembers = groupementMembers.map((m, i) =>
                                    i === 0 ? { ...m, role: role as any } : m
                                );
                                setGroupementMembers(updatedMembers);

                                handleGoToVerification(groupementType, updatedMembers);
                                setCurrentView('decision');
                            }}
                            onCancel={() => setCurrentView(previousView || 'start')}
                            userProfile={userProfile}
                        />
                    )}
                </div>
                {/* Decision Footer - REMOVED (Embedded in View) */}

                {/* Modals */}
                {showCollabPicker && (
                    <CollaboratorPicker
                        currentMembers={groupementMembers}
                        knownCollaborators={existingCollaborators}
                        onUpdateMembers={(members) => {
                            setGroupementMembers(members);
                            if (tenderId) {
                                saveCollaboratorsAndInvite(members);
                            }
                        }}
                        onClose={() => setShowCollabPicker(false)}
                    />
                )}
                {renderSkillsModal()}
                {renderDocDetailsModal()}
                {renderMemberDetailModal()}
                {renderGroupementTypeModal()}
                {renderAddManualModal()}
                {renderContextEditModal()}
                {renderCriteresModal()}
                {renderRetroplanningModal()}
                {renderDCEPiecesModal()}
                {renderCompanyDocPicker()}
                {renderFinalizeConfirmModal()}
                {renderSuccessorPicker()}
                {renderPromotionPicker()}
                {renderRemoveConfirmModal()}

                {/* Exit Confirmation Modal */}
                {showExitConfirm && (
                    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-[#0B1F38]/40 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-300 overflow-hidden">
                            <div className="p-6">
                                <div className="flex items-center gap-4 mb-4">
                                    <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0">
                                        <XCircle size={24} className="text-amber-500" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-[#0B1F38]">Quitter la création ?</h3>
                                        <p className="text-sm text-[#0B1F38]/60 mt-0.5">Votre progression ne sera pas sauvegardée.</p>
                                    </div>
                                </div>
                                <p className="text-sm text-[#0B1F38]/70 leading-relaxed bg-amber-50 rounded-xl p-4 border border-amber-100">
                                    Si vous quittez maintenant, vous devrez recommencer la création de votre dossier depuis le début.
                                </p>
                            </div>
                            <div className="px-6 pb-6 flex gap-3 justify-end">
                                <button
                                    onClick={() => setShowExitConfirm(false)}
                                    className="px-5 py-2.5 text-sm font-bold text-[#0B1F38]/70 hover:text-[#0B1F38] bg-gray-100 hover:bg-gray-200 rounded-xl transition-all"
                                >
                                    Continuer
                                </button>
                                <button
                                    onClick={() => { setShowExitConfirm(false); onCancel(); }}
                                    className="px-5 py-2.5 text-sm font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all shadow-sm"
                                >
                                    Quitter
                                </button>
                            </div>
                        </div>
                    </div>
                )}



                <LimitReachedModal
                    isOpen={showStorageLimitModal}
                    onClose={() => setShowStorageLimitModal(false)}
                    onUpgrade={() => {
                        setShowStorageLimitModal(false);
                        if (onNavigate) {
                            onCancel();
                            onNavigate('pricing');
                        }
                    }}
                    limitType="storage"
                    planLabel={PLANS_CONFIG[(userProfile?.plan as PlanType) || PLANS_TYPES.free]?.label || 'Gratuit'}
                />

                {renderRemoveConfirmModal()}
                {renderDeleteTenderModal()}
                {renderSuccessorPicker()}
                {OutcomeConfirmationModal()}

                {showChatDrawer && tenderId && (
                    <ChatDrawer
                        isOpen={showChatDrawer}
                        onClose={() => {
                            setShowChatDrawer(false);
                            setIsSidebarCollapsed?.(false);
                        }}
                        tenderId={tenderId}
                        tenderTitle={formData.titre}
                    />
                )}
            </div>
        </div>
    );
};