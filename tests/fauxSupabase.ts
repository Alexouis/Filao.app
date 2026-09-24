/**
 * Faux client Supabase pour les tests de rendu de pages.
 *
 * Remplace, le temps d'un test, les méthodes du client partagé : requêtes de
 * tables (chaînables, résolues avec les lignes fournies), RPC, fonctions,
 * stockage, authentification et temps réel. Toute table non décrite renvoie
 * une liste vide : une page doit savoir s'afficher sans données.
 */
import { supabase } from '../src/lib/supabaseClient.ts';

export interface DonneesFausses {
    tables?: Record<string, any[]>;
    rpc?: Record<string, any>;
    fonctions?: Record<string, any>;
    utilisateur?: { id: string; email: string };
}

export const installerFauxSupabase = (d: DonneesFausses = {}) => {
    const s: any = supabase;
    const sauvegarde = {
        from: s.from, rpc: s.rpc, channel: s.channel, removeChannel: s.removeChannel,
        getUser: s.auth.getUser, getSession: s.auth.getSession,
        invoke: s.functions.invoke, storageFrom: s.storage.from,
        onAuth: s.auth.onAuthStateChange, mfa: s.auth.mfa,
    };
    const utilisateur = d.utilisateur ?? { id: 'u1', email: 'moi@exemple.fr' };

    const requete = (table: string) => {
        let lignes = [...(d.tables?.[table] ?? [])];
        let unique = false;
        const b: any = new Proxy({}, {
            get(_t, prop) {
                if (prop === 'then') {
                    const res = unique ? { data: lignes[0] ?? null, error: null } : { data: lignes, error: null, count: lignes.length };
                    return (ok: any, ko: any) => Promise.resolve(res).then(ok, ko);
                }
                if (prop === 'eq') return (col: string, val: any) => { lignes = lignes.filter(l => !(col in l) || l[col] === val); return b; };
                if (prop === 'single' || prop === 'maybeSingle') return () => { unique = true; return b; };
                return () => b;   // select, in, order, limit, range, not, ilike, is, or, update, insert…
            },
        });
        return b;
    };

    s.from = (table: string) => requete(table);
    s.rpc = (nom: string) => Promise.resolve({ data: d.rpc?.[nom] ?? null, error: null });
    s.functions.invoke = (nom: string) => Promise.resolve({ data: d.fonctions?.[nom] ?? {}, error: null });
    s.auth.getUser = () => Promise.resolve({ data: { user: utilisateur }, error: null });
    s.auth.getSession = () => Promise.resolve({ data: { session: { access_token: 'x', user: utilisateur } }, error: null });
    s.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } });
    s.auth.mfa = {
        listFactors: () => Promise.resolve({ data: { all: [], totp: [] }, error: null }),
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
        enroll: () => Promise.resolve({ data: null, error: null }),
        challenge: () => Promise.resolve({ data: null, error: null }),
        verify: () => Promise.resolve({ data: null, error: null }),
        unenroll: () => Promise.resolve({ data: null, error: null }),
    };
    const canal: any = { on: () => canal, subscribe: () => canal, unsubscribe: () => {} };
    s.channel = () => canal;
    s.removeChannel = () => Promise.resolve();
    s.storage.from = () => ({
        list: () => Promise.resolve({ data: [], error: null }),
        download: () => Promise.resolve({ data: new Blob(), error: null }),
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://exemple.fr/f' }, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://exemple.fr/p' } }),
        remove: () => Promise.resolve({ data: [], error: null }),
    });

    return () => {
        s.from = sauvegarde.from; s.rpc = sauvegarde.rpc; s.channel = sauvegarde.channel;
        s.removeChannel = sauvegarde.removeChannel; s.auth.getUser = sauvegarde.getUser;
        s.auth.getSession = sauvegarde.getSession; s.functions.invoke = sauvegarde.invoke;
        s.storage.from = sauvegarde.storageFrom;
        s.auth.onAuthStateChange = sauvegarde.onAuth; s.auth.mfa = sauvegarde.mfa;
    };
};
