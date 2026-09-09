import React from 'react';

/**
 * Attente d'un écran chargé à la demande.
 *
 * Reprend exactement le voyant déjà utilisé pendant le chargement du profil,
 * pour qu'un enchaînement « profil puis écran » ne fasse pas changer
 * l'animation en cours de route — ce qui donnerait l'impression de deux
 * chargements successifs là où il n'y en a qu'un du point de vue de
 * l'utilisateur.
 *
 * `role="status"` et le libellé masqué existent parce qu'une animation seule
 * n'est pas annoncée : sans eux, un lecteur d'écran ne dit rien pendant que
 * le morceau se télécharge.
 */
export const EcranEnChargement: React.FC = () => (
    <div className="min-h-screen flex items-center justify-center bg-filao-surface" role="status">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-filao-primary" aria-hidden="true" />
        <span className="sr-only">Chargement en cours…</span>
    </div>
);
