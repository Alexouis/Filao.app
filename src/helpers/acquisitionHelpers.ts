/**
 * Capture des paramètres d'acquisition (UTM + source) jusqu'à la création de
 * compte.
 *
 * Problème résolu
 * Les UTM ne sont présents que sur l'URL du PREMIER contact (souvent la landing
 * filao.io, ou un lien de campagne pointant vers l'app). Dès que le visiteur
 * navigue, ou passe par la redirection OAuth Google, ces paramètres
 * disparaissent de l'URL. Les lire seulement au moment du `signUp` reviendrait
 * à ne presque jamais les capturer.
 *
 * Principe
 * On capture une seule fois, au premier chargement de l'app, et on persiste en
 * `sessionStorage` — qui survit à la navigation interne comme à l'aller-retour
 * OAuth. On n'écrase jamais une capture existante : le premier contact prime
 * (modèle « first-touch »), cohérent avec l'idée de tracer l'origine réelle du
 * visiteur.
 */

const STORAGE_KEY = 'filao_acquisition';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

export interface AcquisitionData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  /** Page de premier contact, utile pour distinguer un lien profond d'une entrée racine. */
  landing_path?: string;
  /** Referrer externe au premier contact (jamais un domaine interne). */
  referrer?: string;
  /** Horodatage du premier contact. */
  captured_at?: string;
}

/**
 * Capture les UTM présents dans l'URL courante et les fige en session.
 * Idempotent : ne fait rien si une capture existe déjà (first-touch).
 * À appeler une fois au démarrage de l'application.
 */
export const captureAcquisitionParams = (): void => {
  try {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(STORAGE_KEY)) return; // first-touch : ne pas écraser

    const params = new URLSearchParams(window.location.search);
    const data: AcquisitionData = {};

    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) data[key] = value.slice(0, 200); // borne défensive
    }

    // On ne persiste que s'il y a quelque chose d'exploitable : au moins un UTM
    // ou un referrer externe. Sinon on laisse la clé vide pour ne pas figer un
    // « direct » prématuré (l'utilisateur pourrait recharger depuis un lien UTM).
    const externalReferrer =
      document.referrer && !document.referrer.includes(window.location.host)
        ? document.referrer
        : '';

    const hasSignal = UTM_KEYS.some(k => data[k]) || externalReferrer;
    if (!hasSignal) return;

    data.landing_path = window.location.pathname;
    data.referrer = externalReferrer || undefined;
    data.captured_at = new Date().toISOString();

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage indisponible (mode privé strict, quota) : la capture est
    // best-effort, on n'interrompt jamais le chargement de l'app pour ça.
  }
};

/** Relit les paramètres d'acquisition capturés, ou un objet vide. */
export const getAcquisitionParams = (): AcquisitionData => {
  try {
    if (typeof window === 'undefined') return {};
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AcquisitionData) : {};
  } catch {
    return {};
  }
};

/**
 * Dérive la source d'inscription selon le référentiel EN BASE.
 *
 * ⚠️ La colonne `utilisateurs.source_inscription` porte une contrainte CHECK
 * (migration 045) qui n'autorise que : invitation | annuaire | landing |
 * referral | direct. Toute autre valeur ferait échouer l'inscription. On s'y
 * tient strictement — les UTM détaillés vivent dans leurs propres colonnes.
 *
 * @param invitationTenderId identifiant de dossier déposé par InvitationLanding
 */
export const resolveSourceInscription = (
  invitationTenderId?: string | null
): 'invitation' | 'landing' | 'referral' | 'direct' => {
  if (invitationTenderId) return 'invitation';
  const acq = getAcquisitionParams();
  // Présence d'UTM : le visiteur vient d'une campagne pointant vers une landing.
  if (acq.utm_source || acq.utm_campaign || acq.utm_medium) return 'landing';
  // Referrer externe sans UTM : arrivée depuis un site tiers.
  if (acq.referrer) return 'referral';
  return 'direct';
};
