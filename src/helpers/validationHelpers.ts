/**
 * Validation et nettoyage des saisies utilisateur.
 *
 * Ces contrôles servent au confort : ils évitent un aller-retour réseau et
 * signalent l'erreur immédiatement. Ils ne protègent rien — tout ce qui tourne
 * dans le navigateur est contournable, et la validation qui fait autorité est
 * celle des edge functions.
 */

/**
 * Validation d'adresse e-mail.
 *
 * Volontairement permissive. La grammaire complète de la RFC 5322 autorise des
 * formes que personne n'utilise (guillemets, commentaires, adresses IP
 * littérales) et l'implémenter produirait surtout des faux négatifs. On écarte
 * ce qui est manifestement erroné — absence d'arobase, de domaine, d'extension,
 * espaces — et l'existence réelle de la boîte n'est de toute façon prouvée que
 * par l'envoi.
 */
const MOTIF_EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const emailValide = (valeur: string | null | undefined): boolean => {
    const adresse = (valeur ?? '').trim();
    // 254 caractères : limite imposée par la RFC 5321 à une adresse complète.
    return adresse.length > 0 && adresse.length <= 254 && MOTIF_EMAIL.test(adresse);
};

/** Adresse normalisée pour comparaison et stockage. */
export const normaliserEmail = (valeur: string | null | undefined): string =>
    (valeur ?? '').trim().toLowerCase();

/**
 * Nettoie un nom ou un intitulé saisi librement.
 *
 * Retire les caractères de contrôle et les balises, et borne la longueur. Ce
 * n'est pas une protection contre l'injection — l'échappement se fait au point
 * d'affichage, et pour l'e-mail d'invitation, côté serveur. C'est une mesure
 * d'hygiène : rien ne justifie qu'un nom de partenaire contienne `<script>`,
 * et le refuser à la saisie évite d'avoir à s'en soucier ensuite.
 */
export const nettoyerTexteLibre = (valeur: string | null | undefined, longueurMax = 120): string =>
    (valeur ?? '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/<[^>]*>/g, '')
        .trim()
        .slice(0, longueurMax);

/** @returns vrai si la valeur contient une balise ou un caractère de contrôle. */
export const contientBalise = (valeur: string | null | undefined): boolean =>
    /<[^>]*>|[\u0000-\u001F\u007F]/.test(valeur ?? '');

/**
 * Validation de la clé de contrôle d'un SIREN / SIRET (algorithme de Luhn).
 *
 * Comme les autres contrôles de ce fichier, c'est un confort de saisie : on
 * évite un appel réseau voué à l'échec et on signale une coquille tout de
 * suite. Le numéro peut être formellement valide (clé juste) sans correspondre
 * à une entreprise réelle — seule l'API Sirene le dit. À l'inverse, une clé
 * fausse garantit une erreur de frappe : c'est ce cas qu'on intercepte.
 *
 * SIREN = 9 chiffres, SIRET = 14 (SIREN + 5 chiffres d'établissement). Les
 * espaces sont tolérés à la saisie et retirés avant contrôle.
 *
 * Exception documentée : le SIRET du siège de La Poste (356000000) ne respecte
 * pas Luhn. On l'accepte explicitement pour ne pas rejeter un numéro pourtant
 * officiel.
 */
const passeLuhn = (chiffres: string): boolean => {
    let somme = 0;
    let doubler = false;
    for (let i = chiffres.length - 1; i >= 0; i--) {
        let n = chiffres.charCodeAt(i) - 48; // '0' = 48
        if (doubler) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        somme += n;
        doubler = !doubler;
    }
    return somme % 10 === 0;
};

const nettoyerNumeroInsee = (valeur: string | null | undefined): string =>
    (valeur ?? '').replace(/\s/g, '');

/** @returns vrai si `valeur` est un SIREN à 9 chiffres avec clé de Luhn correcte. */
export const sirenValide = (valeur: string | null | undefined): boolean => {
    const n = nettoyerNumeroInsee(valeur);
    if (!/^\d{9}$/.test(n)) return false;
    return passeLuhn(n);
};

/** @returns vrai si `valeur` est un SIRET à 14 chiffres avec clé de Luhn correcte. */
export const siretValide = (valeur: string | null | undefined): boolean => {
    const n = nettoyerNumeroInsee(valeur);
    if (!/^\d{14}$/.test(n)) return false;
    // La Poste : SIRET du siège non conforme à Luhn mais officiel.
    if (n.startsWith('356000000')) return true;
    return passeLuhn(n);
};

/**
 * Contrôle de saisie d'un identifiant d'acheteur.
 *
 * L'utilisateur peut chercher par SIRET, SIREN **ou nom** : on ne valide la clé
 * que lorsque la saisie ressemble à un numéro (que des chiffres). Un nom
 * d'entreprise passe donc toujours, et un numéro n'est signalé que si sa clé
 * est fausse — jamais bloquant, juste informatif.
 *
 * @returns un message d'erreur, ou null si la saisie est acceptable.
 */
export const messageErreurIdentifiantAcheteur = (valeur: string | null | undefined): string | null => {
    const brut = (valeur ?? '').trim();
    if (brut.length === 0) return null;
    const n = nettoyerNumeroInsee(brut);
    // Contient autre chose que des chiffres → recherche par nom, pas de contrôle.
    if (!/^\d+$/.test(n)) return null;
    if (n.length === 9) {
        return sirenValide(n) ? null : 'La clé de contrôle de ce SIREN semble incorrecte.';
    }
    if (n.length === 14) {
        return siretValide(n) ? null : 'La clé de contrôle de ce SIRET semble incorrecte.';
    }
    // Nombre de chiffres inattendu (mais purement numérique) : on prévient sans bloquer.
    return 'Un SIREN comporte 9 chiffres et un SIRET 14.';
};

/**
 * Validation d'une date au format ISO court `yyyy-MM-dd` (celui des
 * <input type="date">). Vérifie que la date existe réellement — un simple
 * `new Date()` accepterait le 31 février en le décalant au 3 mars.
 *
 * @returns vrai si la date est bien formée et réelle. Une chaîne vide est
 * considérée valide (champ optionnel non renseigné) : le caractère obligatoire
 * se contrôle ailleurs.
 */
export const dateValide = (valeur: string | null | undefined): boolean => {
    const v = (valeur ?? '').trim();
    if (v.length === 0) return true;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    const annee = Number(m[1]);
    const mois = Number(m[2]);
    const jour = Number(m[3]);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return false;
    const d = new Date(Date.UTC(annee, mois - 1, jour));
    // Rejette les dates décalées (31/02 → 03/03) : les composantes doivent tenir.
    return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour;
};
