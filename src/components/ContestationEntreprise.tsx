import React, { useState } from 'react';
import { ShieldAlert, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { deposerFichier } from '../helpers/uploadHelpers';
import { messageErreurFonction } from '../helpers/erreurFonction';

/**
 * Contester l'inscription d'une entreprise (migration 117).
 *
 * Le SIRET étant unique, une société inscrite par un tiers ne pouvait que
 * demander à rejoindre ce tiers. Le demandeur transmet ici un motif et un
 * extrait Kbis ; l'équipe Filao vérifie et tranche.
 */
export const ContestationEntreprise: React.FC<{
    entreprise: { id: string; nom: string };
    userId: string;
}> = ({ entreprise, userId }) => {
    const [ouvert, setOuvert] = useState(false);
    const [motif, setMotif] = useState('');
    const [fichier, setFichier] = useState<File | null>(null);
    const [envoi, setEnvoi] = useState(false);
    const [erreur, setErreur] = useState<string | null>(null);
    const [envoyee, setEnvoyee] = useState(false);

    if (envoyee) {
        return (
            <div className="mt-6 text-left bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex gap-3">
                <CheckCircle size={18} className="text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-emerald-800 leading-relaxed">
                    Votre contestation est transmise à l'équipe Filao. Nous vérifions le justificatif et
                    vous répondons par notification et par e-mail, en principe sous 5 jours ouvrés.
                </p>
            </div>
        );
    }

    if (!ouvert) {
        return (
            <button
                type="button"
                onClick={() => setOuvert(true)}
                className="mt-6 text-xs text-[#0B1F38]/50 hover:text-[#0B1F38] hover:underline"
            >
                Cette entreprise a été inscrite par quelqu'un qui n'en fait pas partie ? Contester l'inscription
            </button>
        );
    }

    const envoyer = async () => {
        setErreur(null);
        if (motif.trim().length < 20) {
            setErreur('Expliquez en quelques phrases pourquoi vous contestez cette inscription.');
            return;
        }
        if (!fichier) {
            setErreur('Joignez un extrait Kbis de moins de 3 mois.');
            return;
        }
        setEnvoi(true);
        try {
            const { chemin, erreur: erreurDepot } = await deposerFichier(fichier, {
                dossier: `documents/${userId}`,
                point: 'candidature',
                nom: `contestation-${entreprise.id}-${Date.now()}`,
            });
            if (erreurDepot || !chemin) throw new Error(erreurDepot || 'Le justificatif n’a pas pu être déposé.');

            const { data, error } = await supabase.functions.invoke('contester-entreprise', {
                body: { entrepriseId: entreprise.id, motif: motif.trim(), justificatif: chemin },
            });
            if (error) throw new Error(await messageErreurFonction(error, 'La contestation n’a pas pu être envoyée.'));
            if (data?.error) throw new Error(data.error);
            setEnvoyee(true);
        } catch (err: any) {
            setErreur(err?.message || 'La contestation n’a pas pu être envoyée.');
        } finally {
            setEnvoi(false);
        }
    };

    return (
        <div className="mt-6 text-left border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
                <ShieldAlert size={16} className="text-[#FF8575]" aria-hidden="true" />
                <h3 className="text-sm font-bold text-[#0B1F38]">Contester l'inscription de {entreprise.nom}</h3>
            </div>
            <p className="text-xs text-[#0B1F38]/60 leading-relaxed">
                Si vous représentez cette entreprise et que son compte Filao a été créé par une personne
                extérieure, l'équipe Filao peut vous en confier l'administration après vérification.
            </p>
            <label className="block">
                <span className="text-[11px] font-bold text-[#0B1F38]/60">Motif</span>
                <textarea
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Votre fonction dans l'entreprise, et pourquoi ce compte ne lui appartient pas…"
                    className="mt-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00A3E0]"
                />
            </label>
            <label className="block">
                <span className="text-[11px] font-bold text-[#0B1F38]/60">Extrait Kbis de moins de 3 mois (PDF ou image)</span>
                <input
                    type="file"
                    accept="application/pdf,.pdf,image/*"
                    onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-xs"
                />
            </label>
            {erreur && <p className="text-xs text-red-600">{erreur}</p>}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={envoyer}
                    disabled={envoi}
                    className="flex-1 py-2.5 bg-[#0B1F38] text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    {envoi && <Loader2 size={14} className="animate-spin" />} Envoyer la contestation
                </button>
                <button
                    type="button"
                    onClick={() => setOuvert(false)}
                    disabled={envoi}
                    className="px-4 py-2.5 text-sm text-[#0B1F38]/60 hover:text-[#0B1F38]"
                >
                    Annuler
                </button>
            </div>
        </div>
    );
};
