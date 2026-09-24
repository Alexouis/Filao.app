import React, { useCallback, useEffect, useState } from 'react';
import { Mail, RotateCw, X, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/Toast';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { messageErreurFonction } from '../../helpers/erreurFonction';

interface InvitationEnvoyee {
    id: string;
    email: string;
    created_at: string;
    expires_at: string;
    consumed_at: string | null;
}

/** État affichable d'une invitation. */
export const etatInvitationReseau = (i: Pick<InvitationEnvoyee, 'expires_at' | 'consumed_at'>, maintenant = Date.now()):
    'inscrit' | 'en_attente' | 'expiree' =>
    i.consumed_at ? 'inscrit' : new Date(i.expires_at).getTime() > maintenant ? 'en_attente' : 'expiree';

/**
 * Invitations au réseau envoyées par e-mail à des personnes pas encore
 * inscrites (migration 122).
 *
 * Elles ne se voyaient nulle part : impossible de savoir si elles avaient
 * abouti, de les relancer ou de les annuler.
 */
export const InvitationsReseauEnvoyees: React.FC<{ version?: number }> = ({ version = 0 }) => {
    const { showToast } = useToast();
    const [liste, setListe] = useState<InvitationEnvoyee[]>([]);
    const [action, setAction] = useState<string | null>(null);
    const [aAnnuler, setAAnnuler] = useState<InvitationEnvoyee | null>(null);

    const charger = useCallback(async () => {
        const { data, error } = await supabase.rpc('mes_invitations_reseau');
        if (error) { console.error('Invitations réseau envoyées :', error); return; }
        setListe((data as InvitationEnvoyee[]) ?? []);
    }, []);

    useEffect(() => { charger(); }, [charger, version]);

    const relancer = async (i: InvitationEnvoyee) => {
        setAction(i.id);
        const { error } = await supabase.functions.invoke('send-network-invite', { body: { email: i.email } });
        setAction(null);
        if (error) {
            showToast(await messageErreurFonction(error, "L'invitation n'a pas pu être renvoyée."), 'error');
            return;
        }
        showToast(`Invitation renvoyée à ${i.email}`, 'success');
        charger();
    };

    const annuler = async (i: InvitationEnvoyee) => {
        setAction(i.id);
        const { data, error } = await supabase.rpc('annuler_invitation_reseau', { p_invitation: i.id });
        setAction(null);
        if (error || !data) {
            showToast("L'invitation n'a pas pu être annulée.", 'error');
            return;
        }
        showToast('Invitation annulée : le lien ne fonctionne plus.', 'success');
        charger();
    };

    if (liste.length === 0) return null;

    return (
        <div className="mb-6 space-y-2">
            <h3 className="text-sm font-bold text-[#0B1F38] flex items-center gap-2">
                <Mail size={16} className="text-[#00A3E0]" />
                Invitations envoyées par e-mail ({liste.length})
            </h3>
            {liste.map((i) => {
                const etat = etatInvitationReseau(i);
                return (
                    <div key={i.id} className="flex items-center gap-3 bg-white/60 border border-white/60 rounded-xl px-4 py-2.5">
                        <span className="flex-1 min-w-0 text-sm text-[#0B1F38] truncate" title={i.email}>{i.email}</span>
                        {etat === 'inscrit' && (
                            <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> Inscrit</span>
                        )}
                        {etat === 'en_attente' && (
                            <span className="text-[11px] text-[#0B1F38]/50">
                                En attente · expire le {new Date(i.expires_at).toLocaleDateString('fr-FR')}
                            </span>
                        )}
                        {etat === 'expiree' && (
                            <span className="text-[11px] text-[#0B1F38]/40">Expirée ou annulée</span>
                        )}
                        {etat !== 'inscrit' && (
                            <button
                                type="button"
                                onClick={() => relancer(i)}
                                disabled={action === i.id}
                                className="text-[11px] font-bold text-[#00A3E0] hover:underline flex items-center gap-1 disabled:opacity-50"
                            >
                                {action === i.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                                {etat === 'expiree' ? 'Renvoyer' : 'Relancer'}
                            </button>
                        )}
                        {etat === 'en_attente' && (
                            <button
                                type="button"
                                onClick={() => setAAnnuler(i)}
                                disabled={action === i.id}
                                className="text-[#0B1F38]/30 hover:text-red-500 p-1 disabled:opacity-50"
                                title="Annuler l'invitation"
                                aria-label={`Annuler l'invitation de ${i.email}`}
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>
                );
            })}
            <ConfirmDialog
                ouvert={!!aAnnuler}
                titre="Annuler cette invitation ?"
                message={`Le lien envoyé à ${aAnnuler?.email ?? ''} ne fonctionnera plus. Vous pourrez l'inviter de nouveau plus tard.`}
                libelleConfirmer="Annuler l'invitation"
                libelleAnnuler="Garder"
                destructif
                onConfirmer={() => { const i = aAnnuler; setAAnnuler(null); if (i) annuler(i); }}
                onAnnuler={() => setAAnnuler(null)}
            />
        </div>
    );
};
