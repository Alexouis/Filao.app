import { useEffect, useRef, useCallback } from 'react';

/**
 * useHistoryStep — synchronise l'étape courante d'un wizard avec l'historique du
 * navigateur, pour que « Précédent » recule d'une étape au lieu de sortir de la
 * vue (ou de l'application).
 *
 * PROBLÈME RÉSOLU
 * Les étapes d'un wizard vivent dans un `useState` local, jamais empilé dans
 * l'historique : « Précédent » saute donc tout le wizard. Ce hook pousse une
 * entrée à chaque AVANCÉE, et laisse le navigateur piloter tous les RECULS via
 * `popstate` — y compris le bouton « Précédent » interne, qui doit appeler la
 * fonction `reculer` renvoyée (elle délègue à history.back()).
 *
 * MODÈLE À UNE SEULE SOURCE DE VÉRITÉ
 * - Avancer : `setStep(n)` puis l'effet empile l'entrée (n > précédent).
 * - Reculer : TOUJOURS via l'historique (`reculer()` -> history.back() ->
 *   `popstate` -> setStep). Aucun setStep « arrière » manuel, donc aucune
 *   désynchronisation possible entre l'historique et l'état.
 *
 * NETTOYAGE À LA FERMETURE
 * Le wizard se ferme souvent par un changement d'état React (pas par l'URL) :
 * ses entrées d'historique resteraient alors dans la pile et « pollueraient » le
 * bouton Précédent de l'écran suivant. Au démontage, on dépile exactement le
 * nombre d'entrées poussées (`history.go(-n)`), sauf si la fermeture vient déjà
 * d'un popstate (l'utilisateur a lui-même reculé).
 *
 * ÉVITER LA BOUCLE
 * `depuisPopstate` empêche l'effet d'avancée de repousser une entrée quand le
 * changement provient du navigateur.
 */
interface Options {
  /** Identifiant du wizard, pour ne réagir qu'à ses propres entrées. */
  key: string;
  /** Appelé quand l'utilisateur recule depuis l'étape 0 (sortie du wizard). */
  onExit?: () => void;
}

export function useHistoryStep(
  step: number,
  setStep: (n: number) => void,
  options: Options
) {
  const { key, onExit } = options;
  const depuisPopstate = useRef(false);
  const stepPrecedent = useRef(step);
  const stepRef = useRef(step);
  stepRef.current = step;

  // Nombre net d'entrées poussées par ce wizard, encore présentes dans la pile.
  const entreesEmpilees = useRef(0);

  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const etat = e.state;
      if (etat && etat.__wizard === key && typeof etat.step === 'number') {
        depuisPopstate.current = true;
        entreesEmpilees.current = Math.max(0, entreesEmpilees.current - 1);
        setStep(etat.step);
      } else if (stepRef.current > 0) {
        // Recul au-delà du début du wizard : sortie. Les entrées ont déjà été
        // dépilées par le navigateur, on remet le compteur à zéro.
        depuisPopstate.current = true;
        entreesEmpilees.current = 0;
        onExit?.();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [key, setStep, onExit]);

  useEffect(() => {
    if (depuisPopstate.current) {
      depuisPopstate.current = false;
      stepPrecedent.current = step;
      return;
    }
    if (step > stepPrecedent.current) {
      window.history.pushState({ __wizard: key, step }, '');
      entreesEmpilees.current += 1;
    }
    stepPrecedent.current = step;
  }, [step, key]);

  // Au démontage : consommer les entrées fantômes restantes. Sans cela, le
  // bouton Précédent de l'écran suivant repasserait par les étapes du wizard
  // fermé. `history.go(-n)` est asynchrone mais suffit à assainir la pile.
  useEffect(() => {
    return () => {
      const n = entreesEmpilees.current;
      if (n > 0) {
        entreesEmpilees.current = 0;
        try { window.history.go(-n); } catch { /* pile indisponible : sans effet */ }
      }
    };
  }, []);

  const reculer = useCallback(() => {
    window.history.back();
  }, []);

  return { reculer };
}
