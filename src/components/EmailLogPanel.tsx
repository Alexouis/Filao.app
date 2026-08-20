import React, { useState, useEffect } from 'react';
import { Mail, FileUp, CheckCircle2, Clock, AlertTriangle, Eye, MousePointerClick } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface EmailLogPanelProps {
  /** Dossier concerné : filtre les emails et dépôts liés. */
  tenderId: string;
  /** Optionnel : restreindre aux dépôts d'un partenaire (par email). */
  partenaireEmail?: string;
}

interface EmailRow {
  id: string;
  type_email: string;
  destinataire: string;
  objet: string | null;
  statut: string;
  horodatage: string;
}

interface DepotRow {
  id: string;
  auteur_libelle: string | null;
  type_piece: string | null;
  nom_piece: string | null;
  created_at: string;
}

// Libellés lisibles par statut d'email, avec icône et couleur.
const STATUT_EMAIL: Record<string, { label: string; couleur: string; Icone: any }> = {
  envoye:  { label: 'Envoyé',   couleur: 'text-[#0B1F38]/50', Icone: Clock },
  livre:   { label: 'Livré',    couleur: 'text-[#007AA8]',    Icone: CheckCircle2 },
  ouvert:  { label: 'Ouvert',   couleur: 'text-[#00A3E0]',    Icone: Eye },
  clique:  { label: 'Cliqué',   couleur: 'text-green-600',    Icone: MousePointerClick },
  differe: { label: 'Différé',  couleur: 'text-amber-600',    Icone: Clock },
  bounce:  { label: 'Rejeté',   couleur: 'text-red-600',      Icone: AlertTriangle },
  plainte: { label: 'Plainte',  couleur: 'text-red-600',      Icone: AlertTriangle },
  erreur:  { label: 'Erreur',   couleur: 'text-red-600',      Icone: AlertTriangle },
};

const dateCourte = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Journal consultable des emails et dépôts liés à un dossier. La visibilité est
 * garantie par la RLS (migration 061) : le mandataire voit ses dossiers, l'admin
 * d'entreprise ceux de son entreprise. Le composant ne fait que lire.
 */
export const EmailLogPanel: React.FC<EmailLogPanelProps> = ({ tenderId, partenaireEmail }) => {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [depots, setDepots] = useState<DepotRow[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);

      // Emails liés au dossier (RLS filtre déjà à ce que l'utilisateur peut voir).
      let reqEmails = supabase
        .from('emails_envoyes')
        .select('id, type_email, destinataire, objet, statut, horodatage')
        .eq('objet_id', tenderId)
        .order('horodatage', { ascending: false })
        .limit(50);
      if (partenaireEmail) reqEmails = reqEmails.eq('destinataire', partenaireEmail);

      // Dépôts liés au dossier.
      let reqDepots = supabase
        .from('depots_pieces')
        .select('id, auteur_libelle, type_piece, nom_piece, created_at')
        .eq('tender_id', tenderId)
        .order('created_at', { ascending: false })
        .limit(50);

      const [resEmails, resDepots] = await Promise.all([reqEmails, reqDepots]);
      if (annule) return;

      if (resEmails.error) console.error('journal emails:', resEmails.error);
      if (resDepots.error) console.error('journal dépôts:', resDepots.error);

      setEmails((resEmails.data as EmailRow[]) || []);
      setDepots((resDepots.data as DepotRow[]) || []);
      setChargement(false);
    })();
    return () => { annule = true; };
  }, [tenderId, partenaireEmail]);

  if (chargement) {
    return <div className="py-6 text-center text-sm text-[#0B1F38]/40">Chargement du journal…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Emails */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-bold text-[#0B1F38] mb-2">
          <Mail size={14} /> Emails envoyés
        </h4>
        {emails.length === 0 ? (
          <p className="text-sm text-[#0B1F38]/40 italic">Aucun email pour ce dossier.</p>
        ) : (
          <ul className="space-y-1">
            {emails.map((e) => {
              const s = STATUT_EMAIL[e.statut] || STATUT_EMAIL.envoye;
              return (
                <li key={e.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/40 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-[#0B1F38]">{e.objet || e.type_email}</p>
                    <p className="truncate text-xs text-[#0B1F38]/50">{e.destinataire} · {dateCourte(e.horodatage)}</p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs font-semibold shrink-0 ${s.couleur}`}>
                    <s.Icone size={12} /> {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Dépôts */}
      <div>
        <h4 className="flex items-center gap-2 text-sm font-bold text-[#0B1F38] mb-2">
          <FileUp size={14} /> Dépôts de pièces
        </h4>
        {depots.length === 0 ? (
          <p className="text-sm text-[#0B1F38]/40 italic">Aucun dépôt pour ce dossier.</p>
        ) : (
          <ul className="space-y-1">
            {depots.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/40 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-[#0B1F38]">{d.type_piece || d.nom_piece || 'Pièce'}</p>
                  <p className="truncate text-xs text-[#0B1F38]/50">{d.auteur_libelle || 'Partenaire'} · {dateCourte(d.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
