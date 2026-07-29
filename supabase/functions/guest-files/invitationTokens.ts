/**
 * Jetons d'invitation — génération et empreinte.
 *
 * Le jeton donne accès au dossier et au dépôt de pièces sans compte : c'est un
 * secret d'authentification, au même titre qu'un mot de passe. La base n'en
 * conserve que l'empreinte SHA-256 (migration 042) ; la valeur en clair
 * n'existe qu'au moment de la génération, le temps de partir dans le lien du
 * courriel.
 *
 * Pas de sel ni de bcrypt, contrairement à un mot de passe : 32 octets
 * aléatoires ne sont pas attaquables par dictionnaire, et la vérification a lieu
 * à chaque requête de l'invité — elle doit rester rapide.
 */

/**
 * @returns un jeton de 32 octets aléatoires en base64url.
 *
 * base64url plutôt qu'hexadécimal : 43 caractères au lieu de 64 pour la même
 * entropie, et aucun caractère à échapper dans une URL. Le jeton circule dans
 * le chemin (`/invitation/<token>`).
 */
export const genererJetonInvitation = (): string => {
  const octets = new Uint8Array(32);
  crypto.getRandomValues(octets);
  return btoa(String.fromCharCode(...octets))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

/**
 * @returns l'empreinte hexadécimale du jeton, telle que stockée en base.
 *
 * Doit produire exactement le même résultat que `empreinte_jeton()` côté
 * PostgreSQL — d'où l'hexadécimal en minuscules, format de `encode(..., 'hex')`.
 */
export const empreinteJeton = async (jeton: string): Promise<string> => {
  const donnees = new TextEncoder().encode(jeton);
  const empreinte = await crypto.subtle.digest("SHA-256", donnees);
  return Array.from(new Uint8Array(empreinte))
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Masque un jeton pour la journalisation.
 *
 * La conception l'exige : « le token ne doit apparaître ni dans les logs
 * applicatifs, ni dans l'instrumentation analytics ». Un jeton dans une trace
 * d'erreur est un jeton exposé à quiconque lit ces traces.
 */
export const masquerJeton = (jeton?: string | null): string =>
  jeton ? `${jeton.slice(0, 4)}…(${jeton.length})` : "(absent)";