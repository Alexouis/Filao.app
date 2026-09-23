/**
 * Filtres de la page Réseau, isolés pour être testés.
 */

export interface TaxonomieBrute {
    natures: string[];
    domains: string[];
    specialties: string[];
    geo_zones: string[];
    expertise_tags: string[];
}

export interface Competences {
    domaines: Set<string>;
    specialites: Set<string>;
    tags: Set<string>;
    /** Libellés des zones d'intervention. */
    zones: string[];
}

export interface CriteresReseau {
    domaine: string;
    specialite: string;
    tag: string;
    zone: string;
}

export interface EntrepriseFiltrable {
    id: string;
    nom?: string;
    ville?: string | null;
}

/**
 * Compétences d'une entreprise complétées par la hiérarchie du référentiel :
 * une spécialité implique son domaine. Beaucoup d'entreprises renseignent
 * leurs spécialités sans cocher le domaine correspondant ; filtrer sur la
 * seule table `company_domains` les rendait invisibles.
 */
export const competencesDerivees = (
    taxonomies: Record<string, TaxonomieBrute>,
    refSpecialites: Array<{ id: string; domain_id: string }>,
    refZones: Array<{ id: string; label: string }>,
): Record<string, Competences> => {
    const domaineDeSpecialite = new Map(refSpecialites.map(sp => [sp.id, sp.domain_id]));
    const libelleZone = new Map(refZones.map(z => [z.id, z.label]));
    const res: Record<string, Competences> = {};
    Object.entries(taxonomies).forEach(([id, t]) => {
        const domaines = new Set<string>(t.domains);
        t.specialties.forEach(sid => {
            const d = domaineDeSpecialite.get(sid);
            if (d) domaines.add(d);
        });
        res[id] = {
            domaines,
            specialites: new Set(t.specialties),
            tags: new Set(t.expertise_tags),
            zones: t.geo_zones.map(zid => libelleZone.get(zid)).filter((l): l is string => !!l),
        };
    });
    return res;
};

/** L'entreprise satisfait-elle tous les critères renseignés ? */
export const correspondCriteres = (
    e: EntrepriseFiltrable, comp: Competences | undefined, crit: CriteresReseau,
): boolean => {
    if (crit.domaine && !comp?.domaines.has(crit.domaine)) return false;
    if (crit.specialite && !comp?.specialites.has(crit.specialite)) return false;
    if (crit.tag && !comp?.tags.has(crit.tag)) return false;
    if (crit.zone) {
        const z = crit.zone.toLowerCase();
        const dansVille = !!e.ville && e.ville.toLowerCase() === z;
        const dansZone = !!comp?.zones.some(l => l.toLowerCase() === z);
        if (!dansVille && !dansZone) return false;
    }
    return true;
};

export interface OptionFiltre { id: string; label: string; n: number }

/**
 * Options d'un filtre : seulement les valeurs présentes dans `source`
 * (l'onglet actif), avec le nombre d'entreprises qu'elles donneraient compte
 * tenu des AUTRES critères. La valeur sélectionnée reste proposée même à zéro
 * — après un changement d'onglet, elle ne doit pas disparaître en silence.
 * Les « Autre… » du référentiel sont écartés des choix.
 */
export const optionsFiltre = (
    source: EntrepriseFiltrable[],
    competences: Record<string, Competences>,
    criteres: CriteresReseau,
    cle: keyof CriteresReseau,
    valeursDe: (e: EntrepriseFiltrable, comp: Competences | undefined) => string[],
    libelleDe: (id: string) => string | undefined,
): OptionFiltre[] => {
    const compte = new Map<string, number>();
    const autres: CriteresReseau = { ...criteres, [cle]: '' };
    source.forEach(e => {
        const comp = competences[e.id];
        if (!correspondCriteres(e, comp, autres)) return;
        new Set(valeursDe(e, comp)).forEach(v => compte.set(v, (compte.get(v) ?? 0) + 1));
    });
    const selection = criteres[cle];
    if (selection && !compte.has(selection)) compte.set(selection, 0);
    return [...compte]
        .map(([id, n]) => ({ id, n, label: libelleDe(id) ?? '' }))
        .filter(o => o.label && (o.id === selection || !/^autre/i.test(o.label)))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
};
