/**
 * ⚠️ COPIE à l'identique dans upload-document/invitationCode.ts — une Edge
 * Function ne peut importer hors de son dossier. Un test vérifie que les deux
 * copies restent identiques.
 *
 * Invitation correspondant à un couple (e-mail, code d'accès), parmi les
 * invitations d'un dossier.
 *
 * Comparaison EXACTE (casse ignorée), faite ici plutôt qu'avec `.ilike()` : ce
 * dernier traite l'e-mail et le code saisis comme des MOTIFS — « % » et « % »
 * désignaient n'importe quelle invitation du dossier. Une invitation révoquée
 * ou expirée ne correspond jamais.
 */
export interface LigneInvitation {
  email?: string | null;
  access_code?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
  [cle: string]: unknown;
}

export const invitationParCode = <T extends LigneInvitation>(
  lignes: T[],
  email: string,
  code: string,
  maintenant: number = Date.now(),
): T | null => {
  const adresse = String(email ?? "").trim().toLowerCase();
  const codeNormalise = String(code ?? "").trim().toUpperCase();
  if (!adresse || codeNormalise.length < 6) return null;
  return lignes.find((i) =>
    String(i.email ?? "").toLowerCase() === adresse
    && String(i.access_code ?? "").toUpperCase() === codeNormalise
    && !i.revoked_at
    && (!i.expires_at || new Date(i.expires_at).getTime() > maintenant)
  ) ?? null;
};
