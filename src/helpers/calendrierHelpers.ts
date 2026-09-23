/**
 * Règles de navigation du calendrier, isolées pour être testées.
 */
export type VueCalendrier = 'month' | 'week' | 'quarter';

/** Lundi de la semaine de `d` — un dimanche appartient à la semaine qui finit. */
export const lundiDe = (d: Date): Date => {
    const l = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    l.setDate(l.getDate() - ((l.getDay() + 6) % 7));
    return l;
};

/** « 21 sept. – 27 sept. 2026 » : la plage exacte de la semaine affichée. */
export const libelleSemaine = (d: Date): string => {
    const debut = lundiDe(d);
    const fin = new Date(debut);
    fin.setDate(debut.getDate() + 6);
    const jourMois = (x: Date) => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return `${jourMois(debut)} – ${jourMois(fin)} ${fin.getFullYear()}`;
};

/** Premier mois (0-11) du trimestre CIVIL contenant `d`. */
export const premierMoisTrimestre = (d: Date): number => Math.floor(d.getMonth() / 3) * 3;

/** Date affichée après navigation (±1 pas) dans la vue donnée. */
export const decaler = (vue: VueCalendrier, d: Date, sens: 1 | -1): Date => {
    if (vue === 'month') return new Date(d.getFullYear(), d.getMonth() + sens, 1);
    if (vue === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * sens);
    return new Date(d.getFullYear(), premierMoisTrimestre(d) + 3 * sens, 1);
};

/**
 * Date d'ancrage lors d'un changement de vue. La navigation par mois cale la
 * date sur le 1er : passer ensuite en vue Semaine montrait la PREMIÈRE semaine
 * du mois. Si la période affichée contient aujourd'hui, on s'y ancre.
 */
export const ancrageChangementVue = (
    vueCible: VueCalendrier, vueActuelle: VueCalendrier, affichee: Date, aujourdhui: Date = new Date(),
): Date => {
    if (vueCible !== 'week') return affichee;
    const memeAnnee = affichee.getFullYear() === aujourdhui.getFullYear();
    const contientAujourdhui = vueActuelle === 'quarter'
        ? memeAnnee && premierMoisTrimestre(affichee) === premierMoisTrimestre(aujourdhui)
        : vueActuelle === 'month'
            ? memeAnnee && affichee.getMonth() === aujourdhui.getMonth()
            : false;
    return contientAujourdhui ? aujourdhui : affichee;
};
