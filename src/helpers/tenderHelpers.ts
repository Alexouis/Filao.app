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
