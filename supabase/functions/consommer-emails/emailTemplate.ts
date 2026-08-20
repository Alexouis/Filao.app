// Gabarit d'email commun — partagé par les Edge Functions d'envoi.
// -------------------------------------------------------------------------
// Enveloppe un contenu (titre, corps, un seul bouton d'action) dans une
// structure HTML unique et cohérente : logo, un bouton d'action maximum,
// version texte systématique, aucune pièce jointe (uniquement des liens).
//
// Principes (cf. ticket Lot 7) :
//   • Logo en tête.
//   • UN SEUL bouton d'action (les messageries et l'UX pénalisent les emails à
//     boutons multiples). Si plusieurs liens sont nécessaires, ils vont en texte.
//   • Version texte brut TOUJOURS fournie (certaines messageries publiques
//     bloquent le HTML) — c'est l'appelant qui la fournit, ce module aide à la
//     composer.
//   • Aucune pièce jointe : uniquement des liens vers l'application.

export interface ContenuEmail {
  /** Titre affiché en haut du corps (h1). */
  titre: string;
  /** Paragraphes de corps (chacun rendu dans un <p>). */
  paragraphes: string[];
  /** Bouton d'action unique (optionnel). */
  action?: { label: string; url: string };
  /** Lignes de détail optionnelles (listes) rendues en <ul>. */
  details?: string[];
}

// URL du logo — hébergé publiquement. À ajuster si le logo déménage.
const LOGO_URL = "https://www.filao.io/assets/Logo_white.png";
const COULEUR_PRIMAIRE = "#26367F";
const COULEUR_TEXTE = "#0B1F38";

/** Échappe le HTML pour éviter toute injection depuis les données de payload. */
const echapper = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Rend la version HTML complète (gabarit + contenu). */
export const rendreHtml = (c: ContenuEmail): string => {
  const paras = c.paragraphes.map((p) => `<p style="margin:0 0 16px;color:${COULEUR_TEXTE};font-size:15px;line-height:1.6;">${echapper(p)}</p>`).join("");

  const liste = c.details && c.details.length > 0
    ? `<ul style="margin:0 0 16px;padding-left:20px;color:${COULEUR_TEXTE};font-size:14px;line-height:1.6;">${c.details.map((d) => `<li>${echapper(d)}</li>`).join("")}</ul>`
    : "";

  // Un seul bouton, mis en avant. Aucun autre bouton n'est rendu.
  const bouton = c.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:10px;background:${COULEUR_PRIMAIRE};">
         <a href="${echapper(c.action.url)}" style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;border-radius:10px;">${echapper(c.action.label)}</a>
       </td></tr></table>`
    : "";

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;width:100%;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #eef1f7;">
          <img src="${LOGO_URL}" alt="Filao" height="32" style="height:32px;" />
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <h1 style="margin:0 0 16px;color:${COULEUR_TEXTE};font-size:20px;">${echapper(c.titre)}</h1>
          ${paras}
          ${liste}
          ${bouton}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #eef1f7;color:#8a93a8;font-size:12px;line-height:1.5;">
          <p style="margin:0;">Filao — la plateforme de réponse aux appels d'offres.</p>
          <p style="margin:4px 0 0;">Cet email vous est envoyé car vous utilisez Filao.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
};

/** Rend la version texte brut complète (systématique). */
export const rendreTexte = (c: ContenuEmail): string => {
  const lignes: string[] = [c.titre, ""];
  for (const p of c.paragraphes) lignes.push(p, "");
  if (c.details && c.details.length > 0) {
    for (const d of c.details) lignes.push(`- ${d}`);
    lignes.push("");
  }
  if (c.action) lignes.push(`${c.action.label} : ${c.action.url}`, "");
  lignes.push("—", "Filao — la plateforme de réponse aux appels d'offres.");
  return lignes.join("\n");
};

/** Compose sujet + html + texte à partir d'un sujet et d'un contenu. */
export const composerEmail = (sujet: string, c: ContenuEmail) => ({
  sujet,
  html: rendreHtml(c),
  texte: rendreTexte(c),
});
