import { useEffect, useRef, type RefObject } from 'react';

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
 * 3. LE FOCUS RESTE DANS LA MODALE. En tabulant, on finissait par atteindre
 *    les éléments situés DERRIÈRE le voile : l'indicateur de focus disparaît,
 *    et l'on agit à l'aveugle sur une page censée être hors d'atteinte.
 *    `aria-modal="true"` traitait déjà le cas des lecteurs d'écran ; il
 *    restait l'utilisateur clavier voyant.
 *
 *    Le confinement n'est appliqué QUE si `refModale` est attachée et qu'elle
 *    contient au moins un élément focalisable. Un piège dont on ne peut pas
 *    sortir est une infraction plus grave que celle qu'on corrige (WCAG 2.1.2,
 *    niveau A) : à défaut de cible sûre, on préfère ne rien confiner. Échap
 *    reste de toute façon une sortie, en toutes circonstances.
 *
 * USAGE
 *
 *   export const MaModale = ({ ouvert, onFermer }) => {
 *       const refModale = useModale(ouvert, onFermer);
 *       if (!ouvert) return null;
 *       return <div ref={refModale} role="dialog" aria-modal="true">…</div>;
 *   };
 *
 * Ignorer la référence retournée reste valable : on garde alors Échap et la
 * restauration du focus, sans confinement.
 */

/**
 * Sélecteur des éléments atteignables au clavier.
 *
 * `tabindex="-1"` est exclu : ces éléments se focalisent par programme mais ne
 * sont pas dans l'ordre de tabulation, les inclure ferait boucler sur des
 * cibles que l'utilisateur ne peut pas atteindre lui-même.
 */
const FOCALISABLES = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[tabindex]', 'audio[controls]', 'video[controls]', '[contenteditable]',
].map((s) => `${s}:not([disabled]):not([tabindex="-1"])`).join(',');

/** Éléments réellement atteignables : ni désactivés, ni masqués. */
const cibles = (racine: HTMLElement): HTMLElement[] =>
    Array.from(racine.querySelectorAll<HTMLElement>(FOCALISABLES))
        // `offsetParent` vaut `null` pour un élément en `display:none` — un
        // panneau replié ne doit pas capter le focus.
        .filter((el) => el.offsetParent !== null || el === document.activeElement);

/** Modales ouvertes, de la plus ancienne à la plus récente. */
type Entree = { fermer: () => void; racine: RefObject<HTMLElement | null> };
const pile: Entree[] = [];

let ecouteurPose = false;

const surTouche = (e: KeyboardEvent) => {
    const dessus = pile[pile.length - 1];
    if (!dessus) return;

    if (e.key === 'Escape') {
        // `stopPropagation` n'aurait pas suffi : les écouteurs sont posés sur
        // le même nœud, l'ordre d'appel n'est donc pas garanti par
        // l'imbrication.
        e.stopPropagation();
        dessus.fermer();
        return;
    }

    if (e.key !== 'Tab') return;

    const racine = dessus.racine.current;
    if (!racine) return;                       // référence non attachée
    const atteignables = cibles(racine);
    if (atteignables.length === 0) return;     // rien où confiner

    const premier = atteignables[0];
    const dernier = atteignables[atteignables.length - 1];
    const actif = document.activeElement;

    // Le focus a pu rester dehors — la modale vient de s'ouvrir, ou l'on
    // revient d'un clic sur le fond. On le ramène plutôt que de le laisser
    // filer vers la page.
    if (!racine.contains(actif)) {
        e.preventDefault();
        (e.shiftKey ? dernier : premier).focus();
        return;
    }

    if (!e.shiftKey && actif === dernier) {
        e.preventDefault();
        premier.focus();
    } else if (e.shiftKey && actif === premier) {
        e.preventDefault();
        dernier.focus();
    }
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
export const useModale = (
    ouvert: boolean,
    onFermer: () => void
): RefObject<HTMLElement | null> => {
    const refModale = useRef<HTMLElement | null>(null);

    // Le rappel change d'identité à chaque rendu du parent. On le lit par
    // référence pour ne pas réinscrire la modale — ce qui la ferait remonter
    // au sommet de la pile et volerait Échap à celle réellement au-dessus.
    const rappel = useRef(onFermer);
    rappel.current = onFermer;

    useEffect(() => {
        if (!ouvert) return;

        const precedent = document.activeElement as HTMLElement | null;

        const entree: Entree = { fermer: () => rappel.current(), racine: refModale };
        pile.push(entree);
        poserEcouteur();

        // Le focus entre dans la modale à l'ouverture. Sans cela, la première
        // tabulation partirait vers la page derrière le voile, et un lecteur
        // d'écran continuerait d'annoncer le contenu précédent.
        const racine = refModale.current;
        if (racine) {
            const premier = cibles(racine)[0];
            if (premier) premier.focus();
            else if (racine.tabIndex >= 0) racine.focus();
        }

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

    return refModale;
};

/** Remise à zéro entre deux tests. Sans usage en production. */
export const __reinitialiserPileModales = () => {
    pile.length = 0;
    retirerEcouteur();
};
