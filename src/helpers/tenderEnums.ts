/**
 * Coercition vers les enums PostgreSQL de la table `reponses_ao`.
 *
 * Trois colonnes de `reponses_ao` sont des enums PostgreSQL — `mode_passation`,
 * `secteur_activite`, `statut` — et toutes trois sont NOT NULL. Aucune ne
 * comporte de valeur vide : écrire `''` provoque une erreur
 * `invalid input value for enum`, et l'insert entier échoue.
 *
 * Le risque est concret dès qu'une valeur vient de l'extérieur : le BOAMP
 * renvoie `type_procedure: null` sur une partie des avis (avis rectificatifs,
 * procédures non catégorisées), et publie des libellés qui ne correspondent pas
 * un pour un à notre nomenclature.
 *
 * Ces fonctions garantissent qu'une valeur d'enum valide sort toujours. Elles
 * sont la dernière ligne de défense avant écriture, pas un substitut à la
 * validation du formulaire : coercer silencieusement un champ que
 * l'utilisateur devait remplir masquerait sa saisie incomplète.
 */

// ---------------------------------------------------------------------------
// Valeurs d'enum — doivent rester strictement alignées sur la base
// ---------------------------------------------------------------------------

/** enum `mode_passation_enum` */
export const MODES_PASSATION = [
    'OUVERT',
    'RESTREINT',
    'PROCEDURE_ADAPTE',
    'DIALOGUE_COMPETITIF',
    'NEGOCIE',
    'CONCOURS_OUVERT',
    'CONCOURS_RESTREINT',
    'DSP',
    'PARTENARIAT_INNOVATION',
    'AUTRE'
] as const;
export type ModePassation = typeof MODES_PASSATION[number];

/** enum `secteur_activite_enum` */
export const SECTEURS_ACTIVITE = [
    'BTP_Construction',
    'Informatique_Digital',
    'Transport_Logistique',
    'Sante_Pharmaceutique',
    'Energie_Environnement',
    'Services_Entreprises',
    'Industrie',
    'Autres'
] as const;
export type SecteurActivite = typeof SECTEURS_ACTIVITE[number];

/** enum `reponse_ao_statuts`. Noter l'absence de « Expiré », qui est calculé. */
export const STATUTS_REPONSE_AO = [
    'Brouillon',
    'En cours',
    'Déposé',
    'Gagné',
    'Perdu'
] as const;
export type StatutReponseAo = typeof STATUTS_REPONSE_AO[number];

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** « Procédure adaptée » → « PROCEDURE_ADAPTEE » : majuscules, sans accents. */
const normaliser = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
};

/**
 * Libellés BOAMP et variantes courantes → valeurs de notre enum.
 *
 * Volontairement permissif : le BOAMP publie plusieurs graphies pour une même
 * procédure selon la version du schéma de l'avis (V110, V2xx, eForms depuis
 * 2024). Toute valeur inconnue retombe sur AUTRE plutôt que de faire échouer
 * l'import — un mode de passation approximatif est préférable à un AO perdu.
 */
const ALIAS_MODE_PASSATION: Record<string, ModePassation> = {
    OUVERT: 'OUVERT',
    APPEL_D_OFFRES_OUVERT: 'OUVERT',
    APPEL_OFFRES_OUVERT: 'OUVERT',
    AOO: 'OUVERT',

    RESTREINT: 'RESTREINT',
    APPEL_D_OFFRES_RESTREINT: 'RESTREINT',
    APPEL_OFFRES_RESTREINT: 'RESTREINT',
    AOR: 'RESTREINT',

    PROCEDURE_ADAPTE: 'PROCEDURE_ADAPTE',
    PROCEDURE_ADAPTEE: 'PROCEDURE_ADAPTE',
    ADAPTEE: 'PROCEDURE_ADAPTE',
    ADAPTE: 'PROCEDURE_ADAPTE',
    MAPA: 'PROCEDURE_ADAPTE',

    DIALOGUE_COMPETITIF: 'DIALOGUE_COMPETITIF',
    DIALOGUE: 'DIALOGUE_COMPETITIF',

    NEGOCIE: 'NEGOCIE',
    NEGOCIEE: 'NEGOCIE',
    PROCEDURE_NEGOCIEE: 'NEGOCIE',
    MARCHE_NEGOCIE: 'NEGOCIE',
    AVEC_NEGOCIATION: 'NEGOCIE',
    PROCEDURE_AVEC_NEGOCIATION: 'NEGOCIE',

    CONCOURS_OUVERT: 'CONCOURS_OUVERT',
    CONCOURS_RESTREINT: 'CONCOURS_RESTREINT',
    CONCOURS: 'CONCOURS_OUVERT',

    DSP: 'DSP',
    DELEGATION_DE_SERVICE_PUBLIC: 'DSP',
    DELEGATION_SERVICE_PUBLIC: 'DSP',
    CONCESSION: 'DSP',

    PARTENARIAT_INNOVATION: 'PARTENARIAT_INNOVATION',
    PARTENARIAT_D_INNOVATION: 'PARTENARIAT_INNOVATION',

    AUTRE: 'AUTRE',
    AUTRES: 'AUTRE'
};

// ---------------------------------------------------------------------------
// Coercition
// ---------------------------------------------------------------------------

/**
 * @returns une valeur toujours valide pour `mode_passation_enum`.
 *          Repli : `AUTRE`.
 */
export const coerceModePassation = (value: unknown): ModePassation => {
    const clef = normaliser(value);
    if (!clef) return 'AUTRE';
    if ((MODES_PASSATION as readonly string[]).includes(clef)) return clef as ModePassation;
    return ALIAS_MODE_PASSATION[clef] ?? 'AUTRE';
};

/**
 * @returns une valeur toujours valide pour `secteur_activite_enum`.
 *          Repli : `Autres`.
 */
export const coerceSecteurActivite = (value: unknown): SecteurActivite => {
    if (typeof value === 'string' && (SECTEURS_ACTIVITE as readonly string[]).includes(value)) {
        return value as SecteurActivite;
    }
    // Comparaison normalisée pour absorber les différences de casse et
    // d'accents (« Santé_Pharmaceutique » vs « Sante_Pharmaceutique »).
    const clef = normaliser(value);
    const trouve = SECTEURS_ACTIVITE.find(s => normaliser(s) === clef);
    return trouve ?? 'Autres';
};

/**
 * @returns une valeur toujours valide pour `reponse_ao_statuts`.
 *          Repli : `Brouillon`.
 */
export const coerceStatut = (value: unknown): StatutReponseAo => {
    if (typeof value === 'string' && (STATUTS_REPONSE_AO as readonly string[]).includes(value)) {
        return value as StatutReponseAo;
    }
    const clef = normaliser(value);
    const trouve = STATUTS_REPONSE_AO.find(s => normaliser(s) === clef);
    return trouve ?? 'Brouillon';
};

// ---------------------------------------------------------------------------
// Validation des champs NOT NULL
// ---------------------------------------------------------------------------

/**
 * Champs `NOT NULL` de `reponses_ao` que l'utilisateur doit renseigner.
 * Les coercer par défaut serait pire que de bloquer : on écrirait une donnée
 * inventée sans que personne ne le sache.
 */
export interface ChampsObligatoires {
    titre?: string;
    organisme_acheteur?: string;
    date_limite?: string;
    type_marche?: string[];
    lieu_execution?: string[];
    mode_passation?: string;
    secteur_activite?: string;
}

/** @returns les libellés des champs obligatoires non renseignés. */
export const champsManquants = (data: ChampsObligatoires): string[] => {
    const manquants: string[] = [];
    if (!data.titre?.trim()) manquants.push('Titre');
    if (!data.organisme_acheteur?.trim()) manquants.push('Organisme acheteur');
    if (!data.date_limite) manquants.push('Date limite');
    if (!data.type_marche?.length) manquants.push('Type de marché');
    if (!data.lieu_execution?.length) manquants.push("Lieu d'exécution");
    if (!data.mode_passation) manquants.push('Mode de passation');
    if (!data.secteur_activite) manquants.push("Secteur d'activité");
    return manquants;
};

/**
 * Traduit une erreur PostgreSQL en message lisible.
 *
 * Les échecs d'enum et de NOT NULL se présentaient jusqu'ici comme un
 * « Erreur lors de l'initialisation du dossier. (Voir console) » indifférencié,
 * qui n'indiquait à l'utilisateur ni la cause ni le champ concerné.
 */
export const messageErreurBase = (error: any): string | null => {
    const brut: string = error?.message || '';

    // 22P02 — invalid input value for enum …: ""
    if (error?.code === '22P02' || /invalid input value for enum/i.test(brut)) {
        if (/mode_passation/i.test(brut)) return "Le mode de passation n'est pas reconnu.";
        if (/secteur_activite/i.test(brut)) return "Le secteur d'activité n'est pas reconnu.";
        if (/statut/i.test(brut)) return "Le statut du dossier n'est pas reconnu.";
        return 'Une valeur du formulaire ne fait pas partie des choix autorisés.';
    }

    // 23502 — null value in column "x" violates not-null constraint
    if (error?.code === '23502') {
        const colonne = brut.match(/column "([^"]+)"/)?.[1];
        const libelles: Record<string, string> = {
            date_limite: 'la date limite',
            montant_estime: 'le montant estimé',
            type_marche: 'le type de marché',
            lieu_execution: "le lieu d'exécution",
            titre: 'le titre',
            organisme_acheteur: "l'organisme acheteur"
        };
        const libelle = colonne ? libelles[colonne] ?? `« ${colonne} »` : 'un champ obligatoire';
        return `Il manque ${libelle} pour enregistrer le dossier.`;
    }

    return null;
};