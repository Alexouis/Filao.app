/**
 * Libellés des divisions CPV.
 *
 * Un code CPV à 8 chiffres n'évoque rien : « 45213000 » ne dit pas s'il s'agit
 * de bâtiments commerciaux ou de voirie. Le référentiel complet compte environ
 * 9 500 entrées ; les 45 **divisions** — les deux premiers chiffres — suffisent
 * à situer un marché, pour un coût de maintenance nul.
 *
 * Volontairement en dur plutôt qu'en base : ces libellés sont fixés par le
 * règlement (CE) n° 2195/2002 et n'ont pas bougé depuis la révision de 2008.
 * Une table apporterait de la latence et une migration pour une donnée qui ne
 * change pas.
 *
 * ⚠️ Ce n'est pas la description exacte du code : « 45213000 » sera présenté
 *    comme « Travaux de construction », le libellé de sa division. Pour la
 *    description précise, il faudra le référentiel complet — utile seulement le
 *    jour où l'on voudra rechercher ou filtrer par libellé.
 */

const DIVISIONS: Record<string, string> = {
    '03': "Produits agricoles, de l'élevage, de la pêche et de la sylviculture",
    '09': 'Produits pétroliers, combustibles, électricité et autres sources d’énergie',
    '14': "Produits d'exploitation des mines et métaux de base",
    '15': 'Produits alimentaires, boissons et tabac',
    '16': 'Machines agricoles',
    '18': 'Vêtements, articles chaussants, bagages et accessoires',
    '19': 'Cuir, textiles, plastique et caoutchouc',
    '22': 'Imprimés et produits connexes',
    '24': 'Produits chimiques',
    '30': 'Matériel informatique et de bureau',
    '31': 'Machines, équipements électriques et éclairage',
    '32': 'Équipements de radio, télévision et télécommunication',
    '33': 'Matériels médicaux, pharmaceutiques et de soins',
    '34': 'Équipements de transport et produits auxiliaires',
    '35': 'Équipements de sécurité, lutte contre l’incendie, police et défense',
    '37': 'Instruments de musique, articles de sport, jeux et artisanat',
    '38': 'Équipements de laboratoire, d’optique et de précision',
    '39': 'Mobilier, aménagements, électroménager et produits de nettoyage',
    '41': 'Eau captée et épurée',
    '42': 'Machines industrielles',
    '43': 'Machines pour les mines, l’extraction et le bâtiment',
    '44': 'Structures et matériaux de construction',
    '45': 'Travaux de construction',
    '48': 'Logiciels et systèmes d’information',
    '50': 'Services de réparation et d’entretien',
    '51': 'Services d’installation',
    '55': 'Hôtellerie, restauration et commerce de détail',
    '60': 'Services de transport',
    '63': 'Services auxiliaires des transports et agences de voyages',
    '64': 'Services des postes et télécommunications',
    '65': 'Services publics (eau, énergie, distribution)',
    '66': 'Services financiers et d’assurance',
    '70': 'Services immobiliers',
    '71': 'Architecture, ingénierie, construction et inspection',
    '72': 'Technologies de l’information, conseil et développement logiciel',
    '73': 'Recherche, développement et conseil associé',
    '75': 'Administration publique, défense et sécurité sociale',
    '76': 'Services liés à l’industrie du pétrole et du gaz',
    '77': 'Services agricoles, sylvicoles, horticoles et d’aquaculture',
    '79': 'Services aux entreprises : droit, marketing, conseil, recrutement, sécurité',
    '80': 'Services d’enseignement et de formation',
    '85': 'Services de santé et services sociaux',
    '90': 'Assainissement, déchets, hygiène et environnement',
    '92': 'Services récréatifs, culturels et sportifs',
    '98': 'Autres services collectifs, sociaux et personnels',
};

/**
 * @param code code CPV à 8 chiffres.
 * @returns le libellé de sa division, ou null si la division est inconnue.
 *
 * Retourner null plutôt qu'un texte générique laisse l'appelant décider :
 * afficher le code nu vaut mieux qu'un « Autre » qui n'informe pas.
 */
export const libelleCpv = (code: string | null | undefined): string | null => {
    const division = String(code ?? '').slice(0, 2);
    return DIVISIONS[division] ?? null;
};

/** Libellé prêt à l'affichage : « 45 213 000 — Travaux de construction ». */
export const cpvLisible = (code: string, codeFormate?: string): string => {
    const libelle = libelleCpv(code);
    const affiche = codeFormate ?? code;
    return libelle ? `${affiche} — ${libelle}` : affiche;
};

/** Nombre de divisions couvertes, pour vérification. */
export const NB_DIVISIONS = Object.keys(DIVISIONS).length;