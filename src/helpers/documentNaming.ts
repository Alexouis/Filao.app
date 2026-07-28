/**
 * Convention de nommage des pièces déposées par les collaborateurs.
 *
 *     {type}-{identifiant_collaborateur}-{identifiant_ao}
 *     dc2-7071c80f-322a-4136-8970-15552379f05b-0a2943e7-f8d6-470a-809f-6502e73995fc
 *
 * Ce nom n'est pas décoratif : c'est lui qui relie un objet du bucket à un
 * emplacement de l'interface. `TenderWizard` s'en sert pour reconstituer la
 * grille des pièces attendues, `CollaboratorSubmission` pour savoir quel
 * emplacement est rempli, et l'edge function `guest-files` pour filtrer.
 *
 * POURQUOI CE MODULE
 * La convention était construite à trois endroits et relue à un quatrième, avec
 * des implémentations divergentes : `TenderWizard` traite correctement le fait
 * qu'un UUID contient des tirets, `split('-')` ailleurs. Un dépôt a d'ailleurs
 * cessé d'être reconnu par l'interface parce qu'un appel avait perdu le nom
 * imposé — le fichier arrivait bien dans le bucket, mais sous un nom que
 * personne ne savait relire, et rien ne le signalait.
 *
 * ⚠️ Les identifiants étant des UUID, ils contiennent des tirets : la lecture
 *    ne peut pas se faire par un simple découpage. Elle part de la fin, où
 *    l'identifiant de l'AO est connu.
 */

export interface PieceCollaborateur {
    /** Type de document attendu (`dc1`, `dc2`, `kbis`…). Sans tiret. */
    docType: string;
    /** Identifiant du collaborateur ou de l'invitation. UUID. */
    collabId: string;
    /** Identifiant de l'appel d'offres. UUID. */
    tenderId: string;
}

/**
 * @returns le nom de fichier à utiliser dans le bucket.
 *
 * Le type ne doit pas contenir de tiret, sous peine de rendre le nom illisible :
 * on le neutralise plutôt que de produire un nom qu'aucun lecteur ne saura
 * découper.
 */
export const nomPieceCollaborateur = ({ docType, collabId, tenderId }: PieceCollaborateur): string =>
    `${String(docType).replace(/-/g, '_')}-${collabId}-${tenderId}`;

/**
 * Lit un nom de fichier produit par `nomPieceCollaborateur`.
 *
 * @param nom nom du fichier, sans son dossier.
 * @param tenderId identifiant de l'AO attendu. Fourni, il sert d'ancre pour
 *   découper le nom sans se laisser piéger par les tirets des UUID.
 * @returns null si le nom ne suit pas la convention, ou ne concerne pas cet AO.
 */
export const lirePieceCollaborateur = (
    nom: string,
    tenderId?: string
): PieceCollaborateur | null => {
    if (!nom) return null;

    if (tenderId) {
        if (!nom.endsWith(tenderId)) return null;
        const prefixe = nom.slice(0, -(tenderId.length + 1));
        const separateur = prefixe.indexOf('-');
        if (separateur <= 0) return null;
        return {
            docType: prefixe.slice(0, separateur),
            collabId: prefixe.slice(separateur + 1),
            tenderId,
        };
    }

    // Sans ancre, on ne peut isoler que le type : le reste est une suite de
    // tirets dont rien ne dit où s'arrête le premier identifiant.
    const separateur = nom.indexOf('-');
    if (separateur <= 0) return null;
    return { docType: nom.slice(0, separateur), collabId: '', tenderId: '' };
};

/**
 * Clé de correspondance utilisée dans les états de l'interface, indépendante
 * de l'AO puisqu'un écran ne traite qu'un dossier à la fois.
 */
export const clePieceCollaborateur = (docType: string, collabId: string): string =>
    `${String(docType).replace(/-/g, '_')}-${collabId}`;

/** @returns vrai si le nom concerne l'appel d'offres indiqué. */
export const concernePiece = (nom: string, tenderId: string): boolean =>
    Boolean(nom) && Boolean(tenderId) && nom.endsWith(tenderId);