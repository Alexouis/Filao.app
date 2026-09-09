import React from 'react';

/**
 * Fond flouté d'une boîte de dialogue.
 *
 * LA RÈGLE QU'IL REND EXPLICITE
 * Le clic sur le fond ferme une modale de CHOIX ou de LECTURE, et ne ferme pas
 * une modale de SAISIE. La distinction n'est pas cosmétique : viser le bord
 * d'une modale et manquer de quelques pixels est une erreur courante, et sur
 * un formulaire à demi rempli elle coûte tout le travail engagé. Échap et le
 * bouton Annuler restent les sorties dans les deux cas — la différence est
 * qu'ils sont délibérés.
 *
 * L'application appliquait déjà cette règle à moitié, sans l'avoir écrite :
 * le tiroir de messagerie et les formulaires d'invitation ignoraient le clic,
 * mais l'édition du contexte et le choix des critères se refermaient dessus,
 * saisie comprise.
 *
 *   <FondModale onFermer={onFermer} />   // choix ou lecture : le clic ferme
 *   <FondModale />                       // saisie en cours : le clic est ignoré
 *
 * Le fond est un frère du dialogue, pas son parent : un clic à l'intérieur de
 * la modale ne peut donc pas l'atteindre par propagation. C'est ce qui permet
 * de se passer du test sur `currentTarget` que traînaient certaines modales —
 * là où le fond et le conteneur étaient le même élément, une réponse cochée
 * refermait la modale.
 *
 * `aria-hidden` : purement décoratif, il n'a rien à annoncer. La fermeture au
 * clavier passe par Échap, gérée par `useModale`.
 */
export interface FondModaleProps {
    /** Fourni ⇒ le clic ferme. Omis ⇒ le clic est ignoré. */
    onFermer?: () => void;
    /** Habillage, quand une modale a besoin d'un voile plus ou moins dense. */
    className?: string;
}

export const FondModale: React.FC<FondModaleProps> = ({
    onFermer,
    className = 'bg-[#0B1F38]/60 backdrop-blur-md',
}) => (
    <div
        aria-hidden="true"
        onClick={onFermer}
        className={`absolute inset-0 ${className} ${onFermer ? '' : 'pointer-events-none'}`}
    />
);
