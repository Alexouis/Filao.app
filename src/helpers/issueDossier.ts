import { supabase } from '../lib/supabaseClient';
import { track } from './analytics';
import { messageErreurFonction } from './erreurFonction';

/** Fourchette de montant pour l'analytique : jamais la valeur exacte. */
const trancheMontant = (m: number): string => {
    if (!m || m <= 0) return 'nc';
    if (m < 50000) return '<50k';
    if (m < 200000) return '50-200k';
    if (m < 1000000) return '200k-1M';
    return '>1M';
};

/**
 * Enregistre l'issue d'un dossier (gagné / perdu) et prévient l'équipe.
 *
 * Point de passage unique pour la liste et l'écran du dossier, qui avaient
 * divergé : notifications différentes, analytique d'un seul côté, erreur de
 * base ignorée côté dossier. Le travail est fait par `enregistrer-issue`,
 * seule à pouvoir résoudre les comptes des entreprises partenaires.
 *
 * @throws Error au message présentable si l'enregistrement échoue.
 */
export const enregistrerIssue = async (
    tenderId: string,
    issue: 'won' | 'lost',
    montantEstime?: number | null,
): Promise<void> => {
    const { data, error } = await supabase.functions.invoke('enregistrer-issue', {
        body: { tenderId, issue },
    });
    if (error) throw new Error(await messageErreurFonction(error, "Erreur lors de la mise à jour."));
    if (data?.error) throw new Error(data.error);

    track('resultat_saisi', {
        resultat: issue === 'won' ? 'gagne' : 'perdu',
        montant_tranche: trancheMontant(Number(montantEstime) || 0),
    });
};
