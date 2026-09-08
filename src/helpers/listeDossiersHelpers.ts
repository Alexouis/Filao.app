/**
 * Filtrage et tri de la liste des appels d'offres.
 *
 * POURQUOI CE FICHIER
 * Ces règles vivaient dans un `useMemo` de 89 lignes au milieu de `Tenders`.
 * Ce ne sont pourtant pas des détails d'affichage mais des décisions produit :
 * ce qu'on montre, ce qu'on cache, dans quel ordre. Invérifiables tant
 * qu'elles étaient enfouies dans un composant.
 */
import { Tender } from '../types';
import { getEffectiveStatus, isUrgent } from './tenderHelpers';

/** Ce que la liste a besoin de savoir de l'utilisateur courant. */
export interface ProfilListe {
    id?: string;
    email?: string;
    entreprise_id?: string | null;
}

export interface CriteresListe {
    recherche?: string;
    /** Statut, « Tous », « Urgents », ou un statut d'invitation. */
    filterStatus?: string;
    filterCategory?: string;
    filterDomain?: string;
    /** « Tous », « Portés », « Rejoints ». */
    filterRole?: string;
    /** Vue « invitations » : on montre alors CE QUI EST habituellement caché. */
    showInvitationsOnly?: boolean;
    /** Afficher aussi les dossiers des collègues. */
    voirToutEntreprise?: boolean;
    sortOption?: string;
}

/** Situation de l'utilisateur vis-à-vis d'un dossier. */
const situation = (t: any, profil?: ProfilListe | null) => {
    const groupement = t?.groupements?.find(
        (g: any) => profil?.entreprise_id && g.entreprise_id === profil.entreprise_id
    );
    const invitation = t?.invitations?.find((i: any) => i.email === profil?.email);
    return {
        refuse: groupement?.statut === 'refuse' || invitation?.status === 'refused',
        enAttente: groupement?.statut === 'invite' || invitation?.status === 'pending',
    };
};

/**
 * La recherche porte sur le titre, l'acheteur et le statut — pas sur la
 * description : un mot fréquent y ramènerait presque tout, ce qui revient à ne
 * pas filtrer.
 */
export const correspondRecherche = (t: any, recherche?: string): boolean => {
    const q = (recherche ?? '').toLowerCase().trim();
    if (!q) return true;
    return [t?.titre, t?.organisme_acheteur, t?.statut]
        .some(v => typeof v === 'string' && v.toLowerCase().includes(q));
};

/** Le type de marché peut être unique ou multiple selon les avis. */
export const correspondCategorie = (t: any, categorie?: string): boolean => {
    if (!categorie || categorie === 'Tous') return true;
    return Array.isArray(t?.type_marche)
        ? t.type_marche.includes(categorie)
        : t?.type_marche === categorie;
};

/**
 * « Portés » = dossiers dont l'utilisateur est le CRÉATEUR, « Rejoints » = les
 * autres. Aligné sur le badge affiché sur la carte : deux définitions du même
 * mot conduiraient à filtrer autrement que ce qu'on annonce.
 */
export const correspondRole = (t: any, role: string | undefined, userId?: string): boolean => {
    if (!role || role === 'Tous') return true;
    const porteur = t?.createur_id === userId;
    return role === 'Portés' ? porteur : role === 'Rejoints' ? !porteur : true;
};

/**
 * Un dossier est-il visible dans la liste ?
 *
 * Deux régimes s'opposent, et c'est le cœur de la règle :
 *  - vue NORMALE : les invitations en attente et les refus sont MASQUÉS — ce
 *    ne sont pas encore (ou plus) des dossiers de l'utilisateur ;
 *  - vue INVITATIONS : on ne montre QUE ceux-là.
 * Un même dossier n'apparaît donc jamais dans les deux.
 */
export const dossierVisible = (
    t: any,
    criteres: CriteresListe,
    profil?: ProfilListe | null,
    estDossierDunCollegue?: (t: any) => boolean,
): boolean => {
    if (!correspondCategorie(t, criteres.filterCategory)) return false;

    if (criteres.filterDomain && criteres.filterDomain !== 'Tous'
        && t?.secteur_activite !== criteres.filterDomain) return false;

    if (!correspondRole(t, criteres.filterRole, profil?.id)) return false;

    // Bascule « toute l'entreprise ». Par défaut on n'affiche que ses propres
    // dossiers : une secrétaire qui suit dix chefs de projet noierait sinon
    // les siens sous ceux des autres.
    if (!criteres.voirToutEntreprise && estDossierDunCollegue?.(t)) return false;

    const { refuse, enAttente } = situation(t, profil);

    if (criteres.showInvitationsOnly) {
        if (!enAttente && !refuse) return false;
        if (criteres.filterStatus === 'En attente' && !enAttente) return false;
        if (criteres.filterStatus === 'Refusé' && !refuse) return false;
        return true;
    }

    if (enAttente || refuse) return false;

    // « Urgents » est transverse au statut : il répond à « qu'est-ce qui
    // presse ? », pas à « où en est ce dossier ? ».
    if (criteres.filterStatus === 'Urgents') return isUrgent(t);

    if (criteres.filterStatus && criteres.filterStatus !== 'Tous'
        && getEffectiveStatus(t) !== criteres.filterStatus) return false;

    return true;
};

/**
 * Comparateur de tri. En vue « invitations », les refus sont relégués en fin
 * de liste avant tout autre critère : ce sont des dossiers sur lesquels il n'y
 * a plus rien à décider.
 */
export const comparerDossiers = (
    criteres: CriteresListe,
    profil?: ProfilListe | null,
) => (a: any, b: any): number => {
    if (criteres.showInvitationsOnly) {
        const aRefuse = situation(a, profil).refuse;
        const bRefuse = situation(b, profil).refuse;
        if (aRefuse && !bRefuse) return 1;
        if (!aRefuse && bRefuse) return -1;
    }

    switch (criteres.sortOption) {
        case 'date_asc':
            return new Date(a?.date_limite || 0).getTime() - new Date(b?.date_limite || 0).getTime();
        case 'date_desc':
            return new Date(b?.date_limite || 0).getTime() - new Date(a?.date_limite || 0).getTime();
        case 'titre_asc':
            return (a?.titre || '').localeCompare(b?.titre || '');
        case 'score_desc':
            return (b?.success_score || 0) - (a?.success_score || 0);
        default:
            return 0;
    }
};

/** Applique recherche, filtres puis tri. Ne modifie pas le tableau reçu. */
export const filtrerEtTrierDossiers = (
    tenders: Tender[] | null | undefined,
    criteres: CriteresListe,
    profil?: ProfilListe | null,
    estDossierDunCollegue?: (t: any) => boolean,
): Tender[] =>
    [...(tenders ?? [])]
        .filter(t => correspondRecherche(t, criteres.recherche))
        .filter(t => dossierVisible(t, criteres, profil, estDossierDunCollegue))
        .sort(comparerDossiers(criteres, profil));
