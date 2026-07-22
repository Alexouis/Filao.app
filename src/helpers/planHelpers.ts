import { PLANS_CONFIG, PlanType, PLANS_TYPES, STATUSES } from '../config';
import { Tender } from '../types';
import { isActive } from './tenderHelpers';

/**
 * Checks if the user can create a new tender based on their plan.
 * For 'partenaire' plan, the limit is 1 AO offert (tracked via ao_offert_utilise on entreprises).
 * For paid plans, the limit is based on activeTenders in PLANS_CONFIG.
 */
export const canCreateTender = (
  userProfile: any,
  currentTenders: Tender[]
): { allowed: boolean; message?: string } => {
  if (!userProfile) return { allowed: false, message: "Non connecté" };

  let planKey = (userProfile.plan as PlanType) || PLANS_TYPES.free;
  if (!PLANS_CONFIG[planKey]) {
    planKey = PLANS_TYPES.free;
  }
  const limits = PLANS_CONFIG[planKey].limits;

  // Count active tenders (deadline not passed) owned by user
  const activeCount = currentTenders.filter(t =>
    t.createur_id === userProfile.id &&
    isActive(t)
  ).length;

  if (activeCount >= limits.activeTenders) {
    return {
      allowed: false,
      message: `Vous avez atteint la limite de ${limits.activeTenders} appel(s) d'offres actif(s) pour le forfait ${PLANS_CONFIG[planKey].label}. Passez au forfait supérieur pour continuer.`
    };
  }

  return { allowed: true };
};

/**
 * Check AI Access
 */
export const hasAIAccess = (userProfile: any): boolean => {
  let planKey = (userProfile?.plan as PlanType) || PLANS_TYPES.free;
  if (!PLANS_CONFIG[planKey]) {
    planKey = PLANS_TYPES.free;
  }
  return PLANS_CONFIG[planKey].limits.aiAccess;
}