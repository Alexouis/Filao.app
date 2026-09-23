/**
 * Avis de sécurité envoyés au titulaire du compte. Sans dépendance distante.
 */
export const AVIS: Record<string, { sujet: string; texte: string }> = {
  mot_de_passe_modifie: {
    sujet: "Votre mot de passe Filao a été modifié",
    texte: "Le mot de passe de votre compte Filao vient d'être modifié.",
  },
  double_authentification_activee: {
    sujet: "Double authentification activée sur votre compte Filao",
    texte: "La double authentification vient d'être activée sur votre compte Filao.",
  },
  double_authentification_desactivee: {
    sujet: "Double authentification désactivée sur votre compte Filao",
    texte: "La double authentification vient d'être DÉSACTIVÉE sur votre compte Filao.",
  },
};

/** Un avis identique envoyé il y a moins d'une minute : on n'en renvoie pas. */
export const DELAI_ANTI_REPETITION_MS = 60_000;
