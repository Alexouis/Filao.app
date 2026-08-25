import { useEffect, useRef, useCallback } from 'react';

/**
 * Registre global de gardes « saisie non enregistrée ».
 *
 * Un écran qui contient un formulaire non sauvegardé y inscrit sa garde ; le
 * routeur de l'application (navigateTo) la consulte AVANT toute navigation
 * interne. Ce registre évite de faire remonter l'état « modifié » à travers
 * toute la hiérarchie de composants, tout en gardant un point de contrôle
 * unique et explicite.
 */
const gardes = new Set<() => boolean>();

/**
 * Consulte toutes les gardes enregistrées. Renvoie `true` si la navigation peut
 * se poursuivre, `false` si un écran a demandé à rester (l'utilisateur a
 * annulé). À appeler depuis la fonction de navigation de l'application.
 */
export const peutQuitter = (): boolean => {
  for (const garde of gardes) {
    if (!garde()) return false;
  }
  return true;
};

/**
 * useUnsavedChanges — avertit l'utilisateur avant qu'il ne perde une saisie non
 * enregistrée.
 *
 * DEUX MÉCANISMES COMPLÉMENTAIRES
 *
 *  1. `beforeunload` — couvre ce qui sort de l'application : fermeture de
 *     l'onglet, rechargement, saisie d'une autre URL. Le navigateur affiche sa
 *     propre boîte de dialogue (son texte n'est pas personnalisable, c'est une
 *     protection anti-abus des navigateurs modernes).
 *
 *  2. `confirmerSortie()` — à appeler AVANT toute navigation interne (changement
 *     d'onglet, fermeture d'un écran). Renvoie `true` si l'on peut continuer,
 *     `false` si l'utilisateur a choisi de rester. C'est un appel explicite :
 *     intercepter la navigation react-router de façon transparente demanderait
 *     un blocage global du routeur, plus intrusif et risqué. Un garde explicite
 *     aux points de sortie connus est plus prévisible.
 *
 * UTILISATION
 *   const { confirmerSortie } = useUnsavedChanges(estModifie);
 *   // au moment de quitter :
 *   if (!confirmerSortie()) return;
 *
 * `estModifie` doit refléter « il existe des modifications non enregistrées ».
 * Le hook ne calcule pas cet état : c'est au formulaire de le déterminer (voir
 * `useDirtyState` ci-dessous pour le cas courant d'un objet de formulaire).
 */
export function useUnsavedChanges(
  estModifie: boolean,
  message = 'Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter cette page ?'
) {
  const estModifieRef = useRef(estModifie);
  estModifieRef.current = estModifie;

  // Mécanisme 1 : sortie de l'application.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!estModifieRef.current) return;
      // La spec exige `preventDefault` + `returnValue` pour déclencher l'alerte.
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Mécanisme 2 : navigation interne. À appeler explicitement avant de quitter.
  const confirmerSortie = useCallback((): boolean => {
    if (!estModifieRef.current) return true;
    return window.confirm(message);
  }, [message]);

  // Inscription au registre global tant que l'écran est monté : la navigation
  // interne de l'application consultera cette garde automatiquement.
  useEffect(() => {
    gardes.add(confirmerSortie);
    return () => { gardes.delete(confirmerSortie); };
  }, [confirmerSortie]);

  return { confirmerSortie };
}

/**
 * useDirtyState — détecte si un objet de formulaire diffère de sa dernière
 * version enregistrée.
 *
 * ATTENTION AU CHARGEMENT ASYNCHRONE
 * Les formulaires de l'app sont remplis après un appel réseau : au premier
 * rendu, l'objet est vide. Capturer cette valeur vide comme référence ferait
 * apparaître le formulaire « modifié » dès l'arrivée des données. La référence
 * n'est donc PAS posée automatiquement : le formulaire appelle
 * `marquerEnregistre(valeur)` une fois les données chargées, puis après chaque
 * sauvegarde réussie. Tant qu'aucune référence n'existe, rien n'est considéré
 * comme modifié.
 *
 * La comparaison est une égalité structurelle par sérialisation : suffisante
 * pour des objets de formulaire plats, et sans dépendance externe.
 */
export function useDirtyState<T>(valeurCourante: T): {
  estModifie: boolean;
  marquerEnregistre: (valeur: T) => void;
} {
  const reference = useRef<string | null>(null);

  const marquerEnregistre = useCallback((valeur: T) => {
    reference.current = safeStringify(valeur);
  }, []);

  return {
    // Aucune référence => données pas encore chargées => rien à protéger.
    estModifie: reference.current !== null && reference.current !== safeStringify(valeurCourante),
    marquerEnregistre,
  };
}

// Sérialisation tolérante : une valeur non sérialisable ne doit jamais faire
// planter la détection (au pire, on considère l'état comme modifié).
const safeStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(Date.now());
  }
};
