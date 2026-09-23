import { supabase } from '../lib/supabaseClient';

/**
 * Suppression complète d'un dossier : pièces, événements d'agenda, ligne.
 *
 * POURQUOI UN MODULE
 * Deux écrans suppriment un dossier — la liste « Mes appels d'offres » et le
 * bouton « Supprimer » du dossier lui-même — et ils ne faisaient pas la même
 * chose. Depuis le dossier, seule la ligne `reponses_ao` était effacée : les
 * pièces des membres restaient dans le stockage (et continuaient de compter
 * dans le forfait), les événements Google Agenda restaient dans l'agenda.
 *
 * Ordre : pièces puis agenda puis ligne. Les deux premières étapes sont
 * best-effort — mieux vaut des fichiers orphelins, rattrapés par la purge
 * périodique, qu'un dossier à moitié supprimé. Seul l'échec de la dernière est
 * remonté.
 *
 * @returns octets libérés par la purge des pièces.
 */
export const supprimerDossier = async (tenderId: string): Promise<number> => {
    // Les pièces vivent dans le dossier de chaque déposant : seule une
    // fonction serveur peut toutes les atteindre (policy DELETE limitée au
    // dossier de l'appelant, migration 037).
    const { data: purge, error: purgeError } = await supabase.functions.invoke(
        'delete-tender-documents',
        { body: { tenderId } }
    );
    if (purgeError || purge?.error) {
        console.error('Purge des pièces incomplète', purgeError ?? purge?.error);
    }

    const octetsLiberes = Number(purge?.octetsLiberes ?? 0);

    try {
        await supabase.functions.invoke('sync-google-calendar', {
            body: { action: 'delete_tender', tenderId },
        });
    } catch (erreurAgenda) {
        console.error('Suppression des événements Google Agenda', erreurAgenda);
    }

    const { error } = await supabase.from('reponses_ao').delete().eq('id', tenderId);
    if (error) throw error;

    return octetsLiberes;
};
