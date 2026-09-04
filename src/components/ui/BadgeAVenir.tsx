import React from 'react';

/**
 * Pastille « Bientôt » — signale une fonctionnalité visible mais pas encore
 * active, pour qu'un testeur ou un client ne la prenne pas pour un bug.
 *
 * Reprend le style du `Pill` vert déjà employé dans le wizard de création
 * (`rgba(11,143,172,0.15)` sur `#0B8FAC`), factorisé ici pour rester cohérent
 * partout où on tague une fonctionnalité à venir.
 */
export const BadgeAVenir: React.FC<{ libelle?: string; className?: string }> = ({
    libelle = 'Bientôt',
    className,
}) => (
    <span
        className={className}
        style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 10,
            background: 'rgba(11,143,172,0.15)',
            color: '#0B8FAC',
            fontWeight: 500,
            whiteSpace: 'nowrap',
        }}
    >
        {libelle}
    </span>
);
