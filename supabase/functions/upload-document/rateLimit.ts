import { empreinteJeton } from "./invitationTokens.ts";

/**
 * Limitation de débit de l'accès invité.
 *
 * Les fonctions ouvertes à un porteur de jeton acceptent des fichiers sans
 * authentification. Un jeton fuité — capture d'écran, courriel transféré —
 * suffirait sinon à faire du stockage un dépôt anonyme, aux frais du projet.
 *
 * Le compteur vit en base (migration 044) et non en mémoire : les edge
 * functions sont sans état et s'exécutent en parallèle sur plusieurs instances,
 * un compteur local ne verrait qu'une fraction du trafic.
 */

/** Limites de la conception : 20 requêtes par minute et par jeton, 100 par heure et par IP. */
export const LIMITE_JETON_MINUTE = 20;
export const LIMITE_IP_HEURE = 100;

export interface VerdictDebit {
    autorise: boolean;
    motif?: string;
}

/**
 * Adresse de l'appelant.
 *
 * Derrière un proxy — c'est le cas des edge functions — l'adresse réelle est en
 * tête de `x-forwarded-for`, le reste étant la chaîne des relais traversés.
 */
const adresseAppelant = (req: Request): string =>
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "inconnue";

/**
 * Consomme un jeton de quota pour cet appel.
 *
 * @param jeton jeton d'invitation en clair, s'il y en a un. Seule son empreinte
 *   est transmise : cette table n'a pas à contenir de secret.
 *
 * En cas d'échec technique du comptage, l'appel est **autorisé**. Bloquer un
 * invité légitime parce qu'une table de compteurs est indisponible serait pire
 * que le risque couvert : la limitation protège d'un abus, elle n'est pas le
 * contrôle d'accès — celui-ci reste le jeton.
 */
export const verifierDebit = async (
    admin: any,
    req: Request,
    jeton?: string | null,
): Promise<VerdictDebit> => {
    try {
        if (jeton) {
            const empreinte = await empreinteJeton(jeton);
            const { data } = await admin.rpc("consommer_quota_invite", {
                p_cle: empreinte,
                p_portee: "jeton_minute",
                p_limite: LIMITE_JETON_MINUTE,
            });
            if (data?.[0] && data[0].autorise === false) {
                return { autorise: false, motif: "Trop de requêtes pour ce lien. Patientez une minute." };
            }
        }

        const { data: parIp } = await admin.rpc("consommer_quota_invite", {
            p_cle: adresseAppelant(req),
            p_portee: "ip_heure",
            p_limite: LIMITE_IP_HEURE,
        });
        if (parIp?.[0] && parIp[0].autorise === false) {
            return { autorise: false, motif: "Trop de requêtes depuis cette connexion. Réessayez plus tard." };
        }

        return { autorise: true };
    } catch (erreur) {
        console.warn("Comptage de débit indisponible, appel autorisé", erreur);
        return { autorise: true };
    }
};