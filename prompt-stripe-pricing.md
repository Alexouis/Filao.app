Configure la facturation Stripe et adapte l'application pour supporter la grille tarifaire ci-dessous. Explore le codebase et le schéma de base existants avant de commencer pour comprendre l'état actuel.

---

## Les 4 plans

### Partenaire — Gratuit (plan par défaut à l'inscription)

**Cible :** entreprise invitée à contribuer sur les AO des autres / première découverte.

- 1 utilisateur par entreprise
- **1 AO créateur offert au total** (un seul dans la vie du compte, non renouvelable une fois consommé)
- Participation illimitée aux AO sur invitation
- Profil entreprise visible sur le réseau FILAO
- Coffre-fort documentaire
- Recevoir des opportunités de collaboration
- Tableau de bord & analytics
- Export dossier complet (ZIP)

### Solo — 79 € HT/mois

**Cible :** solopreneur, artisan, consultant.

- 1 utilisateur par entreprise
- 3 AO simultanés en cours
- Tout Partenaire +
- Création et pilotage d'AO illimité dans le temps


### Équipe — 159 € HT/mois

**Cible :** TPE / PME structurée.

- Jusqu'à 5 utilisateurs par entreprise
- 10 AO simultanés en cours
- Tout Solo +


### Organisation — Sur devis (PAS en self-service)

**Cible :** ETI / Grosse PME.

- Utilisateurs illimités
- AO illimités
- Tout Équipe +


**Ce plan ne passe pas par Stripe.** Il est activé manuellement après signature commerciale. Sur la page pricing, il affiche un CTA "Contactez-nous".

---

## Règles métier

### L'abonnement est au niveau entreprise

L'abonnement est rattaché à l'entreprise, pas à l'utilisateur. Seul l'admin de l'entreprise peut gérer l'abonnement.

### Compteur d'AO simultanés

- Seuls les AO au statut **en cours** comptent dans la limite. Les AO terminés (gagnés, perdus, abandonnés, déposés) libèrent un slot.
- Le contrôle se fait à la **création** d'un nouvel AO.
- Si la limite est atteinte → bloquer la création et proposer l'upgrade.

### Le "1 AO offert" du plan Partenaire

- C'est un compteur **à vie** sur l'entreprise, pas un slot simultané.
- Une fois consommé (premier AO créé, quel que soit son statut final), c'est définitif.
- L'entreprise peut toujours participer aux AO des autres en tant qu'invitée.
- Après consommation → CTA "Passez au plan Solo pour continuer à créer vos propres réponses."

### Utilisateurs internes

- La limite porte sur le nombre de comptes utilisateurs liés à la même entreprise.
- Les partenaires invités sur un AO (utilisateurs d'autres entreprises) ne comptent **jamais** dans cette limite.
- Contrôle à l'ajout d'un nouvel utilisateur interne. Si limite atteinte → bloquer et proposer l'upgrade.

### Membres du groupement

- **Aucune limite** quel que soit le plan. Un AO peut avoir autant de partenaires externes invités que nécessaire.

---

## Ce qu'il faut faire

### Stripe

- Créer les produits et prix correspondant aux plans Solo et Équipe (mensuels, en euros HT, TVA exclusive).
- Configurer le portail client Stripe pour permettre : changement de plan, mise à jour du moyen de paiement, consultation des factures, annulation.
- Mettre en place les webhooks nécessaires pour synchroniser l'état de l'abonnement Stripe avec la base de données. En cas d'annulation, l'entreprise retombe sur le plan Partenaire.
- Lors du checkout, s'assurer que l'entreprise est identifiable pour faire le lien dans les webhooks.

### Base de données

- Adapter le schéma pour stocker sur chaque entreprise : le plan actif, les identifiants Stripe nécessaires, et le suivi du crédit AO offert du plan Partenaire.
- Stocker la configuration des limites par plan de manière centralisée et facilement modifiable.

### Backend

- Implémenter les contrôles de limites : création d'AO, ajout d'utilisateur interne, accès aux fonctionnalités gated (IA, DPGF, alertes péremption, import Chrome, API).
- Les fonctionnalités non accessibles doivent retourner une erreur claire indiquant quel plan est nécessaire.
- Gérer les webhooks Stripe pour maintenir la synchronisation du plan en base.

### Frontend

**Page pricing (`/pricing`) :**
- 4 colonnes : Partenaire, Solo, Équipe, Organisation.
- CTA adapté selon le plan actuel de l'entreprise (plan actuel désactivé, upgrade → checkout ou portail Stripe, Organisation → "Contactez-nous").
- Badge "Populaire" recommandé sur Équipe.

**Gating UX :**
- Ne **pas masquer** les fonctionnalités verrouillées. Les afficher en mode grisé/désactivé avec un badge indiquant le plan requis.
- Au clic sur une feature verrouillée → modale d'upgrade avec CTA vers la page pricing.
- Afficher le compteur d'AO dans le tableau de bord (ex: `2/3 AO en cours`). Quand la limite est atteinte, le bouton "Créer un AO" est désactivé avec un message d'upgrade.

**Indicateur de plan :**
- Afficher le plan actif de l'entreprise dans la navigation (badge dans la sidebar ou le header).

**Gestion de l'abonnement :**
- Dans les paramètres entreprise (admin uniquement) : bouton "Gérer mon abonnement" → portail Stripe. Afficher le plan actif et la prochaine date de facturation.
