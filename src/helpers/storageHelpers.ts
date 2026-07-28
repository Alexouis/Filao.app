import { supabase } from '../lib/supabaseClient';

/**
 * Génération des URL d'accès aux documents.
 *
 * Le bucket `documents` est privé : ses objets ne sont accessibles que par une
 * URL signée, valable une heure. Contrairement à une URL publique, elle ne peut
 * pas être stockée en base — c'est pourquoi les colonnes concernées contiennent
 * un chemin, et non une URL.
 *
 * Les logos et photos de profil ne passent pas par ici : ils vivent dans
 * `public-assets`, dont l'URL publique est persistable telle quelle.
 */

/** Durée de validité d'une URL signée, en secondes. */
export const DUREE_SIGNATURE = 3600; // 1 h

/**
 * Cache des URL déjà signées.
 *
 * Une liste de dix documents déclencherait sinon dix appels réseau à chaque
 * rendu, et autant à chaque re-rendu de React. On conserve l'URL jusqu'à peu
 * avant son expiration.
 */
const cache = new Map<string, { url: string; expireA: number }>();

/** Marge avant expiration réelle, pour ne pas servir une URL sur le point d'expirer. */
const MARGE_MS = 60_000;

/**
 * @param chemin chemin de stockage, tel que conservé en base.
 * @returns une URL signée, ou null si le chemin est vide ou inaccessible.
 *
 * Un chemin vide n'est pas une erreur : il signifie « document non fourni ».
 */
export const urlSignee = async (chemin: string | null | undefined): Promise<string | null> => {
    if (!chemin) return null;

    // Tolérance aux données non converties : une valeur encore sous forme d'URL
    // publique est utilisable telle quelle tant que la 039b n'est pas jouée.
    if (chemin.startsWith('http://') || chemin.startsWith('https://')) return chemin;

    const enCache = cache.get(chemin);
    if (enCache && enCache.expireA > Date.now() + MARGE_MS) return enCache.url;

    const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(chemin, DUREE_SIGNATURE);

    if (error || !data?.signedUrl) {
        console.warn('URL signée indisponible', { chemin, error });
        return null;
    }

    cache.set(chemin, { url: data.signedUrl, expireA: Date.now() + DUREE_SIGNATURE * 1000 });
    return data.signedUrl;
};

/**
 * Signe plusieurs chemins en un seul appel réseau.
 *
 * @returns une correspondance chemin → URL. Les chemins non signables en sont
 *          absents, ce qui permet à l'appelant de distinguer un document
 *          inaccessible d'un document non fourni.
 */
export const urlsSignees = async (chemins: (string | null | undefined)[]): Promise<Map<string, string>> => {
    const resultat = new Map<string, string>();
    const aSigner: string[] = [];

    for (const chemin of chemins) {
        if (!chemin) continue;
        if (chemin.startsWith('http')) { resultat.set(chemin, chemin); continue; }
        const enCache = cache.get(chemin);
        if (enCache && enCache.expireA > Date.now() + MARGE_MS) resultat.set(chemin, enCache.url);
        else aSigner.push(chemin);
    }

    if (aSigner.length === 0) return resultat;

    const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrls(aSigner, DUREE_SIGNATURE);

    if (error) {
        console.warn('Signature groupée impossible', error);
        return resultat;
    }

    for (const entree of data ?? []) {
        if (!entree.signedUrl || !entree.path) continue;
        cache.set(entree.path, { url: entree.signedUrl, expireA: Date.now() + DUREE_SIGNATURE * 1000 });
        resultat.set(entree.path, entree.signedUrl);
    }
    return resultat;
};

/**
 * Ouvre un document dans un nouvel onglet.
 *
 * L'URL étant obtenue de façon asynchrone, un `window.open()` différé serait
 * bloqué comme fenêtre surgissante par le navigateur : l'onglet doit être
 * ouvert immédiatement, dans le geste de l'utilisateur, puis redirigé.
 */
export const ouvrirDocument = async (chemin: string | null | undefined): Promise<boolean> => {
    if (!chemin) return false;
    const onglet = window.open('', '_blank');
    const url = await urlSignee(chemin);
    if (!url) {
        onglet?.close();
        return false;
    }
    if (onglet) onglet.location.href = url;
    else window.location.href = url;   // repli si l'ouverture a été bloquée
    return true;
};

/** Vide le cache — utile après un dépôt qui remplace un document. */
export const oublierUrl = (chemin?: string) => {
    if (chemin) cache.delete(chemin);
    else cache.clear();
};