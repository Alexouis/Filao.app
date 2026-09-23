/**
 * Message lisible d'une erreur d'Edge Function.
 *
 * `supabase.functions.invoke` renvoie une `FunctionsHttpError` dont le message
 * est toujours « Edge Function returned a non-2xx status code » : le vrai motif
 * (`{ error: "…" }`) est dans le corps de la réponse, qu'il faut lire. Sans ce
 * helper, chaque écran affichait soit ce message technique, soit un libellé
 * générique qui masquait la cause.
 */
export const messageErreurFonction = async (erreur: unknown, repli: string): Promise<string> => {
    try {
        const reponse = (erreur as any)?.context;
        if (reponse && typeof reponse.clone === 'function') {
            const corps = await reponse.clone().json();
            if (typeof corps?.error === 'string' && corps.error) return corps.error;
        }
    } catch { /* corps illisible ou non JSON */ }
    const message = (erreur as any)?.message;
    return message && !/non-2xx/i.test(message) ? message : repli;
};
