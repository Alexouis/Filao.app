/**
 * Qui peut ouvrir quoi.
 *
 * Depuis la migration 092, un dossier porté par un collègue REMONTE à tout
 * membre de l'entreprise, mais son contenu reste fermé : ni échanges, ni
 * pièces, et l'écriture est refusée. Ouvrir l'éditeur sur un tel dossier
 * afficherait des sections vides et ferait échouer le moindre enregistrement.
 *
 * Cette règle vivait dans `Tenders.tsx`, l'écran par lequel le problème a été
 * remarqué. Or le dossier s'ouvre aussi depuis le tableau de bord, le
 * calendrier, la page réseau, les notifications et un lien d'invitation —
 * autant de chemins qui contournaient le garde-fou. Elle est donc isolée ici,
 * et appliquée à l'endroit unique où la navigation vers l'éditeur se décide.
 */

/** Forme minimale attendue : on ne dépend pas du type complet `Tender`. */
interface DossierMinimal {
  createur_id?: string | null;
  entreprise_id?: string | null;
}

interface ProfilMinimal {
  id?: string;
  entreprise_id?: string | null;
}

/**
 * Le dossier est-il porté par un collègue ?
 *
 * On compare `reponses_ao.entreprise_id` — la colonne figée à la création par
 * la migration 092 — et non la ligne de groupement : celle du mandataire porte
 * l'entreprise du porteur, si bien qu'un administrateur, qui la voit depuis la
 * 094, serait classé « participant » sur le dossier d'un autre.
 */
export const estDossierDunCollegue = (
  dossier?: DossierMinimal | null,
  profil?: ProfilMinimal | null,
): boolean => {
  if (!dossier || !profil) return false;
  if (!dossier.createur_id || dossier.createur_id === profil.id) return false;
  if (!profil.entreprise_id || !dossier.entreprise_id) return false;
  return dossier.entreprise_id === profil.entreprise_id;
};

/**
 * Visible en liste, mais sans contenu lisible ni droit d'écriture.
 *
 * L'administrateur en est exclu : les migrations 093 et 094 lui ouvrent
 * l'écriture du dossier et la lecture de ses échanges, l'éditeur lui est donc
 * pleinement utilisable.
 */
export const estEnLectureSeule = (
  dossier?: DossierMinimal | null,
  profil?: ProfilMinimal | null,
  estAdmin?: boolean,
): boolean => !estAdmin && estDossierDunCollegue(dossier, profil);
