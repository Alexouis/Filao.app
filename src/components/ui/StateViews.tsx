import React from 'react';
import { Loader2, AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Charte d'états réutilisable : vide / chargement / erreur.
 *
 * OBJECTIF
 * Aucun écran ne doit plus rester blanc. Chaque liste ou vue asynchrone affiche
 * l'un de ces trois états, avec une présentation homogène dans toute
 * l'application.
 *
 * La charte visuelle reprend le motif déjà employé dans l'app (icône large et
 * discrète, titre en capitales espacées, description secondaire, action
 * facultative) afin que l'homogénéisation ne change pas l'identité des écrans
 * existants.
 */

interface EmptyStateProps {
    /** Icône illustrant le contexte (liste vide, aucun résultat…). */
    icon?: LucideIcon;
    /** Titre court, l'information principale. */
    title: string;
    /** Précision facultative : pourquoi c'est vide, quoi faire ensuite. */
    description?: string;
    /** Action facultative (créer, réinitialiser les filtres…). */
    action?: { label: string; onClick: () => void };
    /** Compact pour les zones réduites (panneaux, cartes). */
    compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon: Icon = Inbox,
    title,
    description,
    action,
    compact = false,
}) => (
    <div className={`flex flex-col items-center justify-center text-center text-[#0B1F38]/40 ${compact ? 'py-8 gap-2' : 'h-full py-16 gap-4'}`}>
        <Icon size={compact ? 32 : 64} strokeWidth={1} className="opacity-20" />
        <p className={compact ? 'text-xs font-bold uppercase tracking-widest' : 'text-sm font-bold uppercase tracking-widest'}>
            {title}
        </p>
        {description && (
            <p className="text-xs text-center max-w-xs">{description}</p>
        )}
        {action && (
            <button
                onClick={action.onClick}
                className="text-xs font-bold text-[#00A3E0] hover:underline px-4 py-2 bg-[#00A3E0]/10 rounded-xl transition-colors"
            >
                {action.label}
            </button>
        )}
    </div>
);

interface LoadingStateProps {
    /** Message facultatif affiché sous l'indicateur. */
    label?: string;
    compact?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ label, compact = false }) => (
    <div className={`flex flex-col items-center justify-center gap-3 ${compact ? 'py-8' : 'h-full py-20'}`}>
        <Loader2 className="animate-spin text-[#00A3E0]" size={compact ? 24 : 32} />
        {label && <p className="text-xs text-[#0B1F38]/40">{label}</p>}
    </div>
);

interface ErrorStateProps {
    /** Titre de l'erreur, formulé pour l'utilisateur (pas un message technique). */
    title?: string;
    /** Détail facultatif : ce qui a échoué, ce qu'il peut faire. */
    description?: string;
    /** Relance de l'opération, quand elle est possible. */
    onRetry?: () => void;
    compact?: boolean;
}

/**
 * État d'erreur. On y affiche un message compréhensible plutôt que l'exception
 * brute : le détail technique reste dans la console pour le diagnostic.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
    title = 'Une erreur est survenue',
    description = "Le contenu n'a pas pu être chargé. Réessayez dans un instant.",
    onRetry,
    compact = false,
}) => (
    <div className={`flex flex-col items-center justify-center text-center gap-3 ${compact ? 'py-8' : 'h-full py-16 gap-4'}`}>
        <AlertTriangle size={compact ? 28 : 48} strokeWidth={1.5} className="text-[#FF8575]" />
        <p className={`font-bold text-[#0B1F38] ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
        {description && (
            <p className="text-xs text-[#0B1F38]/50 max-w-xs">{description}</p>
        )}
        {onRetry && (
            <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#00A3E0] hover:underline px-4 py-2 bg-[#00A3E0]/10 rounded-xl transition-colors"
            >
                <RefreshCw size={12} />
                Réessayer
            </button>
        )}
    </div>
);
