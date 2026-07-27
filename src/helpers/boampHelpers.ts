/**
 * Parsing du payload BOAMP (OpenDataSoft, dataset `boamp`).
 *
 * Deux champs de la réponse API — `donnees` et `gestion` — sont des **chaînes**
 * contenant du JSON, elles-mêmes issues d'une conversion XML → JSON du schéma
 * Boamp_v2xx.xsd. Cette origine XML explique les irrégularités traitées ici :
 *
 *  - un élément présent une seule fois est un objet, présent N fois il devient
 *    un tableau (jamais un tableau de taille 1) ;
 *  - les attributs XML sont préfixés `@` (`@POIDS`, `@ORDRE`) et le contenu
 *    textuel est sous la clé `#text` ;
 *  - un élément vide devient `""` et non `null`.
 *
 * Toutes les fonctions de ce module sont pures et tolérantes : elles ne lèvent
 * jamais et retournent une valeur vide si la structure ne correspond pas.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CpvCode {
    /** Code CPV à 8 chiffres, ex. "45213000". */
    code: string;
    /** Code supplémentaire éventuel (nomenclature complémentaire), ex. "LA17". */
    supplementaire?: string;
}

/**
 * Forme des critères d'attribution telle que publiée par l'acheteur.
 *
 *  - `ponderes`  : chaque critère porte un poids exploitable ;
 *  - `priorites` : critères classés par ordre d'importance, sans poids ;
 *  - `libre`     : un texte libre non structuré ;
 *  - `cctp`      : l'acheteur renvoie au CCTP / règlement de consultation ;
 *  - `absent`    : rien de publié.
 */
export type CriteresAttributionKind = 'ponderes' | 'priorites' | 'libre' | 'cctp' | 'absent';

export interface CritereAttribution {
    libelle: string;
    /**
     * Poids brut tel que publié. ⚠️ Ce n'est PAS toujours un pourcentage :
     * certains acheteurs publient des coefficients (ex. 2 / 2 / 5 / 1).
     * Voir `poidsSontDesPourcentages`.
     */
    poids?: number;
    /** Rang d'importance, pour la forme `priorites`. */
    ordre?: number;
}

export interface CriteresAttribution {
    kind: CriteresAttributionKind;
    criteres: CritereAttribution[];
    /** Texte brut, pour les formes `libre` et `cctp`. */
    texte?: string;
    /**
     * Vrai si les poids somment à 100 (±0.5) — auquel cas ils peuvent être
     * affichés tels quels en pourcentage. Sinon ce sont des coefficients et il
     * faut normaliser avant tout affichage en %.
     */
    poidsSontDesPourcentages: boolean;
    /**
     * Origine de la donnée. Permet de ne pas écraser une saisie manuelle par un
     * réimport, et d'indiquer à l'utilisateur ce qui vient de l'avis.
     */
    source?: 'boamp' | 'manuel';
}

// ---------------------------------------------------------------------------
// Utilitaires internes
// ---------------------------------------------------------------------------

/** Normalise objet | tableau | absent → tableau, sans jamais lever. */
const toArray = <T>(value: T | T[] | null | undefined): T[] => {
    if (value === null || value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
};

/**
 * `donnees` et `gestion` arrivent sous forme de chaîne JSON. Certaines annonces
 * anciennes les renvoient déjà désérialisés — on accepte les deux.
 */
const safeParse = (raw: unknown): any => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

/** "80" | 80 | " 80 % " → 80 ; tout le reste → undefined. */
const toNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;
    const parsed = parseFloat(value.replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
};

const cleanLabel = (value: unknown): string =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

// ---------------------------------------------------------------------------
// eForms — avis publiés depuis le 31 janvier 2024
// ---------------------------------------------------------------------------

/**
 * Depuis le 31/01/2024, la réglementation européenne impose le format eForms.
 * Le champ `donnees` contient alors un arbre UBL (`{"EFORMS": {"ContractNotice": …}}`)
 * au lieu du schéma français `Boamp_v2xx`, et `source_schema` vaut « 3.2.5 »
 * plutôt que « Boamp_v230.xsd ».
 *
 * Les deux formats coexistent dans le jeu de données : les 1,6 million d'avis
 * antérieurs restent en Boamp_v2xx. Il faut donc les deux parsers, choisis
 * d'après la forme réelle de `donnees` — pas d'après une date, qui ne dirait
 * rien des avis rectificatifs ou des reprises d'antériorité.
 *
 * Conventions UBL rencontrées :
 *  - une valeur textuelle est `{"@languageID": "FRA", "#text": "…"}` ou une
 *    chaîne nue selon les éléments ;
 *  - un élément présent une fois est un objet, présent N fois un tableau
 *    (même irrégularité que le XML français) ;
 *  - les préfixes de namespace (`cac:`, `cbc:`, `efac:`, `efbc:`) font partie
 *    des clés JSON et ne peuvent pas être ignorés.
 */

/** Extrait le contenu textuel d'un nœud UBL, quelle que soit sa forme. */
const ublTexte = (node: any): string => {
    if (typeof node === 'string') return node.trim();
    if (node && typeof node === 'object') return cleanLabel(node['#text']);
    return '';
};

/** Racine `ContractNotice`, ou null si l'avis n'est pas au format eForms. */
const racineEforms = (boampRecord: any): any => {
    const donnees = safeParse(boampRecord?.donnees);
    const eforms = donnees?.EFORMS;
    if (!eforms || typeof eforms !== 'object') return null;
    // Selon le type d'avis : ContractNotice, ContractAwardNotice, PriorInformationNotice…
    return eforms.ContractNotice ?? eforms.ContractAwardNotice ?? eforms.PriorInformationNotice
        ?? Object.values(eforms)[0] ?? null;
};

/** Les lots, normalisés en tableau (l'élément est un objet quand il est unique). */
const lotsEforms = (racine: any): any[] => toArray<any>(racine?.['cac:ProcurementProjectLot']);

/** Codes CPV portés par un nœud `cac:ProcurementProject`. */
const cpvDUnProjet = (projet: any): string[] => {
    const codes: string[] = [];
    for (const clef of ['cac:MainCommodityClassification', 'cac:AdditionalCommodityClassification']) {
        for (const classification of toArray<any>(projet?.[clef])) {
            for (const item of toArray<any>(classification?.['cbc:ItemClassificationCode'])) {
                // `@listName` vaut "cpv" ; d'autres nomenclatures peuvent
                // apparaître dans ce même élément, on ne prend que le CPV.
                const listName = typeof item === 'object' ? item?.['@listName'] : null;
                if (listName && listName !== 'cpv') continue;
                const code = ublTexte(item);
                if (/^\d{8}$/.test(code)) codes.push(code);
            }
        }
    }
    return codes;
};

const extractCpvCodesEforms = (racine: any): CpvCode[] => {
    // Le CPV du marché d'abord, puis ceux des lots : `deduireSecteurDepuisCpv`
    // s'appuie sur cet ordre pour départager les ex æquo.
    const bruts = [
        ...cpvDUnProjet(racine?.['cac:ProcurementProject']),
        ...lotsEforms(racine).flatMap(lot => cpvDUnProjet(lot?.['cac:ProcurementProject']))
    ];
    const vus = new Set<string>();
    return bruts.filter(c => !vus.has(c) && vus.add(c)).map(code => ({ code }));
};

/**
 * Référence du marché côté acheteur.
 *
 * `cbc:ContractFolderID` (et le champ `contractfolderid` de l'API) est un UUID
 * technique, sans valeur pour l'utilisateur. La référence lisible est
 * `ProcurementProject.cbc:ID` — « 254100 », « F-PF-1610605 » — parfois portée
 * seulement au niveau du lot.
 */
const extractReferenceEforms = (racine: any): string => {
    const auMarche = ublTexte(racine?.['cac:ProcurementProject']?.['cbc:ID']);
    if (auMarche) return auMarche;
    for (const lot of lotsEforms(racine)) {
        const id = lot?.['cac:ProcurementProject']?.['cbc:ID'];
        // Au niveau du lot, `cbc:ID` sert aussi bien de référence acheteur
        // (« F-PF-1610605 ») que de simple libellé de lot (« Catégorie1 »).
        // Seul `@schemeName: "InternalID"` désigne la première.
        if (id?.['@schemeName'] !== 'InternalID') continue;
        const auLot = ublTexte(id);
        if (auLot) return auLot;
    }
    return '';
};

/**
 * Critères d'attribution eForms.
 *
 * Chemin : `ProcurementProjectLot[].cac:TenderingTerms.cac:AwardingTerms
 *           .cac:AwardingCriterion.cac:SubordinateAwardingCriterion`
 *
 * Chaque critère porte un `cbc:AwardingCriterionTypeCode` (quality / cost /
 * price) et un libellé. Les pondérations, quand elles sont publiées, vivent
 * dans l'extension `efac:AwardCriterionParameter`, dont le
 * `efbc:ParameterCode` de liste « number-weight » précise l'unité : pourcentage
 * exact, points, ou ordre d'importance. eForms lève donc l'ambiguïté que le
 * schéma français laissait entière — d'où le renseignement direct de
 * `poidsSontDesPourcentages` plutôt qu'une déduction par la somme.
 *
 * ⚠️ Aucun des avis inspectés ne publiait de pondération (tous renvoyaient au
 * règlement de consultation). Ce chemin suit la spécification eForms mais n'a
 * pas pu être vérifié sur un cas réel.
 */
const extractCriteresEforms = (racine: any): CriteresAttribution => {
    const criteres: CritereAttribution[] = [];
    let unitePourcentage: boolean | null = null;

    for (const lot of lotsEforms(racine)) {
        const critereRacine = lot?.['cac:TenderingTerms']?.['cac:AwardingTerms']?.['cac:AwardingCriterion'];
        for (const bloc of toArray<any>(critereRacine)) {
            for (const sous of toArray<any>(bloc?.['cac:SubordinateAwardingCriterion'])) {
                const libelle = ublTexte(sous?.['cbc:Name']) || ublTexte(sous?.['cbc:Description']);
                if (!libelle) continue;

                let poids: number | undefined;
                const params = sous?.['ext:UBLExtensions']?.['ext:UBLExtension']?.['ext:ExtensionContent']
                    ?.['efext:EformsExtension']?.['efac:AwardCriterionParameter'];
                for (const param of toArray<any>(params)) {
                    const liste = param?.['efbc:ParameterCode']?.['@listName'];
                    if (liste !== 'number-weight') continue;
                    poids = toNumber(param?.['efbc:ParameterNumeric']);
                    const unite = ublTexte(param?.['efbc:ParameterCode']);
                    if (unite) unitePourcentage = unite.startsWith('per-');
                }

                // Un même critère peut être répété à l'identique sur chaque lot.
                if (criteres.some(c => c.libelle === libelle && c.poids === poids)) continue;
                criteres.push(poids === undefined ? { libelle } : { libelle, poids });
            }
        }
    }

    if (criteres.length === 0) return EMPTY_CRITERES;

    const avecPoids = criteres.filter(c => typeof c.poids === 'number');
    if (avecPoids.length === 0) {
        // Critères annoncés sans chiffrage : très majoritairement un renvoi au
        // règlement de consultation. On conserve le texte plutôt que de le perdre.
        return {
            kind: 'libre',
            criteres: [],
            texte: criteres.map(c => c.libelle).join(' — '),
            poidsSontDesPourcentages: false,
            source: 'boamp'
        };
    }

    const total = avecPoids.reduce((s, c) => s + (c.poids as number), 0);
    return {
        kind: 'ponderes',
        criteres,
        // eForms déclare l'unité ; à défaut on retombe sur la même heuristique
        // que pour le schéma français.
        poidsSontDesPourcentages: unitePourcentage ?? Math.abs(total - 100) < 0.5,
        source: 'boamp'
    };
};

// ---------------------------------------------------------------------------
// CPV
// ---------------------------------------------------------------------------

/**
 * Extrait les codes CPV d'une annonce BOAMP.
 *
 * Emplacements pris en charge, dédoublonnés en préservant l'ordre :
 *  - `donnees.OBJET.CPV`            → CPV du marché
 *  - `donnees.OBJET.LOTS.LOT[].CPV` → CPV par lot (souvent plus précis)
 *
 * ⚠️ Ne pas confondre avec `descripteur_code` / `dc`, exposés à la racine de la
 * réponse API : ce sont les descripteurs BOAMP (codes numériques courts, ex.
 * "33" = Bâtiment), une nomenclature française distincte du CPV européen.
 */
export const extractCpvCodes = (boampRecord: any): CpvCode[] => {
    const eforms = racineEforms(boampRecord);
    if (eforms) return extractCpvCodesEforms(eforms);

    const donnees = safeParse(boampRecord?.donnees);
    if (!donnees?.OBJET) return [];

    const sources = [
        donnees.OBJET.CPV,
        ...toArray(donnees.OBJET.LOTS?.LOT).map((lot: any) => lot?.CPV)
    ];

    const result: CpvCode[] = [];
    const seen = new Set<string>();

    for (const source of sources) {
        for (const entry of toArray<any>(source)) {
            const code = cleanLabel(entry?.PRINCIPAL);
            // Un CPV valide est numérique et long de 8 chiffres (la clé de
            // contrôle n'est pas publiée par le BOAMP).
            if (!/^\d{8}$/.test(code) || seen.has(code)) continue;
            seen.add(code);
            const supplementaire = cleanLabel(entry?.SUPPLEMENTAIRE);
            result.push(supplementaire ? { code, supplementaire } : { code });
        }
    }

    return result;
};

/**
 * Division CPV = les 2 premiers chiffres, ex. "45213000" → "45".
 * Utile pour un regroupement grossier par famille de marché.
 */
export const cpvDivision = (code: string): string => code.slice(0, 2);

/** Formatte un CPV pour l'affichage : "45213000" → "45213000-3" n'est pas */
/** calculable (clé non publiée), on affiche donc le code brut groupé. */
export const formatCpv = (code: string): string =>
    /^\d{8}$/.test(code) ? `${code.slice(0, 2)} ${code.slice(2, 5)} ${code.slice(5)}` : code;

// ---------------------------------------------------------------------------
// Critères d'attribution
// ---------------------------------------------------------------------------

const EMPTY_CRITERES: CriteresAttribution = {
    kind: 'absent',
    criteres: [],
    poidsSontDesPourcentages: false
};

/**
 * Extrait les critères d'attribution d'une annonce BOAMP.
 *
 * Les quatre formes publiées par les acheteurs sont mutuellement exclusives
 * dans `donnees.PROCEDURE.CRITERES_ATTRIBUTION` :
 *
 *   CRITERES_PONDERES  { CRITERE: [{ "@POIDS": "80", "#text": "Prix" }] }
 *   CRITERES_PRIORITES { CRITERE: [{ "@ORDRE": "1", "#text": "Prix" }] }
 *   CRITERES_LIBRE     "texte libre"
 *   CRITERES_CCTP      ""      → renvoi au CCTP, rien d'exploitable
 */
export const extractCriteresAttribution = (boampRecord: any): CriteresAttribution => {
    const eforms = racineEforms(boampRecord);
    if (eforms) return extractCriteresEforms(eforms);

    const donnees = safeParse(boampRecord?.donnees);
    const node = donnees?.PROCEDURE?.CRITERES_ATTRIBUTION;
    if (!node || typeof node !== 'object') return EMPTY_CRITERES;

    // 1. Critères pondérés — la seule forme directement exploitable en jauge.
    if (node.CRITERES_PONDERES) {
        const criteres = toArray<any>(node.CRITERES_PONDERES.CRITERE)
            .map(c => ({ libelle: cleanLabel(c?.['#text']), poids: toNumber(c?.['@POIDS']) }))
            .filter(c => c.libelle.length > 0);

        if (criteres.length === 0) return EMPTY_CRITERES;

        const total = criteres.reduce((sum, c) => sum + (c.poids ?? 0), 0);
        return {
            kind: 'ponderes',
            criteres,
            source: 'boamp',
            // Beaucoup d'acheteurs publient des coefficients (2/2/5/1) et non
            // des pourcentages : on ne présume donc jamais d'un total de 100.
            poidsSontDesPourcentages: Math.abs(total - 100) < 0.5
        };
    }

    // 2. Critères classés par ordre de priorité, sans pondération.
    if (node.CRITERES_PRIORITES) {
        const criteres = toArray<any>(node.CRITERES_PRIORITES.CRITERE)
            .map((c, i) => ({
                libelle: cleanLabel(c?.['#text']),
                ordre: toNumber(c?.['@ORDRE']) ?? i + 1
            }))
            .filter(c => c.libelle.length > 0)
            .sort((a, b) => a.ordre - b.ordre);

        if (criteres.length === 0) return EMPTY_CRITERES;
        return { kind: 'priorites', criteres, poidsSontDesPourcentages: false, source: 'boamp' };
    }

    // 3. Texte libre.
    const libre = cleanLabel(node.CRITERES_LIBRE);
    if (libre) {
        return { kind: 'libre', criteres: [], texte: libre, poidsSontDesPourcentages: false, source: 'boamp' };
    }

    // 4. Renvoi au CCTP / règlement de consultation. La clé est présente mais
    //    vide : c'est une information en soi (« à chercher dans le DCE »), à
    //    distinguer d'une absence totale de publication.
    if ('CRITERES_CCTP' in node) {
        return { kind: 'cctp', criteres: [], poidsSontDesPourcentages: false, source: 'boamp' };
    }

    return EMPTY_CRITERES;
};

/**
 * Convertit des poids bruts en pourcentages sommant à 100, pour l'affichage
 * d'une barre segmentée. Retourne un tableau vide si aucun poids exploitable.
 */
export const normaliserPoids = (criteres: CritereAttribution[]): { libelle: string; pourcentage: number }[] => {
    const avecPoids = criteres.filter(c => typeof c.poids === 'number' && c.poids > 0);
    const total = avecPoids.reduce((sum, c) => sum + (c.poids as number), 0);
    if (total <= 0) return [];
    return avecPoids.map(c => ({
        libelle: c.libelle,
        pourcentage: Math.round(((c.poids as number) / total) * 1000) / 10
    }));
};

/**
 * Référence du marché attribuée par l'acheteur (ex. "AOO 15-02").
 * C'est la référence métier attendue par les utilisateurs — à ne pas confondre
 * avec l'UUID technique de la réponse dans Filao.
 */
export const extractReferenceMarche = (boampRecord: any): string => {
    const eforms = racineEforms(boampRecord);
    if (eforms) return extractReferenceEforms(eforms);

    const donnees = safeParse(boampRecord?.donnees);
    return cleanLabel(donnees?.CONDITION_ADMINISTRATIVE?.REFERENCE_MARCHE);
};