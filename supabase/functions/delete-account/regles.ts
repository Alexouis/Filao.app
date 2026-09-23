/**
 * Règles de la suppression de compte, sans dépendance distante : importables
 * par l'Edge Function (Deno) comme par les tests (Node).
 */
export interface MembreEntreprise { id: string; roles?: { name?: string } | null }

const estAdmin = (m?: MembreEntreprise) => m?.roles?.name === 'admin';

/**
 * Le départ de cet utilisateur laisserait-il l'entreprise sans administrateur,
 * d'une façon que la base refusera ? Vrai s'il est le SEUL administrateur et
 * qu'au moins DEUX autres membres restent — avec un seul, la base le promeut
 * automatiquement (080).
 */
export const seulAdministrateurBloquant = (membres: MembreEntreprise[], userId: string): boolean => {
  const moi = membres.find((m) => m.id === userId);
  const autres = membres.filter((m) => m.id !== userId);
  return estAdmin(moi) && autres.length >= 2 && !autres.some(estAdmin);
};
