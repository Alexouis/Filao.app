import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * Petits éléments d'affichage de la fiche entreprise.
 *
 * POURQUOI CE FICHIER
 * Ils étaient définis À L'INTÉRIEUR de `CompanyTab`. React recrée alors le
 * composant à chaque rendu du parent : il ne s'agit plus du même type d'un
 * rendu à l'autre, donc l'arbre est démonté puis remonté au lieu d'être mis à
 * jour. Sur une fiche qui en compte une vingtaine, c'est du travail pour rien
 * à chaque frappe dans un champ.
 *
 * Aucun d'eux ne dépend de l'état du parent — les sortir ne coûte rien.
 */

/**
 * Une étiquette et sa valeur. Une valeur absente n'est pas masquée mais
 * signalée : « Non renseigné » indique quoi compléter, alors qu'un champ
 * escamoté laisse croire qu'il n'existe pas.
 */
export const InfoItem: React.FC<{
    label: string;
    value: React.ReactNode;
    icon?: any;
}> = ({ label, value, icon: Icon }) => (
    <div>
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-0.5">{label}</p>
        <div className="flex items-center gap-1.5 text-sm text-gray-900">
            {Icon && <Icon size={14} className="text-gray-400 shrink-0" />}
            {value || <span className="text-gray-400 italic text-xs">Non renseigné</span>}
        </div>
    </div>
);

/** Entreprise dont les données proviennent d'une recherche SIRET. */
export const VerifiedBadge: React.FC = () => (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <ShieldCheck size={14} />
        Vérifié via SIRET
    </span>
);

/** Entreprise saisie à la main : les informations n'engagent que son auteur. */
export const UnverifiedBadge: React.FC = () => (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <ShieldAlert size={14} />
        Non vérifié
    </span>
);
