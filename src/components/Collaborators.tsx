import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    Search,
    Filter,
    Plus,
    UserPlus,
    MoreVertical,
    MessageSquare,
    Briefcase,
    MapPin,
    ShieldCheck,
    Star,
    Eye,
    XCircle as ClearIcon,
    ChevronDown,
    Users,
    Network as NetworkIcon,
    ArrowLeft,
    Mail,
    Building2,
    FileText,
    Download,
    CheckCircle,
    AlertTriangle,
    LayoutGrid,
    Trash2,
    Globe,
    Loader2 as LoaderIcon
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { STATUSES } from '@/config';
import { Entreprise } from '@/types';
import { useToast } from './ui/Toast';
import { InviteCompanyModal } from './network/InviteCompanyModal';
import { notifyNetworkInviteAccepted } from '../helpers/notificationHelpers';

// --- INTERFACES ---

interface NetworkCompany extends Entreprise {
    // UI Specific
    relationStatus?: 'actif' | 'bloque' | 'en_attente';
    tenders?: Array<{ id: string; titre: string; statut?: string; created_at?: string }>;
    average_rating?: number;
    rating_count?: number;
}

interface PendingNetworkInvite {
    reseauId: string;
    company: Entreprise;
    senderCompanyId: string;
}

interface CollaboratorsProps {
    onNavigate: (tenderId: string) => void;
}

// --- DOCUMENT CONSTANTS ---
// Using documents_entreprise table structure from types
const DOCUMENT_TYPES = [
    { value: 'kbis', label: 'Kbis' },
    { value: 'assurance', label: 'Attestation Assurance' },
    { value: 'fiscale', label: 'Attestation Fiscale' },
    { value: 'sociale', label: 'Attestation Sociale' }
];

// --- STYLES CONSTANTS ---
import { GLASS_STYLE } from '../lib/styles';


const Collaborators: React.FC<CollaboratorsProps> = ({ onNavigate }) => {
    const { showToast } = useToast();
    // --- STATE: DATA ---
    const [myNetwork, setMyNetwork] = useState<NetworkCompany[]>([]);
    const [filaoNetwork, setFilaoNetwork] = useState<NetworkCompany[]>([]);
    const [pendingInvites, setPendingInvites] = useState<PendingNetworkInvite[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

    // --- STATE: UI & FILTERS ---
    const [activeTab, setActiveTab] = useState<'network' | 'filao'>('network');
    const [searchQuery, setSearchQuery] = useState('');
    const [showFilters, setShowFilters] = useState(true);

    // Specific Filters
    const [filterRegion, setFilterRegion] = useState('');
    const [filterSpecialty, setFilterSpecialty] = useState('');
    const [filterExpertiseTag, setFilterExpertiseTag] = useState('');
    const [filterForme, setFilterForme] = useState('');
    const [filterRating, setFilterRating] = useState<'' | '4' | '3' | '2' | '1'>('');
    
    // Taxonomy Filters
    const [filterNature, setFilterNature] = useState('');
    const [filterDomain, setFilterDomain] = useState('');
    const [refDomains, setRefDomains] = useState<any[]>([]);
    const [refSpecialties, setRefSpecialties] = useState<any[]>([]);
    const [refGeoZones, setRefGeoZones] = useState<any[]>([]);
    const [refExpertiseTags, setRefExpertiseTags] = useState<any[]>([]);
    const [loadingRef, setLoadingRef] = useState(true);

    // --- STATE: INVITE TO TENDER MODAL ---
    const [inviteTargetCompany, setInviteTargetCompany] = useState<NetworkCompany | null>(null);
    const [activeTenders, setActiveTenders] = useState<Array<{ id: string; titre: string; statut: string }>>([]);
    const [loadingTenders, setLoadingTenders] = useState(false);
    const [selectedTenderId, setSelectedTenderId] = useState('');
    const [selectedRole, setSelectedRole] = useState<'Co-traitant' | 'Sous-traitant'>('Co-traitant');
    const [inviting, setInviting] = useState(false);

    // Hierarchical Skills & Zones State
    const [companiesSpecialties, setCompaniesSpecialties] = useState<Record<string, { natures: string[], domains: string[], specialties: string[], geo_zones: string[], expertise_tags: string[] }>>({});

    // --- STATE: DOCUMENTS (Detail View) ---
    const [documents, setDocuments] = useState<any[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(false);

    // --- DATA FETCHING ---
    useEffect(() => {
        fetchNetwork();
        fetchTaxonomy();
    }, []);

    const fetchTaxonomy = async () => {
        try {
            setLoadingRef(true);
            const [doms, specs, gz, tags] = await Promise.all([
                supabase.from('ref_domains').select('*').order('label'),
                supabase.from('ref_specialties').select('*').not('label', 'ilike', 'Autre%').order('label'),
                supabase.from('ref_geo_zones').select('*').order('label'),
                supabase.from('ref_expertise_tags').select('*').order('label')
            ]);
            setRefDomains(doms.data || []);
            setRefSpecialties(specs.data || []);
            setRefGeoZones(gz.data || []);
            setRefExpertiseTags(tags.data || []);
        } catch (e) {
            console.error("Error fetching taxonomy:", e);
        } finally {
            setLoadingRef(false);
        }
    };

    // Fetch Docs when a company is selected
    useEffect(() => {
        if (selectedCompanyId) {
            fetchCompanyDocuments(selectedCompanyId);
        } else {
            setDocuments([]);
        }
    }, [selectedCompanyId]);

    const fetchNetwork = async () => {
        try {
            setLoading(true);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Get user's company
            const { data: userData } = await supabase.from('utilisateurs').select('entreprise_id').eq('id', user.id).single();
            if (!userData?.entreprise_id) {
                setLoading(false);
                return;
            }
            const myCompanyId = userData.entreprise_id;

            // 1. Fetch Manual Network (Active connections)
            const { data: activeConnections } = await supabase
                .from('reseau_entreprises')
                .select('statut, entreprise_cible_id, entreprise_cible:entreprises!entreprise_cible_id(*)')
                .eq('entreprise_origine_id', myCompanyId)
                .neq('statut', 'bloque');

            const myActiveNetwork: NetworkCompany[] = activeConnections?.map((c: any) => ({
                ...c.entreprise_cible,
                relationStatus: c.statut,
                tenders: []
            })) || [];

            setMyNetwork(myActiveNetwork);

            // 2. Fetch Incoming Pending Invites
            const { data: incomingInvites } = await supabase
                .from('reseau_entreprises')
                .select('id, entreprise_origine_id, entreprise_origine:entreprises!entreprise_origine_id(*)')
                .eq('entreprise_cible_id', myCompanyId)
                .eq('statut', 'en_attente');

            const mappedPendingInvites: PendingNetworkInvite[] = incomingInvites?.map((c: any) => ({
                reseauId: c.id,
                company: c.entreprise_origine,
                senderCompanyId: c.entreprise_origine_id
            })) || [];
            
            setPendingInvites(mappedPendingInvites);

            // 3. Fetch FILAO NETWORK (All visible companies minus me minus active network)
            const myNetworkIds = new Set(myActiveNetwork.map(c => c.id));
            
            const { data: filaoEnts, error: filaoError } = await supabase
                .from('entreprises')
                .select('*')
                .eq('visible_reseau', true)
                .neq('id', myCompanyId)
                .limit(100);

            if (filaoError) throw filaoError;

            // Filter out companies already in my network
            const filteredFilaoEnts = (filaoEnts || []).filter(c => !myNetworkIds.has(c.id));

            // --- FETCH RATINGS ---
            const allIds = [...myNetworkIds, ...(filteredFilaoEnts.map(c => c.id))];
            
            if (allIds.length > 0) {
                const { data: ratingsData } = await supabase
                    .from('avis_partenaires')
                    .select('evalue_id, note')
                    .in('evalue_id', allIds);

                const ratingsMap = new Map<string, { total: number, count: number }>();

                ratingsData?.forEach((r: any) => {
                    const existing = ratingsMap.get(r.evalue_id) || { total: 0, count: 0 };
                    existing.total += r.note;
                    existing.count += 1;
                    ratingsMap.set(r.evalue_id, existing);
                });

                // Attach ratings
                const attachRating = (c: NetworkCompany) => {
                    const stats = ratingsMap.get(c.id);
                    if (stats && stats.count > 0) {
                        c.average_rating = parseFloat((stats.total / stats.count).toFixed(1));
                        c.rating_count = stats.count;
                    } else {
                        c.average_rating = undefined;
                        c.rating_count = 0;
                    }
                };

                myActiveNetwork.forEach(attachRating);
                filteredFilaoEnts.forEach((c: any) => attachRating(c));
            }

            setMyNetwork(myActiveNetwork);
            setFilaoNetwork(filteredFilaoEnts as NetworkCompany[] || []);
            
            // 4. Fetch Hierarchical Skills for all IDs
            await fetchCompaniesSpecialties(allIds);
            
            setLoading(false);

        } catch (error) {
            console.error('Error fetching network:', error);
            showToast("Erreur lors du chargement du réseau", 'error');
            setLoading(false);
        }
    };

    const fetchCompaniesSpecialties = async (companyIds: string[]) => {
        if (!companyIds.length) return;
        try {
            const [nats, doms, specs, zones, tags] = await Promise.all([
                supabase.from('company_natures').select('entreprise_id, nature').in('entreprise_id', companyIds),
                supabase.from('company_domains').select('entreprise_id, domain_id').in('entreprise_id', companyIds),
                supabase.from('company_specialties').select('entreprise_id, specialty_id').in('entreprise_id', companyIds),
                supabase.from('company_geo_zones').select('entreprise_id, geo_zone_id').in('entreprise_id', companyIds),
                supabase.from('company_expertise_tags').select('entreprise_id, tag_id').in('entreprise_id', companyIds)
            ]);

            const map: Record<string, { natures: string[], domains: string[], specialties: string[], geo_zones: string[], expertise_tags: string[] }> = {};
            companyIds.forEach(id => map[id] = { natures: [], domains: [], specialties: [], geo_zones: [], expertise_tags: [] });

            nats.data?.forEach(n => {
                if (map[n.entreprise_id]) map[n.entreprise_id].natures.push(n.nature);
            });
            doms.data?.forEach(d => {
                if (map[d.entreprise_id]) map[d.entreprise_id].domains.push(d.domain_id);
            });
            specs.data?.forEach(s => {
                if (map[s.entreprise_id]) map[s.entreprise_id].specialties.push(s.specialty_id);
            });
            zones.data?.forEach(z => {
                if (map[z.entreprise_id]) map[z.entreprise_id].geo_zones.push(z.geo_zone_id);
            });
            tags.data?.forEach(t => {
                if (map[t.entreprise_id]) map[t.entreprise_id].expertise_tags.push(t.tag_id);
            });

            setCompaniesSpecialties(map as any);
        } catch (e) {
            console.error("Error fetching company types/specialties:", e);
        }
    };

    const fetchCompanyDocuments = async (companyId: string) => {
        try {
            setLoadingDocs(true);
            // Fetch from documents_entreprise table
            const { data, error } = await supabase
                .from('documents_entreprise')
                .select('*')
                .eq('entreprise_id', companyId);

            if (error) throw error;
            setDocuments(data || []);
            setLoadingDocs(false);
        } catch (error) {
            console.error('Error fetching docs:', error);
            setDocuments([]);
            setLoadingDocs(false);
        }
    };

    // --- INVITE TO TENDER FLOW ---
    const handleInviteToTender = useCallback(async (company: NetworkCompany) => {
        setInviteTargetCompany(company);
        setSelectedTenderId('');
        setSelectedRole('Co-traitant');
        setLoadingTenders(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Fetch active tenders created by this user (Brouillon or En cours)
            const { data: tenders, error } = await supabase
                .from('reponses_ao')
                .select('id, titre, statut')
                .eq('createur_id', user.id)
                .in('statut', ['Brouillon', 'En cours'])
                .order('created_at', { ascending: false });

            if (error) throw error;
            setActiveTenders(tenders || []);
        } catch (error) {
            console.error('Error fetching tenders:', error);
            showToast("Erreur lors du chargement des AO", 'error');
            setActiveTenders([]);
        } finally {
            setLoadingTenders(false);
        }
    }, [showToast]);

    const handleConfirmInvite = async () => {
        if (!inviteTargetCompany || !selectedTenderId) return;

        setInviting(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Generate an access code for the invitee
            const accessCode = Math.random().toString(36).slice(-6).toUpperCase();

            const { error } = await supabase.from('groupements').insert({
                projet_id: selectedTenderId,
                entreprise_id: inviteTargetCompany.id,
                role_groupement: selectedRole,
                statut: 'invite',
                invite_par: user.id
            });

            if (error) {
                if (error.code === '23505') { // Unique constraint
                    showToast(`${inviteTargetCompany.nom} est déjà invité sur cet AO`, 'error');
                } else {
                    throw error;
                }
            } else {
                const tenderName = activeTenders.find(t => t.id === selectedTenderId)?.titre || 'l\'AO';
                showToast(`${inviteTargetCompany.nom} invité en tant que ${selectedRole} sur "${tenderName}"`, 'success');

                // Send notifications via Edge Function
                try {
                    const { data: senderProfile } = await supabase
                        .from('utilisateurs')
                        .select('prenom, nom, photo_url')
                        .eq('id', user.id)
                        .maybeSingle();
                    const { data: tenderInfo } = await supabase
                        .from('reponses_ao')
                        .select('titre')
                        .eq('id', selectedTenderId)
                        .maybeSingle();

                    const inviterName = senderProfile ? `${senderProfile.prenom} ${senderProfile.nom}` : 'Un partenaire';
                    const resolvedTenderName = tenderInfo?.titre || tenderName;

                    const { data: { session } } = await supabase.auth.getSession();
                    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                    if (session && supabaseUrl) {
                        const response = await fetch(`${supabaseUrl}/functions/v1/send-invitation`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${session.access_token}`,
                            },
                            body: JSON.stringify({
                                tenderId: selectedTenderId,
                                entrepriseId: inviteTargetCompany.id,
                                tenderTitle: resolvedTenderName,
                                senderName: inviterName,
                                senderUserId: user.id,
                                role: selectedRole,
                                accessCode,
                                message: '',
                            }),
                        });
                        if (!response.ok) {
                            const err = await response.json();
                            console.error('Edge function error:', err);
                        }
                    }
                } catch (notifErr) {
                    console.error('Error sending invitation notification:', notifErr);
                }
            }

            setInviteTargetCompany(null);
        } catch (error) {
            console.error(error);
            showToast("Erreur lors de l'invitation", 'error');
        } finally {
            setInviting(false);
        }
    };

    const handleDelete = async (company: NetworkCompany) => {
        if (!confirm("Voulez-vous retirer cette entreprise de votre réseau ?")) return;

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data: userData } = await supabase.from('utilisateurs').select('entreprise_id').eq('id', user.id).single();
            if (!userData?.entreprise_id) return;
            
            const myCompanyId = userData.entreprise_id;

            // Delete both directions of the relationship to completely sever the connection
            const { error: err1 } = await supabase
                .from('reseau_entreprises')
                .delete()
                .eq('entreprise_origine_id', myCompanyId)
                .eq('entreprise_cible_id', company.id);
                
            if (err1) throw err1;

            const { error: err2 } = await supabase
                .from('reseau_entreprises')
                .delete()
                .eq('entreprise_origine_id', company.id)
                .eq('entreprise_cible_id', myCompanyId);
                
            if (err2) throw err2;

            showToast(`${company.nom} retiré de votre réseau`, 'success');
            setMyNetwork(prev => prev.filter(c => c.id !== company.id));

            if (company.visible_reseau) {
                // Return them to the filao network view
                setFilaoNetwork(prev => [...prev, company]);
            }

        } catch (error) {
            console.error(error);
            showToast("Erreur lors de la suppression", 'error');
        }
    };

    const handleAcceptNetworkInvite = async (invite: PendingNetworkInvite) => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            
            const { data: userData } = await supabase.from('utilisateurs').select('id, entreprise_id, prenom, nom, photo_url').eq('id', user.id).single();
            if (!userData?.entreprise_id) return;

            const myCompanyId = userData.entreprise_id;

            // 1. Update the original request to 'actif'
            const { error: updateErr } = await supabase
                .from('reseau_entreprises')
                .update({ statut: 'actif' })
                .eq('id', invite.reseauId);
                
            if (updateErr) throw updateErr;

            // 2. Insert the reverse relationship (target -> origin)
            const { error: insertErr } = await supabase
                .from('reseau_entreprises')
                .upsert({
                    entreprise_origine_id: myCompanyId,
                    entreprise_cible_id: invite.senderCompanyId,
                    statut: 'actif'
                }, { onConflict: 'entreprise_origine_id, entreprise_cible_id' });
                
            if (insertErr) throw insertErr;

            // 3. Notify the inviter
            const { data: adminUsers } = await supabase
                .from('utilisateurs')
                .select('id')
                .eq('entreprise_id', invite.senderCompanyId)
                .eq('role_entreprise', 'admin')
                .limit(1);

            if (adminUsers && adminUsers.length > 0) {
                const myName = [userData.prenom, userData.nom].filter(Boolean).join(' ') || 'Un utilisateur';
                await notifyNetworkInviteAccepted(adminUsers[0].id, myName, userData.photo_url || '');
            }

            showToast(`Vous êtes maintenant connecté avec ${invite.company.nom}`, 'success');
            
            // Remove from pending
            setPendingInvites(prev => prev.filter(i => i.reseauId !== invite.reseauId));
            
            // Add to active network
            setMyNetwork(prev => [...prev, { ...invite.company, relationStatus: 'actif' }]);
            
            // Remove from Filao network view if they were there
            setFilaoNetwork(prev => prev.filter(c => c.id !== invite.company.id));
            
        } catch (error) {
            console.error('Accept invite error:', error);
            showToast("Erreur lors de l'acceptation de l'invitation", 'error');
        }
    };

    const handleRefuseNetworkInvite = async (reseauId: string) => {
        try {
            const { error } = await supabase
                .from('reseau_entreprises')
                .delete()
                .eq('id', reseauId);
                
            if (error) throw error;
            
            setPendingInvites(prev => prev.filter(i => i.reseauId !== reseauId));
            showToast("Invitation refusée", 'info');
            
        } catch (error) {
            console.error('Refuse invite error:', error);
            showToast("Erreur lors du refus de l'invitation", 'error');
        }
    };

    // --- FILTERS ---
    const displayedCompanies = useMemo(() => {
        const source = activeTab === 'network' ? myNetwork : filaoNetwork;
        return source.filter(c => {
            const matchesSearch = c.nom.toLowerCase().includes(searchQuery.toLowerCase());
            
            // Taxonomic matching
            const cTax = companiesSpecialties[c.id];
            
            // Region matching: check company ville OR geo_zones labels
            const matchesRegion = filterRegion === '' || 
                (c.ville && c.ville.toLowerCase().includes(filterRegion.toLowerCase())) || 
                (cTax && cTax.geo_zones.some(gzid => refGeoZones.find(z => z.id === gzid)?.label.toLowerCase().includes(filterRegion.toLowerCase())));
            
            const matchesForme = filterForme === '' || c.forme_juridique === filterForme;
            const matchesRating = filterRating === '' || (c.average_rating !== undefined && c.average_rating >= Number(filterRating));
            
            const matchesNature = filterNature === '' || (cTax && cTax.natures.includes(filterNature));
            const matchesDomain = filterDomain === '' || (cTax && cTax.domains.includes(filterDomain));
            const matchesSpecialty = filterSpecialty === '' || (cTax && cTax.specialties.includes(filterSpecialty));
            const matchesExpertiseTag = filterExpertiseTag === '' || (cTax && cTax.expertise_tags.includes(filterExpertiseTag));

            return matchesSearch && matchesRegion && matchesSpecialty && matchesForme && matchesRating && matchesNature && matchesDomain && matchesExpertiseTag;
        });
    }, [activeTab, myNetwork, filaoNetwork, searchQuery, filterRegion, filterSpecialty, filterExpertiseTag, filterForme, filterRating, filterNature, filterDomain, companiesSpecialties, refGeoZones]);

    const uniqueRegions = useMemo(() => {
        const allVilles = [...new Set([...myNetwork, ...filaoNetwork].map(c => c.ville).filter(Boolean))];
        const allZones = [...new Set(Object.values(companiesSpecialties as Record<string, any>).flatMap(t => t.geo_zones).map(zid => refGeoZones.find(z => z.id === zid)?.label).filter(Boolean))];
        return [...new Set([...allVilles, ...allZones])].sort();
    }, [myNetwork, filaoNetwork, companiesSpecialties, refGeoZones]);

    const uniqueSpecialties = useMemo(() => {
        return [...new Set(Object.values(companiesSpecialties as Record<string, any>).flatMap(t => t.specialties).map(sid => refSpecialties.find(s => s.id === sid)?.label).filter(Boolean))].sort();
    }, [companiesSpecialties, refSpecialties]);

    const uniqueFormes = useMemo(() => [...new Set([...myNetwork, ...filaoNetwork].map(c => c.forme_juridique).filter(Boolean))].sort(), [myNetwork, filaoNetwork]);

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (filterRegion) count++;
        if (filterSpecialty) count++;
        if (filterExpertiseTag) count++;
        if (filterForme) count++;
        if (filterRating) count++;
        if (filterNature) count++;
        if (filterDomain) count++;
        return count;
    }, [filterRegion, filterSpecialty, filterExpertiseTag, filterForme, filterRating, filterNature, filterDomain]);

    const clearAllFilters = () => {
        setFilterRegion('');
        setFilterSpecialty('');
        setFilterExpertiseTag('');
        setFilterForme('');
        setFilterRating('');
        setFilterNature('');
        setFilterDomain('');
    };

    const CompanyDetail: React.FC<{ company: NetworkCompany }> = ({ company }) => (
        <div className="flex flex-col h-full animate-in slide-in-from-right-8 duration-300">
            <div className="p-6 border-b border-white/30 flex justify-between items-center bg-white/20">
                <div className="flex items-center gap-4">
                    <button onClick={() => setSelectedCompanyId(null)} className="p-2 rounded-xl bg-white/40 hover:bg-white text-[#0B1F38]/60 hover:text-[#0B1F38] transition-all">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex items-center gap-4">
                        {company.logo_url ? (
                            <img src={company.logo_url} alt={company.nom} className="w-14 h-14 rounded-xl object-contain bg-white border border-white/60 shadow-sm" />
                        ) : (
                            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#00A3E0] to-[#26367F] flex items-center justify-center text-white font-bold text-xl border-2 border-white shadow-sm">
                                {company.nom[0]}
                            </div>
                        )}
                        <div>
                            <h2 className="text-xl font-bold text-[#0B1F38]">{company.nom}</h2>
                            <p className="text-sm text-[#0B1F38]/60 flex items-center gap-1">
                                {company.ville && <span className='flex items-center gap-0.5'><MapPin size={12} /> {company.ville} • </span>}
                                {(() => {
                                    const naf = company.libelle_naf?.trim();
                                    if (naf && naf.length >= 3) return naf;
                                    return 'Activité non renseignée';
                                })()}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => handleInviteToTender(company)} className="flex items-center gap-2 bg-[#00A3E0] hover:bg-[#008CC1] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition-all">
                        <UserPlus size={16} /> Inviter sur un AO
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                <div className="flex flex-col gap-6">
                    {/* Header: Company Bio */}
                    <div className="flex flex-col lg:flex-row gap-6">
                        <div className="w-full lg:w-1/3 space-y-6">
                            <div className="bg-white/60 border border-white/50 rounded-2xl p-5 shadow-sm">
                                <h3 className="text-sm font-bold text-[#0B1F38] mb-4 flex items-center gap-2"><Building2 size={16} className="text-[#00A3E0]" /> Société</h3>
                                <div className="space-y-4">
                                    <div><p className="text-[10px] uppercase font-bold text-[#0B1F38]/40">SIRET</p><p className="text-sm font-bold text-[#0B1F38]">{company.siret || '-'}</p></div>
                                    <div><p className="text-[10px] uppercase font-bold text-[#0B1F38]/40">Adresse</p><p className="text-sm font-bold text-[#0B1F38]">{company.adresse || '-'}</p></div>
                                    <div><p className="text-[10px] uppercase font-bold text-[#0B1F38]/40">Site Web</p>
                                        {company.site_web ? <a href={company.site_web} target="_blank" rel="noreferrer" className="text-sm font-bold text-[#00A3E0] hover:underline truncate block">{company.site_web}</a> : <span className="text-sm font-bold text-[#0B1F38]">-</span>}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="w-full lg:w-2/3">
                            {company.description ? (
                                <div className="bg-white/40 border border-white/50 rounded-2xl p-6 h-full">
                                    <h3 className="text-sm font-bold text-[#0B1F38] mb-3">À propos</h3>
                                    <p className="text-sm text-[#0B1F38]/80 leading-relaxed font-medium">
                                        {company.description}
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-white/40 border border-white/50 rounded-2xl p-6 h-full flex items-center justify-center">
                                    <p className="text-sm text-[#0B1F38]/40 italic">Aucune description disponible</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Section 1: Activités & Spécialités */}
                    <div className="bg-white/40 border border-white/50 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-8 h-8 rounded-lg bg-[#00A3E0]/10 text-[#00A3E0] flex items-center justify-center">
                                <Briefcase size={16} />
                            </div>
                            <h3 className="text-base font-bold text-[#0B1F38]">Activités & Spécialités</h3>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {/* Natures */}
                            <div>
                                <p className="text-[10px] uppercase font-bold text-[#0B1F38]/40 mb-2.5 tracking-wider">Natures d'activité</p>
                                <div className="flex flex-wrap gap-2">
                                    {companiesSpecialties[company.id]?.natures.map(n => (
                                        <span key={n} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-100 capitalize">
                                            {n}
                                        </span>
                                    ))}
                                    {(!companiesSpecialties[company.id] || companiesSpecialties[company.id].natures.length === 0) && (
                                        <span className="text-xs text-[#0B1F38]/40 italic">Non renseigné</span>
                                    )}
                                </div>
                            </div>

                            {/* Domaines */}
                            <div>
                                <p className="text-[10px] uppercase font-bold text-[#0B1F38]/40 mb-2.5 tracking-wider">Domaines d'expertise</p>
                                <div className="flex flex-wrap gap-2">
                                    {companiesSpecialties[company.id]?.domains.map(did => (
                                        <span key={did} className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold border border-emerald-100">
                                            {refDomains.find(rd => rd.id === did)?.label || did}
                                        </span>
                                    ))}
                                    {(!companiesSpecialties[company.id] || companiesSpecialties[company.id].domains.length === 0) && (
                                        <span className="text-xs text-[#0B1F38]/40 italic">Non renseigné</span>
                                    )}
                                </div>
                            </div>

                            {/* Spécialités */}
                            <div>
                                <p className="text-[10px] uppercase font-bold text-[#0B1F38]/40 mb-2.5 tracking-wider">Spécialités précises</p>
                                <div className="flex flex-wrap gap-2">
                                    {companiesSpecialties[company.id]?.specialties.map(sid => (
                                        <span key={sid} className="px-3 py-1 bg-white border border-[#0B1F38]/10 text-[#0B1F38]/70 rounded-lg text-xs font-bold shadow-sm">
                                            {refSpecialties.find(rs => rs.id === sid)?.label || sid}
                                        </span>
                                    ))}
                                    {(!companiesSpecialties[company.id] || companiesSpecialties[company.id].specialties.length === 0) && (
                                        <span className="text-xs text-[#0B1F38]/40 italic">Non renseigné</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: Expertises & Qualifications */}
                    <div className="bg-white/40 border border-white/50 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                                <ShieldCheck size={16} />
                            </div>
                            <h3 className="text-base font-bold text-[#0B1F38]">Expertises & Qualifications</h3>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {companiesSpecialties[company.id]?.expertise_tags.map(tagId => {
                                const tag = refExpertiseTags.find(t => t.id === tagId);
                                if (!tag) return null;
                                return (
                                    <span key={tagId} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-xs font-bold">
                                        {tag.label}
                                    </span>
                                );
                            })}
                            {(!companiesSpecialties[company.id] || companiesSpecialties[company.id].expertise_tags.length === 0) && (
                                <p className="text-sm text-[#0B1F38]/40 italic">Aucune expertise spécifique renseignée.</p>
                            )}
                        </div>
                    </div>

                    {/* Section 3: Périmètre Géographique */}
                    <div className="bg-white/40 border border-white/50 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center">
                                <Globe size={16} />
                            </div>
                            <h3 className="text-base font-bold text-[#0B1F38]">Périmètre Géographique</h3>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {(() => {
                                const cZones = companiesSpecialties[company.id]?.geo_zones || [];
                                const isFranceEntiere = cZones.length >= 13 && refGeoZones.filter(z => z.zone_type === 'metropole').every(z => cZones.includes(z.id));
                                
                                if (isFranceEntiere) {
                                    return (
                                        <span className="px-4 py-2 bg-purple-100 text-purple-800 border border-purple-200 rounded-xl text-xs font-black uppercase tracking-tight shadow-sm">
                                            France Entière (Métropole)
                                        </span>
                                    );
                                }

                                if (cZones.length === 0) {
                                    return <p className="text-sm text-[#0B1F38]/40 italic">Zone d'intervention non renseignée.</p>;
                                }

                                return cZones.map(zid => {
                                    const zone = refGeoZones.find(z => z.id === zid);
                                    return (
                                        <span key={zid} className="px-3 py-1.5 bg-gray-50 text-gray-700 border border-gray-200 rounded-xl text-xs font-bold">
                                            {zone?.label || zid}
                                        </span>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="w-full h-full p-4">
            <style>
                {`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;500;700;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');`}
                {`
          .custom-scrollbar::-webkit-scrollbar { width: 6px; } 
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; margin: 10px 0; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(11, 31, 56, 0.1); border-radius: 20px; } 
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: rgba(11, 31, 56, 0.2); }
          .custom-scrollbar::-webkit-scrollbar-button { display: none; }
        `}
            </style>

            <div className="h-full flex flex-col font-dm-sans relative text-[#0B1F38]">
                <div className="absolute top-[-10%] right-[-5%] w-[800px] h-[800px] bg-[#FF8D6D] rounded-full mix-blend-multiply filter blur-[120px] opacity-10 pointer-events-none"></div>

                <div className={`flex-1 ${GLASS_STYLE} relative overflow-hidden transition-all duration-500 rounded-3xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 mx-2 my-2 md:m-0`}>

                    {selectedCompanyId ? (
                        <CompanyDetail company={[...myNetwork, ...filaoNetwork].find(c => c.id === selectedCompanyId)!} />
                    ) : (
                        <>
                            <div className="p-6 border-b border-white/30 flex flex-col gap-6 z-10">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                    <div>
                                        <h1 className="text-3xl font-bold text-[#00A3E0]">Réseau</h1>
                                        <p className="text-sm text-[#0B1F38]/60 mt-1">Gérez vos partenaires et découvrez des entreprises</p>
                                    </div>
                                    {activeTab === 'network' && (
                                        <button onClick={() => setIsInviteModalOpen(true)} className="flex justify-center items-center gap-2 bg-[#FF8575] hover:bg-[#ff715e] text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-[#FF8575]/20 transition-all transform hover:scale-[1.02] text-sm shrink-0">
                                            <Mail size={18} strokeWidth={3} /> <span className="hidden sm:inline">Inviter par email</span>
                                        </button>
                                    )}
                                </div>

                                <div className="flex gap-4 border-b border-white/20">
                                    <button onClick={() => setActiveTab('network')} className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'network' ? 'text-[#00A3E0] border-[#00A3E0]' : 'text-[#0B1F38]/60 border-transparent hover:text-[#0B1F38]'}`}>
                                        <Users size={18} /> Mon Réseau <span className="bg-[#0B1F38]/5 px-2 rounded-full text-xs">{myNetwork.length}</span>
                                    </button>
                                    <button onClick={() => setActiveTab('filao')} className={`pb-3 px-2 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${activeTab === 'filao' ? 'text-[#00A3E0] border-[#00A3E0]' : 'text-[#0B1F38]/60 border-transparent hover:text-[#0B1F38]'}`}>
                                        <NetworkIcon size={18} /> Réseau FILAO
                                    </button>
                                </div>
                            </div>

                            <div className="px-6 pb-0 z-10 mt-6">
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0B1F38]/40" size={18} />
                                        <input
                                            type="text"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            placeholder="Rechercher une entreprise..."
                                            className="w-full bg-white/60 border-none rounded-xl py-2.5 pl-10 pr-4 text-sm text-[#0B1F38] placeholder-[#0B1F38]/40 focus:outline-none focus:ring-2 focus:ring-[#00A3E0]"
                                        />
                                    </div>
                                    <button onClick={() => setShowFilters(!showFilters)} className={`px-4 py-2.5 text-sm font-bold rounded-xl border transition-all flex items-center gap-2 md:hidden ${showFilters ? 'bg-[#00A3E0] text-white border-[#00A3E0]' : 'bg-white text-[#0B1F38]/70 border-white/50 hover:text-[#00A3E0]'}`}>
                                        <Filter size={16} /> Filtres {activeFilterCount > 0 && <span className="bg-white/20 text-xs px-1.5 rounded-full">{activeFilterCount}</span>}
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 flex overflow-hidden z-0">
                                <aside className={`${showFilters ? 'block' : 'hidden'} md:block w-full md:w-56 lg:w-60 shrink-0 border-r border-white/20 overflow-y-auto custom-scrollbar p-4 space-y-5`}>
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-bold text-[#0B1F38]/60 uppercase tracking-wider">Filtres</h3>
                                        {activeFilterCount > 0 && (
                                            <button onClick={clearAllFilters} className="text-[10px] text-[#00A3E0] hover:underline font-medium">Tout effacer</button>
                                        )}
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Nature</label>
                                        <select value={filterNature} onChange={(e) => { setFilterNature(e.target.value); setFilterDomain(''); }} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-2.5 text-xs text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0] capitalize">
                                            <option value="">Toutes</option>
                                            <option value="travaux">Travaux</option>
                                            <option value="services">Services</option>
                                            <option value="fournitures">Fournitures</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Domaine</label>
                                        <select value={filterDomain} onChange={(e) => setFilterDomain(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-2.5 text-xs text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0]" disabled={!filterNature}>
                                            <option value="">Tous les domaines</option>
                                            {refDomains.filter(d => !filterNature || d.natures.includes(filterNature)).map(d => (
                                                <option key={d.id} value={d.id}>{d.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Spécialité</label>
                                        <select value={filterSpecialty} onChange={(e) => setFilterSpecialty(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-2.5 text-xs text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0]" disabled={!filterDomain}>
                                            <option value="">Toutes les spécialités</option>
                                            {/* List specialties corresponding to selected domain, or all unique from data if no domain selected */}
                                            {filterDomain ? (
                                                refSpecialties.filter(s => s.domain_id === filterDomain).map(s => (
                                                    <option key={s.id} value={s.id}>{s.label}</option>
                                                ))
                                            ) : (
                                                uniqueSpecialties.map(c => <option key={c} value={c}>{c}</option>)
                                            )}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Expertise / Qualification</label>
                                        <select value={filterExpertiseTag} onChange={(e) => setFilterExpertiseTag(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-2.5 text-xs text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0]">
                                            <option value="">Toutes les expertises</option>
                                            {refExpertiseTags.map(t => (
                                                <option key={t.id} value={t.id}>{t.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Forme juridique</label>
                                        <select value={filterForme} onChange={(e) => setFilterForme(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-2.5 text-xs text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0]">
                                            <option value="">Toutes</option>
                                            {uniqueFormes.map(f => <option key={f} value={f}>{f}</option>)}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Avis minimum</label>
                                        <div className="flex flex-col gap-1">
                                            {(['', '4', '3', '2', '1'] as const).map(val => (
                                                <button key={val} onClick={() => setFilterRating(val)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all ${filterRating === val ? 'bg-[#00A3E0]/10 text-[#00A3E0] font-bold' : 'text-[#0B1F38]/60 hover:bg-gray-50'}`}>
                                                    {val === '' ? (
                                                        <span>Tous</span>
                                                    ) : (
                                                        <>
                                                            {Array.from({ length: Number(val) }).map((_, i) => <Star key={i} size={10} className="text-yellow-400 fill-yellow-400" />)}
                                                            <span className="ml-0.5">{val}+ étoiles</span>
                                                        </>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-[11px] font-bold text-[#0B1F38]/50 mb-1.5 block">Ville / Région</label>
                                        <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-2 px-2.5 text-xs text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0]">
                                            <option value="">Toutes</option>
                                            {uniqueRegions.map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    </div>
                                </aside>

                                <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                                    {loading ? (
                                        <div className="flex justify-center py-20"><LoaderIcon className="animate-spin text-[#00A3E0]" size={32} /></div>
                                    ) : (
                                        <>
                                            {activeTab === 'network' && pendingInvites.length > 0 && (
                                                <div className="mb-6 space-y-3">
                                                    <h3 className="text-sm font-bold text-[#0B1F38] flex items-center gap-2">
                                                        <UserPlus size={16} className="text-[#00A3E0]" />
                                                        Invitations en attente ({pendingInvites.length})
                                                    </h3>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        {pendingInvites.map((invite) => (
                                                            <div key={invite.reseauId} className="bg-white/80 border border-[#00A3E0]/20 rounded-xl p-3 flex items-center justify-between shadow-sm animate-in fade-in slide-in-from-left-4">
                                                                <div className="flex items-center gap-3">
                                                                    {invite.company.logo_url ? (
                                                                        <img src={invite.company.logo_url} alt={invite.company.nom} className="w-8 h-8 rounded-full object-cover border border-gray-100" />
                                                                    ) : (
                                                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00A3E0] to-[#1D3557] flex items-center justify-center text-white font-bold text-[10px]">
                                                                            {invite.company.nom[0]}
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <p className="text-xs font-bold text-[#0B1F38] truncate max-w-[120px]">{invite.company.nom}</p>
                                                                        <p className="text-[10px] text-gray-500 uppercase">Souhaite vous ajouter</p>
                                                                    </div>
                                                                </div>
                                                                <div className="flex gap-2">
                                                                    <button onClick={() => handleAcceptNetworkInvite(invite)} className="bg-[#00A3E0] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#008CC1] transition-all">Accepter</button>
                                                                    <button onClick={() => handleRefuseNetworkInvite(invite.reseauId)} className="bg-gray-100 text-gray-500 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-200 transition-all">Refuser</button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {displayedCompanies.length > 0 ? (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                                    {displayedCompanies.map(company => {
                                                        const getNafOrActivity = () => {
                                                            const naf = company.libelle_naf?.trim();
                                                            if (naf && naf.length >= 3) return naf;
                                                            return 'Activité non renseignée';
                                                        };

                                                        return (
                                                            <div key={company.id} onClick={() => setSelectedCompanyId(company.id)} className="bg-white rounded-xl p-3 hover:shadow-md border border-gray-100 transition-all cursor-pointer group">
                                                                <div className="flex items-start gap-2.5 mb-2">
                                                                    <div className="relative shrink-0">
                                                                        {company.logo_url ? (
                                                                            <img src={company.logo_url} alt={company.nom} className="w-9 h-9 rounded-full object-cover border border-gray-100" />
                                                                        ) : (
                                                                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00A3E0] to-[#1D3557] flex items-center justify-center text-white font-bold text-xs uppercase">
                                                                                {company.nom[0]}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <h3 className="font-bold text-[#0B1F38] truncate text-[11px] leading-tight" title={company.nom}>{company.nom}</h3>
                                                                        <p className="text-[10px] text-[#00A3E0] truncate font-medium leading-tight" title={getNafOrActivity()}>{getNafOrActivity()}</p>
                                                                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400">
                                                                            <MapPin size={9} className="shrink-0" />
                                                                            <span className="truncate">{company.ville || '—'}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="flex flex-wrap gap-1 mb-2 min-h-[18px]">
                                                                    {(() => {
                                                                        const cTax = companiesSpecialties[company.id];
                                                                        const all = (cTax?.specialties || [])
                                                                            .map(sid => refSpecialties.find(rs => rs.id === sid)?.label)
                                                                            .filter(Boolean) as string[];
                                                                        
                                                                        return (
                                                                            <>
                                                                                {all.slice(0, 2).map((skill, i) => (
                                                                                    <span key={i} className="px-1.5 py-px bg-gray-50 text-gray-500 rounded text-[9px] font-medium border border-gray-100 whitespace-nowrap truncate max-w-full" title={skill}>{skill}</span>
                                                                                ))}
                                                                                {all.length > 2 && <span className="text-[9px] text-gray-300 shrink-0">+{all.length - 2}</span>}
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>

                                                                <div className="flex items-center justify-between pt-1.5 border-t border-gray-50">
                                                                    <div className="flex items-center gap-1">
                                                                        {company.rating_count ? (
                                                                            <>
                                                                                <Star size={10} className="text-yellow-400 fill-yellow-400" />
                                                                                <span className="text-[10px] font-bold text-[#0B1F38]">{company.average_rating}</span>
                                                                                <span className="text-[9px] text-gray-400">({company.rating_count})</span>
                                                                            </>
                                                                        ) : <span className="text-[9px] text-gray-300">Nouveau</span>}
                                                                    </div>
                                                                    <div className="flex items-center gap-0.5">
                                                                        {activeTab === 'filao' && (
                                                                            <button onClick={(e) => { e.stopPropagation(); handleInviteToTender(company); }} className="p-1 text-[#00A3E0] hover:bg-[#00A3E0]/10 rounded transition-colors" title="Inviter sur un AO">
                                                                                <UserPlus size={13} />
                                                                            </button>
                                                                        )}
                                                                        {activeTab === 'network' && (
                                                                            <>
                                                                                <button onClick={(e) => { e.stopPropagation(); handleDelete(company); }} className="p-1 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100" title="Retirer">
                                                                                    <Trash2 size={11} />
                                                                                </button>
                                                                            </>
                                                                        )}
                                                                        <button onClick={(e) => { e.stopPropagation(); setSelectedCompanyId(company.id); }} className="p-1 text-gray-300 hover:text-[#00A3E0] transition-colors" title="Voir profil">
                                                                            <Eye size={13} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center justify-center py-20 text-[#0B1F38]/50">
                                                    <div className="w-14 h-14 bg-white/50 rounded-full flex items-center justify-center mb-3">
                                                        <LayoutGrid size={28} className="opacity-50" />
                                                    </div>
                                                    <p className="font-bold text-base">Aucune entreprise trouvée</p>
                                                    <p className="text-xs mt-1">Modifiez vos filtres ou invitez des partenaires.</p>
                                                    {activeTab === 'network' && (
                                                        <button onClick={() => setIsInviteModalOpen(true)} className="mt-4 text-[#00A3E0] font-bold text-sm hover:underline">
                                                            Inviter une entreprise
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <InviteCompanyModal 
                isOpen={isInviteModalOpen} 
                onClose={() => setIsInviteModalOpen(false)} 
                onSuccess={fetchNetwork}
            />

            {/* Invite to Tender Modal */}
            {inviteTargetCompany && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setInviteTargetCompany(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-gray-100">
                            <h3 className="text-lg font-bold text-[#0B1F38]">Inviter sur un appel d'offres</h3>
                            <p className="text-sm text-gray-500 mt-1">Inviter <span className="font-semibold text-[#0B1F38]">{inviteTargetCompany.nom}</span> à collaborer sur une réponse AO</p>
                        </div>

                        <div className="p-5 space-y-4">
                            {loadingTenders ? (
                                <div className="flex justify-center py-8">
                                    <LoaderIcon className="animate-spin text-[#00A3E0]" size={24} />
                                </div>
                            ) : activeTenders.length > 0 ? (
                                <>
                                    <div>
                                        <label className="text-xs font-bold text-[#0B1F38]/60 mb-1.5 block">Sélectionner un AO en cours</label>
                                        <select
                                            value={selectedTenderId}
                                            onChange={(e) => setSelectedTenderId(e.target.value)}
                                            className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-sm text-[#0B1F38] focus:outline-none focus:ring-2 focus:ring-[#00A3E0] focus:border-transparent"
                                        >
                                            <option value="">Choisir un appel d'offres...</option>
                                            {activeTenders.map(t => (
                                                <option key={t.id} value={t.id}>
                                                    {t.titre} ({t.statut})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs font-bold text-[#0B1F38]/60 mb-1.5 block">Rôle dans le groupement</label>
                                        <div className="flex gap-2">
                                            {(['Co-traitant', 'Sous-traitant'] as const).map(role => (
                                                <button
                                                    key={role}
                                                    onClick={() => setSelectedRole(role)}
                                                    className={`flex-1 py-2 px-3 rounded-xl text-sm font-bold border transition-all ${selectedRole === role
                                                        ? 'bg-[#00A3E0]/10 border-[#00A3E0] text-[#00A3E0]'
                                                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                                                        }`}
                                                >
                                                    {role}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-6">
                                    <div className="w-12 h-12 bg-[#00A3E0]/10 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <Briefcase size={24} className="text-[#00A3E0]" />
                                    </div>
                                    <p className="font-bold text-[#0B1F38] mb-1">Aucun AO actif</p>
                                    <p className="text-sm text-gray-500 mb-4">Créez une réponse à un appel d'offres pour pouvoir inviter des partenaires.</p>
                                    <button
                                        onClick={() => { setInviteTargetCompany(null); onNavigate(''); }}
                                        className="text-sm font-bold text-[#00A3E0] hover:underline"
                                    >
                                        Créer une nouvelle réponse AO →
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => setInviteTargetCompany(null)}
                                className="px-4 py-2 text-sm font-bold text-gray-500 hover:text-[#0B1F38] transition-colors"
                            >
                                Annuler
                            </button>
                            {activeTenders.length > 0 && (
                                <button
                                    onClick={handleConfirmInvite}
                                    disabled={!selectedTenderId || inviting}
                                    className="px-5 py-2 bg-[#00A3E0] hover:bg-[#008CC1] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
                                >
                                    {inviting ? <LoaderIcon className="animate-spin" size={14} /> : <UserPlus size={14} />}
                                    Inviter
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Collaborators;