import React, { memo } from 'react';
import { Building2, Check, Loader2, PenLine, Search } from 'lucide-react';
import { getFormeJuridiqueLabel } from '../config';

/**
 * Étape 1 de l'inscription : identité de l'entreprise.
 *
 * Recherche par SIRET, ou saisie manuelle. Second découpage de
 * `OnboardingWizard`, après l'étape des compétences.
 *
 * AUCUN ÉTAT NE DESCEND ICI — délibérément.
 * Tout ce que cette étape manipule (les champs saisis, le mode d'entrée, le
 * verrouillage des champs rapportés par le SIRET) est relu par le parent au
 * moment d'enregistrer. Descendre ces états obligerait à les faire remonter
 * aussitôt : on ne gagnerait qu'un aller-retour de plus.
 */
const inputClass = "w-full bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:border-filao-primary focus:ring-2 focus:ring-filao-primary/20 transition-all";

export interface OnboardingCompanyStepProps {
    /** Champs de l'entreprise en cours de saisie. */
    companyData: Record<string, any>;
    setCompanyData: React.Dispatch<React.SetStateAction<any>>;
    /** Champs de l'utilisateur (prénom, nom, poste). */
    userData: Record<string, any>;
    setUserData: React.Dispatch<React.SetStateAction<any>>;

    /** Saisie du SIRET et retour de la recherche. */
    siretInput: string;
    setSiretInput: (valeur: string) => void;
    /** Recherche SIRET en cours. */
    searching: boolean;
    searchError: string | null;
    setSearchError: (message: string | null) => void;
    onRechercherSiret: () => void;

    /** Mode d'entrée retenu : recherche SIRET ou saisie manuelle. */
    entryMode: string | null;
    setEntryMode: (mode: any) => void;
    /** Champs figés parce que rapportés par le SIRET. */
    setFieldsLocked: (verrouille: boolean) => void;
    /** Entreprise vérifiée via SIRET. */
    isVerified: boolean;
    setIsVerified: (verifie: boolean) => void;

    /**
     * Rattachement à une entreprise existante : l'utilisateur consulte les
     * informations déjà déclarées, il ne les modifie pas.
     */
    lectureSeule: boolean;
    nomRattachement?: string | null;
    entrepriseId?: string | null;
}

const OnboardingCompanyStepBase: React.FC<OnboardingCompanyStepProps> = ({
    companyData, setCompanyData, userData, setUserData, searching,
    siretInput, setSiretInput, searchError, setSearchError, onRechercherSiret,
    entryMode, setEntryMode, setFieldsLocked, isVerified, setIsVerified,
    lectureSeule, nomRattachement, entrepriseId,
}) => {
    return (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            {/* Rattaché à une entreprise existante : dire d'où
                                viennent ces informations, et offrir la seule
                                action utile — la quitter pour en choisir une
                                autre. Sans elle, l'utilisateur était bloqué. */}
                            {entrepriseId && lectureSeule && (
                                <div className="bg-[#EFF4F8] border border-[#00A3E0]/15 rounded-2xl p-4 flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-[#0B1F38]">
                                            Vous êtes rattaché à {nomRattachement || 'votre entreprise'}
                                        </p>
                                        <p className="text-xs text-[#0B1F38]/55 mt-0.5 leading-relaxed">
                                            Ces informations sont gérées par un administrateur de votre
                                            entreprise. Pour en rejoindre une autre, saisissez simplement
                                            son SIRET.
                                        </p>
                                    </div>
                                </div>
                            )}

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
                                                        onKeyDown={(e) => e.key === 'Enter' && onRechercherSiret()}
                                                        className={inputClass}
                                                        placeholder="Ex: 123 456 789 00012"
                                                        maxLength={17}
                                                    />
                                                    <button onClick={onRechercherSiret}
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

    );
};

export const OnboardingCompanyStep = memo(OnboardingCompanyStepBase);
