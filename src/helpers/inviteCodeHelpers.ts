/**
 * Génération du code d'accès de l'espace invité.
 *
 * Ce code est le seul secret protégeant le parcours « j'ai perdu mon lien » de
 * CollaboratorSubmission : l'invité saisit son email et ce code pour accéder au
 * dossier. Depuis la migration 034, la table `invitations` n'est plus lisible
 * directement, donc rien d'autre ne protège cet accès.
 *
 * L'implémentation précédente était `Math.random().toString(36).substring(2, 8)`,
 * avec deux défauts :
 *
 *  - `Math.random()` n'est pas cryptographique. Le générateur de V8
 *    (xorshift128+) est déterministe : en observant quelques sorties, son état
 *    interne se reconstitue et les codes suivants se prédisent. Or les codes
 *    sont distribués à des tiers, qui en collectent naturellement plusieurs.
 *  - 6 caractères base36 ≈ 31 bits, énumérables sans limitation de tentatives,
 *    d'autant que `tender_id` circule dans les URL et que l'email se devine.
 */

/**
 * Alphabet sans caractères ambigus : ni O/0, ni I/1/L, ni S/5, ni B/8.
 * Le code est recopié à la main depuis un e-mail, la lisibilité prime sur la
 * taille de l'alphabet.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ2346789';

/** Longueur par défaut : 8 caractères ≈ 38 bits avec cet alphabet. */
const LONGUEUR_DEFAUT = 8;

/**
 * @returns un code d'accès en majuscules, tiré d'une source cryptographique.
 *
 * Le tirage rejette les valeurs qui tomberaient hors d'un multiple entier de la
 * taille de l'alphabet : un simple modulo biaiserait la distribution en faveur
 * des premières lettres.
 */
export const genererCodeAcces = (longueur: number = LONGUEUR_DEFAUT): string => {
    const taille = ALPHABET.length;
    const maxSansBiais = Math.floor(256 / taille) * taille;
    const code: string[] = [];

    while (code.length < longueur) {
        const octets = new Uint8Array(longueur);
        crypto.getRandomValues(octets);
        for (const octet of octets) {
            if (octet >= maxSansBiais) continue; // rejet, pour rester uniforme
            code.push(ALPHABET[octet % taille]);
            if (code.length === longueur) break;
        }
    }

    return code.join('');
};

/**
 * Jeton d'invitation transmis par lien. Plus long que le code d'accès : il
 * n'est jamais saisi à la main, rien n'oblige à le garder court.
 *
 * ⚠️ Les fonctions `get_invitation_by_token` et `respond_to_invitation`
 * exigent au moins 16 caractères.
 */
export const genererTokenInvitation = (): string => {
    const octets = new Uint8Array(24);
    crypto.getRandomValues(octets);
    return Array.from(octets, o => o.toString(16).padStart(2, '0')).join('');
};