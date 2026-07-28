import React, { useState, useEffect, useRef } from 'react';
import { ouvrirDocument, telechargerDocument, oublierUrl } from '../../helpers/storageHelpers';
import { deposerFichier } from '../../helpers/uploadHelpers';
import { Building2, Briefcase, FolderOpen, Wrench, Plus, X, Loader2, Check, Search, ShieldCheck, ShieldAlert, PenLine, Upload, Calendar as CalendarIcon, MapPin, Hash, Globe, Eye, EyeOff, Award, Users, Cpu, FileStack, ExternalLink, FileText, Leaf, Map, ChevronDown, Download } from 'lucide-react';
import { SettingsCard } from './SettingsCard';
import { DocumentInput } from './DocumentInput';
import { supabase } from '../../lib/supabaseClient';
import { UserProfile, SKILLS, INSEE_SECTION_LABELS, FRENCH_REGIONS } from '../../config';
import { Entreprise } from '../../types';
import { Undo2 } from 'lucide-react';
import { SpecialtyAccordion } from '../ui/SpecialtyAccordion';

interface CompanyTabProps {
    userProfile: UserProfile | null;
    onUpdate: () => void;
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

export const CompanyTab: React.FC<CompanyTabProps> = ({ userProfile, onUpdate }) => {
    const [entrepriseData, setEntrepriseData] = useState<Entreprise | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
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
    const [subTab, setSubTab] = useState<'info' | 'docs'>('info');

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

    // Standard administrative document slots (stored on utilisateurs table)
    const STANDARD_DOC_SLOTS = [
        { label: 'Kbis / Extrait D1', field: 'kbis_url' as const },
        { label: 'Attestation sur l\'honneur', field: 'attestation_honneur_url' as const },
        { label: 'Attestation Assurance', field: 'attestation_assurance_url' as const },
        { label: 'Statuts', field: 'presentation_societe_url' as const },
    ];

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

            // Fetch custom documents
            const { data: docs } = await supabase
                .from('documents_candidature')
                .select('id, label, url, statut, categorie, created_at, uploaded_by')
                .eq('entreprise_id', entId)
                .order('created_at', { ascending: true });
            setCustomDocs((docs || []).map(d => ({ ...d, categorie: d.categorie || 'presentation' })));

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
                kbis_url: userProfile?.kbis_url || '',
                presentation_societe_url: userProfile?.presentation_societe_url || '',
                attestation_honneur_url: userProfile?.attestation_honneur_url || '',
                attestation_assurance_url: userProfile?.attestation_assurance_url || '',
            });

            // Load document statuses
            if (userProfile?.document_statuses) {
                const raw = userProfile.document_statuses as Record<string, any>;
                const loaded: Record<string, DocStatusEntry> = {};
                let needsDbUpdate = false;
                for (const [key, val] of Object.entries(raw)) {
                    const entry: DocStatusEntry = typeof val === 'string'
                        ? { status: val as DocStatus, uploaded_at: null }
                        : { status: val.status || 'en_attente', uploaded_at: val.uploaded_at || null };
                    const effective = computeEffectiveStatus(entry);
                    if (effective !== entry.status) {
                        entry.status = effective;
                        needsDbUpdate = true;
                    }
                    loaded[key] = entry;
                }
                setDocStatuses(prev => ({ ...prev, ...loaded }));
                if (needsDbUpdate && userProfile?.id) {
                    supabase.from('utilisateurs').update({ document_statuses: loaded }).eq('id', userProfile.id);
                }
            }

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
        if (!userProfile) return;
        try {
            setSaving(true);
            setError(null);
            setSaveSuccess(false);

            let entId = entrepriseData?.id;

            const companyPayload = {
                nom: formData.nom,
                siret: formData.siret,
                adresse: formData.adresse,
                ville: formData.ville,
                code_postal: formData.code_postal,
                taille: formData.taille,
                forme_juridique: formData.forme_juridique,
                code_naf: formData.code_naf,
                libelle_naf: formData.libelle_naf,
                date_creation: formData.date_creation,
                prenom: formData.prenom || null,
                nom_famille: formData.nom_famille || null,
                effectif: formData.effectif || 1,
                site_web: formData.site_web || null,
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
            setTimeout(() => setSaveSuccess(false), 3000);
            if (isVerified) setIsEditing(false);
            onUpdate();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>, dbField: string) => {
        const file = e.target.files?.[0];
        if (!file || !userProfile) return;
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
            setFormData(prev => ({ ...prev, [dbField]: chemin }));
            oublierUrl(chemin);

            const now = new Date().toISOString();
            const newStatuses = { ...docStatuses, [dbField]: { status: 'valide' as DocStatus, uploaded_at: now } };
            setDocStatuses(newStatuses);
            await supabase.from('utilisateurs').update({ [dbField]: chemin, document_statuses: newStatuses }).eq('id', userProfile.id);
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
        if (!userProfile?.id) return;
        const newStatuses = { ...docStatuses, [field]: { status: 'valide' as DocStatus, uploaded_at: docStatuses[field]?.uploaded_at || new Date().toISOString() } };
        setDocStatuses(newStatuses);
        await supabase.from('utilisateurs').update({ document_statuses: newStatuses }).eq('id', userProfile.id);
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
    const InfoItem = ({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: any }) => (
        <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
            <div className="flex items-center gap-1.5 text-sm text-gray-900">
                {Icon && <Icon size={14} className="text-gray-400 shrink-0" />}
                {value || <span className="text-gray-400 italic text-xs">Non renseigné</span>}
            </div>
        </div>
    );

    // Badges
    const VerifiedBadge = () => (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck size={14} />
            Vérifié via SIRET
        </span>
    );

    const UnverifiedBadge = () => (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <ShieldAlert size={14} />
            Non vérifié
        </span>
    );

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
                    {isVerified && !isEditing && subTab !== 'docs' && (
                        <button onClick={toggleEditMode}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-filao-primary bg-filao-primary/10 hover:bg-filao-primary/20 transition-colors">
                            <PenLine size={16} />
                            Modifier
                        </button>
                    )}
                    {(isEditing || !isVerified) && (
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
            </div>

            {error && <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">{error}</div>}

            {/* =================== TAB: Informations générales =================== */}
            {subTab === 'info' && (
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

                    {/* ========= READ-ONLY VIEW: 2×2 Grid of Cards ========= */}
                    {!isEditing && isVerified ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {/* Card 1: Identité */}
                                <SettingsCard title="Identité" icon={Building2}>
                                    <div className="flex items-start gap-4">
                                        <div className="relative group shrink-0">
                                            <div className="w-16 h-16 rounded-xl border border-gray-100 bg-white flex items-center justify-center overflow-hidden shadow-sm">
                                                {entrepriseData?.logo_url ? (
                                                    <img src={entrepriseData.logo_url} alt="Logo" className="w-full h-full object-contain" />
                                                ) : (
                                                    <Building2 className="w-8 h-8 text-gray-300" />
                                                )}
                                            </div>
                                            {!isEditing && ( // Allow edit even in view mode? Or only in edit mode? ProfileTab allows it always.
                                                <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                                                    {uploadingLogo ? <Loader2 className="w-5 h-5 animate-spin text-white" /> : <Upload className="w-5 h-5 text-white" />}
                                                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={uploadingLogo} />
                                                </label>
                                            )}
                                        </div>
                                        <div className="space-y-3 flex-1">
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">{formData.nom}</p>
                                                {(formData.prenom || formData.nom_famille) && (
                                                    <p className="text-xs text-gray-500 font-medium">{formData.prenom} {formData.nom_famille}</p>
                                                )}
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md font-mono">{formData.siret}</span>
                                                    <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md">{getLegalFormLabel(formData.forme_juridique, formData.forme_juridique)}</span>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <InfoItem label="Date de création" value={formatDate(formData.date_creation)} icon={CalendarIcon} />
                                                <div className="flex gap-4">
                                                    <InfoItem label="Taille" value={formData.taille} />
                                                    <InfoItem label="Effectif" value={formData.effectif} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* Card 2: Localisation */}
                                <SettingsCard title="Localisation" icon={MapPin}>
                                    <div className="space-y-3">
                                        <div>
                                            <p className="text-sm text-gray-900">{formData.adresse}</p>
                                            <p className="text-sm text-gray-900">{formData.code_postal} {formData.ville}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <InfoItem label="N° TVA" value={formData.tva} icon={Hash} />
                                            <InfoItem label="Poste occupé" value={formData.poste} />
                                        </div>
                                        {formData.site_web && (
                                            <InfoItem label="Site web" value={formData.site_web} icon={Globe} />
                                        )}
                                    </div>
                                </SettingsCard>

                                {/* Card 3: Activité & Spécialités (Summary) */}
                                <SettingsCard title="Activités & Spécialités" icon={Briefcase}>
                                    <div className="space-y-4">
                                        {/* Natures */}
                                        <div className="flex flex-wrap gap-2">
                                            {selectedNatures.map(n => (
                                                <span key={n} className="px-3 py-1 rounded-full bg-filao-primary text-white text-[10px] font-bold uppercase tracking-wider">
                                                    {n}
                                                </span>
                                            ))}
                                            {selectedNatures.length === 0 && <span className="text-gray-400 italic text-xs">Aucune nature d'activité</span>}
                                        </div>

                                        {/* Structured Skills Summary */}
                                        <div className="space-y-3">
                                            {refDomains
                                                .filter(dom => selectedDomains.includes(dom.id))
                                                .map(dom => {
                                                    const domSpecs = selectedSpecialties.filter(s => {
                                                        const ref = refSpecialties.find(rs => rs.id === s.specialty_id);
                                                        return ref?.domain_id === dom.id;
                                                    });
                                                    if (domSpecs.length === 0) return null;

                                                    return (
                                                        <div key={dom.id} className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                                                            <p className="text-[11px] font-bold text-gray-700 mb-2 uppercase tracking-tight">{dom.label}</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {domSpecs.map(s => {
                                                                    const ref = refSpecialties.find(rs => rs.id === s.specialty_id);
                                                                    return (
                                                                        <span key={s.specialty_id} className="px-2 py-0.5 bg-white border border-gray-200 text-gray-600 rounded text-[11px] font-medium">
                                                                            {ref?.label}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            {selectedDomains.length === 0 && <p className="text-xs text-gray-400 italic px-1">Aucune spécialité sélectionnée</p>}
                                        </div>
                                    </div>
                                </SettingsCard>

                                {/* Card 4: Réseau Filao */}
                                <SettingsCard title="Réseau Filao" icon={Globe}>
                                    <div className="space-y-3">
                                        <p className="text-xs text-gray-500">
                                            Rendez votre entreprise visible dans l'annuaire Filao. Les autres entreprises pourront vous trouver et vous inviter à collaborer sur des appels d'offres.
                                        </p>
                                        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                {visibleReseau ? <Eye size={16} className="text-emerald-600" /> : <EyeOff size={16} className="text-gray-400" />}
                                                <span className="text-sm font-medium text-gray-900">
                                                    {visibleReseau ? 'Visible sur le réseau' : 'Masqué du réseau'}
                                                </span>
                                            </div>
                                            <button
                                                onClick={handleToggleReseau}
                                                disabled={savingReseau || !entrepriseData?.id}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${visibleReseau ? 'bg-emerald-500' : 'bg-gray-300'} ${savingReseau ? 'opacity-50' : ''}`}
                                                role="switch"
                                                aria-checked={visibleReseau}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${visibleReseau ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                        {!entrepriseData?.id && (
                                            <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">Enregistrez d'abord votre entreprise pour activer cette option.</p>
                                        )}
                                    </div>
                                </SettingsCard>
                            </div>

                             {/* Expertises & Zones Summary (Full Width) */}
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                 <SettingsCard title="Expertises & Qualifications" icon={ShieldCheck}>
                                     <div className="flex flex-wrap gap-1.5">
                                         {selectedExpertiseTags.map(tagId => {
                                             const tag = refExpertiseTags.find(t => t.id === tagId);
                                             return (
                                                 <span key={tagId} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg text-xs font-semibold">
                                                     {tag?.label}
                                                 </span>
                                             );
                                         })}
                                         {selectedExpertiseTags.length === 0 && <span className="text-gray-400 italic text-xs">Aucune expertise renseignée</span>}
                                     </div>
                                 </SettingsCard>

                                 <SettingsCard title="Périmètre géographique" icon={MapPin}>
                                     <div className="flex flex-wrap gap-1.5">
                                         {selectedGeoZones.length >= 13 && refGeoZones.filter(z => z.zone_type === 'metropole').every(z => selectedGeoZones.includes(z.id)) ? (
                                             <span className="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-bold uppercase tracking-tight">
                                                 France Entière (Métropole)
                                             </span>
                                         ) : (
                                             selectedGeoZones.map(zoneId => {
                                                 const zone = refGeoZones.find(z => z.id === zoneId);
                                                 return (
                                                     <span key={zoneId} className="px-2.5 py-1 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-xs font-medium">
                                                         {zone?.label}
                                                     </span>
                                                 );
                                             })
                                         )}
                                         {selectedGeoZones.length === 0 && <span className="text-gray-400 italic text-xs">Aucune zone sélectionnée</span>}
                                     </div>
                                 </SettingsCard>
                             </div>
                        </>
                    ) : (
                        /* ========= EDITABLE FORM VIEW ========= */
                        <div className="space-y-3">
                            <SettingsCard title="Identité & Localisation" icon={Building2}>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                    <div className="col-span-2">
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Nom de l'entreprise</label>
                                        <input type="text" value={formData.nom} onChange={(e) => handleInputChange('nom', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="Ex: Filao SAS" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">SIRET</label>
                                        <input type="text" value={formData.siret} className={lockedInputClass} disabled placeholder="Via recherche" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Effectif</label>
                                        <input type="number" value={formData.effectif} onChange={(e) => handleInputChange('effectif', e.target.value)}
                                            className={inputClass} placeholder="1" min="1" />
                                    </div>

                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Prénom (Dirigeant)</label>
                                        <input type="text" value={formData.prenom} onChange={(e) => handleInputChange('prenom', e.target.value)}
                                            className={inputClass} placeholder="Prénom" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Nom (Dirigeant)</label>
                                        <input type="text" value={formData.nom_famille} onChange={(e) => handleInputChange('nom_famille', e.target.value)}
                                            className={inputClass} placeholder="Nom" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Forme juridique</label>
                                        <input type="text" value={formData.forme_juridique} onChange={(e) => handleInputChange('forme_juridique', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="SAS, SARL..." />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Taille</label>
                                        <select value={formData.taille} onChange={(e) => handleInputChange('taille', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked}>
                                            <option value="">Taille</option>
                                            <option value="Micro/TPE">Micro/TPE</option>
                                            <option value="PME">PME</option>
                                            <option value="ETI">ETI</option>
                                            <option value="GE">GE</option>
                                        </select>
                                    </div>

                                    <div className="col-span-2">
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Code NAF</label>
                                        <input type="text" value={formData.code_naf} onChange={(e) => handleInputChange('code_naf', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="62.01Z" />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-xs font-medium text-gray-600 mb-0.5 block">Activité (NAF)</label>
                                        <input type="text" value={formData.libelle_naf} onChange={(e) => handleInputChange('libelle_naf', e.target.value)}
                                            className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="Libellé de l'activité" />
                                    </div>

                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-2 mt-1">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                            <div className="col-span-2">
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Adresse</label>
                                                <input type="text" value={formData.adresse} onChange={(e) => handleInputChange('adresse', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="Ex: 15 Rue des Capucines" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Ville</label>
                                                <input type="text" value={formData.ville} onChange={(e) => handleInputChange('ville', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Code Postal</label>
                                                <input type="text" value={formData.code_postal} onChange={(e) => handleInputChange('code_postal', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-2 mt-1">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-2">
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Date de création</label>
                                                <input type="text" value={formData.date_creation} onChange={(e) => handleInputChange('date_creation', e.target.value)}
                                                    className={fieldsLocked ? lockedInputClass : inputClass} disabled={fieldsLocked} placeholder="AAAA-MM-JJ" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">N° TVA</label>
                                                <input type="text" value={formData.tva} onChange={(e) => handleInputChange('tva', e.target.value)} className={inputClass} placeholder="FR..." />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="text-xs font-medium text-gray-600 mb-0.5 block">Site web</label>
                                                <input type="url" value={formData.site_web} onChange={(e) => handleInputChange('site_web', e.target.value)} className={inputClass} placeholder="https://www.exemple.fr" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Zone d'intervention — Premium Grid */}
                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-4 mt-2">
                                        <div className="flex items-center justify-between mb-3">
                                            <div>
                                                <label className="text-sm font-bold text-gray-900">Zone d'intervention</label>
                                                <p className="text-xs text-gray-400">Sélectionnez vos régions d'activité (Métropole & DOM-TOM)</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const metroIds = refGeoZones.filter(z => z.zone_type === 'metropole').map(z => z.id);
                                                    const alreadyHasAll = metroIds.every(id => selectedGeoZones.includes(id));
                                                    if (alreadyHasAll) {
                                                        setSelectedGeoZones(prev => prev.filter(id => !metroIds.includes(id)));
                                                    } else {
                                                        setSelectedGeoZones(prev => Array.from(new Set([...prev, ...metroIds])));
                                                    }
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                    refGeoZones.filter(z => z.zone_type === 'metropole').length > 0 && 
                                                    refGeoZones.filter(z => z.zone_type === 'metropole').every(z => selectedGeoZones.includes(z.id))
                                                        ? 'bg-filao-primary text-white border-filao-primary shadow-sm'
                                                        : 'bg-white text-filao-primary border-filao-primary/20 hover:border-filao-primary/50'
                                                }`}
                                            >
                                                France Entière
                                            </button>
                                        </div>

                                        <div className="space-y-4">
                                            {/* Metropole Grid */}
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                                                {refGeoZones.filter(z => z.zone_type === 'metropole').map(zone => (
                                                    <button
                                                        key={zone.id}
                                                        type="button"
                                                        onClick={() => setSelectedGeoZones(prev => prev.includes(zone.id) ? prev.filter(id => id !== zone.id) : [...prev, zone.id])}
                                                        className={`px-3 py-2 rounded-xl text-left transition-all border ${
                                                            selectedGeoZones.includes(zone.id)
                                                                ? 'bg-filao-primary/5 border-filao-primary text-filao-primary ring-1 ring-filao-primary/20'
                                                                : 'bg-white border-gray-100 text-gray-600 hover:border-gray-300'
                                                        }`}
                                                    >
                                                        <p className="text-[11px] font-bold truncate leading-tight" title={zone.label}>{zone.label}</p>
                                                    </button>
                                                ))}
                                            </div>

                                            {/* DOM-TOM Section */}
                                            {refGeoZones.some(z => z.zone_type === 'domtom') && (
                                                <div className="bg-gray-50/50 rounded-xl p-3 border border-gray-100">
                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Départements d'Outre-mer</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {refGeoZones.filter(z => z.zone_type === 'domtom').map(zone => (
                                                            <button
                                                                key={zone.id}
                                                                type="button"
                                                                onClick={() => setSelectedGeoZones(prev => prev.includes(zone.id) ? prev.filter(id => id !== zone.id) : [...prev, zone.id])}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                                                                    selectedGeoZones.includes(zone.id)
                                                                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                                                        : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                                                                }`}
                                                            >
                                                                {zone.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expertises & Qualifications — Accordion Select */}
                                    <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-4 mt-2">
                                        <label className="text-sm font-bold text-gray-900 mb-1 block">Expertises & Qualifications</label>
                                        <p className="text-xs text-gray-400 mb-4">Ciblez vos compétences transversales et certifications.</p>

                                        <div className="space-y-2">
                                            {[
                                                { key: 'environnement', label: 'Approches environnementales & énergétiques', icon: Leaf },
                                                { key: 'contexte', label: 'Contextes d\'intervention', icon: Map },
                                                { key: 'methodologie', label: 'Méthodologies & outils', icon: Wrench },
                                                { key: 'certification', label: 'Certifications & labels', icon: ShieldCheck }
                                            ].map((thematic) => (
                                                <div key={thematic.key} className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedThematic(prev => prev === thematic.key ? null : thematic.key)}
                                                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-gray-50 text-gray-400 flex items-center justify-center">
                                                                <thematic.icon size={16} />
                                                            </div>
                                                            <div className="text-left">
                                                                <p className="text-[13px] font-bold text-gray-800">{thematic.label}</p>
                                                                <p className="text-[10px] text-gray-400">
                                                                    {selectedExpertiseTags.filter(id => refExpertiseTags.find(t => t.id === id)?.thematic === thematic.key).length} sélectionné(s)
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <ChevronDown className={`text-gray-400 transition-transform duration-300 ${expandedThematic === thematic.key ? 'rotate-180' : ''}`} size={16} />
                                                    </button>

                                                    {expandedThematic === thematic.key && (
                                                        <div className="p-4 bg-gray-50/30 border-t border-gray-50">
                                                            <div className="flex flex-wrap gap-2">
                                                                {refExpertiseTags.filter(t => t.thematic === thematic.key).map(tag => (
                                                                    <button
                                                                        key={tag.id}
                                                                        type="button"
                                                                        onClick={() => setSelectedExpertiseTags(prev => prev.includes(tag.id) ? prev.filter(id => id !== tag.id) : [...prev, tag.id])}
                                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                                            selectedExpertiseTags.includes(tag.id)
                                                                                ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                                                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                                                                        }`}
                                                                    >
                                                                        {tag.label}
                                                                    </button>
                                                                ))}
                                                                {refExpertiseTags.filter(t => t.thematic === thematic.key).length === 0 && (
                                                                    <p className="text-xs text-gray-400 italic">Aucun tag disponible pour cette thématique.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                            
                            </div>
                            </SettingsCard>

                            <SettingsCard
                                title="Activités & Spécialités"
                                description="Définissez votre nature d'activité, vos domaines d'intervention et vos spécialités pour un meilleur matching."
                                icon={Briefcase}
                            >
                                {loadingRef ? (
                                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                                        <Loader2 className="w-8 h-8 text-filao-primary animate-spin" />
                                        <p className="text-sm text-gray-400 font-medium">Chargement de la taxonomie...</p>
                                    </div>
                                ) : (
                                    <div className={!isEditing ? "pointer-events-none opacity-80" : ""}>
                                        <SpecialtyAccordion
                                            selectedNatures={selectedNatures}
                                            onNaturesChange={setSelectedNatures}
                                            selectedDomains={selectedDomains}
                                            onDomainsChange={setSelectedDomains}
                                            selectedSpecialties={selectedSpecialties}
                                            onSpecialtiesChange={setSelectedSpecialties}
                                            refDomains={refDomains}
                                            refSpecialties={refSpecialties}
                                        />
                                        {!isEditing && (
                                            <div className="mt-6 pt-6 border-t border-gray-100">
                                                <p className="text-xs text-blue-600 bg-blue-50 p-3 rounded-lg border border-blue-100">
                                                    Activez le mode édition pour modifier vos spécialités.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </SettingsCard>

                            {/* Réseau Filao — also in edit mode */}
                            <SettingsCard title="Réseau Filao" icon={Globe}>
                                <div className="space-y-3">
                                    <p className="text-xs text-gray-500">
                                        Rendez votre entreprise visible dans l'annuaire Filao. Les autres entreprises pourront vous trouver et vous inviter à collaborer sur des appels d'offres.
                                    </p>
                                    <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            {visibleReseau ? <Eye size={16} className="text-emerald-600" /> : <EyeOff size={16} className="text-gray-400" />}
                                            <span className="text-sm font-medium text-gray-900">
                                                {visibleReseau ? 'Visible sur le réseau' : 'Masqué du réseau'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={handleToggleReseau}
                                            disabled={savingReseau || !entrepriseData?.id}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${visibleReseau ? 'bg-emerald-500' : 'bg-gray-300'} ${savingReseau ? 'opacity-50' : ''}`}
                                            role="switch" aria-checked={visibleReseau}>
                                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${visibleReseau ? 'translate-x-6' : 'translate-x-1'}`} />
                                        </button>
                                    </div>
                                    {!entrepriseData?.id && (
                                        <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg">Enregistrez d'abord votre entreprise pour activer cette option.</p>
                                    )}
                                </div>
                            </SettingsCard>
                        </div>
                    )}
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