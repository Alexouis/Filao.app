import React, { useState, useEffect } from 'react';
import {
    Building2, Wrench, FolderOpen, Rocket, Search, Loader2, Check, X,
    PenLine, ChevronRight, ChevronLeft, ArrowRight,
    LayoutDashboard, Sparkles, LogOut,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { UserProfile, SKILLS, APP_CONFIG, FRENCH_REGIONS, getFormeJuridiqueLabel } from '../config';
import { track } from '../helpers/analytics';

// Types for the new taxonomy
interface RefDomain {
    id: string;
    label: string;
    natures: string[];
}

interface RefSpecialty {
    id: string;
    domain_id: string;
    label: string;
}

interface RefGeoZone {
    id: string;
    label: string;
    zone_type: 'metropole' | 'domtom';
}

interface SelectedSpecialty {
    specialty_id: string;
    custom_label?: string;
}

interface OnboardingWizardProps {
    userProfile: UserProfile;
    onComplete: (goToWizard?: boolean) => void;
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


const STEPS = [
    { id: 1, label: 'Entreprise', icon: Building2 },
    { id: 2, label: 'Compétences et zone d\'intervention', icon: Wrench },
    { id: 3, label: 'C\'est parti !', icon: Rocket },
];

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ userProfile, onComplete }) => {
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);

    const [entryMode, setEntryMode] = useState<'siret' | 'manual'>('siret');

    // --- Step 1: Company ---
    const [siretInput, setSiretInput] = useState('');
    // Entreprise déjà inscrite détectée au même SIRET : bascule l'écran sur la
    // demande de rattachement plutôt que d'échouer sur la contrainte UNIQUE.
    const [entrepriseExistante, setEntrepriseExistante] = useState<{ id: string; nom: string } | null>(null);
    const [demandeEnvoyee, setDemandeEnvoyee] = useState(false);
    // Entreprise sans membre actif : aucun administrateur ne peut valider.
    const [entrepriseOrpheline, setEntrepriseOrpheline] = useState(false);
    // Demande de rattachement refusée par un administrateur de l'entreprise.
    const [demandeRefusee, setDemandeRefusee] = useState(false);
    const [cleReprise, setCleReprise] = useState('');
    const [cleErreur, setCleErreur] = useState<string | null>(null);

    // Une demande de rattachement est peut-être déjà en cours : l'utilisateur
    // n'a pas d'entreprise (il est donc renvoyé ici par le gardien de première
    // connexion), mais il n'a rien à ressaisir — il attend une validation. Sans
    // ce contrôle, un rechargement le ramenait au formulaire SIRET.
    useEffect(() => {
        if (!userProfile?.id || userProfile?.entreprise_id) return;
        let annule = false;
        (async () => {
            const { data } = await supabase
                .from('demandes_rattachement')
                .select('entreprise_id, statut, entreprises(nom)')
                .eq('utilisateur_id', userProfile.id)
                // On ne filtre plus sur « en_attente » : une demande REFUSÉE
                // disparaissait de l'écran, renvoyant l'utilisateur au
                // formulaire SIRET comme si rien ne s'était passé. Il
                // redemandait alors sans jamais apprendre qu'il avait été
                // refusé — et l'administrateur recevait une notification de
                // plus à chaque tour.
                .in('statut', ['en_attente', 'refusee'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (annule || !data) return;
            setEntrepriseExistante({
                id: data.entreprise_id,
                nom: (data as any).entreprises?.nom || 'cette entreprise',
            });
            if (data.statut === 'refusee') setDemandeRefusee(true);
            else setDemandeEnvoyee(true);
        })();
        return () => { annule = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile?.id, userProfile?.entreprise_id]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [fieldsLocked, setFieldsLocked] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [companyData, setCompanyData] = useState({
        nom: '', 
        prenom: '',
        nom_famille: '',
        siret: '', adresse: '', ville: '', code_postal: '',
        taille: '', 
        effectif: '',
        forme_juridique: '',
        code_naf: '', libelle_naf: '', date_creation: '',
        site_web: '',
    });
    const [userData, setUserData] = useState({ poste: '' });
    const [entrepriseId, setEntrepriseId] = useState<string | null>(null);

    // --- Step 2: Advanced Taxonomy ---
    const [refDomains, setRefDomains] = useState<RefDomain[]>([]);
    const [refSpecialties, setRefSpecialties] = useState<RefSpecialty[]>([]);
    const [refGeoZones, setRefGeoZones] = useState<RefGeoZone[]>([]);

    const [selectedNatures, setSelectedNatures] = useState<string[]>([]);
    const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
    const [selectedSpecialties, setSelectedSpecialties] = useState<SelectedSpecialty[]>([]);
    // Domaines dont la liste complète de spécialités est dépliée.
    const [domainesDeplies, setDomainesDeplies] = useState<string[]>([]);
    const [selectedZones, setSelectedZones] = useState<string[]>([]);
    const [otherLabels, setOtherLabels] = useState<Record<string, string>>({}); // specialtyId -> text

    const [loadingRef, setLoadingRef] = useState(true);
    const [skillSearch, setSkillSearch] = useState('');

    // --- Step 4: Summary ---

    // Load existing enterprise and skills
    useEffect(() => {
        const loadExisting = async () => {
            if (userProfile.entreprise_id) {
                const { data: ent } = await supabase
                    .from('entreprises')
                    .select('*')
                    .eq('id', userProfile.entreprise_id)
                    .single();
                if (ent) {
                    setEntrepriseId(ent.id);
                    setCompanyData({
                        nom: ent.nom || '', 
                        prenom: ent.prenom || '',
                        nom_famille: ent.nom_famille || '',
                        siret: ent.siret || '', adresse: ent.adresse || '',
                        ville: ent.ville || '', code_postal: ent.code_postal || '',
                        taille: ent.taille || '',
                        effectif: ent.effectif || '',
                        forme_juridique: ent.forme_juridique || '', code_naf: ent.code_naf || '',
                        libelle_naf: ent.libelle_naf || '', date_creation: ent.date_creation || '',
                        site_web: ent.site_web || '', 
                    });
                    setSiretInput(ent.siret || '');
                    if (ent.siret_verified) {
                        setFieldsLocked(true);
                        setIsVerified(true);
                    }

                    // Load new taxonomy associations
                    const [natures, domains, specialties, zones] = await Promise.all([
                        supabase.from('company_natures').select('nature').eq('entreprise_id', ent.id),
                        supabase.from('company_domains').select('domain_id').eq('entreprise_id', ent.id),
                        supabase.from('company_specialties').select('specialty_id, custom_label').eq('entreprise_id', ent.id),
                        supabase.from('company_geo_zones').select('geo_zone_id').eq('entreprise_id', ent.id),
                    ]);

                    if (natures.data) setSelectedNatures(natures.data.map(n => n.nature));
                    if (domains.data) setSelectedDomains(domains.data.map(d => d.domain_id));
                    if (specialties.data) {
                        setSelectedSpecialties(specialties.data.map(s => ({ specialty_id: s.specialty_id, custom_label: s.custom_label })));
                        const others = specialties.data.reduce((acc, s) => {
                            if (s.custom_label) acc[s.specialty_id] = s.custom_label;
                            return acc;
                        }, {} as Record<string, string>);
                        setOtherLabels(others);
                    }
                    if (zones.data) setSelectedZones(zones.data.map(z => z.geo_zone_id));
                }
            }

            // Load reference data
            setLoadingRef(true);
            const [doms, specs, gz] = await Promise.all([
                supabase.from('ref_domains').select('*').order('display_order'),
                supabase.from('ref_specialties').select('*').order('display_order'),
                supabase.from('ref_geo_zones').select('*').order('display_order'),
            ]);
            if (doms.data) setRefDomains(doms.data);
            if (specs.data) setRefSpecialties(specs.data);
            if (gz.data) setRefGeoZones(gz.data);
            setLoadingRef(false);
        };
        loadExisting();
    }, [userProfile.entreprise_id]);

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

            // Format only the street part (no cp/ville redundancy)
            // Some API results (matching_etablissements) omit granular voie fields, so we fallback
            let streetParts = [
                matchingEtab.numero_voie, 
                matchingEtab.type_voie, 
                matchingEtab.libelle_voie
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

            setCompanyData({
                nom: result.nom_complet || result.nom_raison_sociale || '',
                prenom: isIndividual ? (primaryDir?.prenoms || '') : '',
                nom_famille: isIndividual ? (primaryDir?.nom || '') : '',
                siret: cleaned,
                adresse: streetParts || matchingEtab.adresse || '',
                ville: matchingEtab.libelle_commune || '',
                code_postal: matchingEtab.code_postal || '',
                taille: result.categorie_entreprise || mapTaille(result.tranche_effectif_salarie) || '',
                effectif: effectifEstim || 1,
                forme_juridique: result.nature_juridique || '',
                code_naf: result.activite_principale || '',
                libelle_naf: '', // Will be fetched below
                date_creation: result.date_creation || '',
                site_web: '',
            });

            // Fetch full NAF label from INSEE API
            if (result.activite_principale) {
                try {
                    const nafResponse = await fetch(`https://api.insee.fr/metadonnees/V1/codes/nafr2/sousClasse/${encodeURIComponent(result.activite_principale)}`, {
                        headers: { 'Accept': 'application/json' }
                    });
                    if (nafResponse.ok) {
                        const nafData = await nafResponse.json();
                        if (nafData?.intitule) {
                            setCompanyData(prev => ({ ...prev, libelle_naf: nafData.intitule }));
                        }
                    } else {
                        // Fallback API
                        const fallbackResp = await fetch(`https://api-codes-naf.osc-fr1.scalingo.io/api/v1/naf/${result.activite_principale}`);
                        if (fallbackResp.ok) {
                            const fallbackData = await fallbackResp.json();
                            if (fallbackData?.label || fallbackData?.intitule) {
                                setCompanyData(prev => ({ ...prev, libelle_naf: fallbackData.label || fallbackData.intitule }));
                            }
                        }
                    }
                } catch {
                    // NAF label lookup failed silently — section letter will remain
                }
            }

            setFieldsLocked(true);
            setIsVerified(true);
        } catch {
            setSearchError("Erreur lors de la recherche. Vérifiez le numéro SIRET.");
        } finally {
            setSearching(false);
        }
    };

    // Derived state for completion data
    const completionData = {
        company: !!entrepriseId,
        skills: selectedSpecialties.length,
    };

    // --- SAVE STEP 1 ---
    const saveCompany = async () => {
        const isStandard = companyData.nom.trim().length > 0;
        const isIndividual = companyData.prenom.trim().length > 0 && companyData.nom_famille.trim().length > 0;
        
        if (!isStandard && !isIndividual) return;
        setSaving(true);
        try {
            // Prepared payload with correct types and fallback values
            // Chaînes vides normalisées en NULL, comme dans la fiche entreprise :
            // `siret = ''` entre en collision avec la contrainte d'unicité dès
            // qu'une autre entreprise porte la même valeur, alors que plusieurs
            // NULL cohabitent sans problème.
            const vide = (v: unknown) =>
                typeof v === 'string' && v.trim() === '' ? null : v;

            const payload = {
                ...companyData,
                siret: vide(companyData.siret) as string | null,
                adresse: vide(companyData.adresse),
                ville: vide(companyData.ville),
                code_postal: vide(companyData.code_postal),
                forme_juridique: vide(companyData.forme_juridique),
                code_naf: vide(companyData.code_naf),
                nom: isStandard ? companyData.nom : `${companyData.prenom} ${companyData.nom_famille}`,
                effectif: companyData.effectif ? parseInt(companyData.effectif, 10) : 1,
                siret_verified: isVerified,
            };

            let currentEntId = entrepriseId;

            if (currentEntId) {
                // Update existing
                const { error } = await supabase.from('entreprises').update(payload).eq('id', currentEntId);
                if (error) throw error;
            } else {
                // Une entreprise déjà inscrite avec ce SIRET ? La colonne porte une
                // contrainte UNIQUE : sans ce contrôle, l'insertion échouait sur une
                // erreur de base de données brute, sans issue proposée au second
                // collaborateur d'une même société. On lui propose de demander son
                // rattachement plutôt que de le laisser bloqué.
                if (payload.siret) {
                    const { data: existante } = await supabase
                        .from('entreprises')
                        .select('id, nom')
                        .eq('siret', payload.siret)
                        .maybeSingle();

                    if (existante) {
                        setEntrepriseExistante({ id: existante.id, nom: existante.nom });
                        setSaving(false);
                        return; // la suite se joue dans l'écran de rattachement
                    }
                }

                // Create new
                const { data: newEnt, error } = await supabase
                    .from('entreprises')
                    .insert(payload)
                    .select('id')
                    .single();
                if (error) throw error;
                if (newEnt) {
                    currentEntId = newEnt.id;
                    setEntrepriseId(newEnt.id);
                }
            }

            // Always link/update user link if enterprise exists
            if (currentEntId) {
                // Rattachement au réseau de l'invitant. Le jeton a été capté à
                // l'arrivée sur `/register?invite=…` ; il ne peut être consommé
                // qu'ici, l'entreprise n'existant pas avant. Best-effort : un
                // échec ne doit pas interrompre l'onboarding.
                try {
                    const jetonReseau = sessionStorage.getItem('inviteReseau');
                    if (jetonReseau) {
                        await supabase.rpc('consommer_invitation_reseau', {
                            p_token: jetonReseau,
                            p_entreprise: currentEntId,
                        });
                        sessionStorage.removeItem('inviteReseau');
                    }
                } catch (reseauErr) {
                    console.warn('Rattachement au réseau échoué', reseauErr);
                }

                await supabase.from('utilisateurs').update({
                    entreprise_id: currentEntId,
                    poste: userData.poste || null,
                }).eq('id', userProfile.id);
            }
        } catch (err) {
            console.error('Error saving company:', err);
        } finally {
            setSaving(false);
        }
    };

    // --- SAVE STEP 2 ---
    const saveTaxonomy = async () => {
        if (!entrepriseId || selectedNatures.length === 0 || selectedDomains.length === 0 || selectedZones.length === 0) return;
        setSaving(true);
        try {
            // 1. Natures
            await supabase.from('company_natures').delete().eq('entreprise_id', entrepriseId);
            await supabase.from('company_natures').insert(selectedNatures.map(n => ({ entreprise_id: entrepriseId, nature: n })));

            // 2. Domains
            await supabase.from('company_domains').delete().eq('entreprise_id', entrepriseId);
            await supabase.from('company_domains').insert(selectedDomains.map(d => ({ entreprise_id: entrepriseId, domain_id: d })));

            // 3. Specialties
            await supabase.from('company_specialties').delete().eq('entreprise_id', entrepriseId);
            await supabase.from('company_specialties').insert(selectedSpecialties.map(s => ({
                entreprise_id: entrepriseId,
                specialty_id: s.specialty_id,
                custom_label: s.custom_label || null
            })));

            // 4. Geo Zones
            await supabase.from('company_geo_zones').delete().eq('entreprise_id', entrepriseId);
            await supabase.from('company_geo_zones').insert(selectedZones.map(z => ({ entreprise_id: entrepriseId, geo_zone_id: z })));


        } catch (err) {
            console.error('Error saving taxonomy:', err);
        } finally {
            setSaving(false);
        }
    };

    // --- COMPLETE ONBOARDING ---
    const handleComplete = async (goToWizard: boolean) => {
        setSaving(true);
        try {
            await supabase.from('utilisateurs').update({
                onboarding_completed: true,
            }).eq('id', userProfile.id);
            track('onboarding_termine', {});
            onComplete(goToWizard);
        } catch (err) {
            console.error('Error completing onboarding:', err);
        } finally {
            setSaving(false);
        }
    };

    // --- NEXT / PREV ---
    /**
     * Champs obligatoires de l'étape 2 (spécification) : au moins une nature,
     * un domaine et une zone d'intervention. Spécialités et tags d'expertise ne
     * sont volontairement PAS bloquants — un domaine seul suffit à un matching
     * large, et exiger le détail ferait abandonner l'étape.
     */
    const manquesEtape2 = (): string[] => {
        const manques: string[] = [];
        if (selectedNatures.length === 0) manques.push("une nature d'activité");
        if (selectedDomains.length === 0) manques.push('un domaine');
        if (selectedZones.length === 0) manques.push("une zone d'intervention");
        return manques;
    };

    const handleNext = async () => {
        if (step === 1) {
            await saveCompany();
        }
        if (step === 2) {
            await saveTaxonomy();
        }
        if (step < 3) setStep(step + 1);
    };

    const handleSkip = () => {
        if (step < 3) setStep(step + 1);
    };

    const inputClass = "w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-2 focus:ring-filao-primary/20 transition-all";



    const handleSignOut = async () => {
        await supabase.auth.signOut();
        window.location.reload();
    };

    // Écran de rattachement : une entreprise porte déjà ce SIRET. On propose de
    // la rejoindre, ou de repartir sur une autre entreprise pour ne pas laisser
    // l'utilisateur bloqué s'il s'est trompé de numéro.
    if (entrepriseExistante) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
                <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
                    {demandeRefusee ? (
                        <>
                            <h2 className="text-xl font-bold text-[#0B1F38] mb-3">
                                Demande non acceptée
                            </h2>
                            <p className="text-sm text-[#0B1F38]/60 leading-relaxed mb-6">
                                Un administrateur de <strong>{entrepriseExistante.nom}</strong> n'a
                                pas donné suite à votre demande de rattachement.
                            </p>
                            <p className="text-xs text-[#0B1F38]/45 leading-relaxed mb-6">
                                Rapprochez-vous de lui si vous pensez qu'il s'agit d'une erreur : il
                                peut revenir sur sa décision. Vous pouvez aussi relancer une
                                demande, ou renseigner une autre entreprise.
                            </p>

                            <button
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        const { data } = await supabase.rpc('demander_rattachement', {
                                            p_entreprise: entrepriseExistante.id,
                                        });
                                        if (data === 'en_attente') {
                                            setDemandeRefusee(false);
                                            setDemandeEnvoyee(true);
                                        }
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                                disabled={saving}
                                className="w-full py-2.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-50 mb-3"
                            >
                                {saving ? 'Envoi…' : 'Relancer ma demande'}
                            </button>

                            <button
                                onClick={() => { setDemandeRefusee(false); setEntrepriseExistante(null); }}
                                className="text-xs text-[#00A3E0] hover:underline"
                            >
                                Renseigner une autre entreprise
                            </button>
                        </>
                    ) : entrepriseOrpheline ? (
                        <>
                            <h2 className="text-xl font-bold text-[#0B1F38] mb-3">
                                Cette entreprise n'a plus de membre actif
                            </h2>
                            <p className="text-sm text-[#0B1F38]/60 leading-relaxed mb-6">
                                <strong>{entrepriseExistante.nom}</strong> figure sur Filao, mais
                                aucun compte ne la porte actuellement : personne ne peut valider
                                votre rattachement.
                            </p>
                            <p className="text-xs text-[#0B1F38]/45 leading-relaxed mb-5">
                                Si vous disposez de la <strong>clé de reprise</strong> remise au
                                dernier membre lors de son départ, saisissez-la pour reprendre
                                l'entreprise. Ses dossiers et documents sont conservés.
                            </p>

                            <input
                                type="text"
                                value={cleReprise}
                                onChange={(e) => { setCleReprise(e.target.value); setCleErreur(null); }}
                                placeholder="Clé de reprise"
                                className="w-full bg-[#F8FAFC] border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono text-center tracking-wide focus:outline-none focus:border-[#00A3E0] mb-2"
                            />
                            {cleErreur && (
                                <p className="text-[11px] text-red-600 mb-2">{cleErreur}</p>
                            )}

                            <button
                                onClick={async () => {
                                    setSaving(true);
                                    setCleErreur(null);
                                    try {
                                        const { data, error } = await supabase.rpc('reprendre_entreprise', {
                                            p_cle: cleReprise.trim(),
                                        });
                                        if (error) throw error;
                                        if (data === 'reprise') {
                                            // Rechargement : le profil porte désormais une
                                            // entreprise et le rôle d'administrateur.
                                            window.location.href = '/';
                                            return;
                                        }
                                        setCleErreur(
                                            data === 'deja_rattache'
                                                ? 'Votre compte est déjà rattaché à une entreprise.'
                                                : 'Clé invalide ou déjà utilisée.'
                                        );
                                    } catch (err) {
                                        console.error('Reprise d\'entreprise échouée', err);
                                        setCleErreur('Reprise impossible pour le moment.');
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                                disabled={saving || cleReprise.trim().length < 16}
                                className="w-full py-2.5 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-40 mb-4"
                            >
                                {saving ? 'Vérification…' : 'Reprendre cette entreprise'}
                            </button>

                            <p className="text-[11px] text-[#0B1F38]/40 mb-4">
                                Sans cette clé, contactez le support pour en reprendre la main.
                            </p>

                            <button
                                onClick={() => { setEntrepriseOrpheline(false); setEntrepriseExistante(null); }}
                                className="text-xs text-[#00A3E0] hover:underline"
                            >
                                Renseigner une autre entreprise
                            </button>
                        </>
                    ) : demandeEnvoyee ? (
                        <>
                            <h2 className="text-xl font-bold text-[#0B1F38] mb-3">Demande envoyée</h2>
                            <p className="text-sm text-[#0B1F38]/60 leading-relaxed mb-8">
                                Un administrateur de <strong>{entrepriseExistante.nom}</strong> doit
                                valider votre rattachement. Vous serez notifié dès que ce sera fait.
                            </p>
                            <button
                                onClick={() => { setEntrepriseExistante(null); setDemandeEnvoyee(false); }}
                                className="text-xs text-[#00A3E0] hover:underline"
                            >
                                Renseigner une autre entreprise
                            </button>
                        </>
                    ) : (
                        <>
                            <h2 className="text-xl font-bold text-[#0B1F38] mb-3">
                                Cette entreprise est déjà sur Filao
                            </h2>
                            <p className="text-sm text-[#0B1F38]/60 leading-relaxed mb-8">
                                <strong>{entrepriseExistante.nom}</strong> possède déjà un compte.
                                Demandez à la rejoindre : un administrateur validera votre accès.
                            </p>

                            <button
                                onClick={async () => {
                                    setSaving(true);
                                    try {
                                        const { data, error } = await supabase.rpc('demander_rattachement', {
                                            p_entreprise: entrepriseExistante.id,
                                        });
                                        if (error) throw error;
                                        if (data === 'deja_rattache') { onComplete(false); return; }
                                        // Plus aucun membre actif : personne ne
                                        // pourrait valider la demande. On le dit
                                        // plutôt que de laisser attendre sans fin.
                                        if (data === 'entreprise_orpheline') {
                                            setEntrepriseOrpheline(true);
                                            return;
                                        }
                                        setDemandeEnvoyee(true);
                                    } catch (err) {
                                        console.error('Demande de rattachement échouée', err);
                                    } finally {
                                        setSaving(false);
                                    }
                                }}
                                disabled={saving}
                                className="w-full py-3 bg-[#00A3E0] hover:bg-[#008CC1] text-white font-bold text-sm rounded-xl transition-colors disabled:opacity-50 mb-3"
                            >
                                {saving ? 'Envoi…' : 'Demander à la rejoindre'}
                            </button>

                            <button
                                onClick={() => setEntrepriseExistante(null)}
                                className="text-xs text-[#0B1F38]/50 hover:text-[#0B1F38] hover:underline"
                            >
                                Ce n'est pas mon entreprise — en renseigner une autre
                            </button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex flex-col">
            {/* Header */}
            <div className="px-8 py-5 flex items-center justify-between border-b border-gray-100 bg-white/80 backdrop-blur-sm">
                <img src={APP_CONFIG.altLogo} alt="Filao" className="h-7" />
                <div className="flex items-center gap-4 text-sm text-gray-500">
                    <span className="hidden md:flex items-center gap-2">
                        <Sparkles size={16} className="text-filao-primary" />
                        Configuration de votre espace
                    </span>
                    <button onClick={handleSignOut} title="Se déconnecter" className="flex items-center gap-2 text-gray-400 hover:text-red-500 transition-colors">
                        <LogOut size={18} />
                        <span className="hidden sm:inline">Se déconnecter</span>
                    </button>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="px-8 py-6 max-w-3xl mx-auto w-full">
                <div className="flex items-center justify-between relative">
                    {/* Background line */}
                    <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-200" />
                    <div className="absolute top-5 left-0 h-0.5 bg-filao-primary transition-all duration-500"
                        style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }} />

                    {STEPS.map((s) => {
                        const Icon = s.icon;
                        const isActive = s.id === step;
                        const isDone = s.id < step;
                        return (
                            <div key={s.id} className="flex flex-col items-center relative z-10">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isDone ? 'bg-filao-primary text-white shadow-md shadow-filao-primary/30' :
                                    isActive ? 'bg-filao-primary text-white shadow-lg shadow-filao-primary/40 scale-110' :
                                        'bg-white border-2 border-gray-200 text-gray-400'
                                    }`}>
                                    {isDone ? <Check size={18} /> : <Icon size={18} />}
                                </div>
                                <span className={`text-xs mt-2 font-medium transition-colors ${isActive ? 'text-filao-primary' : isDone ? 'text-gray-600' : 'text-gray-400'
                                    }`}>
                                    {s.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex items-start justify-center px-4 pb-8">
                <div className="w-full max-w-2xl">

                    {/* ========== STEP 1: COMPANY ========== */}
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="text-center mb-6">
                                <h1 className="text-2xl font-bold text-gray-900">Commençons par identifier votre entreprise</h1>
                                <p className="text-gray-500 mt-1">
                                    {entryMode === 'siret' 
                                        ? "Entrez votre SIRET pour remplir automatiquement vos informations"
                                        : "Renseignez manuellement vos informations d'entreprise"
                                    }
                                </p>
                            </div>

                            {/* MODE A: SIRET SEARCH */}
                            {entryMode === 'siret' && (
                                <div className="space-y-6">
                                    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-2 bg-filao-primary/10 rounded-lg">
                                                <Search size={20} className="text-filao-primary" />
                                            </div>
                                            <span className="text-base font-bold text-gray-900">Recherche par SIRET</span>
                                        </div>
                                        
                                        {!isVerified ? (
                                            <div className="space-y-4">
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={siretInput}
                                                        onChange={(e) => { setSiretInput(e.target.value.replace(/[^\d\s]/g, '')); setSearchError(null); }}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleSiretSearch()}
                                                        className={inputClass}
                                                        placeholder="Ex: 123 456 789 00012"
                                                        maxLength={17}
                                                    />
                                                    <button onClick={handleSiretSearch}
                                                        disabled={searching || siretInput.replace(/\s/g, '').length < 14}
                                                        className="flex items-center gap-2 px-6 py-2.5 bg-filao-primary text-white rounded-xl text-sm font-bold hover:shadow-lg hover:shadow-filao-primary/30 transition-all disabled:opacity-50 shrink-0">
                                                        {searching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                                                        Rechercher
                                                    </button>
                                                </div>
                                                {searchError && <p className="text-sm text-red-500 font-medium ml-1">{searchError}</p>}
                                                
                                                <button 
                                                    onClick={() => {
                                                        setEntryMode('manual');
                                                        setFieldsLocked(false);
                                                    }}
                                                    className="text-xs text-gray-500 hover:text-filao-primary flex items-center gap-1.5 font-medium transition-colors"
                                                >
                                                    <PenLine size={14} /> Je remplis manuellement
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="animate-in zoom-in-95 duration-200">
                                                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex gap-3">
                                                            <div className="mt-1 p-1 bg-emerald-500 text-white rounded-full">
                                                                <Check size={14} />
                                                            </div>
                                                            <div>
                                                                <h3 className="font-bold text-emerald-900">{companyData.nom}</h3>
                                                                <p className="text-xs text-emerald-700 mt-0.5">SIRET: {companyData.siret}</p>
                                                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3">
                                                                    <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-600/60">Ville</div>
                                                                    <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-600/60">Forme juridique</div>
                                                                    <div className="text-xs font-semibold text-emerald-900">{companyData.ville} ({companyData.code_postal})</div>
                                                                    <div className="text-xs font-semibold text-emerald-900">{getFormeJuridiqueLabel(companyData.forme_juridique) || 'N/A'}</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => {
                                                                setIsVerified(false);
                                                                setFieldsLocked(false);
                                                                setSiretInput('');
                                                            }}
                                                            className="text-xs text-emerald-600 hover:text-emerald-800 font-bold"
                                                        >
                                                            Changer
                                                        </button>
                                                    </div>
                                                </div>
                                                
                                                <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center text-xs">
                                                    <span className="text-gray-400">Ces informations proviennent des données officielles INSEE</span>
                                                    <button 
                                                        onClick={() => setEntryMode('manual')}
                                                        className="text-filao-primary font-bold hover:underline"
                                                    >
                                                        Modifier manuellement
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* MODE B: MANUAL ENTRY */}
                            {entryMode === 'manual' && (
                                <div className="space-y-5 animate-in slide-in-from-bottom-2 duration-300">
                                    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
                                        <div className="flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-2">
                                                <div className="p-2 bg-filao-primary/10 rounded-lg">
                                                    <Building2 size={20} className="text-filao-primary" />
                                                </div>
                                                <span className="text-base font-bold text-gray-900">Saisie manuelle</span>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    setEntryMode('siret');
                                                    if (!isVerified) {
                                                        setCompanyData(prev => ({ ...prev, nom: '', prenom: '', nom_famille: '' }));
                                                    }
                                                }}
                                                className="text-xs text-filao-primary font-bold hover:underline"
                                            >
                                                Utiliser un SIRET
                                            </button>
                                        </div>

                                        <div className="mb-6 p-4 bg-filao-primary/5 rounded-2xl border border-filao-primary/10">
                                            <p className="text-xs text-filao-primary leading-relaxed font-medium">
                                                Remplissez le <strong>Nom de la société</strong> pour une entreprise classique, 
                                                ou vos <strong>Prénom / Nom</strong> si vous exercez en tant qu'auto-entrepreneur ou entrepreneur individuel.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                                            <div className="col-span-2">
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Nom de l'entreprise *</label>
                                                <input type="text" value={companyData.nom}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, nom: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="Nom de la société" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Prénom</label>
                                                <input type="text" value={companyData.prenom}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, prenom: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="Prénom" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Nom</label>
                                                <input type="text" value={companyData.nom_famille}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, nom_famille: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="Nom" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Forme juridique</label>
                                                <input type="text" value={companyData.forme_juridique}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, forme_juridique: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="SAS, SARL..." />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Code NAF</label>
                                                <input type="text" value={companyData.code_naf}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, code_naf: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="62.01Z" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Effectif</label>
                                                <input type="number" value={companyData.effectif}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, effectif: e.target.value }))}
                                                    className={inputClass} placeholder="0" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Votre poste</label>
                                                <input type="text" value={userData.poste}
                                                    onChange={(e) => setUserData(p => ({ ...p, poste: e.target.value }))}
                                                    className={inputClass} placeholder="Ex: Gérant, Directeur..." />
                                            </div>
                                            <div className="col-span-2 mt-2">
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Adresse</label>
                                                <input type="text" value={companyData.adresse}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, adresse: e.target.value }))}
                                                    className={inputClass}
                                                    placeholder="Adresse complète" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Ville</label>
                                                <input type="text" value={companyData.ville}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, ville: e.target.value }))}
                                                    className={inputClass} placeholder="Paris" />
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Code Postal</label>
                                                <input type="text" value={companyData.code_postal}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, code_postal: e.target.value }))}
                                                    className={inputClass} placeholder="75000" />
                                            </div>
                                            <div className="col-span-2">
                                                <label className="text-xs font-bold text-gray-700 mb-1.5 block">Site web <span className="text-gray-400 font-normal">(optionnel)</span></label>
                                                <input type="url" value={companyData.site_web}
                                                    onChange={(e) => setCompanyData(p => ({ ...p, site_web: e.target.value }))}
                                                    className={inputClass} placeholder="https://www.monentreprise.fr" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ========== STEP 2: COMPETENCES ET ZONE D'INTERVENTION ========== */}
                    {step === 2 && (
                        <div className="space-y-8 animate-in fade-in duration-500 pb-12">
                            <div className="text-center mb-8">
                                <h1 className="text-2xl font-bold text-gray-900">Votre activité et expertise</h1>
                                <p className="text-gray-500 mt-1">Ces informations nous permettent de vous proposer les meilleurs partenaires et opportunités.</p>
                            </div>

                            {/* Complétude du profil, en direct.
                                Un profil sans spécialité ni zone ne remonte dans aucune
                                recherche de partenaire : l'indiquer pendant la saisie est
                                plus utile qu'un constat en fin de parcours. */}
                            {!loadingRef && (() => {
                                const criteres = [
                                    selectedNatures.length > 0,
                                    selectedDomains.length > 0,
                                    selectedSpecialties.length > 0,
                                    selectedZones.length > 0,
                                ];
                                const remplis = criteres.filter(Boolean).length;
                                const pourcent = Math.round((remplis / criteres.length) * 100);
                                return (
                                    <div className="max-w-xl mx-auto mb-8">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-bold text-gray-600">Complétude de votre profil</span>
                                            <span className={`text-xs font-bold ${pourcent === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {pourcent}%
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full transition-all duration-500 ${pourcent === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                                                style={{ width: `${pourcent}%` }}
                                            />
                                        </div>
                                        {pourcent < 100 && (
                                            <p className="text-[11px] text-gray-400 mt-1.5">
                                                Un profil incomplet apparaît moins souvent dans les recherches de
                                                partenaires et les suggestions de groupement.
                                            </p>
                                        )}
                                    </div>
                                );
                            })()}

                            {loadingRef ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <Loader2 size={40} className="animate-spin text-filao-primary" />
                                    <p className="text-sm text-gray-400 font-medium tracking-wide">Chargement de la taxonomie...</p>
                                </div>
                            ) : (
                                <>
                                    {/* SECTION A: NATURE D'ACTIVITÉ */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <div className="w-8 h-8 rounded-lg bg-filao-primary/10 flex items-center justify-center text-filao-primary">
                                                <Building2 size={18} />
                                            </div>
                                            <h3 className="text-base font-bold text-gray-900">1. Nature de votre activité *</h3>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4">
                                            {[
                                                { id: 'travaux', label: 'Travaux', icon: Wrench, desc: 'Bâtiment expertises, rénovation, VRD...' },
                                                { id: 'services', label: 'Services', icon: FolderOpen, desc: "Bureau d'études, architecture, conseil..." },
                                                { id: 'fournitures', label: 'Fournitures', icon: Building2, desc: 'Équipements, matériaux, matériel...' },
                                            ].map(n => {
                                                const isSelected = selectedNatures.includes(n.id);
                                                return (
                                                    <button
                                                        key={n.id}
                                                        onClick={() => {
                                                            if (isSelected) {
                                                                // Décocher une nature retire les domaines qui n'en
                                                                // dépendent plus, et donc leurs spécialités. C'est une
                                                                // perte de saisie : on la fait confirmer plutôt que de
                                                                // l'appliquer silencieusement.
                                                                const naturesRestantes = selectedNatures.filter(x => x !== n.id);
                                                                const domainesPerdus = selectedDomains.filter(did => {
                                                                    const d = refDomains.find(rd => rd.id === did);
                                                                    return !d?.natures.some(rn => naturesRestantes.includes(rn));
                                                                });

                                                                if (domainesPerdus.length > 0) {
                                                                    const ok = window.confirm(
                                                                        `Vous avez ${domainesPerdus.length} domaine${domainesPerdus.length > 1 ? 's' : ''} sélectionné${domainesPerdus.length > 1 ? 's' : ''} dans cette catégorie. Voulez-vous les retirer ?`
                                                                    );
                                                                    if (!ok) return;
                                                                }

                                                                setSelectedDomains(currentDoms =>
                                                                    currentDoms.filter(did => {
                                                                        const d = refDomains.find(rd => rd.id === did);
                                                                        return d?.natures.some(rn => naturesRestantes.includes(rn));
                                                                    })
                                                                );
                                                                // Les spécialités des domaines retirés partent avec eux.
                                                                setSelectedSpecialties(currentSpecs =>
                                                                    currentSpecs.filter(sp => {
                                                                        const s = refSpecialties.find(rs => rs.id === sp.specialty_id);
                                                                        return s && !domainesPerdus.includes(s.domain_id);
                                                                    })
                                                                );
                                                                setSelectedNatures(naturesRestantes);
                                                                return;
                                                            }
                                                            setSelectedNatures(prev => [...prev, n.id]);
                                                        }}
                                                        className={`relative flex flex-col items-center text-center p-5 rounded-2xl border-2 transition-all duration-300 group ${isSelected
                                                            ? 'border-filao-primary bg-filao-primary/5 shadow-md shadow-filao-primary/10'
                                                            : 'border-gray-100 bg-white hover:border-filao-primary/30'
                                                            }`}
                                                    >
                                                        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 transition-colors ${isSelected ? 'bg-filao-primary text-white' : 'bg-gray-50 text-gray-400 group-hover:bg-gray-100'}`}>
                                                            <n.icon size={24} />
                                                        </div>
                                                        <span className={`text-sm font-bold mb-1 ${isSelected ? 'text-filao-primary' : 'text-gray-900'}`}>{n.label}</span>
                                                        <span className="text-[10px] text-gray-400 leading-tight px-2">{n.desc}</span>
                                                        {isSelected && (
                                                            <div className="absolute top-3 right-3 w-5 h-5 bg-filao-primary text-white rounded-full flex items-center justify-center animate-in zoom-in duration-200">
                                                                <Check size={12} strokeWidth={3} />
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* SECTION B: DOMAINES */}
                                    {selectedNatures.length > 0 && (
                                        <div className="space-y-4 animate-in slide-in-from-top-4 duration-500">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                                    <FolderOpen size={18} />
                                                </div>
                                                <h3 className="text-base font-bold text-gray-900">2. Vos domaines d'intervention *</h3>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {refDomains
                                                    .filter(d => d.natures.some(n => selectedNatures.includes(n)))
                                                    .map(d => {
                                                        const isSelected = selectedDomains.includes(d.id);
                                                        return (
                                                            <button
                                                                key={d.id}
                                                                onClick={() => {
                                                                    setSelectedDomains(prev => {
                                                                        if (isSelected) {
                                                                            // Cascade: remove specialties associated with this domain
                                                                            setSelectedSpecialties(currentSpecs => 
                                                                                currentSpecs.filter(sid => {
                                                                                    const s = refSpecialties.find(rs => rs.id === sid.specialty_id);
                                                                                    return s?.domain_id !== d.id;
                                                                                })
                                                                            );
                                                                            return prev.filter(x => x !== d.id);
                                                                        }
                                                                        return [...prev, d.id];
                                                                    });
                                                                }}
                                                                className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${isSelected
                                                                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                                                                    : 'border-gray-100 bg-white hover:border-blue-200'
                                                                    }`}
                                                            >
                                                                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200'}`}>
                                                                    {isSelected && <Check size={14} strokeWidth={3} />}
                                                                </div>
                                                                <span className="text-xs font-bold text-left leading-tight">{d.label}</span>
                                                            </button>
                                                        );
                                                    })}
                                            </div>
                                        </div>
                                    )}

                                    {/* SECTION C: SPÉCIALITÉS */}
                                    {selectedDomains.length > 0 && (
                                        <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
                                            <div className="flex items-center gap-2 mb-1">
                                                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                                                    <Wrench size={18} />
                                                </div>
                                                <h3 className="text-base font-bold text-gray-900">3. Vos spécialités (facultatif)</h3>
                                            </div>
                                            
                                            <div className="space-y-6">
                                                {/* Affiché une seule fois, au-dessus du premier
                                                    bloc : les spécialités sont facultatives, mais
                                                    ce sont elles qui rendent le matching précis. */}
                                                {selectedDomains.length > 0 && (
                                                    <p className="text-xs text-gray-500 bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-3">
                                                        Plus vos spécialités sont précises, plus les recommandations
                                                        de partenaires seront pertinentes.
                                                    </p>
                                                )}
                                                {selectedDomains.map(domId => {
                                                    const domain = refDomains.find(d => d.id === domId);
                                                    const toutesSpecs = refSpecialties.filter(s => s.domain_id === domId);
                                                    if (!domain) return null;

                                                    // Le référentiel compte 201 spécialités : certains domaines en
                                                    // alignent des dizaines, ce qui noie l'étape et la rend
                                                    // impraticable « en deux clics ». On en montre une vingtaine,
                                                    // le reste sur demande — en gardant TOUJOURS visibles celles
                                                    // déjà sélectionnées, qui pourraient sinon disparaître sous le
                                                    // repli.
                                                    const deplie = domainesDeplies.includes(domId);
                                                    const specs = deplie
                                                        ? toutesSpecs
                                                        : toutesSpecs.filter((s, i) =>
                                                            i < 20 || selectedSpecialties.some(x => x.specialty_id === s.id));
                                                    const masquees = toutesSpecs.length - specs.length;

                                                    return (
                                                        <div key={domId} className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100">
                                                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">{domain.label}</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {specs.map(s => {
                                                                    const isSelected = selectedSpecialties.some(x => x.specialty_id === s.id);
                                                                    const isOther = s.id.endsWith('99');
                                                                    return (
                                                                        <div key={s.id} className="flex flex-col gap-2">
                                                                            <button
                                                                                onClick={() => {
                                                                                    setSelectedSpecialties(prev => 
                                                                                        isSelected 
                                                                                            ? prev.filter(x => x.specialty_id !== s.id)
                                                                                            : [...prev, { specialty_id: s.id, custom_label: otherLabels[s.id] || '' }]
                                                                                    );
                                                                                }}
                                                                                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${isSelected
                                                                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                                                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                                                                                    }`}
                                                                            >
                                                                                {s.label}
                                                                            </button>
                                                                            {isSelected && isOther && (
                                                                                <input
                                                                                    type="text"
                                                                                    value={otherLabels[s.id] || ''}
                                                                                    onChange={(e) => {
                                                                                        const val = e.target.value;
                                                                                        setOtherLabels(prev => ({ ...prev, [s.id]: val }));
                                                                                        setSelectedSpecialties(current => 
                                                                                            current.map(x => x.specialty_id === s.id ? { ...x, custom_label: val } : x)
                                                                                        );
                                                                                    }}
                                                                                    placeholder="Précisez votre spécialité..."
                                                                                    className="text-[11px] px-3 py-1.5 bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 w-full animate-in fade-in zoom-in-95 duration-200"
                                                                                    autoFocus
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>

                                                            {(masquees > 0 || deplie) && (
                                                                <button
                                                                    onClick={() => setDomainesDeplies(prev =>
                                                                        deplie ? prev.filter(x => x !== domId) : [...prev, domId])}
                                                                    className="mt-3 text-[11px] font-bold text-filao-primary hover:underline"
                                                                >
                                                                    {deplie
                                                                        ? 'Afficher moins'
                                                                        : `Afficher ${masquees} spécialité${masquees > 1 ? 's' : ''} de plus`}
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* SECTION D: ZONE D'INTERVENTION */}
                                    <div className="pt-4 space-y-4">
                                        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-8 mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600">
                                                    <Search size={18} />
                                                </div>
                                                <h3 className="text-base font-bold text-gray-900">4. Zone d'intervention *</h3>
                                            </div>
                                            <button 
                                                onClick={() => {
                                                    const metropoleIds = refGeoZones.filter(z => z.zone_type === 'metropole').map(z => z.id);
                                                    const allSelected = metropoleIds.every(id => selectedZones.includes(id));
                                                    if (allSelected) {
                                                        setSelectedZones(prev => prev.filter(id => !metropoleIds.includes(id)));
                                                    } else {
                                                        setSelectedZones(prev => [...new Set([...prev, ...metropoleIds])]);
                                                    }
                                                }}
                                                className={`text-xs font-bold px-4 py-2 rounded-xl transition-all border ${
                                                    refGeoZones.filter(z => z.zone_type === 'metropole').every(z => selectedZones.includes(z.id))
                                                        ? 'bg-orange-600 text-white border-orange-600'
                                                        : 'bg-white text-orange-600 border-orange-200 hover:bg-orange-50'
                                                }`}
                                            >
                                                France Entière
                                            </button>
                                        </div>

                                        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                                            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-4">Métropole</p>
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                {refGeoZones.filter(z => z.zone_type === 'metropole').map(z => {
                                                    const isSelected = selectedZones.includes(z.id);
                                                    return (
                                                        <button
                                                            key={z.id}
                                                            onClick={() => setSelectedZones(prev => 
                                                                isSelected ? prev.filter(x => x !== z.id) : [...prev, z.id]
                                                            )}
                                                            className={`px-2 py-2 rounded-xl text-[10px] font-bold border transition-all text-center leading-tight min-h-[44px] flex items-center justify-center ${
                                                                isSelected 
                                                                    ? 'bg-orange-500 text-white border-orange-500 shadow-sm' 
                                                                    : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-orange-200 hover:text-orange-600'
                                                            }`}
                                                        >
                                                            {z.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <div className="mt-8">
                                                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-4">DOM-TOM</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {refGeoZones.filter(z => z.zone_type === 'domtom').map(z => {
                                                        const isSelected = selectedZones.includes(z.id);
                                                        return (
                                                            <button
                                                                key={z.id}
                                                                onClick={() => setSelectedZones(prev => 
                                                                    isSelected ? prev.filter(x => x !== z.id) : [...prev, z.id]
                                                                )}
                                                                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                                                                    isSelected 
                                                                        ? 'bg-orange-500 text-white border-orange-500' 
                                                                        : 'bg-slate-50 text-slate-600 border-slate-100 hover:border-orange-200 hover:text-orange-600'
                                                                }`}
                                                            >
                                                                {z.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    )}


                    {/* ========== STEP 3: CONGRATS ========== */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="text-center mb-2">
                                <img src={APP_CONFIG.altLogo} alt="Filao" className="h-9 mx-auto mb-5" />
                                <div className="text-5xl mb-3">🎉</div>
                                <h1 className="text-2xl font-bold text-gray-900">Tout est prêt !</h1>
                                <p className="text-gray-500 mt-1">Votre espace Filao est configuré. Il est temps de répondre à votre premier appel d'offres !</p>
                            </div>

                            {/* Recap */}
                            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
                                <h3 className="text-sm font-semibold text-gray-700">Récapitulatif</h3>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3 text-sm">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${completionData.company ? 'bg-emerald-500' : 'bg-gray-300'
                                            }`}>
                                            {completionData.company ? <Check size={14} /> : <X size={14} />}
                                        </div>
                                        <span className="text-gray-700">
                                            {completionData.company ? 'Entreprise configurée' : 'Entreprise non renseignée'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${completionData.skills > 0 ? 'bg-emerald-500' : 'bg-gray-300'
                                            }`}>
                                            {completionData.skills > 0 ? <Check size={14} /> : <X size={14} />}
                                        </div>
                                        <span className="text-gray-700">
                                            {completionData.skills > 0
                                                ? `${completionData.skills} compétence${completionData.skills > 1 ? 's' : ''} ajoutée${completionData.skills > 1 ? 's' : ''}`
                                                : 'Aucune compétence ajoutée'
                                            }
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm">
                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${selectedZones.length > 0 ? 'bg-emerald-500' : 'bg-gray-300'
                                            }`}>
                                            {selectedZones.length > 0 ? <Check size={14} /> : <X size={14} />}
                                        </div>
                                        <span className="text-gray-700">
                                            {selectedZones.length > 0 
                                                ? `${selectedZones.length} zone${selectedZones.length > 1 ? 's' : ''} d'intervention`
                                                : 'Zone d\'intervention non renseignée'
                                            }
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* CTAs */}
                            <div className="flex flex-col items-center gap-3">
                                {/* Sans entreprise rattachée, terminer l'assistant ramène
                                    sur un tableau de bord inutilisable : ni création de
                                    dossier, ni acceptation d'invitation. Le récapitulatif
                                    ci-dessus le signale déjà ; on empêche ici de passer
                                    outre, et on renvoie à l'étape qui manque. */}
                                {!completionData.company ? (
                                    <>
                                        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center max-w-sm">
                                            Renseignez votre entreprise pour pouvoir créer un dossier
                                            et répondre aux invitations.
                                        </p>
                                        <button
                                            onClick={() => setStep(1)}
                                            className="w-full max-w-sm flex items-center justify-center gap-2 px-6 py-3.5 bg-filao-primary text-white rounded-2xl text-sm font-bold hover:shadow-lg hover:shadow-filao-primary/30 transition-all"
                                        >
                                            <Building2 size={18} />
                                            Renseigner mon entreprise
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleComplete(true)}
                                            disabled={saving}
                                            className="w-full max-w-sm flex items-center justify-center gap-2 px-6 py-3.5 bg-filao-primary text-white rounded-2xl text-sm font-bold hover:shadow-lg hover:shadow-filao-primary/30 transition-all disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 size={18} className="animate-spin" /> : <Rocket size={18} />}
                                            Créer mon premier appel d'offres
                                        </button>
                                        <button
                                            onClick={() => handleComplete(false)}
                                            disabled={saving}
                                            className="flex items-center gap-2 text-sm text-gray-500 hover:text-filao-primary transition-colors"
                                        >
                                            <LayoutDashboard size={16} />
                                            Explorer le tableau de bord
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    {step < 3 && (
                        <div className="flex items-center justify-between mt-8">
                            <div>
                                {step > 1 && (
                                    <button onClick={() => setStep(step - 1)}
                                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                                        <ChevronLeft size={16} /> Retour
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                {/* Message inline : indiquer CE QUI manque évite de laisser
                                    l'utilisateur devant un bouton grisé sans explication. */}
                                {step === 2 && manquesEtape2().length > 0 && (
                                    <span className="text-xs text-amber-600 font-medium text-right max-w-xs">
                                        Sélectionnez {manquesEtape2().join(', ')} pour continuer.
                                    </span>
                                )}
                                <button onClick={handleSkip}
                                    className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                                    Passer
                                </button>
                                <button
                                    onClick={handleNext}
                                    disabled={
                                        saving
                                        || (step === 1 && !companyData.nom.trim() && !(companyData.prenom.trim() && companyData.nom_famille.trim()))
                                        || (step === 2 && manquesEtape2().length > 0)
                                    }
                                    className="flex items-center gap-2 px-6 py-2.5 bg-filao-primary text-white rounded-xl text-sm font-semibold hover:shadow-md hover:shadow-filao-primary/20 transition-all disabled:opacity-50"
                                >
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : 'Continuer'}
                                    {!saving && <ChevronRight size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};