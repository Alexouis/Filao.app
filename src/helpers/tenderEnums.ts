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
// Déduction du secteur depuis les codes CPV
// ---------------------------------------------------------------------------

/**
 * Division CPV (2 premiers chiffres) → secteur d'activité Filao.
 *
 * ⚠️ Correspondance heuristique. La nomenclature CPV compte 45 divisions et ne
 * s'aligne pas sur nos 8 secteurs : certaines divisions sont transverses
 * (79 « services aux entreprises » couvre du juridique comme du marketing) et
 * d'autres pourraient légitimement tomber dans deux secteurs — 71
 * (architecture, ingénierie) est ici rattaché au BTP parce que c'est son usage
 * dominant en marché public, mais couvre aussi de l'ingénierie industrielle.
 *
 * À faire valider côté produit ; le but est de proposer mieux que « Autres »
 * par défaut, pas d'être exact à tous les coups. L'utilisateur peut corriger.
 */
const DIVISION_CPV_VERS_SECTEUR: Record<string, SecteurActivite> = {
    // Travaux, matériaux, ingénierie de construction
    '44': 'BTP_Construction',
    '45': 'BTP_Construction',
    '71': 'BTP_Construction',

    // Informatique, logiciels, télécoms
    '30': 'Informatique_Digital',
    '32': 'Informatique_Digital',
    '48': 'Informatique_Digital',
    '72': 'Informatique_Digital',

    // Transport et logistique
    '34': 'Transport_Logistique',
    '60': 'Transport_Logistique',
    '63': 'Transport_Logistique',

    // Santé et pharmacie
    '33': 'Sante_Pharmaceutique',
    '85': 'Sante_Pharmaceutique',

    // Énergie, eau, déchets, espaces naturels
    '09': 'Energie_Environnement',
    '65': 'Energie_Environnement',
    '77': 'Energie_Environnement',
    '90': 'Energie_Environnement',

    // Industrie et équipements
    '14': 'Industrie',
    '16': 'Industrie',
    '18': 'Industrie',
    '19': 'Industrie',
    '24': 'Industrie',
    '31': 'Industrie',
    '38': 'Industrie',
    '39': 'Industrie',
    '42': 'Industrie',
    '43': 'Industrie',

    // Services aux entreprises et aux collectivités
    '50': 'Services_Entreprises',
    '51': 'Services_Entreprises',
    '55': 'Services_Entreprises',
    '66': 'Services_Entreprises',
    '75': 'Services_Entreprises',
    '79': 'Services_Entreprises',
    '80': 'Services_Entreprises',
    '92': 'Services_Entreprises',
    '98': 'Services_Entreprises'
};

/**
 * Déduit un secteur d'activité à partir des codes CPV d'un avis.
 *
 * Le secteur retenu est celui de la division la plus représentée. À égalité,
 * l'ordre des codes tranche : `extractCpvCodes` place le CPV du marché avant
 * ceux des lots, et le CPV du marché est le plus général.
 *
 * @returns null si aucune division ne correspond — l'appelant décide alors du
 *          repli, plutôt que de recevoir « Autres » sans savoir si c'est une
 *          déduction ou un échec.
 */
export const deduireSecteurDepuisCpv = (codes: string[] | undefined | null): SecteurActivite | null => {
    if (!codes?.length) return null;

    const comptes = new Map<SecteurActivite, number>();
    let premier: SecteurActivite | null = null;

    for (const code of codes) {
        const secteur = DIVISION_CPV_VERS_SECTEUR[String(code).slice(0, 2)];
        if (!secteur) continue;
        if (!premier) premier = secteur;
        comptes.set(secteur, (comptes.get(secteur) ?? 0) + 1);
    }

    if (comptes.size === 0) return null;

    let meilleur = premier as SecteurActivite;
    let meilleurCompte = comptes.get(meilleur) ?? 0;
    for (const [secteur, compte] of comptes) {
        if (compte > meilleurCompte) {
            meilleur = secteur;
            meilleurCompte = compte;
        }
    }
    return meilleur;
};

// ---------------------------------------------------------------------------
// Suggestion de domaines de compétences depuis les CPV
// ---------------------------------------------------------------------------

/**
 * Division CPV → identifiants `ref_domains`, du plus au moins probable.
 *
 * Sert à ordonner le sélecteur de spécialités, pas à présélectionner : un CPV
 * indique l'objet du marché, jamais les compétences précises attendues. La
 * décision reste à l'utilisateur ; on se contente de lui éviter de parcourir
 * 201 spécialités pour en trouver trois.
 *
 * Les identifiants doivent rester alignés sur le seed de la migration 025.
 */
const DIVISION_CPV_VERS_DOMAINES: Record<string, string[]> = {
    '03': ['DOM-17', 'DOM-07'],
    '09': ['DOM-19'],
    '14': ['DOM-17'],
    '15': ['DOM-18'],
    '16': ['DOM-17', 'DOM-07'],
    '18': ['DOM-17'],
    '19': ['DOM-17'],
    '22': ['DOM-12', 'DOM-17'],
    '24': ['DOM-17'],
    '30': ['DOM-10', 'DOM-17'],
    '31': ['DOM-04', 'DOM-17'],
    '32': ['DOM-10', 'DOM-15'],
    '33': ['DOM-20', 'DOM-17'],
    '34': ['DOM-16', 'DOM-17'],
    '35': ['DOM-15'],
    '37': ['DOM-17'],
    '38': ['DOM-17', 'DOM-09'],
    '39': ['DOM-17'],
    '41': ['DOM-19'],
    '42': ['DOM-17'],
    '43': ['DOM-17', 'DOM-05'],
    '44': ['DOM-17', 'DOM-01', 'DOM-02'],
    '45': ['DOM-01', 'DOM-02', 'DOM-05', 'DOM-03', 'DOM-04', 'DOM-06'],
    '48': ['DOM-10'],
    '50': ['DOM-14', 'DOM-03', 'DOM-04'],
    '51': ['DOM-03', 'DOM-04', 'DOM-17'],
    '55': ['DOM-18'],
    '60': ['DOM-16'],
    '63': ['DOM-16'],
    '64': ['DOM-10'],
    '65': ['DOM-19'],
    '66': ['DOM-11'],
    '70': ['DOM-11'],
    '71': ['DOM-08', 'DOM-09'],
    '72': ['DOM-10'],
    '73': ['DOM-09'],
    '75': ['DOM-11'],
    '76': ['DOM-19'],
    '77': ['DOM-07'],
    '79': ['DOM-11', 'DOM-12', 'DOM-15'],
    '80': ['DOM-13'],
    '85': ['DOM-20'],
    '90': ['DOM-19', 'DOM-06'],
    '92': ['DOM-12'],
    '98': ['DOM-14']
};

/**
 * Domaines `ref_domains` suggérés par les CPV d'un avis, sans doublon et par
 * pertinence décroissante.
 *
 * @returns tableau vide si aucun CPV ne correspond — l'ordre d'affichage
 *          existant s'applique alors sans changement.
 */
export const suggererDomainesDepuisCpv = (codes: string[] | undefined | null): string[] => {
    if (!codes?.length) return [];
    const scores = new Map<string, number>();
    const premiereApparition = new Map<string, number>();
    let rangGlobal = 0;

    codes.forEach(code => {
        const domaines = DIVISION_CPV_VERS_DOMAINES[String(code).slice(0, 2)];
        if (!domaines) return;
        domaines.forEach((id, rang) => {
            // Poids décroissant en 1/(rang+1) : le domaine de tête d'une
            // division vaut toujours 1, quelle que soit la longueur de sa liste.
            // Une pondération en (longueur - rang) faisait au contraire gagner
            // les divisions les plus détaillées — « 50 réparation » passait
            // devant « 34 véhicules » sur un marché de véhicules.
            scores.set(id, (scores.get(id) ?? 0) + 1 / (rang + 1));
            if (!premiereApparition.has(id)) premiereApparition.set(id, rangGlobal++);
        });
    });

    return [...scores.entries()]
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            // À égalité, l'ordre des CPV tranche : extractCpvCodes place le CPV
            // du marché avant ceux des lots.
            return (premiereApparition.get(a[0]) ?? 0) - (premiereApparition.get(b[0]) ?? 0);
        })
        .map(([id]) => id);
};

// ---------------------------------------------------------------------------
// Normalisation des colonnes tableau
// ---------------------------------------------------------------------------

/**
 * `type_marche` et `lieu_execution` sont des colonnes ARRAY NOT NULL. Une valeur
 * scalaire ou nulle venue du BOAMP ferait échouer l'écriture ; on normalise.
 */
export const versTableau = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.map(v => String(v)).filter(v => v.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
    return [];
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