import { supabase } from '../lib/supabaseClient';
import { listeIn } from './postgrestHelpers';

export { listeIn };

/**
 * Enregistrement des compétences d'une entreprise (natures, domaines,
 * spécialités, qualifications, zones).
 *
 * POURQUOI
 * Chaque table était vidée puis re-remplie, sans lire aucune erreur. Un
 * `insert` refusé après le `delete` — droits, référentiel modifié, coupure —
 * effaçait les compétences de l'entreprise tandis que l'écran affichait
 * « Enregistré ». Elles disparaissaient alors aussi de l'annuaire.
 *
 * On écrit donc d'abord les valeurs retenues (upsert sur la clé primaire
 * `(entreprise_id, colonne)`), puis on retire celles qui ne le sont plus. À
 * aucun moment l'entreprise n'est sans compétences, et la première erreur
 * interrompt tout avec un message exploitable.
 */

type Table = 'company_natures' | 'company_domains' | 'company_specialties' | 'company_expertise_tags' | 'company_geo_zones';

const remplacer = async (table: Table, colonne: string, entrepriseId: string, lignes: Record<string, unknown>[]) => {
    if (lignes.length > 0) {
        const { error } = await supabase.from(table)
            .upsert(lignes.map(l => ({ ...l, entreprise_id: entrepriseId })), { onConflict: `entreprise_id,${colonne}` });
        if (error) throw new Error(`Enregistrement impossible (${table}) : ${error.message}`);
    }
    let suppression = supabase.from(table).delete().eq('entreprise_id', entrepriseId);
    const conservees = lignes.map(l => String(l[colonne]));
    if (conservees.length > 0) suppression = suppression.not(colonne, 'in', listeIn(conservees));
    const { error } = await suppression;
    if (error) throw new Error(`Mise à jour impossible (${table}) : ${error.message}`);
};

export interface TaxonomieSaisie {
    natures?: string[];
    domaines?: string[];
    specialites?: Array<{ specialty_id: string; custom_label?: string | null }>;
    tags?: string[];
    zones?: string[];
}

/** N'écrit que les familles fournies : `undefined` = ne pas toucher. */
export const enregistrerTaxonomie = async (entrepriseId: string, t: TaxonomieSaisie): Promise<void> => {
    if (t.natures) await remplacer('company_natures', 'nature', entrepriseId, t.natures.map(nature => ({ nature })));
    if (t.domaines) await remplacer('company_domains', 'domain_id', entrepriseId, t.domaines.map(domain_id => ({ domain_id })));
    if (t.specialites) await remplacer('company_specialties', 'specialty_id', entrepriseId,
        t.specialites.map(s => ({ specialty_id: s.specialty_id, custom_label: s.custom_label || null })));
    if (t.tags) await remplacer('company_expertise_tags', 'tag_id', entrepriseId, t.tags.map(tag_id => ({ tag_id })));
    if (t.zones) await remplacer('company_geo_zones', 'geo_zone_id', entrepriseId, t.zones.map(geo_zone_id => ({ geo_zone_id })));
};

/**
 * Compétences REQUISES d'un dossier (`reponses_ao_specialties`), même principe :
 * écrire, puis retirer ce qui n'est plus demandé. Une liste vide efface tout
 * — l'une des deux anciennes versions ne l'enregistrait jamais.
 */
export const enregistrerCompetencesDossier = async (dossierId: string, ids: string[]): Promise<void> => {
    if (ids.length > 0) {
        const { error } = await supabase.from('reponses_ao_specialties')
            .upsert(ids.map(specialty_id => ({ reponse_ao_id: dossierId, specialty_id })),
                { onConflict: 'reponse_ao_id,specialty_id', ignoreDuplicates: true });
        if (error) throw error;
    }
    let retrait = supabase.from('reponses_ao_specialties').delete().eq('reponse_ao_id', dossierId);
    if (ids.length > 0) retrait = retrait.not('specialty_id', 'in', listeIn(ids));
    const { error } = await retrait;
    if (error) throw error;
};
