/**
 * Règles des rappels d'échéance, sans dépendance distante : importables par
 * l'Edge Function (Deno) comme par les tests (Node).
 */

/** Jours restants avant l'échéance déclenchant un rappel. */
export const SEUILS = [7, 3, 1, 0] as const;

/** Écart en jours entre deux dates `yyyy-MM-dd`. */
export const ecartJours = (de: string, a: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

export const libelles = (j: number) =>
  j === 0 ? { titre: "Échéance aujourd'hui", message: "La date limite de réponse est aujourd'hui pour" }
  : j === 1 ? { titre: "Échéance demain", message: "La date limite de réponse est demain pour" }
  : { titre: `Échéance dans ${j} jours`, message: `La date limite de réponse est dans ${j} jours pour` };

/**
 * Ce rappel (dossier, seuil) a-t-il déjà été émis ?
 * Reconnaît aussi les rappels des versions précédentes : ceux de la fonction
 * SQL (`deadline_{dossier}_{j}d`) et ceux de l'ancienne version de celle-ci,
 * sans seuil, qui ne partaient qu'à J-7.
 */
export const dejaEmis = (existantes: any[], dossierId: string, seuil: number): boolean =>
  existantes.some((n) =>
    n?.type === "deadline_reminder" && n?.related_tender_id === dossierId && (
      n?.seuil_jours === seuil
      || n?.id === `deadline_${dossierId}_${seuil}d`
      || (n?.seuil_jours === undefined && !String(n?.id ?? "").startsWith("deadline_") && seuil === 7)
    ));

