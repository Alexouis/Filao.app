import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * webhook-emails — reçoit les événements de statut de Brevo et enrichit le
 * journal `emails_envoyes`, en alimentant `emails_bloques` pour les rejets
 * définitifs.
 *
 * Endpoint PUBLIC (Brevo n'envoie pas de JWT) : on le protège par un secret
 * partagé passé dans l'URL (?secret=…) et comparé à EMAIL_WEBHOOK_SECRET. Sans
 * secret valide, on refuse — un webhook non authentifié laisserait n'importe qui
 * falsifier des statuts ou empoisonner la liste de blocage.
 *
 * Brevo poste un événement par requête (format « transactional webhook ») avec,
 * selon la version : `event`, `message-id` (ou `messageId`), `email`, `ts`…
 * On tolère les deux graphies pour être robuste.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mappe l'événement Brevo → statut du journal `emails_envoyes`.
// Les événements non listés sont ignorés (on ne dégrade jamais un statut plus
// avancé, cf. ORDRE_STATUT plus bas).
const EVENT_VERS_STATUT: Record<string, string> = {
  delivered: "livre",
  opened: "ouvert",
  uniqueOpened: "ouvert",
  click: "clique",
  deferred: "differe",
  soft_bounce: "differe",
  hard_bounce: "bounce",
  blocked: "bounce",
  invalid_email: "bounce",
  spam: "plainte",
  complaint: "plainte",
  unsubscribed: "plainte",
};

// Ordre de progression d'un statut : on ne « recule » jamais (un 'ouvert' reçu
// après un 'clique' ne doit pas écraser 'clique').
const ORDRE_STATUT: Record<string, number> = {
  envoye: 0, livre: 1, differe: 1, ouvert: 2, clique: 3, bounce: 4, plainte: 5, erreur: 4,
};

// Événements qui bloquent définitivement une adresse.
const MOTIF_BLOCAGE: Record<string, string> = {
  hard_bounce: "hard_bounce",
  invalid_email: "hard_bounce",
  spam: "plainte",
  complaint: "plainte",
  unsubscribed: "desinscription",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Vérification du secret partagé (URL ?secret=…).
    const url = new URL(req.url);
    const secretFourni = url.searchParams.get("secret");
    const secretAttendu = Deno.env.get("EMAIL_WEBHOOK_SECRET");
    if (!secretAttendu || secretFourni !== secretAttendu) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const corps = await req.json().catch(() => null);
    if (!corps) {
      return new Response(JSON.stringify({ error: "Corps invalide" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Brevo peut poster un objet unique ou (selon config) un tableau. On
    // normalise en tableau.
    const evenements = Array.isArray(corps) ? corps : [corps];
    let traites = 0, bloques = 0;

    for (const ev of evenements) {
      const type = ev.event ?? ev.type;
      const messageId = ev["message-id"] ?? ev.messageId ?? ev.message_id ?? null;
      const email = ev.email ?? ev.recipient ?? null;
      const nouveauStatut = type ? EVENT_VERS_STATUT[type] : undefined;

      if (!nouveauStatut) continue; // événement non pertinent

      // 1. Enrichir le journal : retrouver la ligne par messageId (ou, à défaut,
      //    la plus récente pour ce destinataire).
      let ligne: any = null;
      if (messageId) {
        const { data } = await admin
          .from("emails_envoyes")
          .select("id, statut")
          .eq("identifiant_prestataire", messageId)
          .maybeSingle();
        ligne = data;
      }
      if (!ligne && email) {
        const { data } = await admin
          .from("emails_envoyes")
          .select("id, statut")
          .eq("destinataire", email)
          .order("horodatage", { ascending: false })
          .limit(1)
          .maybeSingle();
        ligne = data;
      }

      if (ligne) {
        // Ne pas régresser un statut déjà plus avancé.
        const actuel = ORDRE_STATUT[ligne.statut] ?? 0;
        const cible = ORDRE_STATUT[nouveauStatut] ?? 0;
        if (cible >= actuel) {
          await admin
            .from("emails_envoyes")
            .update({ statut: nouveauStatut, updated_at: new Date().toISOString() })
            .eq("id", ligne.id);
        }
        traites++;
      }

      // 2. Rejet définitif → liste de blocage (upsert, idempotent).
      const motif = type ? MOTIF_BLOCAGE[type] : undefined;
      if (motif && email) {
        const { error } = await admin
          .from("emails_bloques")
          .upsert({ destinataire: email, motif }, { onConflict: "destinataire" });
        if (!error) bloques++;
      }
    }

    return new Response(JSON.stringify({ ok: true, traites, bloques }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("webhook-emails:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
