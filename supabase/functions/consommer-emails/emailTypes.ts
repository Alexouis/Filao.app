// Métadonnées des types d'emails — partagées par les Edge Functions.
// -------------------------------------------------------------------------
// Les fonctions Deno ne peuvent pas importer le module front
// `src/helpers/notificationTypes.ts` (runtimes isolés). Ce fichier porte donc,
// côté edge, la même intention : une source unique décrivant, par type d'email,
// sa famille de préférence et son caractère transactionnel/sécurité.
//
// Garder ce fichier ALIGNÉ avec les prefKey de notificationTypes.ts. Si un jour
// un build partagé est mis en place, fusionner les deux.

/** Familles de préférence (cf. utilisateurs.notification_preferences). */
export type FamillePref = "nouveau_document" | "rappels" | "messages_feed" | "communications";

export interface MetaEmail {
  /** Famille de préférence consultée avant envoi. null = pas de préférence
   *  applicable (toujours envoyé, hors plafond si `securite`). */
  famille: FamillePref | null;
  /** Email de sécurité : jamais plafonné, jamais désactivable. Réservé à l'auth
   *  (vérif adresse, mot de passe) — qui de toute façon ne passe pas par la file.
   *  Présent ici pour exhaustivité et robustesse si un tel type y était ajouté. */
  securite?: boolean;
  /** Email transactionnel (déclenché par une action). Les NON-transactionnels
   *  (communications/marketing) doivent porter un en-tête List-Unsubscribe. */
  transactionnel: boolean;
}

export const META_EMAILS: Record<string, MetaEmail> = {
  // Rappels d'échéance → famille "rappels", transactionnel.
  deadline_j7: { famille: "rappels", transactionnel: true },
  deadline_j3: { famille: "rappels", transactionnel: true },
  deadline_j1: { famille: "rappels", transactionnel: true },
  // Récapitulatif quotidien des dépôts → famille "nouveau_document".
  recap_documents: { famille: "nouveau_document", transactionnel: true },
  // Document du coffre-fort bientôt expiré → famille "rappels".
  document_expirant: { famille: "rappels", transactionnel: true },
  // Jalon de rétroplanning échu → famille "rappels".
  jalon_echu: { famille: "rappels", transactionnel: true },
  // Bienvenue → transactionnel, pas de famille (toujours envoyé une fois).
  bienvenue: { famille: null, transactionnel: true },
  // Document du coffre-fort expirant → famille "rappels" (échéance à agir).
  document_expirant: { famille: "rappels", transactionnel: true },
  // Jalon de rétroplanning échu → famille "rappels".
  jalon_echu: { famille: "rappels", transactionnel: true },
  // Email de bienvenue → transactionnel, pas de préférence (toujours envoyé une
  // fois à l'inscription). Famille null = non filtré par préférence.
  bienvenue: { famille: null, transactionnel: true },
  // Actualités / communications → non transactionnel (List-Unsubscribe requis).
  communication: { famille: "communications", transactionnel: false },
};

/** Métadonnées d'un type, avec valeurs par défaut prudentes si type inconnu. */
export const metaEmail = (type: string): MetaEmail =>
  META_EMAILS[type] ?? { famille: null, transactionnel: true };
