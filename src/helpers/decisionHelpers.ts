/**
 * Règles métier de la vue « décision » d'un dossier.
 *
 * POURQUOI CE FICHIER
 * `renderDecisionView` accumulait environ 200 lignes de dérivations avant
 * d'émettre le moindre élément d'interface : score de succès, couverture des
 * compétences, jours restants, rôle de l'utilisateur courant, état terminal du
 * dossier. Ces règles n'ont rien de visuel — ce sont des décisions produit,
 * et elles étaient invérifiables tant qu'elles vivaient au milieu du JSX.
 *
 * Les sortir ici est le préalable au découpage de la vue : chaque bloc extrait
 * ensuite recevra des valeurs déjà calculées, au lieu de faire transiter la
 * logique de props en props.
 */
import { GROUPEMENT_STATUSES, STATUSES } from '../config';
import { getEffectiveStatus } from './tenderHelpers';

/** Membre du groupement, réduit à ce dont ces règles ont besoin. */
export interface MembreCouverture {
    id?: string;
    email?: string;
    deleted?: boolean;
    is_owner?: boolean;
    status?: string;
    /** Rôle dans le groupement — l'interface s'en sert pour situer l'invité. */
    role?: string;
    specialty_ids?: string[];
}

/** Spécialités effectivement couvertes par l'équipe encore en place. */
export const specialitesCouvertes = (membres: MembreCouverture[] | null | undefined): string[] =>
    Array.from(new Set(
        (membres || []).filter(m => !m.deleted).flatMap(m => m.specialty_ids || [])
    ));

/** Spécialités requises que personne ne couvre. */
export const specialitesManquantes = (
    requises: string[] | null | undefined,
    couvertes: string[]
): string[] => (requises || []).filter(sid => !couvertes.includes(sid));

/**
 * La liste des compétences requises est-elle vide À TORT ?
 *
 * `required_skills` est un JSONB porté par la ligne du dossier, lisible par
 * quiconque lit le dossier ; `required_specialty_ids` vient de la table
 * `reponses_ao_specialties`, soumise à ses propres policies. Des libellés sans
 * identifiants signalent donc un échec de LECTURE, pas un dossier qui n'exige
 * rien.
 *
 * La distinction n'est pas cosmétique : sans elle, un cotraitant privé de
 * lecture voyait un score de 85 % là où le mandataire lisait 40 %.
 */
export const lectureCompetencesEchouee = (
    requiredSpecialtyIds: string[] | null | undefined,
    requiredSkills: string[] | null | undefined
): boolean =>
    (requiredSpecialtyIds?.length ?? 0) === 0 && (requiredSkills?.length ?? 0) > 0;

/**
 * Score de succès du DOSSIER — pas un indicateur personnel.
 *
 * Part de 40 % et monte jusqu'à 95 % selon la proportion de compétences
 * requises couvertes par l'équipe. Tous les membres doivent lire la même
 * valeur.
 *
 * @returns le score, ou `null` si les compétences n'ont pas pu être lues —
 *          auquel cas l'interface doit dire « indisponible » plutôt
 *          qu'afficher un chiffre faussement optimiste.
 */
export const scoreSucces = (
    requiredSpecialtyIds: string[] | null | undefined,
    requiredSkills: string[] | null | undefined,
    couvertes: string[]
): number | null => {
    if (lectureCompetencesEchouee(requiredSpecialtyIds, requiredSkills)) return null;

    const requises = requiredSpecialtyIds ?? [];
    // Aucune compétence exigée : le dossier n'a pas de couverture à démontrer.
    if (requises.length === 0) return 85;

    const couvertesCount = requises.filter(sid => couvertes.includes(sid)).length;
    return Math.round(40 + (couvertesCount / requises.length) * 55);
};

/**
 * Gain de score qu'apporterait UNE compétence supplémentaire couverte.
 *
 * Sert à chiffrer l'intérêt d'un partenaire (« +11 % via… »). Vaut 0 quand une
 * seule compétence est requise : la couvrir ne serait pas un gain marginal
 * mais l'écart complet, et l'annoncer comme un « +x % » induirait en erreur.
 */
export const gainPotentiel = (requiredSpecialtyIds: string[] | null | undefined): number => {
    const n = requiredSpecialtyIds?.length ?? 0;
    if (n <= 1) return 0;
    return Math.round(55 / n);
};

/**
 * Jours restants avant l'échéance, ou `null` si aucune date.
 *
 * Valeur d'AFFICHAGE : elle peut être négative pour un dossier expiré, ce que
 * l'interface exploite pour dire « Expiré depuis N jours ». Elle ne sert pas à
 * décider de l'urgence — cette règle-là vit dans `tenderHelpers.isUrgent`, qui
 * raisonne en jours calendaires.
 */
export const joursRestants = (dateLimite: string | null | undefined): number | null => {
    if (!dateLimite) return null;
    return Math.ceil((new Date(dateLimite).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

export interface RoleUtilisateur {
    /** Sa ligne dans le groupement, si elle existe. */
    entree?: MembreCouverture;
    /** Il a décliné l'invitation. */
    aRefuse: boolean;
    /** Il est invité et n'a pas encore tranché (ou a refusé) : bandeau à afficher. */
    estInvite: boolean;
}

/**
 * Situation de l'utilisateur courant vis-à-vis du dossier.
 *
 * Le porteur est exclu de `estInvite` : il n'a pas d'invitation à accepter, et
 * lui présenter le bandeau n'aurait aucun sens.
 */
export const roleUtilisateur = (
    membres: MembreCouverture[] | null | undefined,
    utilisateur: { id?: string; email?: string } | null | undefined,
    tenderId: string | null | undefined
): RoleUtilisateur => {
    const entree = (membres || []).find(
        m => (m.id && m.id === utilisateur?.id) || (m.email && m.email === utilisateur?.email)
    );
    const aRefuse = entree?.status === GROUPEMENT_STATUSES.refuse;
    const estInvite = !!tenderId && !!entree && !entree.is_owner
        && (entree.status === GROUPEMENT_STATUSES.invite || aRefuse);
    return { entree, aRefuse, estInvite };
};

/**
 * Le dossier est-il joué ?
 *
 * Gagné, perdu ou expiré : rejoindre le groupement ne sert plus à préparer la
 * candidature. Passe par `getEffectiveStatus`, qui couvre l'expiration —
 * calculée depuis la date limite et jamais stockée en base.
 */
export const dossierTermine = (tender: any): boolean => {
    const s = getEffectiveStatus(tender);
    return s === STATUSES.won || s === STATUSES.lost || s === STATUSES.expired;
};
