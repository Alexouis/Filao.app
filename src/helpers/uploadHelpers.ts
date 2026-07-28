import { supabase } from '../lib/supabaseClient';
import { verifierFichier, OCTETS_A_LIRE, REGLES, type PointDepot } from './fileValidation';

/**
 * Point de passage unique des dépôts de fichiers (bug B4).
 *
 * Le front écrivait auparavant dans le bucket via `supabase.storage.upload()`,
 * depuis onze endroits différents et sans aucun contrôle. La validation est
 * désormais faite par l'edge function `upload-document`, qui lit les premiers
 * octets du fichier et refuse ce qui ne correspond pas au point de dépôt.
 *
 * ⚠️ Le pré-contrôle exécuté ici ne protège rien : il évite un aller-retour
 *    réseau et affiche l'erreur immédiatement. Tout ce qui tourne dans le
 *    navigateur est contournable — c'est la raison d'être de ce ticket.
 */

export interface OptionsDepot {
    /** Dossier de destination, sans le nom du fichier. */
    dossier: string;
    /** Point de dépôt : détermine les types acceptés et le plafond de taille. */
    point: PointDepot;
    upsert?: boolean;
    /** Invité par lien : jeton de son invitation. */
    token?: string;
    /** Invité par code d'accès. */
    tenderId?: string;
    email?: string;
    accessCode?: string;
}

export interface ResultatDepot {
    /** Chemin réellement écrit — il peut différer du nom d'origine, celui-ci
     *  étant nettoyé côté serveur. */
    chemin?: string;
    /** Bucket de destination : `public-assets` pour les logos et photos,
     *  `documents` pour le reste. */
    bucket?: string;
    /** Message présentable à l'utilisateur, absent en cas de succès. */
    erreur?: string;
}

/** Pré-contrôle local, pour éviter un envoi voué à l'échec. */
const preControle = async (fichier: File, point: PointDepot): Promise<string | null> => {
    try {
        const debut = new Uint8Array(await fichier.slice(0, OCTETS_A_LIRE).arrayBuffer());
        const verdict = verifierFichier(debut, fichier.size, point);
        return verdict.accepte ? null : verdict.motif ?? 'Fichier refusé.';
    } catch {
        // En cas d'échec de lecture locale, on laisse le serveur trancher :
        // c'est lui qui fait autorité.
        return null;
    }
};

export const deposerFichier = async (
    fichier: File,
    options: OptionsDepot
): Promise<ResultatDepot> => {
    const refusLocal = await preControle(fichier, options.point);
    if (refusLocal) return { erreur: refusLocal };

    const formulaire = new FormData();
    formulaire.append('file', fichier);
    formulaire.append('point', options.point);
    formulaire.append('dossier', options.dossier);
    if (options.upsert) formulaire.append('upsert', 'true');
    if (options.token) formulaire.append('token', options.token);
    if (options.tenderId) formulaire.append('tenderId', options.tenderId);
    if (options.email) formulaire.append('email', options.email);
    if (options.accessCode) formulaire.append('accessCode', options.accessCode);

    const { data, error } = await supabase.functions.invoke('upload-document', {
        body: formulaire,
    });

    if (error) {
        // `FunctionsHttpError` ne dit que « non-2xx » : le motif du refus est
        // dans le corps de la réponse, qu'il faut lire explicitement.
        let motif = "Le dépôt du fichier a échoué.";
        try {
            const reponse = (error as any)?.context;
            if (reponse && typeof reponse.json === 'function') {
                const corps = await reponse.json();
                if (corps?.error) motif = corps.error;
            }
        } catch { /* corps illisible ou déjà consommé */ }
        return { erreur: motif };
    }

    if (data?.error) return { erreur: data.error };
    return { chemin: data?.chemin, bucket: data?.bucket };
};

/** Plafond de taille du point de dépôt, pour l'annoncer avant l'envoi. */
export const plafondLisible = (point: PointDepot): string => {
    const octets = REGLES[point].tailleMaxOctets;
    return `${Math.round(octets / (1024 * 1024))} Mo`;
};

/** Formats acceptés, pour l'annoncer avant l'envoi. */
export const formatsLisibles = (point: PointDepot): string => REGLES[point].libelle;