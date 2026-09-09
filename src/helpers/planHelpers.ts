import { Tender } from '../types';
import { consommeQuota } from './tenderHelpers';
import { forfait, illimite } from './planLimits';

/**
 * Checks if the user can create a new tender based on their plan.
 * Le quota vient de `plan_limits` : `partenaire` est à 0 dossier porté.
 * (`ao_offert_utilise` n'a jamais existé en base — mention historique.)
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
      // « Vous portez » était impropre : le décompte porte sur les dossiers
      // CRÉÉS, par n'importe quel membre de l'entreprise, et le mandariat est
      // cessible. Le message doit dire ce qui est réellement compté.
      message: `Votre entreprise a déjà ${activeCount} dossier(s) en cours, la limite du forfait ${offre.libelle}. Finalisez-en un — un dossier déposé libère aussitôt sa place — ou passez au forfait supérieur.`
    };
  }

  return { allowed: true };
};
