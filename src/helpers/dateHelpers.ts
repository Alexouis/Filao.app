/**
 * Date du jour au format `yyyy-MM-dd`, dans le fuseau de l'utilisateur.
 *
 * `new Date().toISOString().slice(0, 10)` donne la date UTC : en France, entre
 * minuit et 1 h (2 h l'été), c'est la VEILLE. Anodin pour un nom de fichier,
 * faux pour une date d'émission d'attestation, dont dépend sa validité.
 */
export const dateLocaleISO = (d: Date = new Date()): string => {
    const mois = String(d.getMonth() + 1).padStart(2, '0');
    const jour = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mois}-${jour}`;
};
