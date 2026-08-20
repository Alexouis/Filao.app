// Source unique de vérité des types d'événements de notification.
// -------------------------------------------------------------------------
// Avant ce module, chaque type était référencé en dur dans plusieurs endroits :
// filtres de la page historique, préférences de notification, helpers
// d'émission, mapping des rappels. Ajouter un type imposait de penser à tous
// ces points, et un oubli passait inaperçu.
//
// Ici, chaque type est décrit UNE fois :
//   • `categorie` : regroupement pour les filtres de l'historique.
//   • `prefKey`   : clé de préférence utilisateur consultée à l'émission
//                   (null = événement critique, toujours émis).
//
// Les préférences (`notification_preferences`) et les rappels d'échéance
// s'appuient sur ces mêmes clés, ce qui garantit la cohérence demandée par le
// ticket : « partager une liste unique de types entre l'historique, les
// préférences et les rappels ».

/** Clés de préférence utilisateur (cf. UserProfile.notification_preferences). */
export type NotifPrefKey = 'nouveau_document' | 'rappels' | 'messages_feed' | 'communications';

/** Catégories de filtre de la page d'historique. */
export type NotifCategorie =
  | 'invitations'
  | 'documents'
  | 'results'
  | 'reminders'
  | 'comments';

export interface NotifTypeDef {
  /** Clé technique stockée dans chaque notification (champ `type`). */
  type: string;
  /** Catégorie de filtre dans l'historique (null = non catégorisé). */
  categorie: NotifCategorie | null;
  /** Préférence consultée avant émission (null = critique, toujours émis). */
  prefKey: NotifPrefKey | null;
}

/**
 * Le registre. Une entrée par type d'événement métier.
 * Un type peut appartenir à plusieurs catégories de filtre (ex. un rappel de
 * document est à la fois « documents » et « échéances ») : `categoriesExtra`
 * couvre ce cas sans dupliquer l'entrée principale.
 */
export const NOTIFICATION_TYPES: (NotifTypeDef & { categoriesExtra?: NotifCategorie[] })[] = [
  { type: 'collaborator_invited',      categorie: 'invitations', prefKey: null },
  { type: 'collaboration_accepted',    categorie: 'invitations', prefKey: null },
  { type: 'collaboration_rejected',    categorie: 'invitations', prefKey: null },
  { type: 'collaboration_left',        categorie: 'invitations', prefKey: null },
  { type: 'network_invite',            categorie: 'invitations', prefKey: null },
  { type: 'network_invite_accepted',   categorie: 'invitations', prefKey: null },
  { type: 'document_added',            categorie: 'documents',   prefKey: 'nouveau_document' },
  { type: 'document_reminder',         categorie: 'documents',   prefKey: 'rappels', categoriesExtra: ['reminders'] },
  { type: 'deadline_reminder',         categorie: 'reminders',   prefKey: 'rappels' },
  { type: 'tender_won',                categorie: 'results',     prefKey: null },
  { type: 'tender_lost',               categorie: 'results',     prefKey: null },
  { type: 'comment_added',             categorie: 'comments',    prefKey: 'messages_feed' },
];

/** Index type → définition, pour les recherches ponctuelles. */
const PAR_TYPE = new Map(NOTIFICATION_TYPES.map((d) => [d.type, d]));

/** Renvoie la définition d'un type, ou undefined si inconnu. */
export const typeDef = (type: string) => PAR_TYPE.get(type);

/** Tous les types techniques appartenant à une catégorie de filtre donnée. */
export const typesDeCategorie = (categorie: NotifCategorie): string[] =>
  NOTIFICATION_TYPES
    .filter((d) => d.categorie === categorie || d.categoriesExtra?.includes(categorie))
    .map((d) => d.type);

/** Un type appartient-il à la catégorie (principale ou extra) ? */
export const estDeCategorie = (type: string, categorie: NotifCategorie): boolean => {
  const d = PAR_TYPE.get(type);
  if (!d) return false;
  return d.categorie === categorie || !!d.categoriesExtra?.includes(categorie);
};

/** Catégories de filtre proposées dans l'historique, avec leur libellé. */
export const CATEGORIES_FILTRE: { cle: NotifCategorie; label: string }[] = [
  { cle: 'invitations', label: 'Invitations' },
  { cle: 'documents',   label: 'Documents' },
  { cle: 'comments',    label: 'Commentaires' },
  { cle: 'reminders',   label: 'Échéances' },
  { cle: 'results',     label: 'Résultats' },
];