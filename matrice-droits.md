# Matrice des droits — FILAO

Document de référence des accès aux données. **Toute migration touchant une
policy doit être confrontée à cette matrice et relue par une seconde personne.**

Dernière mise à jour : migrations 067 à 070.

---

## Principe directeur

Les policies Postgres se combinent en `OR` : **la plus permissive l'emporte
toujours**. Empiler des policies revient donc à empiler des accès non maîtrisés.

La règle est par conséquent : **une seule policy par table et par verbe**, dont
la condition appelle une fonction nommée du schéma `app`. Ajouter un accès se
fait en modifiant la fonction, jamais en ajoutant une policy.

Convention de nommage : `<table>_<verbe>_<acteur>` — par exemple
`reponses_ao_select_membre`.

---

## Les cinq acteurs

| Acteur | Définition | Reconnu par |
|---|---|---|
| **Utilisateur de l'entreprise** | Compte authentifié rattaché à une entreprise | `app.entreprise_courante()` |
| **Mandataire** | Porteur du dossier (`createur_id`) | `app.est_mandataire(ao)` |
| **Cotraitant / sous-traitant** | Entreprise dont la participation au groupement est **acceptée** | `app.est_membre(ao)` |
| **Invité par token** | Personne sans compte, porteuse d'un lien d'invitation | *Aucune policy* — Edge Functions uniquement |
| **Anonyme** | Appel non authentifié | Référentiels publics uniquement |

> **Le statut `invite` n'ouvre aucun accès.** Une invitation non acceptée ne
> donne ni lecture du dossier, ni des échanges, ni de l'e-mail des membres.
> C'est la correction centrale des migrations 068 à 070.

---

## Fonctions socle (migration 067 et 070)

| Fonction | Renvoie | Rôle |
|---|---|---|
| `app.entreprise_courante()` | UUID ou NULL | Entreprise de l'appelant |
| `app.est_membre(ao)` | booléen | Porteur du dossier **ou** entreprise acceptée au groupement |
| `app.est_mandataire(ao)` | booléen | Porteur du dossier uniquement |
| `app.partage_dossier(utilisateur)` | booléen | Collaboration effective avec la personne visée |

Toutes en `SECURITY DEFINER` avec `search_path` verrouillé, exécutables par
`authenticated` seulement.

---

## Matrice par table

Légende : ✅ autorisé · ⛔ refusé · 🔒 soi-même uniquement

### Dossiers et équipe

| Table | Verbe | Utilisateur | Mandataire | Cotraitant | Invité token | Anonyme | Policy |
|---|---|---|---|---|---|---|---|
| `reponses_ao` | SELECT | ⛔ | ✅ | ✅ | ⛔ | ⛔ | `reponses_ao_select_membre` |
| `reponses_ao` | INSERT | ✅ (à son nom) | — | ⛔ | ⛔ | ⛔ | `reponses_ao_insert_utilisateur` |
| `reponses_ao` | UPDATE | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | `reponses_ao_update_mandataire` |
| `reponses_ao` | DELETE | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | `reponses_ao_delete_mandataire` |
| `groupements` | SELECT | ⛔ | ✅ | ✅ | ⛔ | ⛔ | `groupements_select_membre` |
| `groupements` | INSERT/UPDATE/DELETE | ⛔ | ✅ | ⛔ | ⛔ | ⛔ | `groupements_*_mandataire` |

> **Cycle de vie** (finaliser, déposer, saisir le résultat) : porté par les
> colonnes de `reponses_ao`, donc réservé au mandataire par `..._update_mandataire`.

### Échanges et pièces

| Table | Verbe | Utilisateur | Mandataire | Cotraitant | Invité token | Anonyme | Policy |
|---|---|---|---|---|---|---|---|
| `comments` | SELECT | ⛔ | ✅ | ✅ | ⛔ | ⛔ | `comments_select_membre` |
| `comments` | INSERT | ⛔ | ✅ | ✅ | ⛔ | ⛔ | `comments_insert_membre` |
| `comments` | UPDATE/DELETE | 🔒 auteur | 🔒 auteur | 🔒 auteur | ⛔ | ⛔ | `comments_*_auteur` |
| `chat_messages` | SELECT/INSERT | ⛔ | ✅ | ✅ | ⛔ | ⛔ | `chat_messages_*_membre` |
| `depots_pieces` | INSERT | ⛔ | ✅ | ✅ | ⛔ | ⛔ | `depots_pieces_insert_membre` |
| `depots_pieces` | SELECT | destinataire / auteur | ✅ | ✅ | ⛔ | ⛔ | `depots_pieces_select` |

### Entreprise et coffre-fort

| Table | Verbe | Utilisateur | Autres entreprises | Anonyme | Policy |
|---|---|---|---|---|---|
| `entreprises` | SELECT | ✅ (annuaire) | ✅ (annuaire) | ⛔ | `entreprises_select_authentifie` |
| `entreprises` | UPDATE | 🔒 la sienne | ⛔ | ⛔ | `Users can update own company` |
| `documents_candidature` | ALL | 🔒 la sienne | ⛔ | ⛔ | `documents_candidature_*` |
| `company_*` (5 tables) | SELECT | ✅ (annuaire) | ✅ (annuaire) | ⛔ | `company_*_select_authentifie` |
| `company_*` | INSERT/UPDATE/DELETE | 🔒 la sienne | ⛔ | ⛔ | `Manage own company *` |

> **Coffre-fort** (`documents_candidature`) : strictement limité à l'entreprise
> propriétaire, aucun partage inter-entreprises même au sein d'un groupement.
> Les pièces transmises à un dossier passent par `depots_pieces`.

### Profils (migration 070)

| Objet | Colonnes | Qui y accède |
|---|---|---|
| `utilisateurs` (table) | toutes | 🔒 **soi-même uniquement** |
| `utilisateurs_publics` (vue) | id, prénom, nom, photo, entreprise | Tout utilisateur authentifié |
| `utilisateurs_publics.email` | e-mail | Soi-même **et** partenaires d'un dossier commun |

> Téléphone, date de naissance, TVA et préférences ne sortent jamais de la table
> personnelle.

> ⚠️ **Règle sur les vues.** Une vue s'exécute avec les droits de son
> propriétaire et **contourne donc le RLS de la table sous-jacente**. Par
> ailleurs, Supabase accorde par défaut INSERT/UPDATE/DELETE à `anon` et
> `authenticated` sur tout nouvel objet du schéma `public`. Une vue
> auto-modifiable ainsi exposée permet d'écrire dans la table protégée en
> contournant ses policies.
>
> **Toute vue doit donc être explicitement ramenée en lecture seule :**
> ```sql
> REVOKE ALL ON public.<vue> FROM anon, authenticated, public;
> GRANT SELECT ON public.<vue> TO authenticated;
> ALTER VIEW public.<vue> SET (security_barrier = true);
> ```
> Corrigé pour l'ensemble des vues par la migration 071.

### Référentiels et facturation

| Table | Accès | Justification |
|---|---|---|
| `ref_*`, `roles` | Lecture publique (anon incluse) | Données de nomenclature, sans caractère personnel |
| `plan_limits` | Lecture des forfaits **actifs** | Grille tarifaire publique ; les forfaits inactifs restent masqués |
| `avis_partenaires` | Lecture authentifiée | Réputation entre professionnels |
| `connexions` | 🔒 soi-même | Journal de sécurité personnel |
| `user_integrations` | 🔒 soi-même | Contient des jetons |

---

## Invité sans compte

**Aucune policy ne lui est accordée.** L'accès passe exclusivement par des Edge
Functions qui valident le token et ne renvoient que :

l'intitulé de l'AO · l'acheteur · la date limite · le mandataire · le rôle
proposé · les pièces demandées.

Ni montants, ni autres membres, ni messagerie.

**Token** : 32 octets aléatoires, stocké haché en SHA-256 (migration 042), la
base ne contient jamais la valeur en clair. Expiration et révocation gérées par
les migrations 041 et 043.

---

## Vérification à chaque livraison

1. Rejouer le jeu de tests de cloisonnement :
   ```bash
   ./tests/cloisonnement.sh
   ```
   Aucun échec toléré.

2. Joindre à la livraison la sortie de :
   ```sql
   select tablename, policyname, cmd, roles, qual, with_check
     from pg_policies where schemaname = 'public'
    order by tablename, cmd;
   ```

3. Contrôler que **chaque ligne se rattache à cette matrice**, qu'aucune table ne
   porte deux policies pour un même verbe, et qu'aucune condition n'ignore à la
   fois `auth.uid()` et `app.entreprise_courante()` — hormis les référentiels
   listés ci-dessus.

4. Contrôler qu'**aucune vue n'est modifiable** par un utilisateur (le RLS ne
   s'applique pas aux vues, voir la règle ci-dessus) :
   ```sql
   select table_name, grantee, privilege_type
     from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon','authenticated')
      and privilege_type <> 'SELECT'
      and table_name in (select table_name from information_schema.views
                          where table_schema = 'public');
   ```
   Attendu : aucune ligne. À rejouer **après chaque création de vue**.

---

## Points ouverts

- `reponses_ao_specialties` : lecture réservée au créateur. Un cotraitant accepté
  ne peut pas consulter les compétences attendues du dossier qu'il a rejoint.
  À vérifier fonctionnellement ; si l'écran en a besoin, passer la lecture à
  `app.est_membre()` en gardant l'écriture au mandataire.
- `objects` (Storage) : les policies restent écrites en SQL inline, avec une
  logique de chemins de fichiers. Elles gagneraient à s'appuyer sur les mêmes
  fonctions `app.*` pour rester alignées sur cette matrice.
