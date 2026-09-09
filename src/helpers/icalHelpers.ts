/**
 * Génération d'un flux iCalendar (RFC 5545) à partir des appels d'offres.
 *
 * Le calendrier Filao expose deux natures d'échéances : la date limite de
 * remise de chaque AO et les jalons de son rétroplanning. L'export reprend les
 * deux, de sorte qu'un abonnement iCal dans Outlook ou Google Agenda reflète ce
 * que l'utilisateur voit dans « Mon calendrier ».
 *
 * L'export est volontairement autonome : il ne dépend d'aucune synchronisation
 * Google et peut être livré avant elle (c'est l'attendu du ticket « livrer
 * l'export iCal avant toute synchronisation Google »).
 */

interface JalonLike {
    label?: string;
    date?: string;
    statut?: string;
}

interface TenderLike {
    id?: string;
    titre?: string;
    date_limite?: string | null;
    statut?: string;
    organisme_acheteur?: string;
    jalons?: JalonLike[] | null;
}

// Échappement des caractères réservés iCal dans un champ texte (RFC 5545 §3.3.11).
const escapeText = (value: string): string =>
    String(value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');

// Formate une date en UTC au format iCal `yyyyMMddTHHmmssZ`.
const toICalUtc = (date: Date): string =>
    date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Formate une date-seule (jalons sans heure) au format `yyyyMMdd`.
const toICalDate = (isoDay: string): string => isoDay.replace(/-/g, '');

// Découpe les lignes à 75 octets comme l'exige la RFC (repli avec espace).
const foldLine = (line: string): string => {
    if (line.length <= 75) return line;
    const chunks: string[] = [];
    let remaining = line;
    chunks.push(remaining.slice(0, 75));
    remaining = remaining.slice(75);
    while (remaining.length > 0) {
        chunks.push(' ' + remaining.slice(0, 74));
        remaining = remaining.slice(74);
    }
    return chunks.join('\r\n');
};

const DOSSIERS_CLOS = ['Déposé', 'Gagné', 'Perdu'];

/**
 * Construit le contenu texte d'un fichier `.ics` à partir d'une liste d'AO.
 * Un VEVENT par date limite et un VEVENT par jalon non terminé.
 */
export const buildICalendar = (
    tenders: TenderLike[],
    options: { includeClosed?: boolean } = {}
): string => {
    const now = toICalUtc(new Date());
    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Filao//Calendrier AO//FR',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Filao — Mes échéances',
    ];

    const active = (tenders || []).filter(
        t => options.includeClosed || !DOSSIERS_CLOS.includes(t?.statut || '')
    );

    for (const t of active) {
        const tenderTitle = t.titre || 'Appel d\'offres';

        // Date limite de remise → événement daté (avec heure si disponible).
        if (t.date_limite) {
            const dl = new Date(t.date_limite);
            if (!Number.isNaN(dl.getTime())) {
                lines.push('BEGIN:VEVENT');
                lines.push(`UID:filao-deadline-${t.id || tenderTitle}-${toICalUtc(dl)}@filao.app`);
                lines.push(`DTSTAMP:${now}`);
                lines.push(`DTSTART:${toICalUtc(dl)}`);
                lines.push(`SUMMARY:${escapeText(`Remise : ${tenderTitle}`)}`);
                if (t.organisme_acheteur) {
                    lines.push(`DESCRIPTION:${escapeText(`Acheteur : ${t.organisme_acheteur}`)}`);
                }
                lines.push('END:VEVENT');
            }
        }

        // Jalons du rétroplanning → événements « journée entière ».
        for (const j of t.jalons || []) {
            if (!j?.date || j.statut === 'fait') continue;
            if (j.label === 'Date limite de dépôt') continue; // déjà couvert par date_limite
            const day = String(j.date).split('T')[0];
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:filao-jalon-${t.id || tenderTitle}-${escapeText(j.label || 'jalon')}-${toICalDate(day)}@filao.app`);
            lines.push(`DTSTAMP:${now}`);
            lines.push(`DTSTART;VALUE=DATE:${toICalDate(day)}`);
            lines.push(`SUMMARY:${escapeText(`${j.label || 'Jalon'} — ${tenderTitle}`)}`);
            lines.push('END:VEVENT');
        }
    }

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n');
};
