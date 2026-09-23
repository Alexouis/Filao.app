/**
 * Contrôles d'une contestation, sans dépendance distante : importables par
 * l'Edge Function (Deno) comme par les tests (Node).
 */
export interface DemandeContestation {
  motif?: unknown;
  justificatif?: unknown;
}

/** Message d'erreur présentable, ou null si la demande est recevable. */
export const erreurContestation = (d: DemandeContestation, userId: string): string | null => {
  const motif = String(d.motif ?? "").trim();
  if (motif.length < 20) return "Expliquez en quelques phrases pourquoi vous contestez cette inscription (20 caractères minimum).";
  if (motif.length > 2000) return "Le motif est limité à 2 000 caractères.";
  const chemin = String(d.justificatif ?? "");
  // Le justificatif doit être un fichier que l'appelant a lui-même déposé.
  if (!chemin.startsWith(`documents/${userId}/`) || chemin.includes("..")) {
    return "Joignez un extrait Kbis de moins de 3 mois.";
  }
  return null;
};
