import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useHistoryView — variante de `useHistoryStep` pour des sous-vues NOMMÉES
 * (au lieu d'un index d'étape numérique).
 *
 * Même principe éprouvé : la vue courante vit dans un paramètre d'URL géré par
 * react-router (`setSearchParams`), qui est la source de vérité. Le bouton
 * Précédent du navigateur revient donc naturellement à la sous-vue précédente,
 * au lieu de sortir de l'écran (ou de l'application).
 *
 * DIFFÉRENCE AVEC LE WIZARD
 * Un wizard est une séquence (0,1,2…) : on sait qu'un `n > précédent` est une
 * avance. Ici la navigation est un GRAPHE (start -> results -> decision, mais
 * aussi retours directs vers 'start'). On ne peut donc pas déduire le sens de la
 * transition ; toute navigation via `allerA` empile une entrée, et les retours
 * passent par l'historique (`reculer`) ou par une navigation explicite.
 *
 * VUES AUTORISÉES
 * La valeur lue depuis l'URL est validée contre la liste `vuesValides` : une URL
 * trafiquée ou obsolète ne peut pas placer le composant dans un état inconnu.
 */
interface Options<T extends string> {
  /** Nom du paramètre d'URL portant la vue. */
  key: string;
  /** Vues acceptées — toute autre valeur d'URL est ignorée. */
  vuesValides: readonly T[];
  /** Vue à considérer comme point d'entrée (aucune entrée empilée pour elle). */
  vueInitiale: T;
}

export function useHistoryView<T extends string>(
  vue: T,
  setVue: (v: T) => void,
  options: Options<T>
) {
  const { key, vuesValides, vueInitiale } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const setVueRef = useRef(setVue);
  setVueRef.current = setVue;
  const vueRef = useRef(vue);
  vueRef.current = vue;
  const sortieEnCours = useRef(false);

  const urlVueRaw = searchParams.get(key);
  const urlVue = (urlVueRaw && (vuesValides as readonly string[]).includes(urlVueRaw))
    ? (urlVueRaw as T)
    : null;

  // Montage : ancrer la vue courante dans l'URL sans empiler (replace), pour
  // qu'elle soit restaurable. Nettoyage du paramètre au démontage.
  useEffect(() => {
    if (searchParams.get(key) === null) {
      const p = new URLSearchParams(searchParams);
      p.set(key, vueRef.current);
      setSearchParams(p, { replace: true });
    }
    return () => {
      if (sortieEnCours.current) return;
      const p = new URLSearchParams(window.location.search);
      if (p.has(key)) {
        p.delete(key);
        setSearchParams(p, { replace: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // URL -> état local : le bouton Précédent (ou tout changement d'URL) réaligne
  // la vue affichée.
  useEffect(() => {
    if (urlVue && urlVue !== vueRef.current) {
      setVueRef.current(urlVue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlVueRaw]);

  /** Naviguer vers une sous-vue : empile une entrée d'historique. */
  const allerA = useCallback((v: T) => {
    const p = new URLSearchParams(window.location.search);
    p.set(key, v);
    setSearchParams(p); // push -> entrée d'historique
  }, [key, setSearchParams]);

  /** Reculer : délègue au navigateur, comme le bouton Précédent. */
  const reculer = useCallback(() => {
    window.history.back();
  }, []);

  /**
   * Sortie volontaire de l'écran : rembobine les entrées empilées par les
   * sous-vues pour ne pas laisser de traînée dans l'URL, puis exécute l'action.
   * `profondeur` = nombre d'entrées à consommer (0 si l'on est resté sur la vue
   * initiale).
   */
  const sortir = useCallback((action: () => void, profondeur: number) => {
    sortieEnCours.current = true;
    if (profondeur > 0) {
      try { window.history.go(-profondeur); } catch { /* pile indisponible */ }
    }
    action();
  }, []);

  return { allerA, reculer, sortir, vueInitiale };
}
