// Configuration d'expéditeur partagée par les Edge Functions d'envoi d'emails.
// -------------------------------------------------------------------------
// Source unique de l'adresse expéditrice transactionnelle. Avant, chaque
// fonction déclarait son propre `sender`, ce qui avait fait diverger les
// domaines (filao.io vs filao-app.fr) et cassé l'authentification SPF/DKIM/DMARC.
//
// Toute fonction transactionnelle doit importer EXPEDITEUR plutôt que réécrire
// une adresse en dur, pour qu'un seul point porte le domaine authentifié.
//
// ⚠️ Domaine transactionnel DÉDIÉ (mail.filao.io), séparé du domaine vitrine
// filao.io et de tout envoi marketing. Cette séparation isole la réputation
// d'envoi du transactionnel : une dégradation côté marketing (plaintes,
// désabonnements) ne pénalise pas les emails critiques d'acquisition.
// Pour changer d'expéditeur, ne toucher qu'ici.

export const EXPEDITEUR = {
  name: "Filao",
  email: "contact@mail.filao.io",
} as const;