import { Tender } from '../types';
import { STATUSES } from '../config';

/**
 * Computes the effective display status of a tender.
 * "Expiré" is never stored in DB — it is derived from date_limite.
 *
 * Rules:
 *  - Gagné / Perdu / Brouillon / Déposé → returned as-is
 *  - En cours + date_limite in the past → Expiré
 *  - En cours + date_limite in the future/missing → En cours
 */
export const getEffectiveStatus = (tender: Tender): string => {
    if (tender.statut === STATUSES.won) return STATUSES.won;
    if (tender.statut === STATUSES.lost) return STATUSES.lost;
    if (tender.statut === STATUSES.draft) return STATUSES.draft;
    if (tender.statut === STATUSES.submitted) return STATUSES.submitted;

    // Check for expiration
    if (tender.date_limite) {
        const deadline = new Date(tender.date_limite);
        deadline.setHours(23, 59, 59, 999); 
        if (deadline < new Date()) return STATUSES.expired;
    }
    return STATUSES.on;
};

/**
 * Returns true if the tender is actively in progress (deadline not passed, not closed).
 */
export const isActive = (tender: Tender): boolean => {
    const status = getEffectiveStatus(tender);
    return status === STATUSES.on || status === STATUSES.submitted;
}

/**
 * Un dossier consomme-t-il un emplacement de l'abonnement ?
 *
 * Distinct de `isActive`, qui sert à l'affichage. Un dossier déposé reste
 * « actif » au sens du suivi — on attend le résultat, il figure dans les
 * tableaux de bord — mais il ne doit plus consommer de quota : le travail de
 * Filao s'arrête au dépôt. Garder l'emplacement pendant les trois à six mois
 * d'instruction transformerait un abonnement à cinq dossiers en abonnement à
 * cinq dossiers par an.
 *
 * @param tender dossier à évaluer.
 * @param userId utilisateur concerné. Seul le porteur du dossier consomme :
 *   un co-traitant n'a pas choisi d'ouvrir ce dossier, le facturer pour une
 *   invitation reçue serait incompréhensible.
 */
/**
 * Un dossier consomme-t-il une place du quota ?
 *
 * Le critère est le CRÉATEUR, pas le mandataire. Le rôle de mandataire est
 * cessible entre membres d'un groupement : fonder le quota dessus le rendrait
 * transférable, et un dossier changerait de facturation en changeant de
 * porteur. La création est un fait qui ne se cède pas.
 *
 * Seul le statut « En cours » compte : un dossier déposé reste suivi mais le
 * travail de Filao s'y arrête, et un dossier verrouillé a déjà rendu sa place.
 *
 * ⚠️ Le décompte qui fait autorité est celui de l'entreprise, calculé en base
 *    par `dossiers_portes_entreprise` — le forfait appartient à l'entreprise, et
 *    ses membres partagent le quota. Cette fonction ne voit que les dossiers
 *    chargés côté client : elle sert au contrôle immédiat, pas à la décision.
 */
export const consommeQuota = (tender: Tender, userId?: string): boolean => {
    if ((tender as any).verrouille_par_quota) return false;
    if (userId && tender.createur_id !== userId) return false;
    return getEffectiveStatus(tender) === STATUSES.on;
}