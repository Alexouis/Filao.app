import React, { useState, useEffect, useRef } from 'react';
import { ouvrirDocument, telechargerDocument, oublierUrl } from '../../helpers/storageHelpers';
import { deposerFichier } from '../../helpers/uploadHelpers';
import { Building2, Briefcase, FolderOpen, Wrench, Plus, X, Loader2, Check, Search, ShieldCheck, ShieldAlert, PenLine, Upload, Calendar as CalendarIcon, MapPin, Hash, Globe, Eye, EyeOff, Award, Users, Cpu, FileStack, ExternalLink, FileText, Leaf, Map, ChevronDown, Download } from 'lucide-react';
import { InfoItem, VerifiedBadge, UnverifiedBadge } from './CompanyInfoAtoms';
import { CompanyInfoReadOnly } from './CompanyInfoReadOnly';
import { CompanyInfoEditForm } from './CompanyInfoEditForm';
import { SettingsCard } from './SettingsCard';
import { DocumentInput } from './DocumentInput';
import { supabase } from '../../lib/supabaseClient';
import { UserProfile, SKILLS, INSEE_SECTION_LABELS, FRENCH_REGIONS } from '../../config';
import { Entreprise } from '../../types';
import { Undo2 } from 'lucide-react';
import { SpecialtyAccordion } from '../ui/SpecialtyAccordion';
import { useUnsavedChanges, useDirtyState } from '../../helpers/useUnsavedChanges';

interface CompanyTabProps {
    userProfile: UserProfile | null;
    onUpdate: () => void;
    initialSubTab?: 'info' | 'docs';
}

// Map API employee range to French standard categories
const mapTaille = (tranche: string | undefined): string => {
    if (!tranche) return '';
    const code = tranche.toString();
    // 00 to 03: < 10 employees -> Micro/TPE
    // 11 to 31: 10 to 249 employees -> PME
    // 32 to 51: 250 to 4999 employees -> ETI
    // 52 and +: 5000+ employees -> GE
    switch (code) {
        case '00':
        case '01':
        case '02':
        case '03': return 'Micro/TPE';
        case '11':
        case '12':
        case '21':
        case '22':
        case '31': return 'PME';
        case '32':
        case '41':
        case '42':
        case '51': return 'ETI';
        case '52':
        case '53': return 'GE';
        default: return '';
    }
};

// Helper: Format date to DD/MM/YYYY
const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        return new Intl.DateTimeFormat('fr-FR').format(date);
    } catch (e) {
        return dateStr;
    }
};

// Helper: Map standard legal form codes to readable labels
const getLegalFormLabel = (code: string, currentLabel: string): string => {
    if (currentLabel && currentLabel.length > 10 && !/^\d+$/.test(currentLabel)) return currentLabel;
    const mapping: Record<string, string> = {
        '1000': 'Entrepreneur individuel',
        '5499': 'SARL / EURL',
        '5710': 'SAS / SASU',
        '5720': 'Société par actions simplifiée',
        '5599': 'SA à conseil d\'administration',
        '6599': 'SCI',
        '5485': 'SELARL',
        '5785': 'SELAS',
    };
    return mapping[code] || code || 'Non défini';
};

// Helper: Resolve INSEE section code to readable label
const getSecteurLabel = (code: string): string => {
    if (!code) return 'Non défini';
    // If it's already a full label (>3 chars and not a single letter), return as-is
    if (code.length > 3 && !/^[A-U]$/.test(code)) return code;
    return INSEE_SECTION_LABELS[code] || code;
};

export const CompanyTab: React.FC<CompanyTabProps> = ({ userProfile, onUpdate, initialSubTab }) => {
    const [entrepriseData, setEntrepriseData] = useState<Entreprise | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Demandes de rattachement à traiter (migration 080). Visibles des seuls
    // administrateurs : la policy de lecture les filtre déjà côté base, mais on
    // évite d'afficher un panneau vide aux autres membres.
    const [demandes, setDemandes] = useState<any[]>([]);
    const [estAdmin, setEstAdmin] = useState(false);
    /**
     * Membre rattaché sans rôle administrateur : la fiche et les compétences
     * sont PARTAGÉES, et les policies (migration 089) refusent son écriture —
     * mais en silence. Sans cet état, l'écran laissait éditer puis affichait un
     * succès pour un enregistrement qui n'avait rien écrit.
     */
    const lectureSeule = !!userProfile?.entreprise_id && !estAdmin;
    const [placesRestantes, setPlacesRestantes] = useState<number | null | undefined>(undefined);
    const [demandeEnCours, setDemandeEnCours] = useState<string | null>(null);

    const chargerDemandes = async () => {
        const entrepriseId = userProfile?.entreprise_id;
        if (!entrepriseId) return;
        try {
            const [{ data: admin }, { data: places }, { data: lignes }] = await Promise.all([
                supabase.rpc('est_admin_entreprise'),
                supabase.rpc('places_restantes_entreprise', { p_entreprise: entrepriseId }),
                supabase
                    .from('demandes_rattachement')
                    .select('id, created_at, utilisateur_id, statut, motif_refus, traite_le')
                    .eq('entreprise_id', entrepriseId)
                    // Les demandes traitées sont chargées aussi : un refus par
                    // erreur doit pouvoir être corrigé, ce qui suppose de le
                    // retrouver après coup.
                    .in('statut', ['en_attente', 'refusee'])
                    .order('created_at', { ascending: true }),
            ]);
            setEstAdmin(!!admin);
            setPlacesRestantes(places === null ? null : Number(places));

            // Profils chargés séparément : `utilisateurs_publics` est une VUE, et
            // PostgREST ne peut pas l'imbriquer faute de clé étrangère détectable.
            // On fusionne côté client.
            const demandesBrutes = lignes || [];
            if (demandesBrutes.length > 0) {
                const { data: profils } = await supabase
                    .from('utilisateurs_publics')
                    .select('id, prenom, nom, email')
                    .in('id', demandesBrutes.map((d: any) => d.utilisateur_id));

                // Indexation par identifiant.
                //
                // ⚠️ Pas de `new Map()` ici : ce fichier importe l'icône `Map`
                // de lucide-react, qui MASQUE le constructeur natif. L'appel
                // échouait à l'exécution (« Map is not a constructor ») sans que
                // TypeScript ne signale quoi que ce soit, le nom étant valide.
                const parId: Record<string, any> = {};
                for (const p of profils || []) parId[p.id] = p;
                setDemandes(demandesBrutes.map((d: any) => ({ ...d, profil: parId[d.utilisateur_id] })));
            } else {
                setDemandes([]);
            }
        } catch (err) {
            console.warn('Chargement des demandes de rattachement échoué', err);
        }
    };

    useEffect(() => { chargerDemandes(); }, [userProfile?.entreprise_id]);

    const traiterDemande = async (demandeId: string, accepter: boolean) => {
        setDemandeEnCours(demandeId);
        try {
            const { data, error } = await supabase.rpc('traiter_demande_rattachement', {
                p_demande: demandeId,
                p_accepter: accepter,
            });
            if (error) throw error;

            // La fonction renvoie le motif plutôt que de lever une erreur : un
            // quota atteint est un refus légitime, pas une panne.
            if (data === 'quota_atteint') {
                setError("Le nombre d'utilisateurs de votre forfait est atteint. Passez à une offre supérieure pour rattacher ce collaborateur.");
            } else if (data === 'non_autorise') {
                setError("Vous n'êtes pas autorisé à traiter cette demande.");
            } else if (data === 'deja_rattache') {
                // Le demandeur a rejoint une autre entreprise entre-temps : la
                // fonction refuse de le déplacer (migration 088) et clôt la
                // demande, qui devient caduque (migration 091). Elle disparaît
                // donc de la liste au rechargement ci-dessous.
                //
                // Sans ce message, le clic « Accepter » restait sans aucun effet
                // visible — la ligne était toujours là — et l'administrateur
                // recommençait indéfiniment.
                setError("Ce collaborateur a rejoint une autre entreprise entre-temps : sa demande a été clôturée.");
            }
            await chargerDemandes();
            onUpdate();
        } catch (err) {
            console.error('Traitement de la demande échoué', err);
            setError("Impossible de traiter cette demande pour le moment.");
        } finally {
            setDemandeEnCours(null);
        }
    };
    const [error, setError] = useState<string | null>(null);
    const [uploadingField, setUploadingField] = useState<string | null>(null);

    // SIRET search
    const [siretInput, setSiretInput] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    // Fields mode: locked (from SIRET) or manual
    const [fieldsLocked, setFieldsLocked] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [isEditing, setIsEditing] = useState(true);
    const [isManualMode, setIsManualMode] = useState(false);
    const [preManualData, setPreManualData] = useState<any>(null);

    // Network visibility
    const [visibleReseau, setVisibleReseau] = useState(false);
    const [savingReseau, setSavingReseau] = useState(false);

    // Hierarchical Taxonomy & Expertises
    const [selectedNatures, setSelectedNatures] = useState<string[]>([]);
    const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
    const [selectedSpecialties, setSelectedSpecialties] = useState<Array<{ specialty_id: string; custom_label: string }>>([]);
    const [selectedExpertiseTags, setSelectedExpertiseTags] = useState<string[]>([]);
    const [selectedGeoZones, setSelectedGeoZones] = useState<string[]>([]);

    const [refDomains, setRefDomains] = useState<any[]>([]);
    const [refSpecialties, setRefSpecialties] = useState<any[]>([]);
    const [refExpertiseTags, setRefExpertiseTags] = useState<any[]>([]);
    const [refGeoZones, setRefGeoZones] = useState<any[]>([]);
    const [loadingRef, setLoadingRef] = useState(true);
    const [expandedThematic, setExpandedThematic] = useState<string | null>(null);

    // Sub-tabs
    const [subTab, setSubTab] = useState<'info' | 'docs' | 'equipe'>(initialSubTab || 'info');

    /** Membres de l'entreprise — consultation seule, aucune action pour l'instant. */
    const [membres, setMembres] = useState<any[]>([]);
    const [nomRoleAdmin, setNomRoleAdmin] = useState<string | null>(null);

    useEffect(() => {
        const entId = userProfile?.entreprise_id;
        if (!entId) { setMembres([]); return; }
        let annule = false;
        (async () => {
            // La policy de la migration 075 autorise chaque membre à voir ses
            // collègues ; les comptes anonymisés sont exclus, ils ne font plus
            // partie de l'équipe.
            const [{ data: gens }, { data: roles }] = await Promise.all([
                supabase
                    .from('utilisateurs')
                    .select('id, prenom, nom, email, photo_url, role_id, created_at')
                    .eq('entreprise_id', entId)
                    .is('compte_supprime_le', null)
                    .order('created_at', { ascending: true }),
                supabase.from('roles').select('id, name'),
            ]);
            if (annule) return;
            const idAdmin = (roles || []).find((r: any) => r.name === 'admin')?.id || null;
            setNomRoleAdmin(idAdmin);
            setMembres(gens || []);
        })();
        return () => { annule = true; };
    }, [userProfile?.entreprise_id]);

    // Document categories config
    type DocCategorie = 'presentation' | 'moyens_humains' | 'moyens_techniques' | 'references' | 'autres';
    interface DocCategoryConfig {
        key: DocCategorie;
        label: string;
        icon: any;
        description: string;
        defaultDocs: string[];
        placeholder: string;
    }
    const DOC_CATEGORIES: DocCategoryConfig[] = [
        { key: 'presentation', label: 'Présentation', icon: Briefcase, description: 'Qui sommes-nous ? Historique et chiffres clés (Plaquette).', defaultDocs: [], placeholder: 'Ex: Brochure, Portfolio...' },
        { key: 'moyens_humains', label: 'Moyens Humains', icon: Users, description: "L'équipe dédiée au projet et l'organigramme.", defaultDocs: [], placeholder: 'Ex: CV Chef de projet...' },
        { key: 'moyens_techniques', label: 'Moyens Techniques', icon: Cpu, description: 'Matériel, outillage et parc informatique.', defaultDocs: [], placeholder: 'Ex: Liste outillage...' },
        { key: 'references', label: 'Références', icon: Award, description: 'Vos réalisations similaires récentes.', defaultDocs: [], placeholder: 'Ex: Référence chantier X...' },
        { key: 'autres', label: 'Autres Documents', icon: FileStack, description: 'Tout autre document pertinent pour vos candidatures.', defaultDocs: [], placeholder: 'Nom du document...' },
    ];

    // Standard administrative document slots.
    // Depuis le Lot 2, ces documents sont stockés dans `documents_candidature`
    // (categorie = type normalisé), non plus sur `utilisateurs.*_url`. `field`
    // reste la clé d'état locale (formData/docStatuses) ; `categorie` est la clé
    // de persistance et de jointure avec ref_durees_validite_document.
    // `saisieExpiration` = le document porte une échéance réelle à saisir
    // (assurance) ; les autres dérivent leur fraîcheur d'une durée conventionnelle.
    const STANDARD_DOC_SLOTS = [
        { label: 'Kbis / Extrait D1', field: 'kbis_url' as const, categorie: 'kbis', saisieExpiration: false },
        { label: 'Attestation sur l\'honneur', field: 'attestation_honneur_url' as const, categorie: 'attestation_honneur', saisieExpiration: false },
        { label: 'Attestation Assurance', field: 'attestation_assurance_url' as const, categorie: 'attestation_assurance', saisieExpiration: true },
        { label: 'Statuts', field: 'presentation_societe_url' as const, categorie: 'presentation_societe', saisieExpiration: false },
    ];

    // Ensemble des catégories standard : sert à séparer, à la lecture, les
    // documents administratifs des documents personnalisés qui partagent
    // désormais la même table.
    const STANDARD_CATEGORIES = ['kbis', 'attestation_honneur', 'attestation_assurance', 'presentation_societe'];

    // Custom documents
    interface CustomDoc {
        id: string;
        label: string;
        url: string;
        statut: string;
        categorie: DocCategorie;
        created_at?: string;
        uploaded_by?: string;
    }
    const [customDocs, setCustomDocs] = useState<CustomDoc[]>([]);
    const [addingInCategory, setAddingInCategory] = useState<DocCategorie | null>(null);
    const [newDocLabel, setNewDocLabel] = useState('');

    // Document statuses
    type DocStatus = 'valide' | 'expire' | 'en_attente';
    interface DocStatusEntry { status: DocStatus; uploaded_at: string | null; }
    const [docStatuses, setDocStatuses] = useState<Record<string, DocStatusEntry>>({
        kbis_url: { status: 'en_attente', uploaded_at: null },
        presentation_societe_url: { status: 'en_attente', uploaded_at: null },
        attestation_honneur_url: { status: 'en_attente', uploaded_at: null },
        attestation_assurance_url: { status: 'en_attente', uploaded_at: null },
    });

    // Id de la ligne documents_candidature correspondant à chaque slot standard
    // (pour cibler l'upsert/update). Vide tant qu'aucun document n'est déposé.
    const [standardDocIds, setStandardDocIds] = useState<Record<string, string>>({});
    // Date d'expiration saisie par slot (uniquement l'assurance en pratique).
    const [standardDocExpiry, setStandardDocExpiry] = useState<Record<string, string>>({});
    // Passe les URLs standard chargées vers le setFormData qui suit, sans
    // dupliquer la requête.
    const standardUrlsRef = useRef<Record<string, string>>({});

    const [uploadingLogo, setUploadingLogo] = useState(false);

    // ... (existing code)

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !entrepriseData?.id) return;
        try {
            // Sans cette remise à zéro, l'erreur du dépôt précédent reste
            // affichée pendant le nouvel essai : impossible de savoir si elle
            // concerne l'ancien fichier ou le nouveau.
            setError(null);
            setUploadingLogo(true);
            // Le nom du fichier est décidé côté serveur (nom canonique) :
            // le construire ici n'aurait aucun effet.

            // Upload to 'public' bucket or 'documents' depending on config. Assuming 'documents' or creating new bucket?
            // Let's use 'documents' for now as it exists, but ideally a public bucket for logos.
            // Actually, logos usually need to be public. Let's check if 'logos' folder in 'documents' works or if we need a bucket.
            // Using 'documents' bucket, path 'logos/...'
            // Chemin nominatif dans `public-assets` : sans identifiant dans le
            // chemin, aucune policy ne peut restreindre la suppression au
            // propriétaire du logo.
            const { chemin, bucket, urlPublique, erreur } = await deposerFichier(file, {
                dossier: `logos/${entrepriseData?.id}`,
                point: 'logo',
                upsert: true,
            });
            if (erreur || !chemin) throw new Error(erreur || 'Dépôt refusé.');

            // L'URL versionnée renvoyée par le serveur prime : le nom du fichier
            // étant canonique, l'URL nue serait servie depuis le cache navigateur.
            const publicUrl = urlPublique
                || supabase.storage.from(bucket || 'public-assets').getPublicUrl(chemin).data.publicUrl;

            // Update entreprise
            const { error: updateError } = await supabase
                .from('entreprises')
                .update({ logo_url: publicUrl })
                .eq('id', entrepriseData.id);

            if (updateError) throw updateError;

            setEntrepriseData(prev => prev ? { ...prev, logo_url: publicUrl } : null);
            onUpdate();
        } catch (err: any) {
            console.error('Upload logo:', err);
            // Le message du serveur nomme la cause (format, taille, destination).
            setError(err?.message || "Erreur lors de l'upload du logo");
        } finally {
            setUploadingLogo(false);
        }
    };

    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const computeEffectiveStatus = (entry: DocStatusEntry): DocStatus => {
        if (entry.status === 'valide' && entry.uploaded_at) {
            const elapsed = Date.now() - new Date(entry.uploaded_at).getTime();
            if (elapsed > THREE_MONTHS_MS) return 'en_attente';
        }
        return entry.status;
    };

    const [formData, setFormData] = useState({
        nom: '',
        poste: '',
        siret: '',
        tva: '',
        adresse: '',
        ville: '',
        code_postal: '',
        taille: '',
        forme_juridique: '',
        code_naf: '',
        libelle_naf: '',
        date_creation: '',
        site_web: '',
        prenom: '',
        nom_famille: '',
        effectif: 1,
        kbis_url: '',
        presentation_societe_url: '',
        attestation_honneur_url: '',
        attestation_assurance_url: '',
    });

    // Protection de la saisie non enregistrée : ce formulaire se sauvegarde
    // uniquement au clic sur « Enregistrer », donc quitter la page perdrait tout.
    // La référence « dernier état enregistré » est posée après le chargement des
    // données puis après chaque sauvegarde réussie (voir marquerEnregistre).
    const { estModifie, marquerEnregistre } = useDirtyState(formData);
    const { confirmerSortie } = useUnsavedChanges(estModifie);

    useEffect(() => {
        if (userProfile?.entreprise_id) {
            fetchCompanyData(userProfile.entreprise_id);
        } else {
            setLoading(false);
            if (userProfile) {
                setFormData(prev => ({
                    ...prev,
                    nom: userProfile.entreprise || '',
                    poste: userProfile.poste || '',
                    siret: userProfile.siret || '',
                    tva: userProfile.tva || '',
                }));
            }
        }
    }, [userProfile]);

    const fetchCompanyData = async (entId: string) => {
        try {
            setLoading(true);
            const { data: ent, error } = await supabase
                .from('entreprises')
                .select('*')
                .eq('id', entId)
                .single();

            if (error) throw error;
            setEntrepriseData(ent);
            setIsVerified(ent.siret_verified || false);
            setFieldsLocked(ent.siret_verified || false);
            setVisibleReseau(ent.visible_reseau || false);
            if (ent.siret_verified) {
                setIsEditing(false);
            }

            // Hierarchical Data is fetched below

            // Fetch Hierarchical Data
            await fetchHierarchicalData(entId);

            // Fetch documents (standard + custom partagent désormais la table).
            const { data: docs } = await supabase
                .from('documents_candidature')
                .select('id, label, url, statut, categorie, created_at, uploaded_by, date_emission, date_expiration')
                .eq('entreprise_id', entId)
                .order('created_at', { ascending: true });

            const allDocs = docs || [];

            // Les documents personnalisés excluent les catégories standard, qui
            // ont leur propre grille — sans ce filtre, ils apparaîtraient en
            // double depuis le backfill du Lot 1.
            setCustomDocs(
                allDocs
                    .filter(d => !STANDARD_CATEGORIES.includes(d.categorie))
                    .map(d => ({ ...d, categorie: d.categorie || 'presentation' }))
            );

            // Hydrater l'état des slots standard depuis leurs lignes. En cas de
            // doublon résiduel pour une catégorie, la première ligne (plus
            // ancienne, tri created_at asc) fait foi.
            const standardRows = allDocs.filter(d => STANDARD_CATEGORIES.includes(d.categorie));
            const idsByField: Record<string, string> = {};
            const statusesByField: Record<string, DocStatusEntry> = {};
            const urlsByField: Record<string, string> = {};
            const expiryByField: Record<string, string> = {};
            for (const slot of STANDARD_DOC_SLOTS) {
                const row = standardRows.find(d => d.categorie === slot.categorie);
                if (row) {
                    idsByField[slot.field] = row.id;
                    urlsByField[slot.field] = row.url || '';
                    statusesByField[slot.field] = {
                        status: (row.statut as DocStatus) || 'en_attente',
                        uploaded_at: row.date_emission || row.created_at || null,
                    };
                    if (row.date_expiration) expiryByField[slot.field] = row.date_expiration;
                }
            }
            setStandardDocIds(idsByField);
            setStandardDocExpiry(expiryByField);
            if (Object.keys(statusesByField).length > 0) {
                setDocStatuses(prev => ({ ...prev, ...statusesByField }));
            }
            // Injecter les URLs standard dans formData (fait plus bas via setFormData).
            (standardUrlsRef as any).current = urlsByField;

            setFormData({
                nom: ent.nom || '',
                poste: userProfile?.poste || '',
                siret: ent.siret || '',
                tva: userProfile?.tva || '',
                adresse: ent.adresse || '',
                ville: ent.ville || '',
                code_postal: ent.code_postal || '',
                taille: ent.taille || '',
                forme_juridique: ent.forme_juridique || '',
                code_naf: ent.code_naf || '',
                libelle_naf: ent.libelle_naf || '',
                date_creation: ent.date_creation || '',
                site_web: ent.site_web || '',
                prenom: ent.prenom || '',
                nom_famille: ent.nom_famille || '',
                effectif: ent.effectif || 1,
                // URLs des documents administratifs : désormais issues de
                // documents_candidature (hydratées ci-dessus), plus de userProfile.
                kbis_url: standardUrlsRef.current.kbis_url || '',
                presentation_societe_url: standardUrlsRef.current.presentation_societe_url || '',
                attestation_honneur_url: standardUrlsRef.current.attestation_honneur_url || '',
                attestation_assurance_url: standardUrlsRef.current.attestation_assurance_url || '',
            });

            // L'état chargé devient la référence « enregistré ». On la pose via
            // le setter fonctionnel pour capturer exactement l'objet appliqué,
            // sans reconstruire (et risquer de désynchroniser) la liste des champs.
            setFormData(applique => { marquerEnregistre(applique); return applique; });

            setSiretInput('');
        } catch (err: any) {
            console.error(err);
            setError("Erreur chargement entreprise");
        } finally {
            setLoading(false);
        }
    };

    const fetchHierarchicalData = async (entId: string) => {
        try {
            setLoadingRef(true);
            // 1. Fetch Reference Data
            const [doms, specs, tags, zones] = await Promise.all([
                supabase.from('ref_domains').select('*').order('display_order'),
                supabase.from('ref_specialties').select('*').not('label', 'ilike', 'Autre%').order('display_order'),
                supabase.from('ref_expertise_tags').select('*').order('display_order'),
                supabase.from('ref_geo_zones').select('*').order('display_order')
            ]);
            setRefDomains(doms.data || []);
            setRefSpecialties(specs.data || []);
            setRefExpertiseTags(tags.data || []);
            setRefGeoZones(zones.data || []);

            // 2. Fetch Company Junction Data
            const [nats, cDoms, cSpecs, cTags, cZones] = await Promise.all([
                supabase.from('company_natures').select('nature').eq('entreprise_id', entId),
                supabase.from('company_domains').select('domain_id').eq('entreprise_id', entId),
                supabase.from('company_specialties').select('specialty_id, custom_label').eq('entreprise_id', entId),
                supabase.from('company_expertise_tags').select('tag_id').eq('entreprise_id', entId),
                supabase.from('company_geo_zones').select('geo_zone_id').eq('entreprise_id', entId)
            ]);

            setSelectedNatures(nats.data?.map(n => n.nature) || []);
            setSelectedDomains(cDoms.data?.map(d => d.domain_id) || []);
            setSelectedSpecialties(cSpecs.data || []);
            setSelectedExpertiseTags(cTags.data?.map(t => t.tag_id) || []);
            setSelectedGeoZones(cZones.data?.map(z => z.geo_zone_id) || []);

        } catch (err) {
            console.error("Error fetching hierarchical data:", err);
        } finally {
            setLoadingRef(false);
        }
    };

    // --- SIRET SEARCH ---
    const handleSiretSearch = async () => {
        const cleaned = siretInput.replace(/\s/g, '');
        if (cleaned.length !== 14) {
            setSearchError('Le SIRET doit contenir exactement 14 chiffres');
            return;
        }

        try {
            setSearching(true);
            setSearchError(null);

            const response = await fetch(
                `https://recherche-entreprises.api.gouv.fr/search?q=${cleaned}&page=1&per_page=1`
            );
            if (!response.ok) throw new Error('Erreur API');
            const data = await response.json();

            if (!data.results || data.results.length === 0) {
                setSearchError('Aucune entreprise trouvée pour ce SIRET');
                return;
            }

            const result = data.results[0];
            const siege = result.siege;
            const matchingEtab = result.matching_etablissements?.find(
                (e: any) => e.siret === cleaned
            ) || siege;

            // Map effectif tranche to a representative number
            const trancheCode = result.tranche_effectif_salarie || '00';
            const effectifEstim = {
                '00': '0', '01': '1', '02': '3', '03': '6', '11': '10', 
                '12': '20', '21': '50', '22': '100', '31': '200', '32': '250',
                '41': '500', '42': '1000', '51': '2000', '52': '5000', '53': '10000'
            }[trancheCode] || '';

            // Extract director info if potentially an individual expert
            const isIndividual = result.complements?.est_entrepreneur_individuel;
            const primaryDir = result.dirigeants?.[0];

            let streetParts = [
                matchingEtab.numero_voie,
                matchingEtab.type_voie,
                matchingEtab.libelle_voie,
            ].filter(Boolean).join(' ');

            // If still empty but we have the full address, try to strip CP/City
            if (!streetParts && matchingEtab.adresse) {
                const cp = matchingEtab.code_postal;
                const ville = matchingEtab.libelle_commune;
                streetParts = matchingEtab.adresse;
                if (cp) streetParts = streetParts.replace(cp, '');
                if (ville) streetParts = streetParts.replace(ville, '');
                streetParts = streetParts.trim().replace(/,$/, '');
            }

            setFormData(prev => ({
                ...prev,
                nom: result.nom_complet || result.nom_raison_sociale || prev.nom,
                prenom: isIndividual ? (primaryDir?.prenoms || '') : '',
                nom_famille: isIndividual ? (primaryDir?.nom || '') : '',
                siret: cleaned,
                adresse: streetParts || matchingEtab.adresse || prev.adresse,
                ville: matchingEtab.libelle_commune || prev.ville,
                code_postal: matchingEtab.code_postal || prev.code_postal,
                taille: result.categorie_entreprise || mapTaille(result.tranche_effectif_salarie) || prev.taille,
                effectif: effectifEstim || 1,
                forme_juridique: result.nature_juridique || prev.forme_juridique,
                code_naf: result.activite_principale || prev.code_naf,
                libelle_naf: prev.libelle_naf,
                date_creation: result.date_creation || prev.date_creation,
            }));

            // Fetch full NAF label
            if (result.activite_principale) {
                try {
                    const nafResponse = await fetch(`https://api.insee.fr/metadonnees/V1/codes/nafr2/sousClasse/${encodeURIComponent(result.activite_principale)}`, {
                        headers: { 'Accept': 'application/json' }
                    });
                    if (nafResponse.ok) {
                        const nafData = await nafResponse.json();
                        if (nafData?.intitule) {
                            setFormData(prev => ({ ...prev, libelle_naf: nafData.intitule }));
                        }
                    } else {
                        const fallbackResp = await fetch(`https://api-codes-naf.osc-fr1.scalingo.io/api/v1/naf/${result.activite_principale}`);
                        if (fallbackResp.ok) {
                            const fallbackData = await fallbackResp.json();
                            if (fallbackData?.label || fallbackData?.intitule) {
                                setFormData(prev => ({ ...prev, libelle_naf: fallbackData.label || fallbackData.intitule }));
                            }
                        }
                    }
                } catch {
                    // NAF label lookup failed silently
                }
            }

            setFieldsLocked(true);
            setIsVerified(true);
            setIsManualMode(false);
            setPreManualData(null);
            setSearchError(null);
        } catch (err: any) {
            console.error(err);
            setSearchError("Erreur lors de la recherche. Vérifiez le numéro SIRET.");
        } finally {
            setSearching(false);
        }
    };

    const handleManualMode = () => {
        setPreManualData({ formData: { ...formData }, isVerified, fieldsLocked });
        setFieldsLocked(false);
        setIsVerified(false);
        setIsManualMode(true);
    };

    const handleCancelManualMode = () => {
        if (preManualData) {
            setFormData(preManualData.formData);
            setIsVerified(preManualData.isVerified);
            setFieldsLocked(preManualData.fieldsLocked);
        }
        setIsManualMode(false);
        setPreManualData(null);
    };

    const handleInputChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const toggleEditMode = () => {
        setIsEditing(!isEditing);
    };

    const handleCancelEditing = () => {
        if (entrepriseData?.id) {
            fetchCompanyData(entrepriseData.id);
        }
        setIsEditing(false);
    };

    // --- TOGGLE NETWORK VISIBILITY ---
    const handleToggleReseau = async () => {
        if (!entrepriseData?.id) return;
        try {
            setSavingReseau(true);
            const newValue = !visibleReseau;
            const { error } = await supabase
                .from('entreprises')
                .update({ visible_reseau: newValue })
                .eq('id', entrepriseData.id);
            if (error) throw error;
            setVisibleReseau(newValue);
        } catch (err: any) {
            console.error(err);
            setError("Erreur lors de la mise à jour de la visibilité réseau");
        } finally {
            setSavingReseau(false);
        }
    };

    const handleSave = async () => {
        // Les policies refuseraient l'écriture sans erreur visible : autant le
        // dire clairement plutôt que d'afficher un faux succès.
        if (lectureSeule) {
            setError("Ces informations sont gérées par un administrateur de votre entreprise.");
            return;
        }

        if (!userProfile) return;
        try {
            setSaving(true);
            setError(null);
            setSaveSuccess(false);

            let entId = entrepriseData?.id;

            // PostgreSQL autorise plusieurs NULL sous une contrainte d'unicité,
            // mais deux chaînes vides entrent en collision : envoyer `siret: ''`
            // faisait échouer toute création d'entreprise sans SIRET dès qu'une
            // autre ligne portait déjà la chaîne vide. On normalise donc tous
            // les champs texte optionnels — le problème vaut pour chacun d'eux,
            // pas seulement le SIRET.
            const vide = (v: unknown) =>
                typeof v === 'string' && v.trim() === '' ? null : v;

            const companyPayload = {
                nom: formData.nom,
                siret: vide(formData.siret),
                adresse: vide(formData.adresse),
                ville: vide(formData.ville),
                code_postal: vide(formData.code_postal),
                taille: vide(formData.taille),
                forme_juridique: vide(formData.forme_juridique),
                code_naf: vide(formData.code_naf),
                libelle_naf: vide(formData.libelle_naf),
                date_creation: vide(formData.date_creation),
                prenom: vide(formData.prenom),
                nom_famille: vide(formData.nom_famille),
                effectif: formData.effectif || 1,
                site_web: vide(formData.site_web),
                siret_verified: isVerified,
            };

            if (entId) {
                await supabase.from('entreprises').update(companyPayload).eq('id', entId);
            } else if (formData.nom) {
                const { data: newEnt, error: createError } = await supabase.from('entreprises').insert({
                    ...companyPayload,
                    created_by: userProfile.id
                }).select('id').single();
                if (createError) throw createError;
                entId = newEnt.id;
            }

            await supabase.from('utilisateurs').update({
                entreprise_id: entId,
                entreprise: formData.nom,
                poste: formData.poste,
                tva: formData.tva,
            }).eq('id', userProfile.id);

            // Start Taxonomy Update
            if (entId) {
                // 1. Natures
                await supabase.from('company_natures').delete().eq('entreprise_id', entId);
                if (selectedNatures.length > 0) {
                    await supabase.from('company_natures').insert(selectedNatures.map(n => ({ entreprise_id: entId, nature: n })));
                }

                // 2. Domains
                await supabase.from('company_domains').delete().eq('entreprise_id', entId);
                if (selectedDomains.length > 0) {
                    await supabase.from('company_domains').insert(selectedDomains.map(d => ({ entreprise_id: entId, domain_id: d })));
                }

                // 3. Specialties
                await supabase.from('company_specialties').delete().eq('entreprise_id', entId);
                if (selectedSpecialties.length > 0) {
                    await supabase.from('company_specialties').insert(selectedSpecialties.map(s => ({
                        entreprise_id: entId,
                        specialty_id: s.specialty_id,
                        custom_label: s.custom_label || null
                    })));
                }

                // 4. Update Hierarchical Taxonomies (Junctions)
                // Expertise Tags
                await supabase.from('company_expertise_tags').delete().eq('entreprise_id', entId);
                if (selectedExpertiseTags.length > 0) {
                    await supabase.from('company_expertise_tags').insert(
                        selectedExpertiseTags.map(tag_id => ({ entreprise_id: entId, tag_id }))
                    );
                }

                // Geo Zones
                await supabase.from('company_geo_zones').delete().eq('entreprise_id', entId);
                if (selectedGeoZones.length > 0) {
                    await supabase.from('company_geo_zones').insert(
                        selectedGeoZones.map(geo_zone_id => ({ entreprise_id: entId, geo_zone_id }))
                    );
                }
            }

            setSaveSuccess(true);
            // La saisie vient d'être persistée : elle devient la nouvelle
            // référence, le formulaire n'est plus considéré comme modifié.
            marquerEnregistre(formData);

            // Retour à l'invitation interrompue : un partenaire arrivé ici parce
            // qu'il lui manquait une fiche entreprise doit retrouver son dossier
            // sans avoir à le rechercher.
            try {
                const invitationEnAttente = sessionStorage.getItem('invitationEnAttente');
                if (invitationEnAttente) {
                    sessionStorage.removeItem('invitationEnAttente');
                    // `setSaveSuccess(true)` ci-dessus affiche déjà la
                    // confirmation ; on laisse le temps de la lire avant de
                    // revenir au dossier.
                    setTimeout(() => {
                        window.location.href = `/?tab=wizard&id=${invitationEnAttente}`;
                    }, 1500);
                }
            } catch { /* stockage indisponible : on reste sur la fiche */ }
            setTimeout(() => setSaveSuccess(false), 3000);
            if (isVerified) setIsEditing(false);
            onUpdate();
        } catch (err: any) {
            // Une violation de contrainte d'unicité (23505) remontait telle
            // quelle : l'utilisateur lisait « duplicate key value violates
            // unique constraint », message que rien ne lui permet d'exploiter.
            // On le traduit en énoncé métier, et aucun message SQL ne parvient
            // plus à l'écran.
            if (err?.code === '23505') {
                setError(
                    typeof err?.message === 'string' && err.message.includes('siret')
                        ? "Une entreprise avec ce SIRET est déjà enregistrée sur Filao."
                        : "Ces informations correspondent à une entreprise déjà enregistrée sur Filao."
                );
            } else if (typeof err?.message === 'string' && /constraint|duplicate key|violates/i.test(err.message)) {
                setError("Enregistrement impossible : ces informations entrent en conflit avec une entreprise existante.");
            } else {
                setError(err?.message || "Erreur lors de l'enregistrement de l'entreprise.");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>, dbField: string) => {
        const file = e.target.files?.[0];
        if (!file || !userProfile) return;
        const slot = STANDARD_DOC_SLOTS.find(s => s.field === dbField);
        if (!slot || !entrepriseData?.id) return;
        try {
            setError(null);
            setUploadingField(dbField);
            // Un emplacement administratif ne contient qu'un document : le nom
            // dérive du champ, donc un nouvel envoi écrase le précédent au lieu
            // d'empiler des fichiers que plus rien ne référence.
            //
            // Volontairement SANS extension : la conserver ferait de `kbis.pdf`
            // et `kbis.jpg` deux objets distincts, et remplacer un PDF par une
            // image laisserait l'ancien fichier orphelin. Le type réel est de
            // toute façon porté par le `content-type` de l'objet.
            const nomStable = dbField.replace('_url', '');

            const { chemin, erreur } = await deposerFichier(file, {
                dossier: userProfile.email,
                point: 'coffre_fort',
                upsert: true,
                nom: nomStable,
            });
            if (erreur || !chemin) throw new Error(erreur || 'Dépôt refusé.');

            // Le bucket `documents` étant privé, on conserve le CHEMIN : une URL
            // signée expire au bout d'une heure et ne peut pas être persistée.
            oublierUrl(chemin);

            const today = new Date().toISOString().slice(0, 10); // date_emission (DATE)
            const existingId = standardDocIds[dbField];
            // La date d'expiration n'est pertinente que pour les documents qui
            // en portent une (assurance) ; sinon NULL, l'échéance étant dérivée
            // de la durée conventionnelle par la vue.
            const dateExpiration = slot.saisieExpiration
                ? (standardDocExpiry[dbField] || null)
                : null;

            let rowId = existingId;
            if (existingId) {
                // Remplacement d'un document existant : on met à jour la ligne,
                // on repart d'un statut « à vérifier » (le document a changé) et
                // on redate l'émission.
                const { error: updErr } = await supabase
                    .from('documents_candidature')
                    .update({
                        url: chemin,
                        statut: 'valide',
                        date_emission: today,
                        date_expiration: dateExpiration,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingId);
                if (updErr) throw updErr;
            } else {
                // Premier dépôt : nouvelle ligne standard.
                const { data: inserted, error: insErr } = await supabase
                    .from('documents_candidature')
                    .insert({
                        entreprise_id: entrepriseData.id,
                        uploaded_by: userProfile.id,
                        label: slot.label,
                        url: chemin,
                        statut: 'valide',
                        categorie: slot.categorie,
                        date_emission: today,
                        date_expiration: dateExpiration,
                    })
                    .select('id')
                    .single();
                if (insErr) throw insErr;
                rowId = inserted?.id;
            }

            // Refléter l'état localement (URL, id de ligne, statut).
            setFormData(prev => ({ ...prev, [dbField]: chemin }));
            if (rowId) setStandardDocIds(prev => ({ ...prev, [dbField]: rowId as string }));
            setDocStatuses(prev => ({
                ...prev,
                [dbField]: { status: 'valide', uploaded_at: today },
            }));
            onUpdate();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setUploadingField(null);
        }
    };


    // --- CUSTOM DOCUMENTS ---
    const handleAddCustomDoc = async (e: React.ChangeEvent<HTMLInputElement>, categorie: DocCategorie, labelOverride?: string) => {
        const file = e.target.files?.[0];
        // Use provided label, or newDocLabel (if set), or default to filename (without extension)
        const labelToUse = labelOverride || newDocLabel.trim() || file?.name.split('.').slice(0, -1).join('.') || 'Nouveau document';

        if (!file || !labelToUse || !entrepriseData?.id || !userProfile?.id) return;
        try {
            setError(null);
            setUploadingField('custom_new');
            // Ici le nom d'origine est conservé : chaque document personnalisé
            // est distinct, il n'y a rien à écraser.
            const { chemin, erreur } = await deposerFichier(file, {
                dossier: `documents/${entrepriseData.id}`,
                point: 'coffre_fort',
            });
            if (erreur || !chemin) throw new Error(erreur || 'Dépôt refusé.');

            const { data: inserted, error: insertError } = await supabase
                .from('documents_candidature')
                .insert({ entreprise_id: entrepriseData.id, uploaded_by: userProfile.id, label: labelToUse, url: chemin, statut: 'valide', categorie })
                .select('id, label, url, statut, categorie, created_at, uploaded_by')
                .single();

            if (insertError) throw insertError;
            if (inserted) setCustomDocs(prev => [...prev, { ...inserted, categorie: inserted.categorie || categorie }]);
            setNewDocLabel('');
            setAddingInCategory(null);
        } catch (err: any) {
            console.error(err);
            setError('Erreur lors de l\'ajout du document');
        } finally {
            setUploadingField(null);
        }
    };

    const handleDeleteCustomDoc = async (docId: string) => {
        try {
            // Find doc to get path
            const doc = customDocs.find(d => d.id === docId);
            if (doc && doc.url) {
                // `url` contient désormais un chemin ; les lignes antérieures à la
                // migration 039a contiennent encore une URL publique. Découper sur
                // « /documents/ » ne fonctionnait que pour la seconde forme : sur un
                // chemin, la suppression du fichier était silencieusement ignorée et
                // seule la ligne en base disparaissait.
                const relativePath = doc.url.includes('/object/public/documents/')
                    ? decodeURIComponent(doc.url.split('/object/public/documents/')[1].split('?')[0])
                    : doc.url;
                const { error: storageError } = await supabase.storage.from('documents').remove([relativePath]);
                if (storageError) console.error('Storage delete error:', storageError);
                oublierUrl(relativePath);
            }

            const { error } = await supabase.from('documents_candidature').delete().eq('id', docId);
            if (!error) setCustomDocs(prev => prev.filter(d => d.id !== docId));
        } catch (err: any) { console.error(err); }
    };

    const handleValidateDoc = async (field: string) => {
        const rowId = standardDocIds[field];
        if (!rowId) return; // rien à valider tant que le document n'est pas déposé
        const { error } = await supabase
            .from('documents_candidature')
            .update({ statut: 'valide', updated_at: new Date().toISOString() })
            .eq('id', rowId);
        if (!error) {
            setDocStatuses(prev => ({
                ...prev,
                [field]: { status: 'valide', uploaded_at: prev[field]?.uploaded_at || new Date().toISOString().slice(0, 10) },
            }));
        }
    };

    // Persiste la date d'expiration saisie (assurance) sur la ligne standard.
    const handleUpdateExpiry = async (field: string) => {
        const rowId = standardDocIds[field];
        if (!rowId) return;
        const value = standardDocExpiry[field] || null;
        await supabase
            .from('documents_candidature')
            .update({ date_expiration: value, updated_at: new Date().toISOString() })
            .eq('id', rowId);
    };

    const handleValidateCustomDoc = async (docId: string) => {
        await supabase.from('documents_candidature').update({ statut: 'valide' }).eq('id', docId);
        setCustomDocs(prev => prev.map(d => d.id === docId ? { ...d, statut: 'valide' } : d));
    };

    const handleCustomDocReupload = async (e: React.ChangeEvent<HTMLInputElement>, docId: string) => {
        const file = e.target.files?.[0];
        if (!file || !entrepriseData?.id) return;
        try {
            setUploadingField(`custom_${docId}`);
            setError(null);
            // Remplacement : on réécrit à l'emplacement du document existant.
            // Un nom neuf laisserait l'ancien fichier dans le bucket, sans plus
            // aucune ligne pour le désigner.
            const ancien = customDocs.find(d => d.id === docId)?.url;
            const nomExistant = ancien && !ancien.startsWith('http')
                ? ancien.split('/').pop()
                : undefined;

            const { chemin, erreur } = await deposerFichier(file, {
                dossier: `documents/${entrepriseData.id}`,
                point: 'coffre_fort',
                upsert: Boolean(nomExistant),
                nom: nomExistant,
            });
            if (erreur || !chemin) throw new Error(erreur || 'Dépôt refusé.');

            const { error: updateError } = await supabase.from('documents_candidature').update({ url: chemin, statut: 'en_attente', updated_at: new Date().toISOString() }).eq('id', docId);
            if (!updateError) setCustomDocs(prev => prev.map(d => d.id === docId ? { ...d, url: chemin, statut: 'en_attente' } : d));
            oublierUrl(chemin);
        } catch (err: any) {
            console.error(err);
            setError('Erreur lors de la mise à jour du document');
        } finally {
            setUploadingField(null);
        }
    };


    const inputClass = "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-1 focus:ring-filao-primary/30 transition-colors";
    const lockedInputClass = "w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-600 text-sm cursor-not-allowed";

    // Read-only info item component

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 text-filao-primary animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Page Header */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Mon Entreprise</h2>
                        <p className="text-gray-500 text-sm">Informations et dossier de candidature</p>
                    </div>
                    {formData.siret && (isVerified ? <VerifiedBadge /> : <UnverifiedBadge />)}
                </div>

                {/* Logo Upload Section - Absolute or separate? Let's put it near title or Card 1 */}
                {/* Actually, let's put it inside Card 1 (Identité) or as a header element. 
                    Given the design, putting it in the Identity card seems best, but let's see where to fit it. 
                    The mockups usually show it near the company name. 
                    Let's add it to the Indentity Card.
                */}


                <div className="flex gap-2">
                    {lectureSeule && subTab !== 'docs' && (
                        <span className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-[#0B1F38]/50 bg-[#EFF4F8]">
                            <ShieldCheck size={16} />
                            Géré par un administrateur
                        </span>
                    )}
                    {!lectureSeule && isVerified && !isEditing && subTab !== 'docs' && (
                        <button onClick={toggleEditMode}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-filao-primary bg-filao-primary/10 hover:bg-filao-primary/20 transition-colors">
                            <PenLine size={16} />
                            Modifier
                        </button>
                    )}
                    {!lectureSeule && (isEditing || !isVerified) && (
                        <>
                            {isEditing && isVerified && (
                                <button onClick={handleCancelEditing}
                                    className="px-4 py-2 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100 transition-colors">
                                    Annuler
                                </button>
                            )}
                            <button onClick={handleSave} disabled={saving}
                                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all ${saveSuccess ? 'bg-green-500 text-white' : 'bg-filao-primary text-white hover:shadow-md hover:shadow-filao-primary/20'} disabled:opacity-50`}>
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveSuccess ? <Check className="w-4 h-4" /> : null}
                                {saveSuccess ? 'Enregistré !' : 'Enregistrer'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Sub-tab navigation */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
                <button onClick={() => setSubTab('info')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab === 'info' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <Building2 size={15} />
                    Informations générales
                </button>
                <button onClick={() => setSubTab('docs')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab === 'docs' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <FolderOpen size={15} />
                    Documents de candidature
                </button>
                <button onClick={() => setSubTab('equipe')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${subTab === 'equipe' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    <Users size={15} />
                    Équipe{membres.length > 0 ? ` (${membres.length})` : ''}
                </button>
            </div>

            {error && <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}

            {/* =================== TAB: Informations générales =================== */}
            {subTab === 'info' && (
                <fieldset disabled={lectureSeule} className={lectureSeule ? 'opacity-80' : undefined}>
                <div className="space-y-3">
                    {/* SIRET Search — Only in EDIT mode */}
                    {isEditing && (
                        <>
                            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
                                <Search size={16} className="text-gray-400 shrink-0" />
                                <input type="text" value={siretInput}
                                    onChange={(e) => { setSiretInput(e.target.value.replace(/[^\d\s]/g, '')); setSearchError(null); }}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSiretSearch()}
                                    className="flex-1 bg-transparent text-sm text-gray-900 focus:outline-none placeholder:text-gray-400"
                                    placeholder="Rechercher par SIRET (14 chiffres)..." maxLength={17} />
                                {siretInput && (
                                    <button onClick={() => { setSiretInput(''); setSearchError(null); }}
                                        className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors shrink-0" title="Effacer">
                                        <X size={14} />
                                    </button>
                                )}
                                {isManualMode ? (
                                    <button onClick={handleCancelManualMode}
                                        className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors shrink-0" title="Annuler le mode manuel">
                                        <Undo2 size={12} /> Annuler
                                    </button>
                                ) : fieldsLocked && (
                                    <button onClick={handleManualMode}
                                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-filao-primary transition-colors shrink-0">
                                        <PenLine size={12} /> Manuel
                                    </button>
                                )}
                                <button onClick={handleSiretSearch}
                                    disabled={searching || siretInput.replace(/\s/g, '').length < 14}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-filao-primary text-white rounded-lg text-xs font-semibold hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0">
                                    {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                                    Rechercher
                                </button>
                            </div>
                            {searchError && <p className="text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">{searchError}</p>}
                        </>
                    )}

                    {/* Demandes de rattachement — administrateurs uniquement */}
                    {estAdmin && demandes.length > 0 && (() => {
                        const enAttente = demandes.filter((d: any) => d.statut === 'en_attente');
                        const refusees = demandes.filter((d: any) => d.statut === 'refusee');
                        return (
                        <div className="mb-3 bg-white border border-amber-200 rounded-2xl p-5">
                            <div className="flex items-start justify-between gap-4 mb-4">
                                <div>
                                    <h3 className="text-sm font-bold text-[#0B1F38]">
                                        {enAttente.length > 0
                                            ? `${enAttente.length} demande${enAttente.length > 1 ? 's' : ''} de rattachement`
                                            : 'Demandes de rattachement'}
                                    </h3>
                                    <p className="text-xs text-[#0B1F38]/50 mt-0.5">
                                        {enAttente.length > 0
                                            ? 'Ces personnes souhaitent rejoindre votre entreprise sur Filao.'
                                            : 'Aucune demande en attente.'}
                                    </p>
                                </div>
                                {/* `null` = forfait sans limite d'utilisateurs. */}
                                {placesRestantes !== undefined && (
                                    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0 ${
                                        placesRestantes === null ? 'text-[#0B1F38]/50 bg-gray-100'
                                            : placesRestantes > 0 ? 'text-emerald-700 bg-emerald-50'
                                                : 'text-red-600 bg-red-50'
                                    }`}>
                                        {placesRestantes === null
                                            ? 'Utilisateurs illimités'
                                            : `${placesRestantes} place${placesRestantes > 1 ? 's' : ''} restante${placesRestantes > 1 ? 's' : ''}`}
                                    </span>
                                )}
                            </div>

                            <div className="divide-y divide-gray-100">
                                {enAttente.map((d: any) => {
                                    const p = d.profil;
                                    const nom = [p?.prenom, p?.nom].filter(Boolean).join(' ') || p?.email || 'Utilisateur';
                                    return (
                                        <div key={d.id} className="flex items-center justify-between gap-4 py-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-[#0B1F38] truncate">{nom}</p>
                                                <p className="text-xs text-[#0B1F38]/45 truncate">
                                                    {p?.email}
                                                    {' · '}
                                                    {new Date(d.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    onClick={() => traiterDemande(d.id, true)}
                                                    disabled={demandeEnCours === d.id || placesRestantes === 0}
                                                    title={placesRestantes === 0 ? "Quota d'utilisateurs atteint" : undefined}
                                                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {demandeEnCours === d.id ? '…' : 'Accepter'}
                                                </button>
                                                <button
                                                    onClick={() => traiterDemande(d.id, false)}
                                                    disabled={demandeEnCours === d.id}
                                                    className="px-3 py-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold rounded-xl transition-colors disabled:opacity-40"
                                                >
                                                    Refuser
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Historique des refus.
                                Un refus par erreur doit pouvoir être corrigé : sans
                                cette liste, la demande disparaissait de l'écran et
                                seul le demandeur pouvait la relancer — sans savoir
                                qu'il avait été refusé. */}
                            {refusees.length > 0 && (
                                <details className="mt-4 pt-4 border-t border-gray-100">
                                    <summary className="text-xs font-bold text-[#0B1F38]/50 cursor-pointer hover:text-[#0B1F38]">
                                        {refusees.length} demande{refusees.length > 1 ? 's' : ''} refusée{refusees.length > 1 ? 's' : ''}
                                    </summary>
                                    <div className="divide-y divide-gray-100 mt-2">
                                        {refusees.map((d: any) => {
                                            const p = d.profil;
                                            const nom = [p?.prenom, p?.nom].filter(Boolean).join(' ') || p?.email || 'Utilisateur';
                                            return (
                                                <div key={d.id} className="flex items-center justify-between gap-4 py-3">
                                                    <div className="min-w-0">
                                                        <p className="text-sm text-[#0B1F38]/70 truncate">{nom}</p>
                                                        <p className="text-xs text-[#0B1F38]/40 truncate">
                                                            {d.motif_refus === 'quota_atteint'
                                                                ? "Refusée — nombre d'utilisateurs atteint"
                                                                : 'Refusée'}
                                                            {d.traite_le && ` · ${new Date(d.traite_le).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => traiterDemande(d.id, true)}
                                                        disabled={demandeEnCours === d.id || placesRestantes === 0}
                                                        title={placesRestantes === 0 ? "Quota d'utilisateurs atteint" : undefined}
                                                        className="px-3 py-1.5 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-[11px] font-bold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                                    >
                                                        {demandeEnCours === d.id ? '…' : 'Accepter finalement'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </details>
                            )}
                        </div>
                        );
                    })()}

                    {/* ========= READ-ONLY VIEW: 2×2 Grid of Cards ========= */}
                    {!isEditing && isVerified ? (
                        <CompanyInfoReadOnly
                            formData={formData}
                            entrepriseData={entrepriseData}
                            getLegalFormLabel={getLegalFormLabel}
                            visibleDansReseau={visibleReseau}
                            depotLogoEnCours={uploadingLogo}
                            savingReseau={savingReseau}
                            onDeposerLogo={handleLogoUpload}
                            onBasculerReseau={handleToggleReseau}
                            refDomains={refDomains}
                            refSpecialties={refSpecialties}
                            refExpertiseTags={refExpertiseTags}
                            refGeoZones={refGeoZones}
                            selectedNatures={selectedNatures}
                            selectedDomains={selectedDomains}
                            selectedSpecialties={selectedSpecialties}
                            selectedExpertiseTags={selectedExpertiseTags}
                            selectedGeoZones={selectedGeoZones}
                        />
                    ) : (
                        <CompanyInfoEditForm
                            formData={formData}
                            entrepriseData={entrepriseData}
                            onChangerChamp={handleInputChange}
                            refDomains={refDomains}
                            refSpecialties={refSpecialties}
                            refExpertiseTags={refExpertiseTags}
                            refGeoZones={refGeoZones}
                            selectedNatures={selectedNatures}
                            setSelectedNatures={setSelectedNatures}
                            selectedDomains={selectedDomains}
                            setSelectedDomains={setSelectedDomains}
                            selectedSpecialties={selectedSpecialties}
                            setSelectedSpecialties={setSelectedSpecialties}
                            selectedExpertiseTags={selectedExpertiseTags}
                            setSelectedExpertiseTags={setSelectedExpertiseTags}
                            selectedGeoZones={selectedGeoZones}
                            setSelectedGeoZones={setSelectedGeoZones}
                            fieldsLocked={fieldsLocked}
                            loadingRef={loadingRef}
                            visibleDansReseau={visibleReseau}
                            savingReseau={savingReseau}
                            onBasculerReseau={handleToggleReseau}
                        />
                    )}
                </div>
                </fieldset>
            )}

            {/* =================== TAB: Équipe =================== */}
            {subTab === 'equipe' && (
                <div className="bg-white border border-gray-200 rounded-2xl p-5">
                    <div className="mb-4">
                        <h3 className="text-sm font-bold text-[#0B1F38]">
                            {membres.length} membre{membres.length > 1 ? 's' : ''}
                        </h3>
                        <p className="text-xs text-[#0B1F38]/50 mt-0.5">
                            Les personnes rattachées à votre entreprise sur Filao.
                        </p>
                    </div>

                    <div className="divide-y divide-gray-100">
                        {membres.map((m) => {
                            const nom = [m.prenom, m.nom].filter(Boolean).join(' ') || m.email;
                            const initiales = (m.prenom?.[0] || '') + (m.nom?.[0] || m.email?.[0] || '');
                            const estAdminMembre = nomRoleAdmin && m.role_id === nomRoleAdmin;
                            return (
                                <div key={m.id} className="flex items-center gap-3 py-3">
                                    {m.photo_url ? (
                                        <img src={m.photo_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-[#EFF4F8] flex items-center justify-center text-xs font-bold text-[#0B1F38]/60 uppercase">
                                            {initiales}
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-[#0B1F38] truncate">
                                            {nom}
                                            {m.id === userProfile.id && <span className="text-[#0B1F38]/40 font-normal"> (vous)</span>}
                                        </p>
                                        <p className="text-xs text-[#0B1F38]/45 truncate">{m.email}</p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${estAdminMembre ? 'bg-[#E8F4FD] text-[#0078B8]' : 'bg-gray-100 text-gray-500'}`}>
                                        {estAdminMembre ? 'Administrateur' : 'Membre'}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* =================== TAB: Documents de candidature =================== */}
            {subTab === 'docs' && (
                <div className="flex flex-col h-full gap-3">
                    {/* Standard administrative docs banner */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                <FolderOpen size={14} />
                            </div>
                            <p className="text-xs font-semibold text-gray-800">Documents administratifs</p>
                            <span className="text-[10px] text-gray-400">·  Documents légaux obligatoires</span>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            {STANDARD_DOC_SLOTS.map(slot => {
                                const url = formData[slot.field];
                                const status = url ? computeEffectiveStatus(docStatuses[slot.field]) : undefined;
                                const statusColor = status === 'valide' ? 'text-emerald-500' : status === 'expire' ? 'text-red-500' : status === 'en_attente' ? 'text-amber-500' : 'text-gray-300';
                                return (
                                    <div key={slot.field} className="space-y-1.5">
                                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{slot.label}</p>
                                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                            <FileText size={14} className={statusColor} />
                                            {/* `substring(0, 20)` coupait le nom sans ellipse, en plus
                                                du `truncate` CSS : « Attestation_vigilan » au lieu de
                                                « Attestation_vigilance_URSSAF_2026.pdf ». On laisse le
                                                CSS gérer, et le nom complet reste lisible au survol. */}
                                            {/* Le document n'était consultable nulle part : on pouvait
                                                le déposer et le remplacer, jamais le relire. L'URL signée
                                                est demandée au clic, elle n'est valable qu'une heure. */}
                                            {url ? (
                                                <>
                                                    <button
                                                        onClick={() => ouvrirDocument(url)}
                                                        className="text-xs text-blue-600 flex-1 truncate text-left hover:underline"
                                                        title={`Ouvrir ${slot.label}`}
                                                    >
                                                        {/* Le nom stocké est canonique et sans extension
                                                            (« kbis ») : le libellé de l'emplacement est
                                                            plus parlant. */}
                                                        {slot.label}
                                                    </button>
                                                    {/* Téléchargement séparé : il rétablit une extension
                                                        déduite du type réel de l'objet, sans quoi le
                                                        fichier enregistré s'appellerait « kbis ». */}
                                                    <button
                                                        onClick={() => telechargerDocument(url, slot.label.replace(/[^\p{L}\p{N} _-]/gu, '').trim())}
                                                        title={`Télécharger ${slot.label}`}
                                                        aria-label={`Télécharger ${slot.label}`}
                                                        className="p-1 text-gray-400 hover:text-blue-600 shrink-0"
                                                    >
                                                        <Download size={12} />
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="text-xs text-gray-500 flex-1 truncate">Aucun fichier</span>
                                            )}
                                            <label className={`px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer transition-all shrink-0 ${uploadingField === slot.field ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                                                }`}>
                                                {uploadingField === slot.field ? <Loader2 size={12} className="animate-spin" /> : <><Upload size={10} className="inline mr-1" />{url ? 'Modifier' : 'Ajouter'}</>}
                                                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => handleDocumentUpload(e, slot.field)} className="hidden" disabled={uploadingField === slot.field} />
                                            </label>
                                        </div>
                                        {/* Date d'expiration : seulement pour les documents qui en
                                            portent une (assurance). Les autres dérivent leur fraîcheur
                                            d'une durée conventionnelle, sans saisie. Visible une fois le
                                            document déposé. */}
                                        {slot.saisieExpiration && url && (
                                            <div className="flex items-center gap-1.5 px-1">
                                                <CalendarIcon size={11} className="text-gray-400 shrink-0" />
                                                <label className="text-[10px] text-gray-500 shrink-0">Expire le</label>
                                                <input
                                                    type="date"
                                                    value={standardDocExpiry[slot.field] || ''}
                                                    onChange={(e) => setStandardDocExpiry(prev => ({ ...prev, [slot.field]: e.target.value }))}
                                                    onBlur={() => handleUpdateExpiry(slot.field)}
                                                    className="text-[10px] text-gray-700 bg-transparent border-b border-gray-200 focus:border-blue-400 focus:outline-none flex-1 min-w-0"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* 3x2 Category cards grid (Library structure) */}
                    <div className="grid grid-cols-3 gap-3">
                        {DOC_CATEGORIES.map((cat) => {
                            const catCustomDocs = customDocs.filter(d => d.categorie === cat.key);
                            const CatIcon = cat.icon;

                            return (
                                <div key={cat.key} className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col p-4">
                                    {/* Card header */}
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-7 h-7 rounded-lg bg-filao-primary/10 text-filao-primary flex items-center justify-center shrink-0">
                                            <CatIcon size={14} />
                                        </div>
                                        <p className="text-sm font-semibold text-gray-800">{cat.label}</p>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mb-3">{cat.description}</p>

                                    {/* Default document slots */}
                                    <div className="flex-1 space-y-3">
                                        {cat.defaultDocs.map(docLabel => {
                                            const matchingDoc = catCustomDocs.find(d => d.label === docLabel);
                                            return (
                                                <div key={docLabel}>
                                                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{docLabel}</p>
                                                    <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                                        <FileText size={14} className={matchingDoc ? 'text-emerald-500' : 'text-gray-300'} />
                                                        <span className="text-xs text-gray-500 flex-1 truncate" title={matchingDoc?.label}>
                                                            {matchingDoc ? matchingDoc.label : 'Aucun fichier'}
                                                        </span>
                                                        {matchingDoc ? (
                                                            <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 shrink-0 transition-all">
                                                                <Upload size={10} className="inline mr-1" />Modifier
                                                                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                                    onChange={(e) => handleCustomDocReupload(e, matchingDoc.id)} className="hidden" />
                                                            </label>
                                                        ) : (
                                                            <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 shrink-0 transition-all">
                                                                <Upload size={10} className="inline mr-1" />Ajouter
                                                                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                                    onChange={(e) => handleAddCustomDoc(e, cat.key, docLabel)} className="hidden" />
                                                            </label>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* Extra custom docs added by user */}
                                        {catCustomDocs.filter(d => !cat.defaultDocs.includes(d.label)).map(doc => (
                                            <div key={doc.id}>
                                                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{doc.label}</p>
                                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 group">
                                                    <FileText size={14} className="text-emerald-500" />
                                                    <div className="flex-1 min-w-0 flex flex-col">
                                                        <span className="text-xs text-gray-700 truncate font-medium" title={doc.label}>{doc.label}</span>
                                                        {doc.created_at && (
                                                            <span className="text-[9px] text-gray-400">
                                                                Ajouté le {formatDate(doc.created_at)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 shrink-0 transition-all opacity-0 group-hover:opacity-100">
                                                        <Upload size={10} className="inline mr-1" />Modifier
                                                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                            onChange={(e) => handleCustomDocReupload(e, doc.id)} className="hidden" />
                                                    </label>
                                                    <button onClick={() => handleDeleteCustomDoc(doc.id)}
                                                        className="text-gray-300 hover:text-red-500 transition-colors p-1" title="Supprimer">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Pending Document Row (When adding) */}
                                    {
                                        addingInCategory === cat.key && (
                                            <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Nouveau document</p>
                                                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                                    <FileText size={14} className="text-gray-300" />
                                                    <input type="text"
                                                        value={newDocLabel}
                                                        onChange={(e) => setNewDocLabel(e.target.value)}
                                                        placeholder={cat.placeholder || "Nom du document..."}
                                                        className="flex-1 bg-transparent border-none text-xs focus:ring-0 px-0 text-gray-700 placeholder:text-gray-400 font-medium"
                                                        autoFocus
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <label className="px-2.5 py-1 rounded-md text-[10px] font-semibold cursor-pointer bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 shrink-0 transition-all flex items-center">
                                                            {uploadingField === 'custom_new' ? <Loader2 size={10} className="animate-spin mr-1" /> : <Upload size={10} className="inline mr-1" />}
                                                            {uploadingField === 'custom_new' ? '...' : 'Ajouter'}
                                                            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                                                                onChange={(e) => handleAddCustomDoc(e, cat.key)} className="hidden" disabled={uploadingField === 'custom_new'} />
                                                        </label>
                                                        <button onClick={() => { setAddingInCategory(null); setNewDocLabel(''); }} className="text-gray-400 hover:text-gray-600 transition-colors p-1" title="Annuler">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    }

                                    {/* Add custom document footer button */}
                                    {
                                        !addingInCategory && (
                                            <div className="mt-3 pt-2 border-t border-gray-100">
                                                <button onClick={() => { setAddingInCategory(cat.key); setNewDocLabel(''); }}
                                                    className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-filao-primary transition-colors cursor-pointer">
                                                    <Plus size={14} /> Ajouter un document
                                                </button>
                                            </div>
                                        )
                                    }
                                </div>
                            );
                        })}
                    </div>
                </div>
            )
            }
        </div >
    );
};