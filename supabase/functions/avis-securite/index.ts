import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXPEDITEUR } from "./emailConfig.ts";
import { AVIS, DELAI_ANTI_REPETITION_MS } from "./regles.ts";

/**
 * avis-securite — prévenir le titulaire d'un changement de sécurité.
 *
 * Le changement de mot de passe passait par `send-reminder`, qui exige un
 * dossier : l'appel échouait (400) sans que personne le voie, et aucun avis
 * ne partait. La double authentification n'en envoyait aucun.
 *
 * Le destinataire est TOUJOURS l'adresse du compte appelant (jamais une
 * adresse fournie) : la fonction ne peut pas servir à écrire à un tiers.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const enTete = req.headers.get("Authorization");
    if (!enTete) return json({ error: "Non autorisé." }, 401);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const { data: { user } } = await createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: enTete } },
    }).auth.getUser();
    if (!user?.email) return json({ error: "Non autorisé." }, 401);

    const { type } = await req.json();
    const avis = AVIS[type];
    if (!avis) return json({ error: "Type d'avis inconnu." }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const destinataire = user.email.toLowerCase();

    // Anti-répétition, à partir du journal des envois.
    const depuis = new Date(Date.now() - DELAI_ANTI_REPETITION_MS).toISOString();
    const { data: recents } = await admin.from("emails_envoyes").select("id")
      .eq("type_email", type).eq("destinataire", destinataire).gte("horodatage", depuis).limit(1);
    if (recents?.length) return json({ ok: true, ignore: "déjà envoyé" });

    const cle = Deno.env.get("BREVO_API_KEY");
    if (!cle) return json({ error: "BREVO_API_KEY absente" }, 500);

    const quand = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" });
    const texte = `${avis.texte}\n\nDate : ${quand}\n\nSi vous êtes à l'origine de ce changement, vous n'avez rien à faire.\nSinon, réinitialisez immédiatement votre mot de passe depuis l'écran de connexion (« Mot de passe oublié ») et contactez-nous : contact@filao.io.\n\n— Filao`;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cle, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: EXPEDITEUR,
        to: [{ email: destinataire }],
        subject: avis.sujet,
        textContent: texte,
        htmlContent: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px">${texte
          .split("\n").map((l) => l ? `<p style="margin:0 0 10px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` : "").join("")}</div>`,
      }),
    });
    const corps = await r.text();
    const messageId = r.ok ? (JSON.parse(corps || "{}")?.messageId ?? null) : null;
    await admin.from("emails_envoyes").insert({
      type_email: type, destinataire, destinataire_id: user.id, objet: avis.sujet,
      statut: r.ok ? "envoye" : "erreur", identifiant_prestataire: messageId,
      erreur: r.ok ? null : corps.slice(0, 300),
    });
    if (!r.ok) return json({ error: "Envoi impossible." }, 502);
    return json({ ok: true });
  } catch (err) {
    console.error("avis-securite:", err);
    return json({ error: "Erreur interne." }, 500);
  }
});
