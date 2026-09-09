import React from 'react';
import {
  X, Building2, Calendar, Euro, Users, Lock, Briefcase, MapPin, Tag, Clock
} from 'lucide-react'; 
import type { Tender } from '../types';
import { reparerEncodage } from '../helpers/boampHelpers';
import { getEffectiveStatus } from '@/helpers/tenderHelpers';
import { useModale } from '../helpers/useModale';

/**
 * Consultation d'un dossier porté par un collègue.
 *
 * Depuis la migration 092, tout membre de l'entreprise voit qu'un dossier
 * existe, sans accéder à son contenu. Le wizard ne convenait pas : il suppose
 * qu'on écrit, et ses sections « échanges » et « pièces » seraient vides sans
 * qu'on sache si c'est un droit manquant ou un bug de chargement.
 *
 * Ce panneau n'affiche que ce que la RLS autorise réellement à ce profil :
 * l'en-tête du dossier et la composition du groupement (migration 095). Il ne
 * tente RIEN d'autre — pas de requête sur les commentaires, la messagerie ou
 * les pièces, qui reviendrait vide.
 *
 * Les documents sont volontairement absents. Ce sont des pièces de tiers, et
 * `dce_documents` transporte leurs chemins de stockage : les afficher
 * reviendrait à les diffuser.
 */

interface TenderReadOnlyPanelProps {
  tender: Tender | null;
  onClose: () => void;
}

const formaterMontant = (montant?: number) => {
  if (!montant || montant <= 0) return null;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(montant);
};

const formaterDate = (valeur?: string) => {
  if (!valeur) return null;
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
};

const joursRestants = (valeur?: string) => {
  if (!valeur) return null;
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

export const TenderReadOnlyPanel: React.FC<TenderReadOnlyPanelProps> = ({ tender, onClose }) => {
  useModale(!!tender, onClose);

  if (!tender) return null;

  const porteur = [tender.createur?.prenom, tender.createur?.nom]
    .filter(Boolean).join(' ').trim();
  const montant = formaterMontant(tender.montant_estime);
  const echeance = formaterDate(tender.date_limite);
  const jours = joursRestants(tender.date_limite);
  const statut = getEffectiveStatus(tender);

  // Le mandataire est inscrit dans `groupements` avec sa propre entreprise
  // (TenderWizard) : on l'isole pour ne pas le présenter comme un partenaire.
  const partenaires = (tender.groupements || [])
    .filter((g: any) => (g.role_groupement || '') !== 'Mandataire');

  const lieux = Array.isArray(tender.lieu_execution)
    ? tender.lieu_execution.filter(Boolean)
    : [];

  const Ligne: React.FC<{ icone: React.ReactNode; libelle: string; children: React.ReactNode }> =
    ({ icone, libelle, children }) => (
      <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
        <div className="text-[#00A3E0] mt-0.5 shrink-0">{icone}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#0B1F38]/40">{libelle}</p>
          <div className="text-sm text-[#0B1F38] mt-0.5 break-words">{children}</div>
        </div>
      </div>
    );

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div
        className="absolute inset-0 bg-[#0B1F38]/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Consultation du dossier ${tender.titre || ''}`}
        className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        <header className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 uppercase tracking-tight">
              <Lock size={10} /> Lecture seule
            </span>
            <h2 className="text-lg font-bold text-[#0B1F38] mt-2 leading-tight">
              {reparerEncodage(tender.titre) || 'Dossier sans intitulé'}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 rounded-xl hover:bg-gray-100 text-[#0B1F38]/50 hover:text-[#0B1F38] transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          <Ligne icone={<Briefcase size={16} />} libelle="Porté par">
            {porteur || 'Un collègue de votre entreprise'}
          </Ligne>

          {tender.organisme_acheteur && (
            <Ligne icone={<Building2 size={16} />} libelle="Acheteur">
              {reparerEncodage(tender.organisme_acheteur)}
            </Ligne>
          )}

          <Ligne icone={<Clock size={16} />} libelle="Statut">
            {statut}
          </Ligne>

          {echeance && (
            <Ligne icone={<Calendar size={16} />} libelle="Échéance">
              {echeance}
              {jours !== null && (
                <span className={`ml-2 text-xs font-bold ${
                  jours < 0 ? 'text-gray-400' : jours <= 7 ? 'text-[#FF8575]' : 'text-[#0B1F38]/40'
                }`}>
                  {jours < 0
                    ? 'échue'
                    : jours === 0 ? "aujourd'hui" : `dans ${jours} jour${jours > 1 ? 's' : ''}`}
                </span>
              )}
            </Ligne>
          )}

          {montant && (
            <Ligne icone={<Euro size={16} />} libelle="Montant estimé">
              {montant}
            </Ligne>
          )}

          {tender.secteur_activite && (
            <Ligne icone={<Tag size={16} />} libelle="Secteur">
              {reparerEncodage(tender.secteur_activite)}
            </Ligne>
          )}

          {lieux.length > 0 && (
            <Ligne icone={<MapPin size={16} />} libelle="Lieu d'exécution">
              {lieux.map(l => reparerEncodage(l)).join(', ')}
            </Ligne>
          )}

          <Ligne icone={<Users size={16} />} libelle="Groupement">
            {partenaires.length === 0 ? (
              <span className="text-[#0B1F38]/40">Candidature seule, sans cotraitant.</span>
            ) : (
              <ul className="space-y-1.5 mt-1">
                {partenaires.map((g: any) => (
                  <li key={g.id} className="flex items-center justify-between gap-3">
                    <span className="truncate">{g.entreprise?.nom || 'Entreprise partenaire'}</span>
                    <span className="text-[10px] font-bold uppercase tracking-tight text-[#0B1F38]/40 shrink-0">
                      {g.role_groupement || 'Cotraitant'}
                      {g.statut === 'invite' && ' · en attente'}
                      {g.statut === 'refuse' && ' · refusé'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Ligne>
        </div>

        {/* Dire ce qui manque et pourquoi. Un panneau qui s'arrête sans
            explication laisse croire à une fiche incomplète. */}
        <footer className="px-6 py-4 border-t border-gray-100 bg-[#F8FAFC] shrink-0">
          <p className="text-xs text-[#0B1F38]/60 leading-relaxed">
            Les échanges, les commentaires et les pièces du dossier restent
            réservés à son porteur et à ses cotraitants.
            {porteur
              ? ` Pour y accéder, demandez à ${porteur} ou à un administrateur de votre entreprise.`
              : " Pour y accéder, demandez au porteur ou à un administrateur de votre entreprise."}
          </p>
        </footer>
      </aside>
    </div>
  );
};
