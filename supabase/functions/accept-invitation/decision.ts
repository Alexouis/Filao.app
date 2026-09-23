/**
 * Un utilisateur peut-il répondre à une invitation sur ce dossier ?
 *
 * Sans dépendance distante : importable par l'Edge Function (Deno) comme par
 * les tests (Node).
 *
 * Il faut une invitation qui le concerne :
 *   - la ligne de groupement de SON entreprise, en attente (« invite »), ou
 *   - une invitation nominative à SON adresse, non révoquée, non expirée,
 *     en attente (« pending »).
 * Redire la réponse déjà donnée est accepté (idempotence). L'entreprise
 * porteuse ne répond jamais à une invitation sur son propre dossier.
 */
export interface EntreeDecision {
  accept: boolean;
  entrepriseDossier: string | null;
  monEntreprise: string;
  groupement: { statut?: string | null } | null;
  invitations: Array<{ status?: string | null; revoked_at?: string | null; expires_at?: string | null }>;
  maintenant?: number;
}

export const invitationValide = (
  invitations: EntreeDecision["invitations"], maintenant: number = Date.now(),
) => invitations.find((i) => !i.revoked_at && (!i.expires_at || new Date(i.expires_at).getTime() > maintenant)) ?? null;

export const peutRepondre = (e: EntreeDecision): boolean => {
  if (e.entrepriseDossier && e.entrepriseDossier === e.monEntreprise) return false;
  const statutVise = e.accept ? "accepte" : "refuse";
  const statutInvitation = e.accept ? "accepted" : "refused";
  const inv = invitationValide(e.invitations, e.maintenant);
  return e.groupement?.statut === "invite"
    || e.groupement?.statut === statutVise
    || inv?.status === "pending"
    || inv?.status === statutInvitation;
};
