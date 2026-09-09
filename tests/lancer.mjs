#!/usr/bin/env node
/**
 * Lanceur des suites de tests.
 *
 * POURQUOI CE SCRIPT EXISTE PLUTÔT QU'UNE LIGNE DANS `package.json`
 *
 * Les composants importent `supabaseClient`, et `createClient()` arme dès
 * l'import un minuteur de rafraîchissement de jeton et une connexion temps
 * réel. Ces poignées gardent la boucle d'événements ouverte : sans aide, le
 * processus de test ne rend jamais la main. D'où `--test-force-exit`.
 *
 * Mais `--test-force-exit` coupe le processus sans attendre que le
 * compte-rendu ait traversé le tube entre le lanceur et le processus fils.
 * Tant que la suite DOM tenait en une trentaine de tests, ça passait. Passé
 * une cinquantaine, le compte-rendu s'est mis à être TRONQUÉ de façon
 * aléatoire — 68, puis 66, puis 43 tests d'un lancement à l'autre, en
 * rapportant toujours zéro échec. Une CI verte ne prouvait plus que la suite
 * entière avait tourné : le pire mode de défaillance pour un filet de
 * sécurité.
 *
 * La parade est de supprimer le tube : avec l'isolation désactivée, les tests
 * s'exécutent dans le processus du lanceur, il n'y a plus rien à transmettre
 * et le compte est exact. Vérifié sur plusieurs dizaines de lancements.
 *
 * Le drapeau correspondant a été stabilisé et renommé en cours de route
 * (`--experimental-test-isolation` → `--test-isolation`). On détecte donc
 * lequel le Node courant accepte, plutôt que d'en figer un et de casser la
 * CI le jour d'une montée de version.
 *
 * Enfin, chaque suite tourne dans SON invocation : sans isolation, deux
 * fichiers partageraient le même processus, et le `after()` de l'un
 * désinscrirait happy-dom pendant que l'autre s'en sert encore.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chemin de `tsx`. On vise le binaire local plutôt que le `PATH` : le script
 * doit fonctionner qu'il soit appelé par `npm test` — qui ajoute
 * `node_modules/.bin` au `PATH` — ou directement à la main.
 */
const tsx = () => {
    const base = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    for (const chemin of [`${base}.cmd`, base]) {
        if (existsSync(chemin)) return chemin;
    }
    return 'tsx';
};

/** Le drapeau d'isolation accepté par ce Node, ou `null` s'il n'en accepte aucun. */
const drapeauIsolation = () => {
    for (const nom of ['--test-isolation=none', '--experimental-test-isolation=none']) {
        const r = spawnSync(process.execPath, [nom, '-e', ''], { encoding: 'utf8' });
        if (r.status === 0) return nom;
    }
    return null;
};

const isolation = drapeauIsolation();
if (!isolation) {
    console.warn(
        "Aucun drapeau d'isolation reconnu par ce Node : le compte-rendu des suites\n" +
        "DOM peut être tronqué. Vérifier la sortie plutôt que le seul code de retour."
    );
}

/** `dom: true` → la suite a besoin de happy-dom, donc de la sortie forcée. */
const SUITES = [
    { fichier: 'tests/unit.test.ts', dom: false },
    { fichier: 'tests/navigateur.test.ts', dom: true },
    { fichier: 'tests/composants.test.ts', dom: true },
];

let echec = false;

for (const { fichier, dom } of SUITES) {
    const args = ['--test'];
    if (dom) {
        args.push('--test-force-exit');
        if (isolation) args.push(isolation);
    }
    args.push(fichier);

    console.log(`\n── ${fichier} ${'─'.repeat(Math.max(0, 56 - fichier.length))}`);
    // `shell: true` est nécessaire sous Windows, où `tsx` est un `.cmd`.
    const r = spawnSync(tsx(), args, { stdio: 'inherit', shell: true });
    if (r.status !== 0) echec = true;
}

process.exit(echec ? 1 : 0);
