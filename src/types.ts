import type { CriteresAttribution } from './helpers/boampHelpers';

export type NavItem = 'dashboard' | 'tenders' | 'calendar' | 'collaborators' | 'company' | 'finance' | 'profile' | 'settings' | 'notifications' | 'pricing' | 'chat';


export interface Tender {
    id: string;
    createur_id: string;
    titre: string;
    // Aligné sur l'enum PostgreSQL `reponse_ao_statuts`. « Déposé » manquait,
    // alors que STATUSES.submitted vaut cette valeur et que le verrouillage du
    // dossier en dépend. « Expiré » est calculé depuis date_limite, jamais stocké.
    statut: 'Brouillon' | 'En cours' | 'Déposé' | 'Gagné' | 'Perdu';
    montant_estime: number;
    devise: string;
    etape: string;
    created_at: string;
    date_limite: string;
    organisme_acheteur: string;
    lieu_execution: string[];
    date_depot_souhaitee: Date; // or string? DB is timestamptz. Frontend often treats as string or Date.
    date_publication: Date;
    secteur_activite: string;
    type_marche: string[]; // colonne ARRAY en base
    type_groupement?: 'solidaire' | 'conjoint';
    groupements?: Groupement[];
    modified_at?: string;
    success_score?: number;
    /** Dossier au-delà du quota de l'offre : lecture seule, réversible. */
    verrouille_par_quota?: boolean;
    nb_fichiers_recus?: number;
    nombre_pj_attendues?: number;
    nb_collaborateurs?: number;
    remporte?: boolean;
    feed_id?: string;
    required_skills?: string[];
    jalons?: any[];
    dce_documents?: any[];
    cpv_codes?: string[];
    criteres_attribution?: CriteresAttribution | null;
    reference_marche?: string;
    /** Jointure `invitations (...)`, présente selon la requête. */
    invitations?: { email?: string;[key: string]: any }[];
}

export interface ChartData {
    name: string;
    value: number;
}

export interface Entreprise {
    id: string;
    nom: string;
    siret?: string;
    adresse?: string;
    ville?: string;
    code_postal?: string;
    taille?: string; // 'TPE', 'PME', 'ETI', 'GE'
    logo_url?: string;
    created_at?: string;
    created_by?: string;
    siret_verified?: boolean;
    forme_juridique?: string;
    code_naf?: string;
    libelle_naf?: string;
    date_creation?: string;
    // v3.1
    description?: string;
    site_web?: string;
    referent_id?: string;
    visible_reseau?: boolean;
}

export interface ReseauEntreprise {
    id: string;
    entreprise_origine_id: string;
    entreprise_cible_id: string;
    statut: 'actif' | 'bloque' | 'en_attente';
    created_at: string;
    // Joined
    entreprise_cible?: Entreprise;
}

export type RoleGroupement = 'Mandataire' | 'Co-traitant' | 'Sous-traitant';
export type StatutGroupement = 'invite' | 'accepte' | 'refuse' | 'retire';
export type RoleEntreprise = 'admin' | 'membre';
export type TypeGroupement = 'solidaire' | 'conjoint';

export interface Groupement {
    id: string;
    projet_id: string;           // FK → reponses_ao.id
    entreprise_id: string;       // FK → entreprises.id
    role_groupement: RoleGroupement;
    statut: StatutGroupement;
    date_invitation?: string;
    date_reponse?: string;
    invite_par?: string;         // FK → utilisateurs.id
    // Joined data (from Supabase select with nested joins)
    entreprise?: {
        id: string;
        nom: string;
        logo_url?: string;
        referent?: {             // via entreprises.referent_id → utilisateurs
            id: string;
            email: string;
            nom: string;
            prenom: string;
            photo_url?: string;
        };
    };
}

export interface DocumentEntreprise {
    id: string;
    entreprise_id: string;
    type_document: string;
    nom_fichier?: string;
    url?: string;
    date_emission?: string;
    date_expiration?: string;
    statut: 'valide' | 'expire' | 'en_attente' | 'manquant';
    statut_effectif?: string; // from view
    tags: string[];
    uploaded_by?: string;
    created_at?: string;
}

export interface EntrepriseCertification {
    id: string;
    entreprise_id: string;
    nom: string;
    numero?: string;
    date_obtention?: string;
    date_expiration?: string;
    justificatif_url?: string;
    created_at?: string;
}

export interface UserProfile {
    id: string;
    nom: string;
    prenom: string;
    email: string;
    entreprise_id?: string;
    role_entreprise: RoleEntreprise;
    fonction?: string;
    avatar_url?: string;
    telephone?: string;
    forfait?: string;
    storage_used?: number;
    created_at?: string;
}

// UI Type for Groupement Members management
export interface UIGroupementMember {
    id?: string; // User ID if known
    groupement_id?: string; // Groupement Table ID
    email: string;
    name: string;
    company: string;
    role: RoleGroupement | string;
    photo_url?: string;
    status: StatutGroupement | string;
    deleted?: boolean;
    isNew?: boolean;
    entreprise_id?: string; // If known
    skills?: string[];
    specialty_ids?: string[];
    hasAccount?: boolean;
    access_code?: string;
    /** Horodatage d'une demande de nouveau lien par l'invité, le cas échéant. */
    relance_demandee_le?: string;
    is_owner?: boolean;
}

export interface TenderFormData {
    /** Dossier au-delà du quota : lecture seule, réversible (migration 049). */
    verrouille_par_quota?: boolean;
    titre: string;
    organisme_acheteur: string;
    lieu_execution: string[];
    type_marche: string[];
    secteur_activite: string;
    mode_passation: string;
    description: string;
    date_publication: string;
    date_limite: string;
    date_depot_souhaitee: string;
    montant_estime: number;
    lien_telechargement: string;
    lien_depot?: string;
    /** Codes CPV à 8 chiffres (nomenclature UE). */
    cpv_codes: string[];
    /** Critères d'attribution et pondérations — voir helpers/boampHelpers. */
    criteres_attribution?: CriteresAttribution | null;
    /** Référence du marché côté acheteur (≠ id technique Filao). */
    reference_marche?: string;
    type_groupement?: 'solidaire' | 'conjoint';
    required_skills: string[];
    required_specialty_ids: string[];
    documents: any[];
    jalons: any[];
    dce_documents: any[];
    createur_id?: string;
    statut?: string;
}
export interface ChatMessage {
    id: string;
    tender_id: string;
    sender_id: string;
    content: string;
    created_at: string;
    type: 'text' | 'file' | 'system';
    metadata?: any;
    // Joined data
    sender?: {
        nom: string;
        prenom: string;
        avatar_url?: string;
        photo_url?: string;
    };
}

export interface ChatConversation {
    tender_id: string;
    tender_title: string;
    last_message?: ChatMessage;
    unread_count: number;
    participants_count: number;
}