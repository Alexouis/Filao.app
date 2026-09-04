export function capitalizeFirstLetter(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

/**
 * Prépare une saisie utilisateur pour un attribut `href`.
 *
 * POURQUOI
 * Un lien saisi sans schéma (« www.google.fr », « exemple.fr/avis ») est traité
 * par le navigateur comme un chemin RELATIF : `href="www.google.fr"` sur
 * `http://localhost:3000/` ouvre `http://localhost:3000/www.google.fr` au lieu
 * du site voulu. On préfixe donc `https://` quand aucun schéma n'est présent.
 *
 * - Les schémas déjà là (`http://`, `https://`) sont conservés tels quels.
 * - Les schémas dangereux (`javascript:`, `data:`…) ne sont PAS propagés : dans
 *   le doute, on repasse par `https://`, pour ne pas fabriquer un lien actif à
 *   partir d'une saisie hostile.
 * - Une valeur vide renvoie une chaîne vide (l'appelant n'affiche alors pas de
 *   lien).
 *
 * @returns une URL utilisable dans `href`, ou '' si rien d'exploitable.
 */
export function lienExterne(valeur: string | null | undefined): string {
    const v = (valeur ?? '').trim();
    if (v.length === 0) return '';
    // Schéma explicite http/https : on garde.
    if (/^https?:\/\//i.test(v)) return v;
    // Tout autre schéma (javascript:, data:, mailto:, ftp:…) : on ne le propage
    // pas comme lien de navigation ; on force https sur la partie lisible.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
        return `https://${v.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '')}`;
    }
    // Pas de schéma du tout : on préfixe.
    return `https://${v}`;
}

