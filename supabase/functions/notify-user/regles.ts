/**
 * Règles d'autorisation de `notify-user`, sans dépendance distante :
 * importables par l'Edge Function (Deno) comme par les tests (Node).
 */

/**
 * Types qu'un utilisateur peut adresser à un autre, et leur titre. Le titre
 * est fixé ICI : fourni par le client, il permettait d'afficher n'importe quel
 * texte dans l'application d'autrui (« Support Filao : confirmez votre mot de
 * passe… »). Les autres types (résultats, rappels…) sont émis côté serveur.
 */
export const TITRES: Record<string, string> = {
  document_added: "Document ajouté",
  document_reminder: "Rappel de documents",
  collaboration_accepted: "Collaboration acceptée",
  collaboration_rejected: "Collaboration refusée",
  collaboration_left: "Départ du groupement",
  collaborator_invited: "Invitation à collaborer",
  chat_message: "Nouveau message",
  network_invite_accepted: "Invitation réseau acceptée",
};

/** Adressés au créateur du dossier par un membre qui répond ou s'en va. */
export const VERS_LE_PORTEUR = new Set(["collaboration_accepted", "collaboration_rejected", "collaboration_left"]);

/**
 * Relation exigée entre l'expéditeur, le destinataire et l'objet :
 *   - `reseau`  : leurs entreprises sont liées dans le réseau ;
 *   - `porteur` : le destinataire est le créateur du dossier (réponse ou
 *                 départ d'un membre, qui peut ne plus y figurer) ;
 *   - `dossier` : les deux sont liés au dossier ;
 *   - `null`    : type interdit depuis le client.
 */
export const regleDestinataire = (type: string): "reseau" | "porteur" | "dossier" | null => {
  if (!(type in TITRES)) return null;
  if (type === "network_invite_accepted") return "reseau";
  if (VERS_LE_PORTEUR.has(type)) return "porteur";
  return "dossier";
};
