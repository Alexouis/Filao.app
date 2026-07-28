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

/**
 * Extension à partir du type MIME. Les noms canoniques du coffre-fort sont
 * stockés sans extension — `kbis` — pour qu'un remplacement écrase bien
 * l'ancien fichier quel que soit son format. À l'ouverture ce n'est pas gênant,
 * le navigateur se fie au `content-type` ; au téléchargement, le système
 * d'exploitation n'a en revanche plus rien pour associer une application.
 */
const EXTENSIONS: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/zip': 'zip',
};

/** Type MIME enregistré avec l'objet, ou null s'il est introuvable. */
const typeStocke = async (chemin: string): Promise<string | null> => {
    const morceaux = chemin.split('/');
    const nom = morceaux.pop() ?? '';
    const { data } = await supabase.storage
        .from('documents')
        .list(morceaux.join('/'), { search: nom });
    return data?.find(o => o.name === nom)?.metadata?.mimetype ?? null;
};

/**
 * Télécharge un document sous un nom lisible, extension comprise.
 *
 * @param chemin chemin de stockage.
 * @param nomSouhaite nom présenté à l'utilisateur, sans extension
 *        (ex. « Kbis »). L'extension est déduite du type réel de l'objet.
 */
export const telechargerDocument = async (
    chemin: string | null | undefined,
    nomSouhaite: string
): Promise<boolean> => {
    if (!chemin) return false;

    const mime = await typeStocke(chemin);
    const extension = mime ? EXTENSIONS[mime] : undefined;

    // `nomSouhaite` porte parfois déjà son extension (nom d'origine d'une pièce
    // du DCE), parfois non (nom canonique du coffre-fort). Sans cette
    // normalisation on obtiendrait « RC.pdf.pdf ».
    const base = nomSouhaite.replace(/\.[A-Za-z0-9]{1,8}$/, '').trim() || 'document';
    const nomFichier = extension ? `${base}.${extension}` : nomSouhaite;

    const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(chemin, DUREE_SIGNATURE, { download: nomFichier });

    if (error || !data?.signedUrl) {
        console.warn('Téléchargement impossible', { chemin, error });
        return false;
    }

    // Un lien temporaire plutôt qu'une navigation : `download` n'agit que sur
    // un élément <a>, une redirection afficherait le fichier au lieu de
    // l'enregistrer.
    const lien = document.createElement('a');
    lien.href = data.signedUrl;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    return true;
};

/** Vide le cache — utile après un dépôt qui remplace un document. */
export const oublierUrl = (chemin?: string) => {
    if (chemin) cache.delete(chemin);
    else cache.clear();
};