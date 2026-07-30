tsimport { supabase } from '../lib/supabaseClient';
import { PLANS_CONFIG, PlanType, PLANS_TYPES } from '../config';

/**
 * Forfaits, lus depuis `plan_limits`.
 *
 * POURQUOI CE MODULE
 * Les quotas et les libellés vivaient dans `PLANS_CONFIG` (src/config.ts) ET
 * dans la table `plan_limits`, avec un désaccord : `partenaire` autorisait 1
 * dossier côté front, 0 côté base. L'interface affichait donc « 1/1 » pour un
 * forfait qui n'en permet aucun — c'est l'écart relevé en recette.
 *
 * La table devient la source unique. Modifier un tarif ou un quota ne demande
 * plus de livrer une version du code.
 *
 * `PLANS_CONFIG` subsiste comme **repli** le temps du chargement et en cas
 * d'indisponibilité : un quota inconnu ne doit pas bloquer un utilisateur
 * légitime, ni en laisser passer un au-delà de son offre.
 */

export interface Forfait {
    code: string;
    libelle: string;
    /** null = illimité. 0 = ne peut pas porter de dossier. */
    maxAoSimultanes: number | null;
    maxUtilisateurs: number | null;
    maxStockageOctets: number | null;
    /** Centimes HT. null si l'offre est négociée. */
    prixMensuelHt: number | null;
    prixAnnuelHt: number | null;
    surDevis: boolean;
    fonctionnalites: Record<string, boolean>;
    ordre: number;
}

let cache: Map<string, Forfait> | null = null;
let chargementEnCours: Promise<void> | null = null;

/** Traduction du repli codé en dur vers la même forme que la table. */
const depuisConfig = (code: string): Forfait => {
    const conf = PLANS_CONFIG[(code as PlanType)] ?? PLANS_CONFIG[PLANS_TYPES.free as PlanType];
    return {
        code,
        libelle: conf.label,
        maxAoSimultanes: conf.limits.activeTenders,
        maxUtilisateurs: conf.limits.users,
        maxStockageOctets: conf.limits.storage,
        prixMensuelHt: conf.price * 100,
        prixAnnuelHt: null,
        surDevis: false,
        fonctionnalites: { ia: conf.limits.aiAccess },
        ordre: conf.level,
    };
};

/**
 * Charge les forfaits une fois par session.
 *
 * Appelé au démarrage par `AuthContext` : les quotas sont consultés par des
 * fonctions synchrones, réparties dans plusieurs écrans, qui ne peuvent pas
 * attendre une requête.
 */
export const chargerForfaits = async (): Promise<void> => {
    if (cache) return;
    if (chargementEnCours) return chargementEnCours;

    chargementEnCours = (async () => {
        const { data, error } = await supabase
            .from('plan_limits')
            .select('plan, label, max_ao_simultanes, max_utilisateurs, max_stockage_octets, prix_mensuel_ht, prix_annuel_ht, sur_devis, fonctionnalites, ordre')
            .order('ordre');

        if (error || !data) {
            // On laisse le cache vide : `forfait()` retombera sur la
            // configuration en dur plutôt que de renvoyer des quotas nuls.
            console.warn('Forfaits non chargés, repli sur la configuration locale', error);
            chargementEnCours = null;
            return;
        }

        cache = new Map(data.map((l: any) => [l.plan, {
            code: l.plan,
            libelle: l.label ?? l.plan,
            maxAoSimultanes: l.max_ao_simultanes,
            maxUtilisateurs: l.max_utilisateurs,
            maxStockageOctets: l.max_stockage_octets,
            prixMensuelHt: l.prix_mensuel_ht,
            prixAnnuelHt: l.prix_annuel_ht,
            surDevis: Boolean(l.sur_devis),
            fonctionnalites: l.fonctionnalites ?? {},
            ordre: l.ordre ?? 9,
        }]));
        chargementEnCours = null;
    })();

    return chargementEnCours;
};

/**
 * @param code code du forfait de l'utilisateur.
 * @returns le forfait, ou le repli local si la table n'est pas chargée.
 *
 * Un code inconnu retombe sur `partenaire` : c'est le forfait le plus
 * restrictif, donc celui qui ne laisse rien passer par erreur.
 */
export const forfait = (code?: string | null): Forfait => {
    const clef = code && (cache?.has(code) || PLANS_CONFIG[code as PlanType]) ? code : PLANS_TYPES.free;
    return cache?.get(clef) ?? depuisConfig(clef);
};

/** Tous les forfaits, pour le comparatif de l'écran Abonnement. */
export const tousLesForfaits = (): Forfait[] =>
    cache
        ? [...cache.values()].sort((a, b) => a.ordre - b.ordre)
        : Object.keys(PLANS_CONFIG).map(depuisConfig).sort((a, b) => a.ordre - b.ordre);

/** Vrai si le forfait n'impose aucune limite de dossiers portés. */
export const illimite = (f: Forfait): boolean => f.maxAoSimultanes === null;

/** Tarif présentable, en euros. */
export const prixLisible = (f: Forfait): string => {
    if (f.surDevis) return 'Sur devis';
    if (!f.prixMensuelHt) return 'Gratuit';
    return `${Math.round(f.prixMensuelHt / 100)} € / mois`;
};