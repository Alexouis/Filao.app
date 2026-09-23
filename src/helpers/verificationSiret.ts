import { supabase } from '../lib/supabaseClient';
import { messageErreurFonction } from './erreurFonction';

export interface ResultatVerification {
    verifie: boolean;
    motif?: string;
    /** Registre injoignable : réessayer plus tard, rien n'est conclu. */
    indisponible?: boolean;
}

/**
 * Demande au serveur de vérifier le SIRET de l'entreprise auprès du registre
 * (Edge Function `verifier-siret`). Seul chemin qui pose le badge : le
 * navigateur ne peut plus l'écrire (migrations 112 et 119).
 */
export const verifierSiret = async (entrepriseId: string): Promise<ResultatVerification> => {
    const { data, error } = await supabase.functions.invoke('verifier-siret', { body: { entrepriseId } });
    if (error) {
        const motif = await messageErreurFonction(error, 'La vérification du SIRET a échoué.');
        return { verifie: false, motif, indisponible: /indisponible/i.test(motif) };
    }
    return { verifie: !!data?.verifie, motif: data?.motif, indisponible: !!data?.indisponible };
};
