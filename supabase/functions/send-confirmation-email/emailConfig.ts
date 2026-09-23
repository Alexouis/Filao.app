// Configuration d'expéditeur partagée par les Edge Functions d'envoi d'emails.
// -------------------------------------------------------------------------
// Source unique de l'adresse expéditrice transactionnelle. Avant, chaque
// fonction déclarait son propre `sender`, ce qui avait fait diverger les
// domaines (filao.io vs filao-app.fr) et cassé l'authentification SPF/DKIM/DMARC.
//
// Toute fonction transactionnelle doit importer EXPEDITEUR plutôt que réécrire
// une adresse en dur, pour qu'un seul point porte le domaine authentifié.
//
// ⚠️ L'adresse DOIT être un expéditeur actif d'un domaine authentifié dans
// Brevo. Sinon Brevo accepte l'appel (201, messageId renvoyé) puis rejette
// l'envoi en asynchrone : aucune erreur côté fonction, aucun e-mail reçu.
// C'est ce qui s'est produit avec `contact@mail.filao.io`, domaine jamais
// déclaré dans Brevo. Vérification : `diagnostic-email?config=1`.
//
// Un sous-domaine transactionnel dédié (mail.filao.io) reste souhaitable pour
// isoler la réputation d'envoi ; il faudra d'abord l'authentifier dans Brevo.
//
// ⚠️ Ce fichier est dupliqué dans chaque fonction d'envoi (une Edge Function
// ne peut importer hors de son dossier au déploiement) : le modifier partout.

export const EXPEDITEUR = {
  name: "Filao",
  email: "noreply@filao.io",
} as const;
