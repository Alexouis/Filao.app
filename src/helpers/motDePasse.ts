import { LONGUEUR_MOT_DE_PASSE } from './validationHelpers';

/**
 * Règles d'un nouveau mot de passe — UNE seule définition pour l'inscription,
 * le changement (Paramètres › Sécurité) et la réinitialisation.
 *
 * POLITIQUE
 * Longueur plutôt que composition : imposer majuscule + chiffre + symbole
 * pousse à des variantes prévisibles (« Motdepasse1! »), quand la longueur
 * augmente réellement le coût d'une attaque (recommandations ANSSI et NIST).
 * S'y ajoutent les critères qui écartent les mots de passe devinables : nom,
 * adresse e-mail, mots de passe courants, suites évidentes.
 *
 * Pour exiger aussi une composition, ajouter la règle à `REGLES` : la légende
 * des trois formulaires et leur validation la reprennent d'elles-mêmes.
 */

export interface ContexteMotDePasse {
    email?: string | null;
    prenom?: string | null;
    nom?: string | null;
}

export interface CritereMotDePasse {
    cle: string;
    libelle: string;
    ok: boolean;
}

/** Bases de mots de passe les plus fréquentes, en minuscules et sans chiffres. */
const COURANTS = [
    'motdepasse', 'password', 'azerty', 'qwerty', 'soleil', 'bonjour', 'doudou', 'loulou',
    'chouchou', 'marseille', 'filao', 'admin', 'welcome', 'bienvenue', 'iloveyou', 'jetaime',
    'football', 'nicolas', 'julien', 'camille', 'princesse', 'motdepass', 'passw0rd',
];

/**
 * Suites de clavier (lignes enchaînées, AZERTY et QWERTY), alphabet et
 * chiffres. Répétées trois fois pour couvrir les suites qui rebouclent
 * (« 1234567890123… »).
 */
const SUITES = ['azertyuiopqsdfghjklmwxcvbn', 'qwertyuiopasdfghjklzxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '0123456789']
    .map(s => s + s + s);

/** Longueur de la plus longue portion de `v` qui suit une des suites. */
const plusLongueSuite = (v: string): number => {
    let max = 0;
    for (let i = 0; i < v.length; i++) {
        for (let j = i + max + 1; j <= v.length; j++) {
            const morceau = v.slice(i, j);
            if (SUITES.some(s => s.includes(morceau))) max = morceau.length;
            else break;
        }
    }
    return max;
};

const normaliser = (v: string) => v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Le mot de passe est-il devinable : une base courante à peine décorée
 * (« Azerty2026! »), une suite (« 123456789012 »), ou un caractère répété ?
 */
export const estPrevisible = (motDePasse: string): boolean => {
    const v = normaliser(motDePasse);
    if (!v) return false;
    if (/^(.)\1+$/.test(v)) return true;
    // Substitutions courantes (« P@ssw0rd ») ramenées à la lettre d'origine
    // avant de comparer aux mots de passe courants.
    const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '3': 'e', '$': 's', '5': 's', '7': 't' };
    const lettres = v.replace(/[@401$357]/g, c => LEET[c]).replace(/[^a-z]/g, '');
    if (COURANTS.some(c => lettres === c || (lettres.startsWith(c) && lettres.length - c.length <= 2))) return true;
    // Une suite qui couvre l'essentiel du mot de passe (« azertyuiopqs »,
    // « 123456789012 », « abcdef-2026 ») le rend devinable.
    const compact = v.replace(/[^a-z0-9]/g, '');
    const suite = plusLongueSuite(compact);
    if (suite >= 6 && suite >= compact.length * 0.6) return true;
    return false;
};

/** Le mot de passe reprend-il le nom, le prénom ou l'identifiant de l'adresse ? */
export const contientIdentite = (motDePasse: string, c: ContexteMotDePasse): boolean => {
    const v = normaliser(motDePasse);
    const identifiant = normaliser(String(c.email ?? '').split('@')[0]).replace(/[^a-z0-9]/g, '');
    const morceaux = [identifiant, normaliser(c.prenom ?? ''), normaliser(c.nom ?? '')]
        .map(m => m.replace(/[^a-z0-9]/g, ''))
        .filter(m => m.length >= 4);
    return morceaux.some(m => v.replace(/[^a-z0-9]/g, '').includes(m));
};

/** Critères affichés dans la légende, dans l'ordre. */
export const evaluerMotDePasse = (
    motDePasse: string,
    confirmation: string,
    contexte: ContexteMotDePasse = {},
): CritereMotDePasse[] => [
    { cle: 'longueur', libelle: `Au moins ${LONGUEUR_MOT_DE_PASSE} caractères`, ok: motDePasse.length >= LONGUEUR_MOT_DE_PASSE },
    { cle: 'identite', libelle: 'Ne contient ni votre nom ni votre adresse e-mail', ok: motDePasse.length > 0 && !contientIdentite(motDePasse, contexte) },
    { cle: 'previsible', libelle: 'N’est pas un mot de passe courant ni une suite évidente', ok: motDePasse.length > 0 && !estPrevisible(motDePasse) },
    { cle: 'confirmation', libelle: 'Les deux saisies correspondent', ok: motDePasse.length > 0 && motDePasse === confirmation },
];

/** Premier critère non respecté (message d'erreur à la validation), ou null. */
export const premierCritereManquant = (criteres: CritereMotDePasse[]): CritereMotDePasse | null =>
    criteres.find(c => !c.ok) ?? null;

export interface Robustesse { niveau: 0 | 1 | 2 | 3 | 4; libelle: string; couleur: string }

/**
 * Jauge indicative : longueur et variété réelle. Un mot de passe devinable
 * est plafonné, quelle que soit sa longueur.
 */
export const robustesseMotDePasse = (motDePasse: string, contexte: ContexteMotDePasse = {}): Robustesse => {
    const n = motDePasse.length;
    const varietes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(motDePasse)).length;
    if (n === 0) return { niveau: 0, libelle: '', couleur: 'bg-gray-200' };
    if (n < LONGUEUR_MOT_DE_PASSE) return { niveau: 1, libelle: `Trop court — ${LONGUEUR_MOT_DE_PASSE - n} caractère(s) manquant(s)`, couleur: 'bg-red-400' };
    if (estPrevisible(motDePasse) || contientIdentite(motDePasse, contexte)) return { niveau: 1, libelle: 'Facile à deviner', couleur: 'bg-red-400' };
    if (n < 16 && varietes < 3) return { niveau: 2, libelle: 'Acceptable — allongez-le pour plus de sûreté', couleur: 'bg-amber-400' };
    if (n < 20) return { niveau: 3, libelle: 'Bon mot de passe', couleur: 'bg-emerald-400' };
    return { niveau: 4, libelle: 'Excellent', couleur: 'bg-emerald-500' };
};
