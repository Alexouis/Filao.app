/**
 * Génération du rétroplanning d'un appel d'offres.
 *
 * DÉFAUT CORRIGÉ
 * L'implémentation précédente répartissait les jalons **en avant depuis
 * `date_publication`** :
 *
 *     const dp = new Date(formData.date_publication);
 *     const dq = new Date(dp.getTime() + diff * 0.3);
 *
 * Or `date_publication` vient de l'avis BOAMP et peut dater de plusieurs
 * semaines. Sur un AO créé le 27/07 et publié le 14/06, « Retrait du DCE »
 * tombait au 14/06 et « Deadline questions » au 08/07 — deux jalons déjà passés
 * à la création du dossier.
 *
 * Le ticket de recette attribue le défaut à un « calcul en rétro depuis la date
 * limite ». C'est l'inverse : le calcul partait de la date de publication. La
 * distinction compte, car un simple `max(aujourd'hui, date calculée)` — le
 * correctif proposé — écraserait tous les jalons passés sur la date du jour,
 * produisant trois jalons le même jour au lieu d'un planning.
 *
 * PRINCIPE RETENU
 * Le point de départ est `max(date_publication, aujourd'hui)` : on ne planifie
 * pas dans le passé. Les jalons sont ensuite répartis sur le temps **restant**,
 * en conservant les proportions de la fiche (30 % / 60 %). Quand le temps
 * manque, les jalons sont resserrés puis marqués comme non tenables, plutôt
 * que datés dans le passé.
 */

export interface Jalon {
    label: string;
    /** Format ISO court `yyyy-MM-dd`, celui attendu par les <input type="date">. */
    date: string;
    color: string;
    source: string;
    editable: boolean;
    /** Un jalon obligatoire ne peut pas être supprimé. */
    obligatoire?: boolean;
    /** Suivi d'avancement. Sans ce champ, une date passée était affichée comme faite. */
    statut?: 'a_faire' | 'fait';
    /** Responsable désigné, laissé au créateur du dossier. */
    responsable?: string;
    /**
     * Vrai si le jalon ne tient pas dans le temps restant : il a fallu le poser
     * au plus tôt possible plutôt qu'à sa place théorique. À signaler à l'écran.
     */
    non_tenable?: boolean;
}

const JOUR_MS = 24 * 60 * 60 * 1000;

/** `yyyy-MM-dd` en heure locale — `toISOString()` décalerait d'un jour à l'ouest de Greenwich. */
const versISO = (d: Date): string => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Minuit local, pour raisonner en jours pleins sans dérive horaire. */
const aMinuit = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const ajouterJours = (d: Date, n: number): Date => new Date(d.getTime() + n * JOUR_MS);

const parseDate = (valeur: string | Date | undefined | null): Date | null => {
    if (!valeur) return null;
    const d = valeur instanceof Date ? valeur : new Date(valeur);
    return Number.isNaN(d.getTime()) ? null : aMinuit(d);
};

/**
 * Modèle du rétroplanning. Les ratios s'appliquent au temps restant, pas à la
 * durée totale de la consultation.
 *
 * « Deadline questions » figurait déjà dans l'implémentation d'origine, contrairement
 * à ce que laisse entendre la fiche qui le présente comme un ajout.
 */
const MODELE: { label: string; ratio: number; color: string; source: string; editable: boolean; obligatoire?: boolean }[] = [
    { label: 'Retrait du DCE', ratio: 0, color: '#1D9E75', source: 'Automatique', editable: false, obligatoire: true },
    { label: 'Deadline questions', ratio: 0.30, color: '#EF9F27', source: 'Extrait du RC', editable: true },
    { label: 'Consolidation interne', ratio: 0.60, color: '#0B8FAC', source: 'Suggestion FILAO', editable: true },
    { label: 'Dépôt souhaité', ratio: 0.85, color: '#0B8FAC', source: 'Modifiable', editable: true },
    { label: 'Date limite de dépôt', ratio: 1, color: '#D85A30', source: 'Officielle', editable: false, obligatoire: true }
];

export interface EntreesJalons {
    date_publication?: string | Date | null;
    date_limite?: string | Date | null;
    date_depot_souhaitee?: string | Date | null;
}

/**
 * @param entrees dates du dossier.
 * @param maintenant injectable pour les tests ; par défaut la date du jour.
 * @returns les jalons triés par date croissante.
 *
 * Cas limites traités explicitement :
 *  - date limite absente → fenêtre par défaut de 21 jours à partir d'aujourd'hui ;
 *  - date limite dépassée ou aujourd'hui → seuls les deux jalons obligatoires
 *    sont produits, marqués non tenables : un rétroplanning n'a plus de sens ;
 *  - fenêtre courte (quelques jours) → jalons resserrés à un jour d'intervalle,
 *    et ceux qui ne rentrent pas sont marqués `non_tenable` plutôt que reculés
 *    dans le passé.
 */
export const genererJalons = (entrees: EntreesJalons, maintenant: Date = new Date()): Jalon[] => {
    const aujourdhui = aMinuit(maintenant);
    const publication = parseDate(entrees.date_publication);

    // On ne planifie jamais avant aujourd'hui : c'est tout le correctif.
    const debut = publication && publication > aujourdhui ? publication : aujourdhui;

    const limite = parseDate(entrees.date_limite) ?? ajouterJours(debut, 21);
    const joursRestants = Math.round((limite.getTime() - debut.getTime()) / JOUR_MS);

    // Dossier déjà clos, ou clos aujourd'hui : les jalons intermédiaires
    // n'auraient aucun sens, on ne conserve que le strict nécessaire.
    if (joursRestants <= 0) {
        // Le retrait du DCE a bien eu lieu dans le passé : le dater
        // d'aujourd'hui le placerait après la date limite.
        const retrait = publication && publication < limite ? publication : limite;
        // `ratio` ne fait pas partie de Jalon : on ne reprend que les champs utiles.
        const minimal = (m: typeof MODELE[number], date: Date): Jalon => ({
            label: m.label, date: versISO(date), color: m.color, source: m.source,
            editable: m.editable, obligatoire: m.obligatoire,
            statut: 'a_faire', non_tenable: true
        });
        return [minimal(MODELE[0], retrait), minimal(MODELE[4], limite)]
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    const souhaite = parseDate(entrees.date_depot_souhaitee);
    let dernierOffset = -1;

    const jalons = MODELE.map((m, i) => {
        let offset: number;

        if (m.label === 'Dépôt souhaité' && souhaite) {
            // La date saisie prime, sans jamais dépasser la date limite.
            offset = Math.round((souhaite.getTime() - debut.getTime()) / JOUR_MS);
            offset = Math.min(Math.max(offset, 0), joursRestants);
        } else {
            offset = Math.round(m.ratio * joursRestants);
        }

        // Ordre strict : chaque jalon tombe au moins un jour après le précédent,
        // tant que la date limite le permet.
        const minimum = dernierOffset + 1;
        let effectif = Math.max(offset, minimum);

        // Le dernier jalon est la date limite : elle ne bouge pas.
        const estDernier = i === MODELE.length - 1;
        if (estDernier) effectif = joursRestants;

        // Fenêtre trop courte pour espacer : le jalon est posé au plus tard
        // possible et signalé, plutôt que d'être daté avant aujourd'hui.
        const nonTenable = !estDernier && effectif >= joursRestants;
        if (nonTenable) effectif = joursRestants;

        dernierOffset = effectif;

        return {
            label: m.label,
            date: versISO(ajouterJours(debut, effectif)),
            color: m.color,
            source: m.source,
            editable: m.editable,
            obligatoire: m.obligatoire,
            statut: 'a_faire' as const,
            ...(nonTenable ? { non_tenable: true } : {})
        };
    });

    return jalons.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * @returns vrai si le jalon est en retard : sa date est passée alors qu'il
 *          n'est pas marqué fait.
 *
 * L'affichage confondait jusqu'ici « date passée » et « réalisé » — un jalon
 * daté d'hier s'affichait en vert avec une coche, ce qui masquait tout retard.
 */
export const estEnRetard = (jalon: Jalon, maintenant: Date = new Date()): boolean =>
    jalon.statut !== 'fait' && parseDate(jalon.date)! < aMinuit(maintenant);