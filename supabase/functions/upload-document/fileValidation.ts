/**
 * ⚠️ COPIE de src/helpers/fileValidation.ts.
 *
 * Le front est bâti par Vite depuis `src/`, les edge functions tournent sous
 * Deno depuis `supabase/functions/` : les deux ne peuvent pas partager un même
 * fichier sans outillage supplémentaire. Cette copie est la version qui
 * PROTÈGE ; celle de `src/` ne sert qu'au retour d'erreur immédiat à l'écran.
 * Toute modification des règles doit être reportée dans les deux.
 *
 * Détection du type réel d'un fichier par sa signature binaire.
 *
 * POURQUOI
 * Trois informations prétendent décrire le type d'un fichier, et aucune des
 * deux premières n'est fiable :
 *
 *  1. l'extension du nom — choisie par le déposant, `virus.exe` → `photo.pdf` ;
 *  2. le `Content-Type` déclaré — envoyé par le client, donc falsifiable ;
 *  3. les premiers octets du contenu — imposés par le format lui-même.
 *
 * L'attribut HTML `accept` ne relève même d'aucune des trois : il filtre la
 * boîte de dialogue du navigateur et disparaît au glisser-déposer.
 *
 * Ce module lit les octets. Il est volontairement autonome — aucune dépendance,
 * aucun accès réseau — pour tourner à l'identique côté Deno (edge function) et
 * côté navigateur (pré-contrôle d'ergonomie).
 *
 * ⚠️ Le contrôle qui protège est celui de l'edge function. La copie exécutée
 *    dans le navigateur ne sert qu'à afficher une erreur immédiate : tout ce qui
 *    tourne côté client est contournable.
 */

export type TypeFichier =
    | 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp'
    | 'docx' | 'xlsx' | 'pptx' | 'doc' | 'xls'
    | 'zip' | 'odt' | 'ods'
    | 'exe' | 'elf' | 'macho' | 'script' | 'inconnu';

interface Signature {
    type: TypeFichier;
    octets: number[];
    /** Décalage du début de la signature. Presque toujours 0. */
    decalage?: number;
    /** Octets à ignorer dans la comparaison (valeurs variables). */
    joker?: number[];
}

/**
 * Signatures classées de la plus spécifique à la plus générale : `docx`, `xlsx`
 * et `pptx` sont des archives ZIP, ils ne se distinguent qu'au contenu de
 * l'archive — traité plus bas.
 */
const SIGNATURES: Signature[] = [
    // Documents
    { type: 'pdf', octets: [0x25, 0x50, 0x44, 0x46] },                      // %PDF

    // Images
    { type: 'png', octets: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    { type: 'jpeg', octets: [0xFF, 0xD8, 0xFF] },
    { type: 'gif', octets: [0x47, 0x49, 0x46, 0x38] },                      // GIF8
    // WebP : "RIFF" .... "WEBP" — les 4 octets de taille sont variables.
    { type: 'webp', octets: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], joker: [4, 5, 6, 7] },

    // Conteneurs ZIP (Office moderne, OpenDocument) — affinés ensuite.
    { type: 'zip', octets: [0x50, 0x4B, 0x03, 0x04] },
    { type: 'zip', octets: [0x50, 0x4B, 0x05, 0x06] },                      // archive vide
    { type: 'zip', octets: [0x50, 0x4B, 0x07, 0x08] },                      // segmentée

    // Office binaire hérité (.doc, .xls) : conteneur OLE2 commun.
    { type: 'doc', octets: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1] },

    // Exécutables — c'est précisément ce que l'on veut refuser.
    { type: 'exe', octets: [0x4D, 0x5A] },                                  // MZ, PE Windows
    { type: 'elf', octets: [0x7F, 0x45, 0x4C, 0x46] },                      // ELF Linux
    { type: 'macho', octets: [0xCF, 0xFA, 0xED, 0xFE] },                    // Mach-O 64 bits
    { type: 'macho', octets: [0xCE, 0xFA, 0xED, 0xFE] },                    // Mach-O 32 bits
    { type: 'macho', octets: [0xCA, 0xFE, 0xBA, 0xBE] },                    // universel / Java
    { type: 'script', octets: [0x23, 0x21] },                               // #! shebang
];

const correspond = (octets: Uint8Array, sig: Signature): boolean => {
    const debut = sig.decalage ?? 0;
    if (octets.length < debut + sig.octets.length) return false;
    for (let i = 0; i < sig.octets.length; i++) {
        if (sig.joker?.includes(i)) continue;
        if (octets[debut + i] !== sig.octets[i]) return false;
    }
    return true;
};

/**
 * Affine un conteneur ZIP en cherchant le nom du premier fichier de l'archive,
 * qui trahit le format Office ou OpenDocument.
 *
 * Le nom du premier membre est stocké en clair juste après l'en-tête local, à
 * l'octet 30. Cela évite de décompresser l'archive pour la reconnaître.
 */
const affinerZip = (octets: Uint8Array): TypeFichier => {
    const zone = new TextDecoder('ascii', { fatal: false })
        .decode(octets.slice(0, Math.min(octets.length, 2048)));

    if (zone.includes('word/')) return 'docx';
    if (zone.includes('xl/')) return 'xlsx';
    if (zone.includes('ppt/')) return 'pptx';
    if (zone.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt';
    if (zone.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return 'ods';
    return 'zip';
};

/**
 * @param octets les premiers octets du fichier — 2 048 suffisent.
 * @returns le type déduit du contenu, `inconnu` si aucune signature ne colle.
 */
export const detecterType = (octets: Uint8Array): TypeFichier => {
    if (octets.length === 0) return 'inconnu';

    for (const sig of SIGNATURES) {
        if (!correspond(octets, sig)) continue;
        return sig.type === 'zip' ? affinerZip(octets) : sig.type;
    }
    return 'inconnu';
};

// ---------------------------------------------------------------------------
// Politique par point de dépôt
// ---------------------------------------------------------------------------

/**
 * Chaque point de dépôt a ses propres besoins : un logo n'est jamais un PDF,
 * une pièce de candidature n'est jamais un exécutable. Autoriser partout le
 * même ensemble reviendrait à aligner la sécurité sur le point le plus permissif.
 */
export type PointDepot =
    | 'coffre_fort'        // documents administratifs de l'entreprise
    | 'candidature'        // pièces de candidature d'un AO
    | 'dce'                // pièces du marché fournies par l'acheteur
    | 'depot_partenaire'   // dépôt par un partenaire non inscrit
    | 'logo';              // logo d'entreprise, photo de profil

export interface RegleDepot {
    types: TypeFichier[];
    tailleMaxOctets: number;
    libelle: string;
}

const Mo = 1024 * 1024;

export const REGLES: Record<PointDepot, RegleDepot> = {
    coffre_fort: {
        types: ['pdf', 'png', 'jpeg', 'docx', 'xlsx', 'doc', 'xls'],
        tailleMaxOctets: 25 * Mo,
        libelle: 'PDF, image, Word ou Excel',
    },
    candidature: {
        types: ['pdf', 'png', 'jpeg', 'docx', 'xlsx', 'doc', 'xls'],
        tailleMaxOctets: 25 * Mo,
        libelle: 'PDF, image, Word ou Excel',
    },
    dce: {
        // Le DCE arrive fréquemment sous forme d'archive : c'est le seul point
        // de dépôt où le ZIP est légitime.
        types: ['pdf', 'png', 'jpeg', 'docx', 'xlsx', 'doc', 'xls', 'zip'],
        tailleMaxOctets: 100 * Mo,
        libelle: 'PDF, image, Word, Excel ou archive ZIP',
    },
    depot_partenaire: {
        types: ['pdf', 'png', 'jpeg', 'docx', 'xlsx'],
        tailleMaxOctets: 25 * Mo,
        libelle: 'PDF, image, Word ou Excel',
    },
    logo: {
        types: ['png', 'jpeg', 'webp'],
        tailleMaxOctets: 2 * Mo,
        libelle: 'image PNG, JPEG ou WebP',
    },
};

export interface Verdict {
    accepte: boolean;
    type: TypeFichier;
    /** Message destiné à l'utilisateur : il doit dire quoi faire, pas seulement refuser. */
    motif?: string;
}

const formaterTaille = (octets: number): string =>
    octets >= Mo ? `${Math.round(octets / Mo)} Mo` : `${Math.max(1, Math.round(octets / 1024))} Ko`;

/**
 * Applique la règle du point de dépôt à un fichier.
 *
 * @param octets  début du contenu (2 048 octets suffisent).
 * @param taille  taille totale du fichier, en octets.
 * @param point   point de dépôt concerné.
 */
export const verifierFichier = (
    octets: Uint8Array,
    taille: number,
    point: PointDepot
): Verdict => {
    const regle = REGLES[point];
    const type = detecterType(octets);

    // Un fichier vide passe toutes les vérifications de signature faute de
    // contenu à examiner : il faut l'écarter explicitement.
    if (taille === 0) {
        return { accepte: false, type, motif: 'Ce fichier est vide (0 octet).' };
    }

    if (taille > regle.tailleMaxOctets) {
        return {
            accepte: false,
            type,
            motif: `Ce fichier fait ${formaterTaille(taille)}, la limite est de ${formaterTaille(regle.tailleMaxOctets)}.`,
        };
    }

    if (!regle.types.includes(type)) {
        // Nommer ce qui a été détecté vaut mieux qu'un refus opaque : dans la
        // plupart des cas, le déposant s'est simplement trompé de fichier.
        const detecte = type === 'inconnu'
            ? "Le format de ce fichier n'a pas pu être reconnu."
            : `Ce fichier est de type « ${type} », quelle que soit son extension.`;
        return { accepte: false, type, motif: `${detecte} Formats acceptés ici : ${regle.libelle}.` };
    }

    return { accepte: true, type };
};

/** Nombre d'octets à lire en tête de fichier pour décider. */
export const OCTETS_A_LIRE = 2048;