/** Liste PostgREST pour un filtre `in` : `("a","b")`, guillemets échappés. */
export const listeIn = (valeurs: string[]): string =>
    `(${valeurs.map(v => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
