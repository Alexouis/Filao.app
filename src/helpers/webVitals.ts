import { onLCP, onINP, onCLS, type Metric } from 'web-vitals';
import { track, masquerChemin } from './analytics';

/**
 * Collecte des Web Vitals (LCP, INP, CLS) et émission via le module analytics.
 *
 * Chaque métrique est envoyée comme un événement `web_vital` avec le nom de la
 * métrique, sa valeur, et l'écran (chemin masqué — jamais de token dans l'URL).
 * L'alerte « p75 d'une transition > 1 s » relève de la configuration du tableau
 * de bord analytics (PostHog), pas du client : on émet la donnée brute, le seuil
 * s'évalue côté outil.
 *
 * CLS est sans unité ; LCP et INP sont en millisecondes. On arrondit pour ne pas
 * émettre de bruit décimal.
 */

const envoyerMetrique = (metric: Metric) => {
  const valeur = metric.name === 'CLS'
    ? Math.round(metric.value * 1000) / 1000
    : Math.round(metric.value);

  track('web_vital', {
    metrique: metric.name,
    valeur,
    ecran: masquerChemin(window.location.pathname),
  });
};

/**
 * Démarre la collecte. À appeler une fois au démarrage de l'application.
 * Les callbacks se déclenchent au fil de la navigation et à la fermeture.
 */
export const initWebVitals = (): void => {
  try {
    onLCP(envoyerMetrique);
    onINP(envoyerMetrique);
    onCLS(envoyerMetrique);
  } catch {
    // La collecte des Web Vitals ne doit jamais interrompre l'application.
  }
};
