import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXPEDITEUR } from "./emailConfig.ts";

/**
 * consommer-emails — consomme la file `emails_a_envoyer` et envoie via Brevo.
 *
 * Séparée de `calculer-emails` : peut être rejouée après incident sans
 * recalculer, et inversement. Écrit chaque tentative dans `emails_envoyes`
 * (journal), en conservant le messageId Brevo pour le rapprochement webhook.
 *
 * Peut être appelée par cron (juste après le calcul) et/ou à la demande.
 * Traite un lot borné par appel pour rester dans les limites d'exécution.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TAILLE_LOT = 50;       // emails traités par appel
const MAX_TENTATIVES = 3;    // au-delà, l'email passe en 'echoue'

const roleDuJeton = (enTete: string | null): string | null => {
  if (!enTete?.startsWith("Bearer ")) return null;
  const segments = enTete.slice(7).trim().split(".");
  if (segments.length !== 3) return null;
  try {
    const charge = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(charge.padEnd(Math.ceil(charge.length / 4) * 4, "=")))?.role ?? null;
  } catch {
    return null;
  }
};

/**
 * Construit sujet + contenu selon le type d'email. Gabarit minimal ici ; le
 * gabarit commun riche (logo, bouton unique, version texte) arrivera dans un
 * lot dédié. On fournit DÉJÀ une version texte systématique (certaines
 * messageries bloquent le HTML) et un seul lien d'action.
 */
const construireEmail = (type: string, payload: any, appUrl: string) => {
  const lien = payload?.tender_id ? `${appUrl}/?tab=tenders&id=${payload.tender_id}` : appUrl;

  switch (type) {
    case "deadline_j7":
    case "deadline_j3":
    case "deadline_j1": {
      const j = payload?.jours_restants ?? "quelques";
      const titre = payload?.tender_titre ?? "votre appel d'offres";
      return {
        sujet: `Échéance dans ${j} jour${j > 1 ? "s" : ""} : ${titre}`,
        texte: `La date limite approche (dans ${j} jour${j > 1 ? "s" : ""}) pour « ${titre} ».\n\nAccéder au dossier : ${lien}`,
        html: `<p>La date limite approche (dans <strong>${j} jour${j > 1 ? "s" : ""}</strong>) pour « ${titre} ».</p><p><a href="${lien}">Accéder au dossier</a></p>`,
      };
    }
    default:
      return {
        sujet: "Notification Filao",
        texte: `Vous avez une nouvelle notification sur Filao.\n\n${lien}`,
        html: `<p>Vous avez une nouvelle notification sur Filao.</p><p><a href="${lien}">Ouvrir Filao</a></p>`,
      };
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const role = roleDuJeton(req.headers.get("Authorization"));
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (role !== "service_role") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const appUrl = Deno.env.get("APP_URL") ?? "https://filao.io";
    if (!brevoApiKey) throw new Error("BREVO_API_KEY absente");

    // Lot d'emails en attente, les plus anciens d'abord.
    const { data: aTraiter, error: errLot } = await admin
      .from("emails_a_envoyer")
      .select("*")
      .eq("statut", "en_attente")
      .order("created_at", { ascending: true })
      .limit(TAILLE_LOT);
    if (errLot) throw errLot;

    // Liste de blocage : sécurité supplémentaire au moment de l'envoi (une
    // adresse peut être bloquée entre le calcul et la consommation).
    const { data: bloquesData } = await admin.from("emails_bloques").select("destinataire");
    const bloques = new Set((bloquesData ?? []).map((b: any) => b.destinataire));

    let envoyes = 0, echoues = 0, ignores = 0;

    for (const item of aTraiter ?? []) {
      // Verrou optimiste : passe en 'en_cours' seulement si toujours 'en_attente'
      // (évite qu'un second appel concurrent traite le même email).
      const { data: verrou } = await admin
        .from("emails_a_envoyer")
        .update({ statut: "en_cours", updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("statut", "en_attente")
        .select("id");
      if (!verrou || verrou.length === 0) continue; // pris par un autre worker

      // Adresse bloquée → on annule sans envoyer.
      if (bloques.has(item.destinataire)) {
        await admin.from("emails_a_envoyer")
          .update({ statut: "annule", derniere_erreur: "destinataire bloqué" })
          .eq("id", item.id);
        ignores++;
        continue;
      }

      const contenu = construireEmail(item.type_email, item.payload, appUrl);

      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoApiKey, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            sender: EXPEDITEUR,
            to: [{ email: item.destinataire }],
            subject: contenu.sujet,
            htmlContent: contenu.html,
            textContent: contenu.texte, // version texte systématique
          }),
        });

        if (!res.ok) {
          const texte = await res.text();
          throw new Error(`Brevo ${res.status}: ${texte}`);
        }

        const reponse = await res.json().catch(() => ({}));
        const messageId = reponse?.messageId ?? null;

        // Marque envoyé + journalise.
        await admin.from("emails_a_envoyer")
          .update({ statut: "envoye", updated_at: new Date().toISOString() })
          .eq("id", item.id);

        await admin.from("emails_envoyes").insert({
          type_email: item.type_email,
          destinataire: item.destinataire,
          objet: contenu.sujet,
          objet_id: item.objet_id,
          statut: "envoye",
          identifiant_prestataire: messageId,
        });
        envoyes++;
      } catch (err) {
        const tentatives = (item.tentatives ?? 0) + 1;
        const statutFinal = tentatives >= MAX_TENTATIVES ? "echoue" : "en_attente"; // re-tentera
        await admin.from("emails_a_envoyer")
          .update({
            statut: statutFinal,
            tentatives,
            derniere_erreur: String((err as any)?.message || err),
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        // Journalise l'échec définitif seulement (évite de polluer le journal
        // à chaque retry intermédiaire).
        if (statutFinal === "echoue") {
          await admin.from("emails_envoyes").insert({
            type_email: item.type_email,
            destinataire: item.destinataire,
            objet: contenu.sujet,
            objet_id: item.objet_id,
            statut: "erreur",
            erreur: String((err as any)?.message || err),
          });
        }
        echoues++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, traites: (aTraiter ?? []).length, envoyes, echoues, ignores }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("consommer-emails:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
