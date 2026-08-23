import { useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * useHistoryStep — synchronise l'étape d'un wizard avec l'URL via react-router,
 * pour que « Précédent » recule d'une étape.
 *
 * POURQUOI REACT-ROUTER PLUTÔT QUE history.pushState
 * L'app pilote déjà sa navigation (onglets, ouverture d'AO) avec
 * `setSearchParams`, et ça fonctionne — y compris sous React.StrictMode, qui
 * casse les manipulations manuelles de l'API History (double-exécution des
 * effets). On réutilise donc ce mécanisme éprouvé : l'étape vit dans un
 * paramètre d'URL (`wstep`), source de vérité unique.
 *
 * FONCTIONNEMENT
 *  - L'URL `?wstep=n` est la vérité. Un effet recopie sa valeur dans le `step`
 *    local du composant (qui s'en sert partout pour le rendu).
 *  - Avancer : `setSearchParams` en mode push -> nouvelle entrée d'historique.
 *  - Reculer (bouton interne) : `reculer()` -> history.back(), que react-router
 *    interprète en repassant à l'entrée précédente -> l'URL change -> le `step`
 *    local suit. Le bouton Précédent du navigateur fait exactement pareil.
 *  - Au démontage du wizard, on retire `wstep` de l'URL (remplacement, sans
 *    empiler) pour ne pas laisser traîner le paramètre.
 *
 * Comme react-router gère lui-même l'historique et StrictMode, il n'y a ni
 * compteur manuel ni écoute de `popstate` à maintenir.
 */
interface Options {
  /** Nom du paramètre d'URL portant l'étape (unique par wizard). */
  key: string;
  /** Appelé quand l'utilisateur recule depuis l'étape initiale (sortie). */
  onExit?: () => void;
}

export function useHistoryStep(
  step: number,
  setStep: (n: number) => void,
  options: Options
) {
  const { key, onExit } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const setStepRef = useRef(setStep);
  setStepRef.current = setStep;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const stepRef = useRef(step);
  stepRef.current = step;

  // Étape lue depuis l'URL (source de vérité). Absente => étape 0.
  const urlStepRaw = searchParams.get(key);
  const urlStep = urlStepRaw !== null ? parseInt(urlStepRaw, 10) : 0;

  // Au montage : inscrire l'étape initiale dans l'URL sans empiler d'entrée
  // (replace). Cela crée le point d'ancrage auquel « Précédent » pourra revenir.
  useEffect(() => {
    if (searchParams.get(key) === null) {
      const p = new URLSearchParams(searchParams);
      p.set(key, String(stepRef.current));
      setSearchParams(p, { replace: true });
    }
    // Nettoyage au démontage : retirer le paramètre d'étape.
    return () => {
      const p = new URLSearchParams(window.location.search);
      if (p.has(key)) {
        p.delete(key);
        setSearchParams(p, { replace: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // URL -> état local : quand l'URL change (Précédent navigateur, history.back),
  // on aligne le `step` du composant.
  useEffect(() => {
    if (urlStepRaw === null) return;
    if (!Number.isNaN(urlStep) && urlStep !== stepRef.current) {
      setStepRef.current(urlStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlStepRaw]);

  // Avancer/naviguer : pousse une nouvelle entrée d'historique avec l'étape.
  const allerA = useCallback((n: number) => {
    const p = new URLSearchParams(window.location.search);
    p.set(key, String(n));
    setSearchParams(p); // push par défaut -> entrée d'historique
  }, [key, setSearchParams]);

  // Reculer : délègue à l'historique du navigateur (comme le bouton Précédent).
  // Si on est déjà à l'étape 0, on sort du wizard.
  const reculer = useCallback(() => {
    if (stepRef.current <= 0) {
      onExitRef.current?.();
      return;
    }
    window.history.back();
  }, []);

  return { reculer, allerA };
}
