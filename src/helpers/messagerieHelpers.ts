/**
 * Dossiers dont la messagerie concerne l'utilisateur : ceux qu'il a créés, et
 * ceux où SON entreprise a accepté de participer.
 *
 * L'ancienne règle retenait tout dossier où « une » entreprise avait accepté —
 * y compris la ligne du porteur, présente sur tous les dossiers. Une
 * invitation encore en attente comptait donc comme un dossier de messagerie,
 * et déclenchait une requête de décompte par dossier pour rien.
 */
export const dossiersDeMessagerie = (
    dossiers: Array<{ id: string; createur_id?: string | null; groupements?: Array<{ entreprise_id?: string | null; statut?: string | null }> | null }>,
    userId: string,
    entrepriseId?: string | null,
): string[] =>
    dossiers
        .filter(d => d.createur_id === userId
            || (!!entrepriseId && (d.groupements ?? []).some(g => g.entreprise_id === entrepriseId && g.statut === 'accepte')))
        .map(d => d.id);

/** Total des non-lus : dérivé, jamais tenu à jour à part. */
export const totalNonLus = (compteurs: Record<string, number>): number =>
    Object.values(compteurs).reduce((somme, n) => somme + (n > 0 ? n : 0), 0);
