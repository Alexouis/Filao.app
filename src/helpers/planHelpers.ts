import { PLANS_CONFIG, PlanType, PLANS_TYPES, STATUSES } from '../config';
import { Tender } from '../types';
import { consommeQuota } from './tenderHelpers';
import { forfait, illimite } from './planLimits';

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

  // Quotas et libellés viennent de `plan_limits` : les valeurs en dur de
  // `PLANS_CONFIG` divergeaient de la base — `partenaire` y autorisait 1
  // dossier contre 0 en base, d'où le « 1/1 » affiché pour un forfait qui n'en
  // permet aucun.
  const offre = forfait(userProfile.plan);

  // Dossiers portés et encore en cours. `isActive` incluait les dossiers
  // déposés, qui restent suivis mais n'ont plus à consommer d'emplacement.
  const activeCount = currentTenders.filter(t =>
    consommeQuota(t, userProfile.id)
  ).length;

  // Un forfait sans limite ne bloque jamais.
  if (illimite(offre)) return { allowed: true };

  // 0 dossier autorisé : c'est le cas du forfait Partenaire, créé par
  // invitation. Le message doit dire que ce n'est pas un dépassement mais la
  // nature de l'offre, sinon « vous portez déjà 0 dossier » est absurde.
  if ((offre.maxAoSimultanes ?? 0) === 0) {
    return {
      allowed: false,
      message: `Le forfait ${offre.libelle} permet de rejoindre des dossiers et d'y déposer vos pièces, sans en porter vous-même. Choisissez une offre pour créer votre premier dossier.`
    };
  }

  if (activeCount >= (offre.maxAoSimultanes ?? 0)) {
    // Le message dit ce qui bloque ET ce qui débloque. « Passez au forfait
    // supérieur » n'indique ni lequel, ni à quel prix, ni qu'il existe une
    // alternative gratuite — finaliser un dossier en cours libère un
    // emplacement immédiatement.
    return {
      allowed: false,
      message: `Vous portez déjà ${activeCount} dossier(s) en cours, la limite du forfait ${offre.libelle}. Finalisez-en un — un dossier déposé libère aussitôt sa place — ou passez au forfait supérieur.`
    };
  }

  return { allowed: true };
};

/**
 * Check AI Access
 */
export const hasAIAccess = (userProfile: any): boolean =>
  Boolean(forfait(userProfile?.plan).fonctionnalites.ia);

/**
 * @returns le quota de stockage du forfait, en octets. null = illimité.
 */
export const quotaStockage = (userProfile: any): number | null =>
  forfait(userProfile?.plan).maxStockageOctets;

/**
 * @returns le nombre d'utilisateurs autorisés. null = illimité.
 */
export const quotaUtilisateurs = (userProfile: any): number | null =>
  forfait(userProfile?.plan).maxUtilisateurs;

/**
 * Dossiers portés au-delà du quota.
 *
 * Sert au cas du critère 4 : après une résiliation, un échec de paiement ou une
 * rétrogradation, le quota peut devenir inférieur à l'usage. `canCreateTender`
 * ne couvre que la création — il ne dit rien d'un dépassement survenu
 * rétroactivement.
 *
 * @returns 0 si l'usage tient dans l'offre.
 */
export const depassementQuota = (userProfile: any, currentTenders: Tender[]): number => {
  const offre = forfait(userProfile?.plan);
  if (offre.maxAoSimultanes === null) return 0;

  const portes = currentTenders.filter(t => consommeQuota(t, userProfile?.id)).length;
  return Math.max(portes - offre.maxAoSimultanes, 0);
}