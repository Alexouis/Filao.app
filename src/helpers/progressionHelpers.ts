/**
 * Progression d'un dossier et libellé de statut — RÈGLE UNIQUE.
 *
 * POURQUOI CE FICHIER
 * Le tableau de bord et l'écran du dossier calculaient chacun leur
 * progression, avec des règles différentes sur les DEUX termes de la
 * fraction :
 *   - dénominateur : le tableau de bord comptait TOUTES les lignes de
 *     groupement (invitées, refusées comprises) ; l'écran du dossier ne
 *     comptait que le porteur et les membres acceptés ;
 *   - numérateur : le tableau de bord lisait un compteur en base
 *     (`nb_fichiers_recus`, jamais décrémenté) ; l'écran comptait les fichiers
 *     réellement présents.
 * Le même dossier affichait 100 % d'un côté et 21 % de l'autre.
 *
 * Le libellé de statut divergeait aussi : « En cours » sur la carte, « En
 * préparation » dans le dossier, et ce dernier ignorait l'expiration.
 *
 * Ce module fixe une règle, et une seule. Les écrans fournissent les données
 * dont ils disposent ; la règle décide.
 */
import { REQUIRED_DOCS_BY_ROLE, STATUSES } from '../config';
import { Tender } from '../types';
import { getEffectiveStatus } from './tenderHelpers';

/** Rôles reconnus dans un groupement. */
export type RoleGroupement = 'Mandataire' | 'Co-traitant' | 'Sous-traitant';

const ROLE_PAR_DEFAUT: RoleGroupement = 'Co-traitant';

/**
 * Nombre de pièces attendues pour un rôle.
 * Un rôle inconnu ou absent est traité comme cotraitant : c'est le cas le plus
 * fréquent, et le plus prudent (on n'attend pas les pièces du mandataire à
 * quelqu'un qui n'en a pas la charge).
 */
export const piecesAttenduesPourRole = (role?: string | null): number => {
  const cle = (role && role in REQUIRED_DOCS_BY_ROLE ? role : ROLE_PAR_DEFAUT) as RoleGroupement;
  return (REQUIRED_DOCS_BY_ROLE[cle] || []).length;
};

/** Membre tel que la règle a besoin de le voir : un rôle, un statut. */
export interface MembreProgression {
  role?: string | null;
  statut?: string | null;
  /** Le porteur n'a pas d'invitation à accepter : il compte toujours. */
  estPorteur?: boolean;
}

/**
 * Un membre compte-t-il dans la progression ?
 *
 * Seuls les membres ENGAGÉS comptent : le porteur, et ceux qui ont accepté.
 * Un invité qui n'a pas répondu, ou qui a refusé, n'a pas de pièces à
 * fournir — les compter gonflait le dénominateur et enfonçait artificiellement
 * le pourcentage ; les ignorer côté dossier mais pas côté tableau de bord
 * faisait diverger les deux écrans.
 */
export const membreComptabilise = (m: MembreProgression): boolean =>
  !!m.estPorteur || m.statut === 'accepte';

/** Total des pièces attendues pour une équipe. */
export const piecesAttendues = (membres: MembreProgression[]): number =>
  membres.filter(membreComptabilise).reduce((n, m) => n + piecesAttenduesPourRole(m.role), 0);

export interface Progression {
  recues: number;
  attendues: number;
  /** Entier entre 0 et 100. */
  percent: number;
}

/**
 * La fraction, bornée. `recues` peut venir d'un comptage réel ou d'un
 * compteur dénormalisé : la règle est la même, seule la fiabilité de
 * l'entrée change — et c'est à l'appelant de la garantir.
 */
export const calculerProgression = (recues: number, attendues: number): Progression => {
  const r = Math.max(0, Math.floor(recues || 0));
  const a = Math.max(0, Math.floor(attendues || 0));
  if (a === 0) return { recues: r, attendues: 0, percent: 0 };
  return { recues: r, attendues: a, percent: Math.min(100, Math.round((r / a) * 100)) };
};

/**
 * Progression d'un dossier à partir de ses groupements et d'un nombre de
 * pièces reçues. Point d'entrée du tableau de bord.
 *
 * Le porteur est ajouté s'il n'est pas déjà dans les groupements (données
 * antérieures à la v3.1, où le créateur n'y figurait pas).
 */
export const progressionDossier = (
  groupements: Array<{ role_groupement?: string | null; statut?: string | null }> | null | undefined,
  piecesRecues: number,
  porteurDansGroupements: boolean
): Progression => {
  const membres: MembreProgression[] = (groupements || []).map(g => ({
    role: g.role_groupement,
    statut: g.statut,
  }));
  if (!porteurDansGroupements) {
    membres.push({ role: 'Mandataire', estPorteur: true });
  }
  return calculerProgression(piecesRecues, piecesAttendues(membres));
};

/**
 * Libellé de statut à afficher — LE MÊME PARTOUT.
 *
 * Passe par `getEffectiveStatus` : un dossier « En cours » dont l'échéance est
 * passée est « Expiré », que l'on soit sur la carte ou dans le dossier.
 * L'écran du dossier affichait « En préparation » pour `En cours`, un
 * synonyme maison que la carte n'employait pas : on tranche pour le libellé
 * officiel de `STATUSES`, source unique.
 */
export const libelleStatut = (tender: Tender): string => getEffectiveStatus(tender);

/** Statuts pour lesquels la progression a encore un sens. */
export const progressionPertinente = (tender: Tender): boolean => {
  const s = getEffectiveStatus(tender);
  return s === STATUSES.on || s === STATUSES.draft;
};
