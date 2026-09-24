/**
 * Règles des codes de secours, sans dépendance distante : importables par
 * l'Edge Function (Deno) comme par les tests (Node).
 */

/**
 * Niveau d'authentification (`aal`) porté par un jeton déjà VÉRIFIÉ par
 * `auth.getUser()` : on n'en lit que la charge utile.
 */
export const aalDuJeton = (enTete: string | null): string | null => {
  if (!enTete?.startsWith("Bearer ")) return null;
  const segments = enTete.slice(7).trim().split(".");
  if (segments.length !== 3) return null;
  try {
    const charge = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(charge.padEnd(Math.ceil(charge.length / 4) * 4, "=")))?.aal ?? null;
  } catch {
    return null;
  }
};

/**
 * Générer des codes de secours exige une session AAL2 (double
 * authentification passée). En AAL1 — mot de passe seul —, générer puis
 * utiliser un code retirait la double authentification : elle était
 * contournable avec le seul mot de passe.
 */
export const peutGenererCodes = (aal: string | null): boolean => aal === "aal2";
