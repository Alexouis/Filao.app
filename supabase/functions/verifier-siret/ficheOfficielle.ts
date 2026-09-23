/**
 * Lecture de la fiche officielle d'un établissement, depuis une réponse de
 * l'annuaire recherche-entreprises.api.gouv.fr. Sans dépendance distante :
 * importable par l'Edge Function (Deno) comme par les tests (Node).
 *
 * Mêmes règles que `ficheDepuisSirene` côté front (src/helpers/inseeLabels.ts),
 * un test vérifie qu'elles donnent les mêmes champs officiels — à une
 * exigence près : ici, le SIRET DOIT désigner le siège ou un établissement de
 * la réponse. Le front retombait sur le siège sinon ; pour un badge « vérifié »,
 * une correspondance approximative ne suffit pas.
 */

export interface FicheOfficielle {
  nom?: string;
  adresse?: string;
  ville?: string;
  code_postal?: string;
  forme_juridique?: string;
  code_naf?: string;
  date_creation?: string;
  /** Entrepreneur individuel seulement. */
  prenom?: string;
  nom_famille?: string;
}

/** Colonnes de la fiche qui proviennent du registre. */
export const CHAMPS_OFFICIELS = [
  "siret", "nom", "adresse", "ville", "code_postal", "forme_juridique", "code_naf", "date_creation",
] as const;

/** 14 chiffres et clé de Luhn (exception La Poste, SIREN 356000000). */
export const siretFormatValide = (valeur: string): boolean => {
  const s = String(valeur ?? "").replace(/\s/g, "");
  if (!/^\d{14}$/.test(s)) return false;
  if (s.startsWith("356000000")) return true;
  let somme = 0;
  for (let i = 0; i < 14; i++) {
    let c = Number(s[13 - i]);
    if (i % 2 === 1) { c *= 2; if (c > 9) c -= 9; }
    somme += c;
  }
  return somme % 10 === 0;
};

const rueDepuisEtablissement = (etab: any): string => {
  const composants = [etab?.numero_voie, etab?.type_voie, etab?.libelle_voie].filter(Boolean).join(" ").trim();
  if (composants) return composants;
  let reste: string = etab?.adresse ?? "";
  if (!reste) return "";
  if (etab?.code_postal) reste = reste.replace(etab.code_postal, "");
  if (etab?.libelle_commune) reste = reste.replace(etab.libelle_commune, "");
  return reste.trim().replace(/,$/, "").trim();
};

/** Fiche officielle de l'établissement `siret`, ou null s'il n'est pas dans la réponse. */
export const ficheOfficielle = (resultat: any, siret: string): FicheOfficielle | null => {
  const siege = resultat?.siege;
  const etab = resultat?.matching_etablissements?.find((e: any) => e?.siret === siret)
    || (siege?.siret === siret ? siege : null);
  if (!etab) return null;

  const estIndividuel = !!resultat?.complements?.est_entrepreneur_individuel;
  const dirigeant = resultat?.dirigeants?.[0];
  const rue = rueDepuisEtablissement(etab);

  const fiche: FicheOfficielle = {
    nom: resultat?.nom_complet || resultat?.nom_raison_sociale || undefined,
    adresse: rue || etab?.adresse || undefined,
    ville: etab?.libelle_commune || undefined,
    code_postal: etab?.code_postal || undefined,
    forme_juridique: resultat?.nature_juridique || undefined,
    code_naf: resultat?.activite_principale || undefined,
    date_creation: resultat?.date_creation || undefined,
  };
  if (estIndividuel) {
    fiche.prenom = dirigeant?.prenoms || "";
    fiche.nom_famille = dirigeant?.nom || "";
  }
  return fiche;
};
