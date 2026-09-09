# Filao — gestion d'appels d'offres

Application web de pilotage d'appels d'offres publics : suivi des dossiers,
constitution de groupements, dépôt des pièces, rétroplanning et facturation.

- **Front** : React 19, TypeScript, Vite, Tailwind CSS 4, React Router 7
- **Back** : Supabase — PostgreSQL avec RLS stricte, Auth, Storage, et des
  Edge Functions Deno. Aucune logique de sécurité côté client.

## Prérequis

Node.js 24. La CI utilise cette version : les tests s'appuient sur le lanceur
intégré `node:test` et sur `--test-force-exit`, dont le comportement a changé
d'une version à l'autre.

## Démarrage

```bash
npm install
cp .env.example .env.local   # puis renseigner les deux variables
npm run dev                  # http://localhost:3000
```

### Variables d'environnement

Seules deux variables sont lues par le client. Le préfixe `VITE_` est ce qui
les rend visibles dans le bundle : **n'y mettre aucun secret.**

| Variable | Rôle |
| --- | --- |
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé anonyme — publique par conception, l'isolation repose sur les policies RLS |

Les secrets réels (clé `service_role`, clés Stripe, identifiants SMTP) vivent
dans les variables des Edge Functions, jamais dans ce dépôt ni dans le bundle.

Hors Vite — sous Node, pendant les tests — `import.meta.env` n'existe pas :
`src/lib/supabaseClient.ts` retombe sur une adresse factice pour rester
importable, sans jamais viser un vrai projet par accident.

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production dans `dist/` |
| `npm run preview` | Sert le build |
| `npm run typecheck` | `tsc --noEmit` sur `src` et `tests` |
| `npm test` | Tests unitaires, helpers navigateur, puis composants |

Le typage exclut `supabase/functions` : ces fonctions tournent sous Deno, avec
des imports par URL et le global `Deno`, que ce compilateur ne connaît pas.

## Tests

Trois fichiers, exécutés par `node:test` via `tsx` — ni Vitest ni Jest.

- `tests/unit.test.ts` — logique métier pure, sans DOM ni backend
- `tests/navigateur.test.ts` — helpers lisant `window`, `document`, `sessionStorage`
- `tests/composants.test.ts` — rendu et décisions d'affichage (happy-dom)

`npm test` passe par `tests/lancer.mjs`, qui donne à chaque suite son
invocation et désactive l'isolation de processus. Ce n'est pas décoratif : la
combinaison précédente rapportait un nombre de tests variable d'un lancement à
l'autre, en affichant toujours zéro échec. Le script explique le pourquoi en
tête de fichier — le lire avant d'y toucher.

`tests/cloisonnement.sh` vérifie l'isolation multi-entreprises contre un projet
Supabase réel : il demande un environnement dédié (voir
`tests/cloisonnement.env.example`) et ne fait pas partie de `npm test`.

## Organisation

```
src/helpers/         logique métier pure — le cœur de ce qui est testé
src/components/      écrans et composants d'interface
src/context/         Auth et messagerie (React Context)
src/lib/             client Supabase, styles partagés
supabase/migrations/ schéma et policies RLS, appliqués dans l'ordre
supabase/functions/  Edge Functions Deno (emails, Stripe, dépôts, purges)
```

`matrice-droits.md` décrit qui a le droit de faire quoi, par rôle et par statut
de dossier. C'est la référence à mettre à jour avant de toucher aux policies.

## Conventions

`.agent/rules/filao-rules.md` fixe les règles suivies dans ce dépôt : RLS
stricte par défaut, aucune logique de sécurité côté client, WCAG 2.1 AA,
Core Web Vitals, et pas de secret exposé au navigateur.
