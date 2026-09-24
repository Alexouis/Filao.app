/**
 * Règles de la purge des pièces orphelines, sans dépendance distante :
 * importables par l'Edge Function (Deno) comme par les tests (Node).
 */

/**
 * Dossier de fichiers d'un utilisateur dans le bucket `documents`.
 *
 * Les pièces sont rangées à la RACINE, sous l'e-mail en minuscules — c'est
 * le chemin qu'écrit `upload-document` et que lisent les policies. La purge
 * cherchait sous `documents/{email}` : elle n'a jamais rien trouvé.
 */
export const dossierDePieces = (email: string): string => String(email ?? "").trim().toLowerCase();

export interface SituationPiece {
  dossierExiste: boolean;
  /** Le déposant est le créateur du dossier. */
  estCreateur: boolean;
  liensGroupement: number;
  liensInvitation: number;
}

/**
 * Une pièce est orpheline si son dossier n'existe plus, ou si plus rien ne
 * relie le déposant au dossier. Les pièces du CRÉATEUR sur son propre dossier
 * ne le sont jamais — sans entreprise ni invitation, elles auraient été
 * supprimées.
 */
export const estOrpheline = (s: SituationPiece): boolean => {
  if (!s.dossierExiste) return true;
  if (s.estCreateur) return false;
  return s.liensGroupement === 0 && s.liensInvitation === 0;
};
