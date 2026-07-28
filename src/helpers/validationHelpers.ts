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