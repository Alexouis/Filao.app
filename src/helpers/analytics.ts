/**
 * Module d'instrumentation analytics — point d'entrée UNIQUE.
 *
 * Règle d'or : aucun autre fichier n'appelle directement la bibliothèque
 * analytics. Tout passe par `track(evenement, proprietes)`, qui applique les
 * garde-fous RGPD avant émission. Cela garantit qu'aucune donnée personnelle ni
 * token ne fuit, où que l'événement soit déclenché.
 *
 * Trois règles RGPD non négociables, appliquées ici et nulle part ailleurs :
 *   1. Aucune donnée personnelle dans les événements (nom, email, SIRET,
 *      intitulé d'AO, nom d'acheteur…). Garanti par une LISTE BLANCHE stricte :
 *      toute propriété non listée est supprimée avant envoi.
 *   2. Identifiant utilisateur PSEUDONYMISÉ : hachage de `user_id` avec un sel,
 *      jamais l'email ni l'UUID Supabase brut.
 *   3. Masquage des URLs à token : `/invitation/<token>` → `/invitation/:token`
 *      avant tout envoi, sinon l'outil analytics devient un annuaire de tokens.
 *
 * Le transport (PostHog) est isolé dans `envoyer()` : brancher la librairie ne
 * touchera que cette fonction. Tant qu'elle n'est pas branchée, `track()` reste
 * sûr et sans effet visible (log en dev uniquement).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Plan de marquage : liste blanche des événements et de leurs propriétés.
//
// Nommage `objet_action`, en français, au passé. Toute propriété absente de
// cette table est retirée de l'événement — c'est la barrière anti-fuite.
// ─────────────────────────────────────────────────────────────────────────────

export const EVENEMENTS = {
  // Entonnoir 1 — activation
  inscription_terminee: [],
  onboarding_termine: [],
  ao_creation_demarree: [],
  ao_cree: ['origine', 'mode', 'forme', 'nb_competences'],
  ao_wizard_etape: ['etape', 'duree_etape_s'],

  // Entonnoir 2 — promesse produit (le plus important)
  invitation_envoyee: ['role_propose', 'rang_invitation'],
  invitation_ouverte: [],
  invitation_acceptee: [],
  piece_deposee: ['origine', 'par'],

  // Entonnoir 3 — finalisation
  checklist_100: [],
  dossier_finalise: ['pieces_manquantes', 'competences_non_couvertes'],
  resultat_saisi: ['resultat', 'montant_tranche'],

  // Transverses
  paywall_affiche: [],
  offre_souscrite: [],
  recherche_boamp: [],
  erreur_applicative: ['type', 'contexte'],
  web_vital: ['metrique', 'valeur', 'ecran'],
} as const;

export type NomEvenement = keyof typeof EVENEMENTS;

// ─────────────────────────────────────────────────────────────────────────────
// Configuration / environnement
// ─────────────────────────────────────────────────────────────────────────────

const env = (import.meta as any).env || {};

// Désactivation automatique en développement.
const EST_DEV: boolean = env.DEV === true || env.MODE === 'development';

// Sel de pseudonymisation, injecté au build (jamais dérivable de l'UUID).
// À défaut, la pseudonymisation reste active mais avec un sel vide — on préfère
// pseudonymiser faiblement que d'émettre l'UUID brut.
const SEL: string = env.VITE_ANALYTICS_SALT || '';

// Domaines des comptes internes, exclus de la mesure.
const DOMAINES_INTERNES = ['@filao.io', '@filao.app'];

let idPseudonyme: string | null = null;
let estInterne = false;
let initialise = false;

// ─────────────────────────────────────────────────────────────────────────────
// Pseudonymisation
// ─────────────────────────────────────────────────────────────────────────────

// Hachage SHA-256 (Web Crypto) de `sel + user_id`, tronqué. Asynchrone : on le
// calcule une fois à l'init et on mémorise le résultat.
const hacher = async (valeur: string): Promise<string> => {
  try {
    const data = new TextEncoder().encode(SEL + valeur);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
  } catch {
    return 'anon';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Masquage des URLs à token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remplace les segments sensibles d'un chemin par des placeholders avant envoi.
 * `/invitation/abc123` → `/invitation/:token`. Étendu aux autres chemins
 * porteurs d'identifiants pour ne jamais exposer d'UUID en clair.
 */
export const masquerChemin = (chemin: string): string =>
  chemin
    .replace(/\/invitation\/[^/?#]+/gi, '/invitation/:token')
    .replace(/\/reset-password\/[^/?#]+/gi, '/reset-password/:token')
    // UUID génériques dans un segment de chemin.
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id');

// ─────────────────────────────────────────────────────────────────────────────
// Liste blanche
// ─────────────────────────────────────────────────────────────────────────────

// Ne conserve que les propriétés déclarées pour l'événement. Toute autre clé
// (y compris introduite par erreur) est supprimée — barrière anti-fuite.
const filtrerProprietes = (
  evenement: NomEvenement,
  proprietes: Record<string, unknown>
): Record<string, unknown> => {
  const autorisees = EVENEMENTS[evenement] as readonly string[];
  const propre: Record<string, unknown> = {};
  for (const cle of autorisees) {
    if (proprietes[cle] !== undefined) propre[cle] = proprietes[cle];
  }
  return propre;
};

// ─────────────────────────────────────────────────────────────────────────────
// Transport (PostHog) — SEUL endroit à brancher la librairie
// ─────────────────────────────────────────────────────────────────────────────

// Émet réellement l'événement. Tant que PostHog n'est pas câblé, on ne fait rien
// en production et on log en dev pour vérifier le plan de marquage.
const envoyer = (evenement: NomEvenement, proprietes: Record<string, unknown>) => {
  if (EST_DEV) {
    // eslint-disable-next-line no-console
    console.debug('[analytics]', evenement, proprietes);
    return;
  }
  // Point d'injection PostHog (à activer une fois le compte UE configuré) :
  //   const ph = (window as any).posthog;
  //   if (ph && idPseudonyme) ph.capture(evenement, { ...proprietes, $set: { id: idPseudonyme } });
};

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise l'identité pseudonymisée. À appeler une fois l'utilisateur connu
 * (id + email pour la détection interne). Idempotent.
 */
export const identifierUtilisateur = async (userId: string, email?: string): Promise<void> => {
  estInterne = !!email && DOMAINES_INTERNES.some(d => email.toLowerCase().endsWith(d));
  idPseudonyme = await hacher(userId);
  initialise = true;
};

/** Réinitialise l'identité (déconnexion). */
export const reinitialiserAnalytics = (): void => {
  idPseudonyme = null;
  estInterne = false;
  initialise = false;
};

/**
 * Émet un événement analytics.
 *
 * @param evenement  nom issu du plan de marquage (liste blanche)
 * @param proprietes propriétés — filtrées par la liste blanche de l'événement
 *
 * N'émet jamais si : compte interne, environnement dev (log seulement), ou
 * événement inconnu. Les propriétés non déclarées sont silencieusement retirées.
 */
export const track = (
  evenement: NomEvenement,
  proprietes: Record<string, unknown> = {}
): void => {
  // Événement hors plan de marquage : on refuse plutôt que d'émettre un
  // événement générique non prévu.
  if (!(evenement in EVENEMENTS)) return;

  // Comptes internes exclus de la mesure (mais pas en dev, où l'on veut voir
  // les logs pour vérifier le marquage).
  if (estInterne && !EST_DEV) return;

  const propres = filtrerProprietes(evenement, proprietes);

  // Masquage défensif : si une propriété ressemble à un chemin, on la masque.
  for (const [cle, val] of Object.entries(propres)) {
    if (typeof val === 'string' && val.includes('/invitation/')) {
      propres[cle] = masquerChemin(val);
    }
  }

  envoyer(evenement, propres);
};