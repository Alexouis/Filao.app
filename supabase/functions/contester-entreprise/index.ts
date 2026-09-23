import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXPEDITEUR } from "./emailConfig.ts";
import { erreurContestation } from "./regles.ts";

/**
 * contester-entreprise — signaler qu'une entreprise a été inscrite par
 * quelqu'un qui n'en fait pas partie.
 *
 * Enregistre la contestation (table `contestations_entreprise`, migration 117)
 * et prévient l'équipe Filao, qui vérifie le justificatif puis tranche avec
 * `resoudre_contestation`. Aucune décision automatique : un SIRET, un nom ou
 * un dirigeant sont publics, seul un justificatif vérifié par un humain
 * établit l'appartenance.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const echapperHtml = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const enTete = req.headers.get("Authorization");
    if (!enTete) return json({ error: "Non autorisé." }, 401);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: { user } } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: enTete } },
    }).auth.getUser();
    if (!user) return json({ error: "Non autorisé." }, 401);

    const { entrepriseId, motif, justificatif } = await req.json();
    const refus = erreurContestation({ motif, justificatif }, user.id);
    if (refus) return json({ error: refus }, 400);

    const [{ data: entreprise }, { data: profil }] = await Promise.all([
      admin.from("entreprises").select("id, nom, siret").eq("id", entrepriseId).maybeSingle(),
      admin.from("utilisateurs").select("prenom, nom, email, entreprise_id").eq("id", user.id).maybeSingle(),
    ]);
    if (!entreprise) return json({ error: "Entreprise introuvable." }, 404);
    if (profil?.entreprise_id === entreprise.id) {
      return json({ error: "Vous faites déjà partie de cette entreprise." }, 400);
    }

    // Le justificatif existe-t-il réellement ?
    const dossier = String(justificatif).split("/").slice(0, -1).join("/");
    const nomFichier = String(justificatif).split("/").pop() ?? "";
    const { data: trouves } = await admin.storage.from("documents").list(dossier, { search: nomFichier });
    if (!trouves?.some((o: { name: string }) => o.name === nomFichier)) {
      return json({ error: "Le justificatif est introuvable. Déposez-le à nouveau." }, 400);
    }

    const { data: contestation, error: errInsert } = await admin.from("contestations_entreprise").insert({
      entreprise_id: entreprise.id,
      demandeur_id: user.id,
      motif: String(motif).trim(),
      justificatif,
    }).select("id").single();
    if (errInsert) {
      // Index unique partiel : une contestation est déjà en cours.
      if ((errInsert as any).code === "23505") {
        return json({ error: "Une contestation est déjà en cours d'examen pour cette entreprise." }, 409);
      }
      throw errInsert;
    }

    // Alerte à l'équipe Filao. Best-effort : la contestation est enregistrée,
    // et l'équipe la retrouve de toute façon par la requête de suivi (117).
    const cle = Deno.env.get("BREVO_API_KEY");
    const support = Deno.env.get("SUPPORT_EMAIL") || "contact@filao.io";
    if (cle) {
      const { data: signe } = await admin.storage.from("documents").createSignedUrl(String(justificatif), 7 * 24 * 3600);
      const demandeur = [profil?.prenom, profil?.nom].filter(Boolean).join(" ") || profil?.email || user.email;
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": cle, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: EXPEDITEUR,
          to: [{ email: support }],
          replyTo: profil?.email ? { email: profil.email } : undefined,
          subject: `Contestation d'inscription : ${String(entreprise.nom ?? "").replace(/[\r\n]+/g, " ")} (${entreprise.siret ?? "SIRET inconnu"})`,
          htmlContent: `
            <p><strong>Entreprise :</strong> ${echapperHtml(entreprise.nom)} — SIRET ${echapperHtml(entreprise.siret)}</p>
            <p><strong>Demandeur :</strong> ${echapperHtml(demandeur)} &lt;${echapperHtml(profil?.email ?? user.email)}&gt;</p>
            <p><strong>Motif :</strong><br/>${echapperHtml(motif).replace(/\n/g, "<br/>")}</p>
            <p><strong>Justificatif :</strong> ${signe?.signedUrl ? `<a href="${echapperHtml(signe.signedUrl)}">ouvrir (lien valable 7 jours)</a>` : echapperHtml(justificatif)}</p>
            <p>Pour trancher, dans le SQL Editor :<br/>
              <code>select resoudre_contestation('${contestation.id}', true, 'Kbis vérifié');</code><br/>
              <code>select resoudre_contestation('${contestation.id}', false, 'motif du refus');</code></p>`,
        }),
      });
      if (!r.ok) console.error("contester-entreprise (e-mail support):", await r.text());
    } else {
      console.error("BREVO_API_KEY absente : équipe Filao non prévenue par e-mail.");
    }

    return json({ ok: true });
  } catch (err) {
    console.error("contester-entreprise:", err);
    return json({ error: "Erreur interne." }, 500);
  }
});
