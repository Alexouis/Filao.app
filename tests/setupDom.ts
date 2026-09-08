/**
 * Environnement DOM pour les tests de composants.
 *
 * POURQUOI CE FICHIER
 * Les tests tournent sous le lanceur intégré de Node, qui n'a pas de DOM.
 * `happy-dom` en installe un dans les globales avant que React ne soit chargé —
 * d'où un module séparé, importé EN PREMIER par les tests de composants.
 *
 * On n'utilise pas Vitest ni Jest : la suite existante repose sur `node:test`
 * et `tsx`, et ajouter un second lanceur pour quelques tests de rendu
 * coûterait plus qu'il ne rapporte.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let installe = false;

/** Installe le DOM une seule fois, quel que soit le nombre de fichiers. */
export const installerDom = () => {
    if (installe) return;
    GlobalRegistrator.register();
    installe = true;
};

installerDom();
