// Application Configuration
// Edit this file to change global settings, logo, and theme variables.
import React from 'react';
import { NavItem } from './types';
import type { CriteresAttribution } from '../helpers/boampHelpers';

export const APP_CONFIG = {
  appName: "Filao",
  altLogo: 'https://res.cloudinary.com/dxh9pvvmc/image/upload/v1765985504/logo_alt_l6djrg.png',
  logoExpandedUrl: 'https://res.cloudinary.com/dxh9pvvmc/image/upload/v1765972329/logo_s8fkk1.png',
  logoCollapsedUrl: 'https://res.cloudinary.com/dxh9pvvmc/image/upload/v1765972329/collapasedLogo_wk0cvr.png',
  logoWidth: "auto",
  logoHeight: "32px",
};

// All colors are synced with the Tailwind config in index.html.
export const THEME_COLORS = {
  dark: '#1B2533',
  primary: '#F06A50',
  secondary: '#2C7A7B',
  blue: '#0E4F70',
  ocean: '#0086B1',
  lightTeal: '#B6E0E2',
  headerGray: '#5D7285',
  wizard: '#0A3D58',
  success: '#568FA6',
  chart: '#569CB1',
  actionLight: '#A7D7D9',
  danger: '#D32F2F',
  muted: '#6B7C8E',
  surface: '#EFF4F8',
  accent: '#0088A5',
  cardBg: '#EBE7E4',
  cardBgAlt: '#B4C5CD',
  cardBgAlt2: '#E5E7E6',
  input: '#062C41',
  white: '#FFFFFF',
};

// Global Dimensions and Structural variables
export const THEME_DIMENSIONS = {
  radius: {
    card: '2.5rem',      // 40px - Main large containers
    cardSm: '1.5rem',    // 24px - Secondary containers
    button: '1rem',      // 16px - Primary actions
    input: '0.75rem',    // 12px - Form elements
    inner: '0.5rem',     // 8px - Smallest elements
  },
  spacing: {
    card: '2rem',        // p-8
    cardLg: '2.5rem',    // p-10
    container: '2rem',   // Page margins
  }
};

// Style Presets (Shadows, Opacity, Transitions)
export const THEME_STYLE = {
  shadow: {
    card: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    cardLg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    modal: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  },
  transition: {
    duration: '300ms',
    timing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  }
};


export const BOAMP_BaseUrl = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

// 1. Define the shape of a Document Type
export interface DocumentTypeDefinition {
  label: string; // Display name: "Mémoire technique"
  value: string; // System name:  "memoire_technique"
}

// 2. Update the constant
export const REQUIRED_DOCS_BY_ROLE: Record<string, DocumentTypeDefinition[]> = {
  "Mandataire": [
    { label: "DC1", value: "dc1" },
    { label: "DC2", value: "dc2" },
    { label: "Dossier administratif", value: "dossier_administratif" },
    { label: "Dossier de présentation", value: "dossier_presentation" },
    { label: "Bordereau des prix", value: "bordereau_prix" },
    { label: "DPGF", value: "dpgf" },
    { label: "Mémoire technique", value: "memoire_technique" },
    { label: "Planning", value: "planning" },
    { label: "Annexes", value: "annexes" }
  ],
  "Co-traitant": [
    { label: "DC2", value: "dc2" },
    { label: "Dossier administratif", value: "dossier_administratif" },
    { label: "Acte d'engagement", value: "acte_engagement" },
    { label: "Dossier de présentation", value: "dossier_presentation" },
    { label: "Annexes", value: "annexes" }
  ],
  "Sous-traitant": [
    { label: "DC4", value: "dc4" },
    { label: "Dossier administratif", value: "dossier_administratif" },
    { label: "Acte d'engagement", value: "acte_engagement" },
    { label: "Dossier de présentation", value: "dossier_presentation" },
    { label: "Annexes", value: "annexes" }
  ]
};

export const STATUSES = {
  draft: 'Brouillon',
  on: 'En cours',
  submitted: 'Déposé',
  expired: 'Expiré', // Virtual: computed from date_limite, never stored in DB
  won: 'Gagné',
  lost: 'Perdu'
}

export const DEPARTEMENTS = [
  "Ain",
  "Aisne",
  "Allier",
  "Alpes de Haute Provence",
  "Hautes Alpes",
  "Alpes Maritimes",
  "Ardèche",
  "Ardennes",
  "Ariège",
  "Aube",
  "Aude",
  "Aveyron",
  "Bouches du Rhône",
  "Calvados",
  "Cantal",
  "Charente",
  "Charente Maritime",
  "Cher",
  "Corrèze",
  "Corse du Sud",
  "Haute Corse",
  "Côte d’Or",
  "Côtes d’Armor",
  "Creuse",
  "Dordogne",
  "Doubs",
  "Drôme",
  "Eure",
  "Eure et Loir",
  "Finistère",
  "Gard",
  "Haute Garonne",
  "Gers",
  "Gironde",
  "Hérault",
  "Ille et Vilaine",
  "Indre",
  "Indre et Loire",
  "Isère",
  "Jura",
  "Landes",
  "Loir et Cher",
  "Loire",
  "Haute Loire",
  "Loire Atlantique",
  "Loiret",
  "Lot",
  "Lot et Garonne",
  "Lozère",
  "Maine et Loire",
  "Manche",
  "Marne",
  "Haute Marne",
  "Mayenne",
  "Meurthe et Moselle",
  "Meuse",
  "Morbihan",
  "Moselle",
  "Nièvre",
  "Nord",
  "Oise",
  "Orne",
  "Pas de Calais",
  "Puy de Dôme",
  "Pyrénées Atlantiques",
  "Hautes Pyrénées",
  "Pyrénées Orientales",
  "Bas-Rhin",
  "Haut-Rhin",
  "Rhône",
  "Métropole de Lyon",
  "Haute Saône",
  "Saône et Loire",
  "Sarthe",
  "Savoie",
  "Haute Savoie",
  "Paris",
  "Seine Maritime",
  "Seine et Marne",
  "Yvelines",
  "Deux Sèvres",
  "Somme",
  "Tarn",
  "Tarn et Garonne",
  "Var",
  "Vaucluse",
  "Vendée",
  "Vienne",
  "Haute Vienne",
  "Vosges",
  "Yonne",
  "Territoire de Belfort",
  "Essonne",
  "Hauts de Seine",
  "Seine Saint Denis",
  "Val de Marne",
  "Val d’Oise",
  "Guadeloupe",
  "Martinique",
  "Guyane",
  "La Réunion",
  "Mayotte",
  "Province Sud de la Nouvelle Calédonie"
];

export const DEPARTEMENTS_OBJ = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège",
  "10": "Aube",
  "11": "Aude",
  "12": "Aveyron",
  "13": "Bouches du Rhône",
  "14": "Calvados",
  "15": "Cantal",
  "16": "Charente",
  "17": "Charente Maritime",
  "18": "Cher",
  "19": "Corrèze",
  "21": "Côte d’Or",
  "22": "Côtes d’Armor",
  "23": "Creuse",
  "24": "Dordogne",
  "25": "Doubs",
  "26": "Drôme",
  "27": "Eure",
  "28": "Eure et Loir",
  "29": "Finistère",
  "30": "Gard",
  "31": "Haute Garonne",
  "32": "Gers",
  "33": "Gironde",
  "34": "Hérault",
  "35": "Ille et Vilaine",
  "36": "Indre",
  "37": "Indre et Loire",
  "38": "Isère",
  "39": "Jura",
  "40": "Landes",
  "41": "Loir et Cher",
  "42": "Loire",
  "43": "Haute Loire",
  "44": "Loire Atlantique",
  "45": "Loiret",
  "46": "Lot",
  "47": "Lot et Garonne",
  "48": "Lozère",
  "49": "Maine et Loire",
  "50": "Manche",
  "51": "Marne",
  "52": "Haute Marne",
  "53": "Mayenne",
  "54": "Meurthe et Moselle",
  "55": "Meuse",
  "56": "Morbihan",
  "57": "Moselle",
  "58": "Nièvre",
  "59": "Nord",
  "60": "Oise",
  "61": "Orne",
  "62": "Pas de Calais",
  "63": "Puy de Dôme",
  "64": "Pyrénées Atlantiques",
  "65": "Hautes Pyrénées",
  "66": "Pyrénées Orientales",
  "67": "Bas-Rhin",
  "68": "Haut-Rhin",
  "69": "Rhône",
  "70": "Haute Saône",
  "71": "Saône et Loire",
  "72": "Sarthe",
  "73": "Savoie",
  "74": "Haute Savoie",
  "75": "Paris",
  "76": "Seine Maritime",
  "77": "Seine et Marne",
  "78": "Yvelines",
  "79": "Deux Sèvres",
  "80": "Somme",
  "81": "Tarn",
  "82": "Tarn et Garonne",
  "83": "Var",
  "84": "Vaucluse",
  "85": "Vendée",
  "86": "Vienne",
  "87": "Haute Vienne",
  "88": "Vosges",
  "89": "Yonne",
  "90": "Territoire de Belfort",
  "91": "Essonne",
  "92": "Hauts de Seine",
  "93": "Seine Saint Denis",
  "94": "Val de Marne",
  "95": "Val d’Oise",
  "971": "Guadeloupe",
  "972": "Martinique",
  "973": "Guyane",
  "974": "La Réunion",
  "976": "Mayotte",
  "988": "Province Sud de la Nouvelle Calédonie",
  "2A": "Corse du Sud",
  "2B": "Haute Corse",
  "69M": "Métropole de Lyon"
}

export const SECTORS = [
  { "label": "BTP & Construction", "value": "BTP_Construction" },
  { "label": "Informatique & Digital", "value": "Informatique_Digital" },
  { "label": "Transport & Logistique", "value": "Transport_Logistique" },
  { "label": "Santé & Pharmaceutique", "value": "Sante_Pharmaceutique" },
  { "label": "Énergie & Environnement", "value": "Energie_Environnement" },
  { "label": "Services aux entreprises", "value": "Services_Entreprises" },
  { "label": "Industrie", "value": "Industrie" },
  { "label": "Autres", "value": "Autres" }
];

export const SECTORS_LABELS = {
  "BTP_Construction": "BTP & Construction",
  "Informatique_Digital": "Informatique & Digital",
  "Transport_Logistique": "Transport & Logistique",
  "Sante_Pharmaceutique": "Santé & Pharmaceutique",
  "Energie_Environnement": "Énergie & Environnement",
  "Services_Entreprises": "Services aux entreprises",
  "Industrie": "Industrie",
  "Autres": "Autres"
};

// INSEE NAF section codes → French labels
// Source: https://www.insee.fr/fr/information/2120875
export const INSEE_SECTION_LABELS: Record<string, string> = {
  'A': 'Agriculture, sylviculture et pêche',
  'B': 'Industries extractives',
  'C': 'Industrie manufacturière',
  'D': "Production d'électricité, gaz, vapeur",
  'E': "Production d'eau, assainissement, déchets",
  'F': 'Construction',
  'G': 'Commerce, réparation automobiles',
  'H': 'Transports et entreposage',
  'I': 'Hébergement et restauration',
  'J': 'Information et communication',
  'K': "Activités financières et d'assurance",
  'L': 'Activités immobilières',
  'M': 'Activités spécialisées, scientifiques et techniques',
  'N': 'Activités de services administratifs',
  'O': 'Administration publique',
  'P': 'Enseignement',
  'Q': 'Santé humaine et action sociale',
  'R': 'Arts, spectacles et activités récréatives',
  'S': 'Autres activités de services',
  'T': 'Activités des ménages',
  'U': 'Activités extraterritoriales',
};

export const MARKET_TYPES = [
  { "label": "Travaux", "value": "TRAVAUX" },
  { "label": "Fournitures", "value": "FOURNITURES" },
  { "label": "Services", "value": "SERVICES" }
];

export const MARKET_TYPES_LABELS = {
  "TRAVAUX": "Travaux",
  "FOURNITURES": "Fournitures",
  "SERVICES": "Services"
};


export const HANDOVER_TYPES = [
  { "label": "Appel d’offres ouvert", "value": "OUVERT" },
  { "label": "Appel d’offres restreint", "value": "RESTREINT" },
  { "label": "MAPA (Marché à procédure adaptée)", "value": "PROCEDURE_ADAPTE" },
  { "label": "Dialogue compétitif", "value": "DIALOGUE_COMPETITIF" },
  { "label": "Marché négocié", "value": "NEGOCIE" },
  { "label": "Concours ouvert", "value": "CONCOURS_OUVERT" },
  { "label": "Concours restreint", "value": "CONCOURS_RESTREINT" },
  { "label": "Délégation de service public", "value": "DSP" },
  { "label": "Partenariat innovation", "value": "PARTENARIAT_INNOVATION" },
  { "label": "Autres", "value": "AUTRE" }
];

export const HANDOVER_TYPES_LABELS = {
  "OUVERT": "Appel d’offres ouvert",
  "RESTREINT": "Appel d’offres restreint",
  "PROCEDURE_ADAPTE": "MAPA (Marché à procédure adaptée)",
  "DIALOGUE_COMPETITIF": "Dialogue compétitif",
  "NEGOCIE": "Marché négocié",
  "CONCOURS_OUVERT": "Concours ouvert",
  "CONCOURS_RESTREINT": "Concours restreint",
  "DSP": "Délégation de service public",
  "PARTENARIAT_INNOVATION": "Partenariat innovation",
  "AUTRE": "Autres"
};

export const ROLES = ["Mandataire", "Co-traitant", "Sous-traitant"];

export const SKILLS = [
  // Construction & BTP - Gros Oeuvre
  "Gros Oeuvre", "Maçonnerie", "Béton armé", "Fondations", "Charpente", "Coffrage",
  // Structure & Architecture  
  "Architecture", "Ingénierie structure", "Conception architecturale", "Maîtrise d'oeuvre", "BIM",
  // Second Oeuvre
  "Menuiserie", "Serrurerie", "Métallerie", "Plâtrerie", "Cloisons", "Faux plafonds",
  // Finitions
  "Peinture", "Revêtements de sols", "Carrelage", "Faïence", "Parquet", "Moquette",
  // Couverture & Étanchéité
  "Couverture", "Étanchéité", "Zinguerie", "Bardage", "Isolation thermique", "ITE",
  // Façades
  "Ravalement", "Façades", "Enduits", "Nettoyage façades",
  // VRD & Terrassement
  "VRD", "Voirie", "Réseaux divers", "Terrassement", "Assainissement", "Génie civil",
  // Espaces Verts
  "Paysagisme", "Espaces verts", "Plantation", "Élagage", "Arrosage automatique",
  // Fluides - Électricité
  "Électricité", "Courants forts (CFO)", "Courants faibles (CFA)", "Éclairage", "Domotique", "Photovoltaïque",
  // Fluides - CVC/Plomberie
  "CVC", "Chauffage", "Ventilation", "Climatisation", "Plomberie", "Sanitaire", "Géothermie",
  // Ascenseurs
  "Ascenseurs", "Monte-charges", "Escalators",
  // Sécurité
  "Sécurité incendie (SSI)", "Désenfumage", "Sprinklers", "SPS", "Coordination sécurité", "Contrôle d'accès",
  // Démolition & Désamiantage
  "Démolition", "Désamiantage", "Déconstruction", "Curage", "Dépollution",
  // Informatique & Réseaux
  "Réseaux informatiques", "Fibre optique", "Data center", "Téléphonie", "Vidéosurveillance", "Cybersécurité", "Cloud Computing",
  // Services & Maintenance
  "Nettoyage", "Maintenance", "Exploitation", "Facility management", "Blanchisserie", "Conciergerie",
  // Restauration & Food
  "Restauration", "Catering", "Traiteur", "Cantine scolaire", "Liaison froide", "Sécurité alimentaire (HACCP)",
  // Juridique & RH
  "Conseil juridique", "Droit public", "Droit social", "Recrutement", "Formation professionnelle", "Paie",
  // Logistique & Transport
  "Déménagement", "Transport de personnes", "Transport de marchandises", "Logistique", "Flotte automobile", "Livraison",
  // Communication & Marketing
  "Événementiel", "Graphisme", "Publicité", "Relations presse", "Digital Marketing", "Signalétique",
  // Environnement & Déchets
  "Gestion des déchets", "Recyclage", "Traitement des eaux", "Biodiversité", "Dépollution sols",
  // Mobilier & Équipement
  "Mobilier de bureau", "Équipement informatique", "Fournitures de bureau", "Matériel médical", "Aménagement intérieur",
  // Études & Conseil
  "Études techniques", "AMO", "OPC", "Économiste", "Diagnostics immobiliers", "Audit énergétique", "Expertise technique",
  // Gestion
  "Gestion de projet", "Pilotage chantier", "Planification", "Suivi de travaux", "Management de transition"
];

export const PLANS_TYPES = { free: 'partenaire', solo: 'solo', team: 'equipe', org: 'organisation' };

export const STRIPE_PRICES: Record<string, string> = {
  solo: 'price_1T2999LxJkH1ubMfNCul93Um',
  equipe: 'price_1T2999LxJkH1ubMfVCD0OB7F',
};

export const PLANS = [
  {
    id: 'partenaire',
    name: 'Réseau',
    price: 0,
    popular: false,
    cta: 'Votre plan actuel',
    features: [
      '1 AO offert (premier dossier)',
      'Réponse en tant que partenaire invité',
      '1 utilisateur',
    ],
  },
  {
    id: 'solo',
    name: 'Solo',
    price: 79,
    popular: false,
    cta: 'Choisir Solo',
    features: [
      '3 AO actifs simultanément',
      'Pilotage de groupement',
      '1 utilisateur interne',
      'Outils IA inclus',
    ],
  },
  {
    id: 'equipe',
    name: 'Équipe',
    price: 159,
    popular: true,
    cta: 'Choisir Équipe',
    features: [
      '10 AO actifs simultanément',
      'Pilotage de groupement',
      "Jusqu'à 5 utilisateurs internes",
      'Outils IA inclus',
      'Tableau de bord avancé',
    ],
  },
  {
    id: 'organisation',
    name: 'Organisation',
    price: 0,
    popular: false,
    cta: 'Contactez-nous',
    features: [
      'AO illimités',
      'Utilisateurs illimités',
      'Support dédié',
      'Fonctionnalités sur mesure',
    ],
  },
];

export type PlanType = 'partenaire' | 'solo' | 'equipe' | 'organisation';

export const PLANS_CONFIG: Record<PlanType, {
  level: number;
  price: number;
  label: string;
  limits: {
    activeTenders: number;
    storage: number;
    users: number;
    durationDays?: number;
    aiAccess: boolean;
  };
}> = {
  partenaire: {
    level: 0,
    price: 0,
    label: 'Réseau',
    limits: {
      activeTenders: 1, // 1 AO offert, controlled via ao_offert_utilise on entreprises
      storage: 0.5 * 1024 * 1024 * 1024,
      users: 1,
      aiAccess: false,
    },
  },
  solo: {
    level: 1,
    price: 79,
    label: 'Solo',
    limits: {
      activeTenders: 3,
      storage: 20 * 1024 * 1024 * 1024,
      users: 1,
      aiAccess: true,
    },
  },
  equipe: {
    level: 2,
    price: 159,
    label: 'Équipe',
    limits: {
      activeTenders: 10,
      storage: 50 * 1024 * 1024 * 1024,
      users: 5,
      aiAccess: true,
    },
  },
  organisation: {
    level: 3,
    price: 0,
    label: 'Organisation',
    limits: {
      activeTenders: 9999,
      storage: 120 * 1024 * 1024 * 1024,
      users: 9999,
      aiAccess: true,
    },
  },
};

export interface UserProfile {
  id: string;
  email: string;
  prenom: string;
  nom: string;
  telephone: string;
  photo_url: string;
  date_naissance: string | null;
  poste: string | null;
  plan: string;
  email_facturation: string | null;
  tva: string | null;
  notifications: boolean;
  notifications_enabled: boolean;
  accepte_communications: boolean;
  notification_preferences: {
    nouveau_document: { app: boolean; email: boolean };
    rappels: { app: boolean; email: boolean };
    messages_feed: { app: boolean; email: boolean };
    communications: { app: boolean; email: boolean };
  };
  onboarding_completed: boolean;
  document_statuses?: Record<string, string>;
  entreprise_id?: string;
  entreprise?: string;
};

export interface CollaboratorData {
  id?: string;
  email: string;
  photo_url?: string;
  nom?: string;
  prenom?: string;
  hasAccount: boolean;
  role?: string;
  company?: string;
  entreprise_id?: string;
  entreprise_nom?: string;
  joinedDate?: string;
  skills?: string[];
  phone?: string;
  tenders?: Array<{ id: string; titre: string; statut?: string; created_at?: string }>;
  status?: 'online' | 'busy' | 'offline';
  location?: string;
  hasWonTogether?: boolean;
  winCount?: number;
  initials?: string;
  displayName?: string;
}

export interface Tender {
  id: string;
  createur_id: string;
  titre: string;
  statut: string;
  montant_estime: number;
  devise: string;
  etape: string;
  created_at: string;
  date_limite: string;
  success_score?: number;
  type_groupement?: 'solidaire' | 'conjoint';
  jalons?: any[];
  dce_documents?: any[];
};

export interface GroupementData {
  id?: string;
  projet_id: string;
  entreprise_id: string;
  role_groupement: 'Mandataire' | 'Co-traitant' | 'Sous-traitant';
  statut: GroupementStatus;
  date_invitation?: string;
  date_reponse?: string;
  invite_par?: string;
  // Joined data (optional, from queries)
  entreprise_nom?: string;
  email?: string;
  phone?: string;
};

export type GroupementStatus = 'invite' | 'accepte' | 'refuse' | 'retire';

export const GROUPEMENT_STATUSES: Record<GroupementStatus, GroupementStatus> = {
  'invite': 'invite',
  'accepte': 'accepte',
  'refuse': 'refuse',
  'retire': 'retire'
};

export const GROUPEMENT_STATUSES_LABELS: Record<GroupementStatus, string> = {
  'invite': 'En attente',
  'accepte': 'Accepté',
  'refuse': 'Refusé',
  'retire': 'Retiré'
};

export const ROLE_ENTREPRISE = ['admin', 'membre'] as const;

export const TYPE_GROUPEMENT = ['solidaire', 'conjoint'] as const;

export const TYPE_GROUPEMENT_LABELS: Record<string, string> = {
  'solidaire': 'Groupement solidaire',
  'conjoint': 'Groupement conjoint'
};

export const DOCUMENT_TYPES = [
  'kbis', 'attestation_assurance', 'attestation_honneur',
  'presentation_societe', 'rib', 'attestation_sociale',
  'attestation_fiscale', 'cv', 'references', 'autre'
] as const;

// Helper to check if a user can access project files (via groupement)
export const canAccessProjectFiles = (groupement: GroupementData) => {
  return groupement.statut === 'accepte';
};

export interface FinancialProps {
  onNavigate?: (tab: string) => void;
  cachedTenders?: Tender[];
  onTendersLoad?: (tenders: Tender[]) => void;
  userProfile: UserProfile;
};

export interface MonthlyData {
  name: string;
  value: number;
};

export interface LayoutProps {
  children: React.ReactNode;
  currentTab: NavItem;
  onTabChange: (tab: NavItem) => void;
  onLogout: () => void;
  userProfile: UserProfile | null;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
};

export interface SidebarProps {
  currentTab: NavItem;
  onTabChange: (tab: NavItem) => void;
  isOpen: boolean;
  toggleSidebar: () => void;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  onLogout: () => void;
};

export interface TenderFormData {
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
  lien_depot: string;
  // ⚠️ Doublon de TenderFormData dans types.ts — les deux wizards manipulent le
  // même objet via deux définitions distinctes. Garder les deux synchronisées
  // tant que la fusion n'est pas faite.
  cpv_codes: string[];
  criteres_attribution?: CriteresAttribution | null;
  reference_marche?: string;
  type_groupement?: 'solidaire' | 'conjoint';
  required_skills: string[];
  required_specialty_ids: string[];
  documents: File[]; // Used for temporary UI state in wizard
  jalons: any[];
  dce_documents: any[];
}

export interface Notifications {
  id: string;
  type: 'collaboration_accepted' | 'collaboration_rejected' | 'collaboration_left' | 'document_added' | 'tender_won' | 'tender_lost' | 'deadline_reminder' | 'comment_added' | 'collaborator_invited' | 'document_reminder' | 'network_invite' | 'network_invite_accepted';
  titre: string;
  message: string;
  sender_id?: string;
  sender_name?: string;
  sender_avatar?: string;
  related_tender_id?: string;
  related_tender_titre?: string;
  date: string;
  read: boolean;
  link?: string;
}

export const FRENCH_REGIONS = [
  'Toute la France',
  'Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Hauts-de-France',
  'Île-de-France',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  'Provence-Alpes-Côte d\'Azur',
  'Guadeloupe',
  'Martinique',
  'Guyane',
  'La Réunion',
  'Mayotte',
  'Saint-Pierre-et-Miquelon',
  'Saint-Barthélemy',
  'Saint-Martin',
  'Wallis-et-Futuna',
  'Polynésie française',
  'Nouvelle-Calédonie'
];