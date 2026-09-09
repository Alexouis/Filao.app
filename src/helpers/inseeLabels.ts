import { INSEE_SECTION_LABELS } from '../config';

/**
 * Traduction des codes INSEE en libellés lisibles.
 *
 * POURQUOI CES FONCTIONS EXISTENT
 * L'API Sirene renvoie des codes, pas des mots : `5710` pour une SAS, `12`
 * pour une tranche d'effectif, `F` pour la construction. Affichés bruts, ils
 * font passer une fiche entreprise correctement remplie pour une fiche
 * incomplète.
 *
 * ELLES SONT TOLÉRANTES AUX DEUX FORMES
 * Une fiche peut contenir soit le code d'origine, soit le libellé déjà résolu
 * — selon qu'elle a été remplie par la recherche SIRET ou à la main, et selon
 * l'ancienneté de l'enregistrement. Chaque fonction reconnaît donc un libellé
 * déjà lisible et le laisse passer, plutôt que de le remplacer par
 * « Non défini ». C'est ce qui évite qu'une fiche saisie manuellement se vide
 * de son secteur au premier réenregistrement.
 *
 * Ces fonctions vivaient en tête de `CompanyTab`, hors de portée des tests.
 */

/** Tranches d'effectif INSEE, regroupées par catégorie d'entreprise. */
const CATEGORIES_EFFECTIF: Record<string, string> = {
    // 00 à 03 : moins de 10 salariés
    '00': 'Micro/TPE', '01': 'Micro/TPE', '02': 'Micro/TPE', '03': 'Micro/TPE',
    // 11 à 31 : de 10 à 249
    '11': 'PME', '12': 'PME', '21': 'PME', '22': 'PME', '31': 'PME',
    // 32 à 51 : de 250 à 4 999
    '32': 'ETI', '41': 'ETI', '42': 'ETI', '51': 'ETI',
    // 52 et au-delà : 5 000 et plus
    '52': 'GE', '53': 'GE',
};

/**
 * Catégorie d'entreprise depuis une tranche d'effectif INSEE.
 *
 * Renvoie une chaîne vide pour une tranche inconnue : mieux vaut ne rien
 * afficher qu'annoncer une taille fausse, sur laquelle se jouent des critères
 * d'allotissement.
 */
export const categorieEffectif = (tranche: string | number | undefined | null): string => {
    if (tranche === undefined || tranche === null || tranche === '') return '';
    return CATEGORIES_EFFECTIF[tranche.toString()] ?? '';
};

/** Date au format français, ou la valeur d'origine si elle est illisible. */
export const dateLisible = (dateIso: string | null | undefined): string => {
    if (!dateIso) return '';
    const date = new Date(dateIso);
    // `Intl` formaterait « Invalid Date » en toutes lettres ; on préfère
    // rendre la valeur d'origine, qui reste au moins un indice exploitable.
    if (Number.isNaN(date.getTime())) return dateIso;
    return new Intl.DateTimeFormat('fr-FR').format(date);
};

/** Formes juridiques les plus fréquentes chez les répondants aux marchés publics. */
const FORMES_JURIDIQUES: Record<string, string> = {
    '1000': 'Entrepreneur individuel',
    '5499': 'SARL / EURL',
    '5710': 'SAS / SASU',
    '5720': 'Société par actions simplifiée',
    '5599': "SA à conseil d'administration",
    '6599': 'SCI',
    '5485': 'SELARL',
    '5785': 'SELAS',
};

/**
 * Forme juridique lisible.
 *
 * @param code       code INSEE à quatre chiffres
 * @param libelleActuel libellé déjà enregistré, s'il y en a un. Un libellé
 *                      long et non numérique est considéré comme déjà résolu
 *                      et conservé tel quel — y compris pour les formes
 *                      absentes de la table ci-dessus.
 */
export const formeJuridiqueLisible = (
    code: string | null | undefined,
    libelleActuel?: string | null
): string => {
    if (libelleActuel && libelleActuel.length > 10 && !/^\d+$/.test(libelleActuel)) {
        return libelleActuel;
    }
    return (code && FORMES_JURIDIQUES[code]) || code || 'Non défini';
};

/**
 * Secteur d'activité lisible depuis une section INSEE (`A` à `U`).
 *
 * Une valeur longue qui n'est pas une lettre de section est un libellé déjà
 * résolu : on le rend inchangé.
 */
export const secteurLisible = (code: string | null | undefined): string => {
    if (!code) return 'Non défini';
    if (code.length > 3 && !/^[A-U]$/.test(code)) return code;
    return (INSEE_SECTION_LABELS as Record<string, string>)[code] || code;
};

// ---------------------------------------------------------------------------
// Fiche entreprise depuis l'annuaire des entreprises
// ---------------------------------------------------------------------------

/** Effectif représentatif par tranche, pour préremplir un champ numérique. */
const EFFECTIF_REPRESENTATIF: Record<string, string> = {
    '00': '0', '01': '1', '02': '3', '03': '6', '11': '10',
    '12': '20', '21': '50', '22': '100', '31': '200', '32': '250',
    '41': '500', '42': '1000', '51': '2000', '52': '5000', '53': '10000',
};

export interface FicheSirene {
    nom?: string;
    prenom: string;
    nom_famille: string;
    siret: string;
    adresse?: string;
    ville?: string;
    code_postal?: string;
    taille?: string;
    effectif: string | number;
    forme_juridique?: string;
    code_naf?: string;
    date_creation?: string;
}

/**
 * Rue seule, extraite d'un établissement.
 *
 * L'annuaire expose tantôt les composants de la voie, tantôt une adresse
 * complète en un bloc. Dans le second cas on retire le code postal et la
 * commune, qui ont déjà leurs propres champs : sans cela, la ville
 * apparaissait deux fois sur les documents générés.
 */
export const rueDepuisEtablissement = (etab: any): string => {
    const composants = [etab?.numero_voie, etab?.type_voie, etab?.libelle_voie]
        .filter(Boolean).join(' ').trim();
    if (composants) return composants;

    let reste: string = etab?.adresse ?? '';
    if (!reste) return '';
    if (etab?.code_postal) reste = reste.replace(etab.code_postal, '');
    if (etab?.libelle_commune) reste = reste.replace(etab.libelle_commune, '');
    return reste.trim().replace(/,$/, '').trim();
};

/**
 * Traduit une réponse de l'annuaire en champs de fiche entreprise.
 *
 * DEUX POINTS QUI ONT LEUR IMPORTANCE
 *
 * 1. C'est l'établissement CORRESPONDANT au SIRET recherché qui prime, pas le
 *    siège. Une entreprise multi-établissements renseignait sinon l'adresse du
 *    siège pour une agence — et l'adresse figure sur les actes d'engagement.
 *
 * 2. Prénom et nom ne sont repris QUE pour un entrepreneur individuel. Pour une
 *    société, le dirigeant n'est pas l'entreprise : recopier son état civil
 *    dans la fiche mélangerait deux identités juridiques distinctes.
 *
 * Les champs absents de la réponse sont laissés `undefined`, à charge de
 * l'appelant de conserver la valeur existante — écraser une adresse saisie à
 * la main par du vide serait une régression pour l'utilisateur.
 */
export const ficheDepuisSirene = (resultat: any, siretRecherche: string): FicheSirene => {
    const siege = resultat?.siege;
    const etab = resultat?.matching_etablissements?.find(
        (e: any) => e?.siret === siretRecherche
    ) || siege || {};

    const estIndividuel = !!resultat?.complements?.est_entrepreneur_individuel;
    const dirigeant = resultat?.dirigeants?.[0];

    const rue = rueDepuisEtablissement(etab);

    return {
        nom: resultat?.nom_complet || resultat?.nom_raison_sociale || undefined,
        prenom: estIndividuel ? (dirigeant?.prenoms || '') : '',
        nom_famille: estIndividuel ? (dirigeant?.nom || '') : '',
        siret: siretRecherche,
        adresse: rue || etab?.adresse || undefined,
        ville: etab?.libelle_commune || undefined,
        code_postal: etab?.code_postal || undefined,
        taille: resultat?.categorie_entreprise
            || categorieEffectif(resultat?.tranche_effectif_salarie)
            || undefined,
        effectif: EFFECTIF_REPRESENTATIF[resultat?.tranche_effectif_salarie ?? '00'] || 1,
        forme_juridique: resultat?.nature_juridique || undefined,
        code_naf: resultat?.activite_principale || undefined,
        date_creation: resultat?.date_creation || undefined,
    };
};
