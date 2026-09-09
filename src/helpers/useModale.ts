import { useEffect, useRef } from 'react';

/**
 * Comportement clavier commun à toutes les boîtes de dialogue.
 *
 * CE QU'IL RÈGLE
 *
 * 1. ÉCHAP FERME. C'est le premier réflexe devant un dialogue, et son absence
 *    se remarque comme un défaut. Sans lui, sortir demandait de viser le fond
 *    flouté ou de retrouver le bouton Annuler — une friction qui se répète
 *    d'autant plus que le wizard enchaîne les modales.
 *
 * 2. LE FOCUS REVIENT D'OÙ IL VENAIT. À la fermeture, le focus retombait sur
 *    `<body>` : la tabulation suivante repartait du haut de la page. Sur un
 *    écran comme `TenderWizard`, cela veut dire retraverser tout le formulaire
 *    pour revenir là où on était — et le payer autant de fois qu'on ouvre une
 *    modale.
 *
 * POURQUOI UNE PILE, ET PAS UN ÉCOUTEUR PAR MODALE
 * Trois implémentations séparées existaient déjà, chacune posant son propre
 * `keydown` sur `window`. Quand une modale s'ouvre par-dessus une autre — une
 * confirmation au-dessus du détail d'un membre — les deux écouteurs répondent
 * et Échap ferme les DEUX d'un coup. On tient donc une pile au niveau du
 * module : seule la modale du dessus réagit, et un seul écouteur est posé,
 * quel que soit le nombre de dialogues ouverts.
 *
 * CE QU'IL NE FAIT PAS ENCORE
 * Le focus n'est pas piégé dans la modale : en tabulant, on finit par
 * atteindre des éléments situés derrière le voile. `aria-modal="true"` traite
 * déjà le cas des lecteurs d'écran ; reste l'utilisateur clavier voyant. Un
 * piège mal écrit enferme pour de bon (WCAG 2.1.2), donc ce sera un lot à
 * part, avec ses propres tests.
 *
 * USAGE
 *
 *   export const MaModale = ({ ouvert, onFermer }) => {
 *       useModale(ouvert, onFermer);
 *       if (!ouvert) return null;
 *       return <div role="dialog" aria-modal="true">…</div>;
 *   };
 */

/** Modales ouvertes, de la plus ancienne à la plus récente. */
type Entree = { fermer: () => void };
const pile: Entree[] = [];

let ecouteurPose = false;

const surTouche = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const dessus = pile[pile.length - 1];
    if (!dessus) return;
    // `stopPropagation` n'aurait pas suffi : les écouteurs sont posés sur le
    // même nœud, l'ordre d'appel n'est donc pas garanti par l'imbrication.
    e.stopPropagation();
    dessus.fermer();
};

const poserEcouteur = () => {
    if (ecouteurPose || typeof document === 'undefined') return;
    document.addEventListener('keydown', surTouche);
    ecouteurPose = true;
};

const retirerEcouteur = () => {
    if (!ecouteurPose || pile.length > 0) return;
    document.removeEventListener('keydown', surTouche);
    ecouteurPose = false;
};

/**
 * @param ouvert la modale est-elle affichée ? Passer `false` désinscrit tout.
 * @param onFermer fermeture demandée par l'utilisateur (Échap).
 */
export const useModale = (ouvert: boolean, onFermer: () => void): void => {
    // Le rappel change d'identité à chaque rendu du parent. On le lit par
    // référence pour ne pas réinscrire la modale — ce qui la ferait remonter
    // au sommet de la pile et volerait Échap à celle réellement au-dessus.
    const rappel = useRef(onFermer);
    rappel.current = onFermer;

    useEffect(() => {
        if (!ouvert) return;

        const precedent = document.activeElement as HTMLElement | null;

        const entree: Entree = { fermer: () => rappel.current() };
        pile.push(entree);
        poserEcouteur();

        return () => {
            const i = pile.indexOf(entree);
            if (i !== -1) pile.splice(i, 1);
            retirerEcouteur();

            // On ne rend le focus que si l'élément d'origine est encore là :
            // il a pu disparaître avec la liste qui le contenait, auquel cas
            // `focus()` sur un nœud détaché ne fait rien de bon.
            if (precedent && precedent !== document.body && document.contains(precedent)) {
                precedent.focus();
            }
        };
    }, [ouvert]);
};

/** Remise à zéro entre deux tests. Sans usage en production. */
export const __reinitialiserPileModales = () => {
    pile.length = 0;
    retirerEcouteur();
};
