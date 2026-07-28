import React, { useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { TenderFormData, UserProfile, SKILLS } from '../config';
import { suggererDomainesDepuisCpv } from '../helpers/tenderEnums';
import { genererJalons } from '../helpers/jalonHelpers';
import { supabase } from '../lib/supabaseClient';

// Reference Colors & Constants from filao-wizard-workflow.jsx
const T = "#0B8FAC", G = "#1D9E75", R = "#D85A30", P = "#534AB7";

interface TenderCreationWizardProps {
    formData: TenderFormData;
    setFormData: React.Dispatch<React.SetStateAction<TenderFormData>>;
    onComplete: (groupementType: 'solidaire' | 'conjoint' | undefined, role: string | null) => void;
    onCancel: () => void;
    userProfile: any; // Allow for more flexible profile access
}

const DOCUMENTS = [
    { field: 'kbis_url', label: 'Kbis (moins de 6 mois)', desc: 'Extrait d\'immatriculation' },
    { field: 'presentation_societe_url', label: 'Présentation Société', desc: 'Plaquette commerciale' },
    { field: 'attestation_honneur_url', label: 'Attestation sur l\'honneur', desc: 'Conformité administrative' },
    { field: 'attestation_assurance_url', label: 'Attestation Assurance', desc: 'Responsabilité civile' },
];

// Taxonomy Types
interface RefDomain {
    id: string;
    label: string;
}

interface RefSpecialty {
    id: string;
    domain_id: string;
    label: string;
}

// Custom Icons translated from JSX reference
const Icon = ({ type, size = 24, color = "currentColor", sw = 2 }: { type: string, size?: number, color?: string, sw?: number }) => {
    const paths: Record<string, React.ReactNode> = {
        doc: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /></>,
        team: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></>,
        solo: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
        folder: <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
        cal: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
        check: <polyline points="20,6 9,17 4,12" />,
        grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
        link: <><circle cx="12" cy="12" r="9" /><path d="M8 12h8M12 8v8" /></>,
        spark: <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />,
        comp: <><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></>,
        plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
        info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
        crown: <><path d="M2 20h20" /><path d="M5 17l1-10 4 4 2-6 2 6 4-4 1 10" /></>,
        upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17,8 12,3 7,8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
        edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
        search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
        x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
        back: <><polyline points="15,18 9,12 15,6" /></>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
};

// UI Components translated from reference
const Pill = ({ children, bg, color }: { children: React.ReactNode, bg: string, color: string }) => (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: bg, color: color, fontWeight: 500 }}>{children}</span>
);

const RadioDot = ({ on }: { on: boolean }) => (
    <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? T : "#ccc"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {on && <div style={{ width: 12, height: 12, borderRadius: "50%", background: T }} />}
    </div>
);

const Teaser = ({ title, desc }: { title: string, desc: string }) => (
    <div style={{ background: "linear-gradient(135deg,#E6F4F8 0%,#E1F5EE 100%)", borderRadius: 12, padding: 14, display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon type="spark" size={16} color={T} />
        </div>
        <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <p style={{ fontSize: 12, fontWeight: 500, margin: 0, color: "#085041" }}>{title}</p>
                <Pill bg="rgba(11,143,172,0.15)" color={T}>Bientôt</Pill>
            </div>
            <p style={{ fontSize: 11, color: "#0F6E56", margin: 0, lineHeight: 1.4 }}>{desc}</p>
        </div>
    </div>
);

const InfoTip = ({ children }: { children: React.ReactNode }) => (
    <div style={{ padding: "10px 12px", background: "#f5f5f5", borderRadius: 10, display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12 }}>
        <div style={{ flexShrink: 0, marginTop: 1 }}><Icon type="info" size={14} color={T} /></div>
        <p style={{ fontSize: 11, color: "#666", margin: 0, lineHeight: 1.5 }}>{children}</p>
    </div>
);

const StepHeader = ({ icon, title, sub, bg = "#E6F4F8", stroke = T }: { icon: string, title: string, sub: string, bg?: string, stroke?: string }) => (
    <div style={{ textAlign: "center", margin: "8px 0 16px" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <Icon type={icon} size={24} color={stroke} />
        </div>
        <p style={{ fontSize: 17, fontWeight: 500, margin: "0 0 4px", color: "#1a1a1a" }}>{title}</p>
        <p style={{ fontSize: 13, color: "#666", margin: 0, lineHeight: 1.4 }}>{sub}</p>
    </div>
);


// Le calcul partait de `date_publication`, souvent vieille de plusieurs
// semaines, ce qui datait « Retrait du DCE » et « Deadline questions » dans le
// passé dès la création du dossier. La logique est désormais dans
// helpers/jalonHelpers, ancrée sur aujourd'hui et testée sur les cas limites.
const jalonsInit = (formData: TenderFormData) => genererJalons(formData);

export const TenderCreationWizard: React.FC<TenderCreationWizardProps> = ({
    formData,
    setFormData,
    onComplete,
    onCancel,
    userProfile
}) => {
    const [step, setStep] = useState(0);
    const [mode, setMode] = useState<'seul' | 'groupement' | null>(null);
    const [grpType, setGrpType] = useState<'conjoint' | 'solidaire' | null>(null);
    const [role, setRole] = useState<'mandataire' | 'cotraitant' | 'soustraitant' | null>(null);
    const [query, setQuery] = useState("");
    const [dropOpen, setDropOpen] = useState(false);
    const [loadingRef, setLoadingRef] = useState(true);
    const [refDomains, setRefDomains] = useState<RefDomain[]>([]);
    const [refSpecialties, setRefSpecialties] = useState<any[]>([]);
    const [selectedNature, setSelectedNature] = useState<string | null>(null);
    const [userSpecialtyIds, setUserSpecialtyIds] = useState<string[]>([]);
    const [editingJalon, setEditingJalon] = useState<number | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const adminFileInputRef = useRef<HTMLInputElement>(null);
    const searchRef = useRef<HTMLDivElement>(null);
    const [uploadingField, setUploadingField] = useState<string | null>(null);
    const [docUrls, setDocUrls] = useState<Record<string, string>>({});

    const hasMissingDocs = !userProfile?.kbis_url || !userProfile?.presentation_societe_url || !userProfile?.attestation_honneur_url || !userProfile?.attestation_assurance_url;
    // We only show the admin step if it's the first time (docs missing)
    const showAdminStep = hasMissingDocs;

    useEffect(() => {
        if (userProfile) {
            setDocUrls({
                kbis_url: userProfile.kbis_url || '',
                presentation_societe_url: userProfile.presentation_societe_url || '',
                attestation_honneur_url: userProfile.attestation_honneur_url || '',
                attestation_assurance_url: userProfile.attestation_assurance_url || ''
            });
        }
    }, [userProfile]);

    const TOTAL = showAdminStep ? 6 : 5;

    const [jalons, setJalons] = useState(formData.jalons && formData.jalons.length > 0 ? formData.jalons : jalonsInit(formData));

    const canContinue = () => {
        if (step === 1) { // Mode de réponse
            return mode !== null && (mode === 'seul' || (mode === 'groupement' && grpType && role));
        }
        if (showAdminStep && step === 2) { // Documents Administratifs
            // We allow skipping or continuing if some are uploaded, for now we don't block
            return true;
        }
        if (step === (showAdminStep ? 3 : 2)) { // Compétences
            return formData.required_skills.length > 0;
        }
        if (step === (showAdminStep ? 4 : 3)) { // Retroplanning
            return jalons.every((j: any) => j.date);
        }
        return true;
    };

    const isReady = canContinue();

    useEffect(() => {
        setFormData(prev => ({ ...prev, jalons }));
    }, [jalons]);

    // Initial load: Fetch taxonomy and user skills
    useEffect(() => {
        const loadTaxonomy = async () => {
            setLoadingRef(true);
            const [doms, specs] = await Promise.all([
                supabase.from('ref_domains').select('id, label, natures').order('label'),
                supabase.from('ref_specialties').select('id, domain_id, label').order('label'),
            ]);
            if (doms.data) setRefDomains(doms.data);
            if (specs.data) setRefSpecialties(specs.data);

            if (userProfile?.entreprise_id) {
                const { data } = await supabase
                    .from('company_specialties')
                    .select('specialty_id')
                    .eq('entreprise_id', userProfile.entreprise_id);
                if (data) setUserSpecialtyIds(data.map(s => s.specialty_id));
            }
            setLoadingRef(false);
        };
        loadTaxonomy();
    }, [userProfile?.entreprise_id]);

    const addComp = (s: RefSpecialty) => {
        if (!formData.required_specialty_ids.includes(s.id)) {
            setFormData(prev => ({ 
                ...prev, 
                required_specialty_ids: [...prev.required_specialty_ids, s.id],
                required_skills: [...prev.required_skills, s.label] 
            }));
        }
        setQuery("");
        setDropOpen(false);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setIsUploading(true);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const timestamp = Date.now();
            const cleanName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
            const fileName = `${timestamp}-${cleanName}`;
            const path = `tenders/temp/${userProfile?.id}/${fileName}`;

            try {
                const { error } = await supabase.storage
                    .from('documents')
                    .upload(path, file);

                if (error) throw error;

                const newDoc = {
                    id: Math.random().toString(36).substr(2, 9),
                    name: file.name,
                    size: file.size,
                    type: file.name.split('.').pop()?.toUpperCase() || 'FILE',
                    path: path
                };

                setFormData(prev => ({
                    ...prev,
                    dce_documents: [...(prev.dce_documents || []), newDoc]
                }));
            } catch (err) {
                console.error("Upload error:", err);
            }
        }
        setIsUploading(false);
    };

    const handleAdminDocUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
        const file = e.target.files?.[0];
        if (!file || !userProfile) return;
        try {
            setUploadingField(field);
            const ext = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;
            const filePath = `documents/${userProfile.id}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('documents')
                .upload(filePath, file);
            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('documents')
                .getPublicUrl(filePath);

            setDocUrls(prev => ({ ...prev, [field]: publicUrl }));

            // Save to user record immediately
            await supabase.from('utilisateurs').update({
                [field]: publicUrl,
            }).eq('id', userProfile.id);

        } catch (err) {
            console.error('Upload error:', err);
        } finally {
            setUploadingField(null);
        }
    };

    const handleAddJalon = () => {
        const newJalon = {
            id: Math.random().toString(36).substr(2, 9),
            label: "Nouveau jalon",
            date: new Date().toISOString().split('T')[0],
            color: P,
            source: "Manuel",
            editable: true
        };
        setJalons([...jalons, newJalon]);
        setEditingJalon(jalons.length);
    };

    const handleJalonChange = (index: number, field: string, value: any) => {
        const updated = [...jalons];
        updated[index] = { ...updated[index], [field]: value };
        setJalons(updated);
    };

    const sel = (on: boolean) => ({ border: `1.5px solid ${on ? T : "#e5e5e5"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "all 0.15s", background: on ? "rgba(11,143,172,0.04)" : "#fff" });
    const ib = (on: boolean, sz = 42) => ({ width: sz, height: sz, borderRadius: 12, background: on ? "#E6F4F8" : "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 });

    const S_Admin = () => (
        <>
            <StepHeader icon="doc" title="Documents administratifs" sub="Ces documents sont obligatoires pour vos futures candidatures (une seule fois)." />
            <div style={{ background: "rgba(11,143,172,0.05)", borderRadius: 12, padding: 14, marginBottom: 16, border: "1px solid rgba(11,143,172,0.1)" }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: T, margin: "0 0 4px" }}>Profil Entreprise</p>
                <p style={{ fontSize: 11, color: "#666", margin: 0 }}>Ces pièces seront stockées dans votre coffre-fort numérique et réutilisées pour chaque dossier.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {DOCUMENTS.map((doc) => {
                    const url = docUrls[doc.field];
                    const up = uploadingField === doc.field;
                    return (
                        <div key={doc.field} style={{ border: "1.5px solid #e5e5e5", borderRadius: 14, padding: "14px 16px", background: "#fff", display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: url ? "#E1F5EE" : "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <Icon type={url ? "check" : "upload"} size={18} color={url ? G : "#999"} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: "#1a1a1a" }}>{doc.label}</p>
                                <p style={{ fontSize: 11, color: "#999", margin: "1px 0 0" }}>{doc.desc}</p>
                            </div>
                            <label style={{ position: "relative", cursor: up ? "default" : "pointer" }}>
                                <input type="file" style={{ display: "none" }} onChange={(e) => handleAdminDocUpload(e, doc.field)} disabled={up} />
                                <div style={{ fontSize: 13, fontWeight: 600, color: url ? G : T, padding: "6px 14px", borderRadius: 8, background: url ? "rgba(29,158,117,0.1)" : "rgba(11,143,172,0.1)", border: `1px solid ${url ? "rgba(29,158,117,0.2)" : "rgba(11,143,172,0.2)"}` }}>
                                    {up ? "Envoi..." : url ? "Modifier" : "Ajouter"}
                                </div>
                            </label>
                        </div>
                    );
                })}
            </div>
            <p style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 14 }}>Vous pourrez modifier ces documents à tout moment dans vos paramètres.</p>
        </>
    );

    const removeComp = (sId: string) => {
        const spec = refSpecialties.find(s => s.id === sId);
        setFormData(prev => ({ 
            ...prev, 
            required_specialty_ids: prev.required_specialty_ids.filter(id => id !== sId),
            required_skills: spec ? prev.required_skills.filter(s => s !== spec.label) : prev.required_skills
        }));
    };

    useEffect(() => {
        const handler = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setDropOpen(false); };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const S0 = () => (
        <>
            <StepHeader icon="folder" title="Pièces du marché (DCE)" sub="Ajoutez les documents du dossier de consultation." />
            <Teaser title="Import automatique du DCE" desc="FILAO récupérera automatiquement les pièces depuis la plateforme de l'acheteur." />
            
            <input 
                type="file" 
                multiple 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                style={{ display: 'none' }} 
            />

            {formData.dce_documents && formData.dce_documents.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                {formData.dce_documents.map((d, i) => (
                    <div key={d.id || i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f5f5f5", borderRadius: 12 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: G, flexShrink: 0 }} />
                        <Icon type="doc" size={15} color="#666" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</p>
                            <p style={{ fontSize: 11, color: "#999", margin: "1px 0 0" }}>{(d.size / 1024 / 1024).toFixed(2)} Mo</p>
                        </div>
                        <span style={{ fontSize: 11, color: G, fontWeight: 500 }}>Ajouté</span>
                        <div 
                            onClick={() => setFormData(prev => ({ ...prev, dce_documents: prev.dce_documents.filter((_, idx) => idx !== i) }))}
                            style={{ cursor: 'pointer', padding: 4 }}
                        >
                            <Icon type="x" size={12} color="#999" />
                        </div>
                    </div>
                ))}
            </div>}
            
            <div onClick={() => fileInputRef.current?.click()}
                style={{ border: "1.5px dashed #ccc", borderRadius: 14, padding: "22px 16px", textAlign: "center", cursor: "pointer", opacity: isUploading ? 0.5 : 1 }}>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                    {isUploading ? <Loader2 size={16} className="animate-spin text-[#999]" /> : <Icon type="upload" size={20} color="#999" />}
                </div>
                <p style={{ fontSize: 13, color: "#666", margin: "0 0 2px", fontWeight: 500 }}>
                    {isUploading ? "Téléchargement..." : "Glissez vos fichiers ici"}
                </p>
                <p style={{ fontSize: 12, color: "#999", margin: 0 }}>ou cliquez pour parcourir · PDF, DOCX, XLSX, ZIP</p>
            </div>
            <p style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 12 }}>Vous pourrez compléter les pièces à tout moment depuis le dossier.</p>

            {/* Lien vers l'avis : jusqu'ici saisissable uniquement après création, via la
                modale Détails. En saisie manuelle, le dossier naissait donc sans lien. */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "0.5px solid #ebebeb" }}>
                <label
                    htmlFor="creation-lien-telechargement"
                    style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#1a1a1a", marginBottom: 6 }}
                >
                    Lien vers l'appel d'offres
                </label>
                <input
                    id="creation-lien-telechargement"
                    type="url"
                    inputMode="url"
                    value={formData.lien_telechargement || ""}
                    onChange={(e) => setFormData(prev => ({ ...prev, lien_telechargement: e.target.value }))}
                    placeholder="https://..."
                    style={{
                        width: "100%",
                        boxSizing: "border-box",
                        border: "1.5px solid #e5e5e5",
                        borderRadius: 12,
                        padding: "11px 14px",
                        fontSize: 13,
                        color: "#1a1a1a",
                        outlineColor: T
                    }}
                />
                <p style={{ fontSize: 11, color: "#999", margin: "6px 0 0" }}>
                    Facultatif — page de l'avis sur le profil d'acheteur. Restera accessible depuis le dossier.
                </p>
            </div>
        </>
    );

    const S1 = () => (
        <>
            <StepHeader icon="team" title="Mode de réponse" sub="Sélection obligatoire pour configurer votre dossier." />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[["seul", "solo", "Réponse individuelle", "Votre entreprise répond seule."], ["groupement", "team", "Réponse en groupement", "Avec une ou plusieurs entreprises partenaires."]].map(([id, ic, t, s]) => (
                    <div key={id} onClick={() => { setMode(id as any); if (id === "seul") { setGrpType(null); setRole(null); } }} style={sel(mode === id) as any}>
                        <div style={ib(mode === id) as any}><Icon type={ic} size={20} color={mode === id ? T : "#666"} /></div>
                        <div style={{ flex: 1 }}><p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: "#1a1a1a" }}>{t}</p><p style={{ fontSize: 12, color: "#666", margin: "3px 0 0" }}>{s}</p></div>
                        <RadioDot on={mode === id} />
                    </div>
                ))}
            </div>
            {mode === "groupement" && <div style={{ marginTop: 14, paddingTop: 14, borderTop: "0.5px solid #ebebeb" }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 10px", color: "#1a1a1a" }}>Type de groupement</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[["conjoint", "grid", "Conjoint", "Chaque membre exécute uniquement ses prestations attribuées."], ["solidaire", "link", "Solidaire", "Chaque membre est engagé pour la totalité du marché."]].map(([id, ic, t, s]) => (
                        <div key={id} onClick={() => setGrpType(id as any)} style={{ border: `1.5px solid ${grpType === id ? T : "#e5e5e5"}`, borderRadius: 14, padding: 16, cursor: "pointer", textAlign: "center", background: grpType === id ? "rgba(11,143,172,0.04)" : "#fff" }}>
                            <div style={{ ...ib(grpType === id, 38), margin: "0 auto 10px" } as any}><Icon type={ic} size={18} color={grpType === id ? T : "#666"} /></div>
                            <p style={{ fontSize: 14, fontWeight: 500, margin: 0, color: "#1a1a1a" }}>{t}</p>
                            <p style={{ fontSize: 11, color: "#666", margin: "5px 0 0", lineHeight: 1.4 }}>{s}</p>
                        </div>
                    ))}
                </div>
                <InfoTip>En cas de doute, le groupement conjoint est recommandé : il limite l'engagement de chaque membre à ses propres prestations.</InfoTip>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "16px 0 10px", color: "#1a1a1a" }}>Votre rôle dans le groupement</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[["mandataire", "crown", "Mandataire du groupement"], ["cotraitant", "team", "Co-traitant"], ["soustraitant", "solo", "Sous-traitant"]].map(([id, ic, t]) => (
                        <div key={id} onClick={() => setRole(id as any)} style={{ ...sel(role === id), padding: "12px 14px", borderRadius: 12 } as any}>
                            <div style={ib(role === id, 36) as any}><Icon type={ic} size={16} color={role === id ? T : "#666"} /></div>
                            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#1a1a1a", flex: 1 }}>{t}</p>
                            <RadioDot on={role === id} />
                        </div>
                    ))}
                </div>
                {(!grpType || !role) && <p style={{ fontSize: 11, color: R, textAlign: 'center', marginTop: 14, fontWeight: 500 }}>Saisie obligatoire : Veuillez choisir le type et votre rôle.</p>}
            </div>}
        </>
    );

    const S2 = () => (
        <>
            <StepHeader icon="comp" title="Compétences requises" sub="Ajoutez au moins une compétence pour construire votre score de succès." />
            
            <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
                {[
                    { id: 'travaux', label: 'Travaux' },
                    { id: 'services', label: 'Services' },
                    { id: 'fournitures', label: 'Fournitures' }
                ].map(n => (
                    <button
                        key={n.id}
                        onClick={() => setSelectedNature(selectedNature === n.id ? null : n.id)}
                        style={{
                            padding: "8px 16px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 600,
                            transition: "all 0.2s",
                            border: `1.5px solid ${selectedNature === n.id ? T : "#eee"}`,
                            background: selectedNature === n.id ? T : "#fff",
                            color: selectedNature === n.id ? "#fff" : "#666",
                            whiteSpace: "nowrap"
                        }}
                    >
                        {n.label}
                    </button>
                ))}
            </div>

            <Teaser title="Analyse intelligente du DCE" desc="FILAO analysera le DCE pour identifier les compétences à couvrir et maximiser vos chances de succès." />

            <div style={{ position: "relative", marginBottom: (formData.required_specialty_ids?.length || 0) > 0 ? 12 : 0 }} ref={searchRef}>
                <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", zIndex: 1 }}>
                    <Icon type="search" size={16} color="#999" />
                </div>
                <input
                    type="text" value={query}
                    onChange={e => { setQuery(e.target.value); setDropOpen(true); }}
                    onFocus={() => setDropOpen(true)}
                    placeholder={loadingRef ? "Chargement..." : "Rechercher une spécialité ou un domaine..."}
                    disabled={loadingRef}
                    style={{ width: "100%", padding: "12px 16px 12px 40px", border: "1.5px solid #e5e5e5", borderRadius: 14, fontSize: 14, color: "#1a1a1a", background: "#fff", outline: "none" }}
                />
                {dropOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1.5px solid #e5e5e5", borderRadius: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", zIndex: 10, maxHeight: 320, overflowY: "auto" }}>
                        {(() => {
                            const filteredSpecs = refSpecialties
                                .filter(s => {
                                    const domain = refDomains.find(d => d.id === s.domain_id);
                                    if (selectedNature && (!domain || !domain.natures.includes(selectedNature))) return false;
                                    if (!query) return true;
                                    return s.label.toLowerCase().includes(query.toLowerCase()) || 
                                           (domain && domain.label.toLowerCase().includes(query.toLowerCase()));
                                })
                                .slice(0, query ? 20 : 50);

                            if (filteredSpecs.length === 0) {
                                return (
                                    <div style={{ padding: "20px 16px", textAlign: "center", color: "#999", fontSize: 12 }}>
                                        Aucun résultat {selectedNature ? `pour ${selectedNature}` : ""}
                                    </div>
                                );
                            }

                            // Group by Domain
                            const grouped: Record<string, typeof filteredSpecs> = {};
                            filteredSpecs.forEach(s => {
                                const d = refDomains.find(rd => rd.id === s.domain_id);
                                const dName = d ? d.label : "Autre";
                                if (!grouped[dName]) grouped[dName] = [];
                                grouped[dName].push(s);
                            });

                            return Object.entries(grouped).map(([domainName, specs]) => (
                                <div key={domainName}>
                                    <div style={{ padding: "8px 16px 4px", background: "#f9f9f9", fontSize: 10, fontWeight: 700, color: "#aaa", textTransform: "uppercase", letterSpacing: 0.5 }}>
                                        {domainName}
                                    </div>
                                    {specs.map(s => {
                                        const isUserSkill = userSpecialtyIds.includes(s.id);
                                        const isSelected = formData.required_specialty_ids?.includes(s.id);
                                        return (
                                            <div key={s.id} onClick={() => !isSelected && addComp(s)} 
                                                style={{ padding: "10px 16px", cursor: isSelected ? "default" : "pointer", borderBottom: "1px solid #f8f8f8", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: isSelected ? 0.5 : 1 }}
                                                onMouseEnter={e => !isSelected && (e.currentTarget.style.background = "#f5f5f5")} onMouseLeave={e => !isSelected && (e.currentTarget.style.background = "transparent")}>
                                                <div>
                                                    <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1a" }}>{s.label}</div>
                                                    {isUserSkill && <p style={{ margin: 0, fontSize: 10, color: "#1D9E75", fontWeight: 600 }}>Dans votre profil</p>}
                                                </div>
                                                {isSelected && <Icon type="check" size={14} color={T} />}
                                            </div>
                                        );
                                    })}
                                </div>
                            ));
                        })()}
                    </div>
                )}
            </div>

            {/* Suggestions issues des codes CPV de l'avis. Cette étape est
                bloquante (au moins une compétence requise pour continuer), donc
                c'est ici que le coup de pouce a le plus de valeur.
                Rien n'est présélectionné : un CPV décrit l'objet du marché, pas
                les compétences attendues. */}
            {(() => {
                const domaines = suggererDomainesDepuisCpv(formData.cpv_codes).slice(0, 2);
                if (domaines.length === 0) return null;

                const proposees = refSpecialties
                    .filter(s => domaines.includes(s.domain_id))
                    .filter(s => !formData.required_specialty_ids?.includes(s.id))
                    .sort((a, b) => domaines.indexOf(a.domain_id) - domaines.indexOf(b.domain_id))
                    .slice(0, 8);

                if (proposees.length === 0) return null;

                return (
                    <div style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                            <p style={{ fontSize: 11, color: "#999", margin: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
                                Suggéré d'après les codes CPV
                            </p>
                            <button
                                onClick={() => proposees.forEach(addComp)}
                                style={{ fontSize: 11, fontWeight: 500, color: T, background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
                            >
                                Tout ajouter
                            </button>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {proposees.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => addComp(s)}
                                    aria-label={`Ajouter la spécialité ${s.label}`}
                                    style={{
                                        display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
                                        padding: "6px 12px", borderRadius: 20, background: "transparent",
                                        border: `1.5px dashed ${T}66`, color: "#666", fontWeight: 500, cursor: "pointer"
                                    }}
                                >
                                    <Icon type="plus" size={10} color={T} sw={2.5} /> {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {(formData.required_specialty_ids?.length || 0) > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {formData.required_specialty_ids?.map(sid => {
                    const s = refSpecialties.find(x => x.id === sid);
                    if (!s) return null;
                    return (
                        <span key={sid} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "6px 12px", borderRadius: 20, background: "#E6F4F8", color: T, fontWeight: 500 }}>
                            {s.label}
                            <span onClick={() => removeComp(sid)} style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(0,0,0,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                                <Icon type="x" size={10} color={T} sw={2.5} />
                            </span>
                        </span>
                    );
                })}
            </div>}

            {mode === "groupement" && <div style={{ marginTop: 14, padding: 14, background: "#f5f5f5", borderRadius: 14, display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div style={ib(true, 32) as any}><Icon type="team" size={16} color={T} /></div>
                <div>
                    <p style={{ fontSize: 12, fontWeight: 500, margin: "0 0 2px", color: "#1a1a1a" }}>Invitez vos partenaires plus tard</p>
                    <p style={{ fontSize: 11, color: "#666", margin: 0, lineHeight: 1.4 }}>Vous pourrez inviter co-traitants et sous-traitants depuis votre espace de consultation.</p>
                </div>
            </div>}
            {formData.required_skills.length === 0 && <p style={{ fontSize: 11, color: R, textAlign: 'center', marginTop: 14, fontWeight: 500 }}>Une sélection est requise pour élaborer votre stratégie.</p>}
        </>
    );

    const S3 = () => (
        <>
            <StepHeader icon="cal" title="Jalons & rétroplanning" sub="Configurez les dates clés pour organiser votre réponse (obligatoire)." />

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {jalons.map((j: any, i: number) => (
                    <div key={j.id || i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#f5f5f5", borderRadius: 12 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", border: `2.5px solid ${j.color}`, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                            {editingJalon === i ? (
                                <input
                                    type="text"
                                    defaultValue={j.label}
                                    onBlur={(e) => {
                                        handleJalonChange(i, 'label', e.target.value);
                                        setEditingJalon(null);
                                    }}
                                    autoFocus
                                    style={{ fontSize: 13, border: `1.5px solid ${T}`, borderRadius: 8, padding: "4px 8px", color: "#1a1a1a", outline: "none", width: "100%", marginBottom: 4 }}
                                />
                            ) : (
                                <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#1a1a1a" }}>{j.label}</p>
                            )}
                            <p style={{ fontSize: 11, color: "#999", margin: "1px 0 0" }}>{j.source}</p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {editingJalon === i ? (
                                <input
                                    type="date"
                                    defaultValue={j.date}
                                    onChange={(e) => handleJalonChange(i, 'date', e.target.value)}
                                    style={{ fontSize: 13, border: `1.5px solid ${T}`, borderRadius: 8, padding: "4px 8px", color: "#1a1a1a", outline: "none", width: 140 }}
                                />
                            ) : (
                                <>
                                    <span style={{ fontSize: 13, fontWeight: 500, color: j.editable ? j.color : "#1a1a1a" }}>
                                        {new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </span>
                                    {j.editable && <div onClick={() => setEditingJalon(i)} style={{ cursor: "pointer" }}><Icon type="edit" size={14} color="#999" /></div>}
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <div onClick={handleAddJalon}
                style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", border: "1.5px dashed #ccc", borderRadius: 12, cursor: "pointer" }}>
                <Icon type="plus" size={16} color="#999" /><p style={{ fontSize: 13, color: "#666", margin: 0 }}>Ajouter un jalon personnalisé</p>
            </div>
            <InfoTip>Des alertes automatiques seront envoyées à l'approche de chaque jalon.</InfoTip>
        </>
    );

    const S4 = () => {
        const mL = mode === "groupement" ? `Groupement ${grpType || "—"} · ${role === "mandataire" ? "Mandataire" : role === "cotraitant" ? "Co-traitant" : role === "soustraitant" ? "Sous-traitant" : "—"}` : mode === "seul" ? "Réponse individuelle" : "—";
        return <>
            <StepHeader icon="check" title="Tout est prêt !" sub="Vérifiez le récapitulatif avant de créer votre dossier." bg="#E1F5EE" stroke={G} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div style={{ background: "#f5f5f5", borderRadius: 14, padding: "14px 16px" }}>
                        <p style={{ fontSize: 11, color: "#999", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>Mode</p>
                        <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#1a1a1a" }}>{mL}</p>
                    </div>
                    <div style={{ background: "#f5f5f5", borderRadius: 14, padding: "14px 16px" }}>
                        <p style={{ fontSize: 11, color: "#999", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: 0.5 }}>Pièces DCE</p>
                        <p style={{ fontSize: 13, fontWeight: 500, margin: 0, color: "#1a1a1a" }}>{formData.dce_documents?.length || 0} document{formData.dce_documents?.length !== 1 ? "s" : ""}</p>
                    </div>
                </div>
                <div style={{ background: "#f5f5f5", borderRadius: 14, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <p style={{ fontSize: 11, color: "#999", margin: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>Compétences</p>
                        <span onClick={() => setStep(2)} style={{ fontSize: 11, color: T, cursor: "pointer", fontWeight: 500 }}>Modifier</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {formData.required_skills.length > 0 ? formData.required_skills.map(s => <span key={s} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: "#E6F4F8", color: T }}>{s}</span>) :
                            <span style={{ fontSize: 11, color: "#999", fontStyle: "italic" }}>Aucune sélectionnée</span>}
                    </div>
                </div>
                <div style={{ background: "#f5f5f5", borderRadius: 14, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <p style={{ fontSize: 11, color: "#999", margin: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>Jalons</p>
                        <span onClick={() => setStep(3)} style={{ fontSize: 11, color: T, cursor: "pointer", fontWeight: 500 }}>Modifier</span>
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {jalons.filter((j: any) => j.label !== "Retrait du DCE").slice(0, 3).map((j: any) => (
                            <div key={j.id || j.label}>
                                <p style={{ fontSize: 11, color: "#999", margin: 0 }}>{j.label}</p>
                                <p style={{ fontSize: 13, fontWeight: 500, margin: "1px 0 0", color: j.color }}>
                                    {new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </p>
                            </div>
                        ))}
                        {jalons.length > 3 && <div style={{ fontSize: 11, color: "#999", alignSelf: 'flex-end' }}>+{jalons.length - 3} autres</div>}
                    </div>
                </div>
            </div>
        </>;
    };

    const renders = showAdminStep ? [S0, S1, S_Admin, S2, S3, S4] : [S0, S1, S2, S3, S4];
    const bL = showAdminStep ? [
        ["Continuer", "Passer cette étape"], 
        ["Continuer", "Retour"], 
        ["Continuer", "Passer (temporairement)"],
        ["Continuer", "Retour"], 
        ["Continuer", "Retour"], 
        ["Créer le dossier", "Retour"]
    ] : [
        ["Continuer", "Passer cette étape"], 
        ["Continuer", "Retour"], 
        ["Continuer", "Retour"], 
        ["Continuer", "Retour"], 
        ["Créer le dossier", "Retour"]
    ];

    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(11,31,56,0.4)", backdropBlur: "4px", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "2.5rem 1rem", overflowY: "auto" }}>
            <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 540, overflow: "visible", boxShadow: "0 8px 32px rgba(0,0,0,0.08)", marginTop: "2rem", position: "relative", zIndex: 70 }}>

                {/* === HEADER === */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "20px 28px 0" }}>
                    <div onClick={() => step > 0 ? setStep(step - 1) : onCancel()} style={{ width: 32, height: 32, borderRadius: 8, background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginTop: 2 }}>
                        <Icon type="back" size={16} color="#666" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 15, fontWeight: 500, margin: 0, color: "#1a1a1a", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formData.titre}</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
                            <p style={{ fontSize: 12, color: "#999", margin: 0 }}>{formData.organisme_acheteur} · {formData.mode_passation}</p>
                            <p style={{ fontSize: 12, margin: 0 }}><span style={{ color: "#999" }}>Limite : </span><span style={{ color: R, fontWeight: 500 }}>{formData.date_limite ? new Date(formData.date_limite).toLocaleDateString() : "—"}</span></p>
                        </div>
                    </div>
                    <div onClick={onCancel} style={{ width: 32, height: 32, borderRadius: 8, background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, marginTop: 2 }}>
                        <Icon type="x" size={16} color="#666" />
                    </div>
                </div>

                {/* === PROGRESS === */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 28px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                        {Array.from({ length: TOTAL }).map((_, i) => <div key={i} style={{ height: 4, flex: 1, borderRadius: 2, background: i <= step ? T : "#e0e0e0", transition: "background 0.3s" }} />)}
                    </div>
                    <p style={{ fontSize: 11, color: "#999", margin: "0 0 0 8px", whiteSpace: "nowrap" }}>{step + 1}/{TOTAL}</p>
                </div>

                {/* === CONTENT === */}
                <div style={{ padding: "12px 28px 20px" }}>
                    {renders[step]()}
                </div>

                {/* === FOOTER === */}
                <div style={{ padding: "0 28px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <button 
                        onClick={() => { 
                            if (!isReady) return;
                            if (step < TOTAL - 1) setStep(step + 1); 
                            else {
                                onComplete(grpType === 'solidaire' ? 'solidaire' : grpType === 'conjoint' ? 'conjoint' : undefined, role);
                            }
                        }}
                        style={{ 
                            width: "100%", padding: 14, borderRadius: 14, 
                            background: isReady ? T : "#ccc", 
                            color: "#fff", fontSize: 15, fontWeight: 500, border: "none", 
                            cursor: isReady ? "pointer" : "not-allowed",
                            transition: "all 0.2s"
                        }}
                    >
                        {bL[step][0]}
                    </button>
                    <button 
                        onClick={() => { 
                            if (step === 0) setStep(1); // Passer cette étape (DCE)
                            else if (showAdminStep && step === 2) setStep(3); // Passer (temporairement) Admin docs
                            else if (step > 0) setStep(step - 1); // Retour
                            else onCancel(); 
                        }}
                        style={{ width: "100%", padding: 10, borderRadius: 14, background: "transparent", color: "#666", fontSize: 14, border: "none", cursor: "pointer" }}
                    >
                        {bL[step][1]}
                    </button>
                </div>

            </div>
        </div>
    );
};