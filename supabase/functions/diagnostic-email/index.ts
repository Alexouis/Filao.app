import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * diagnostic-email — ce que Brevo sait d'un envoi, sans accès à sa console.
 *
 * Interroge l'API d'événements transactionnels de Brevo avec la clé déjà
 * présente dans les secrets. Répond à « l'e-mail est-il parti, a-t-il été
 * livré, bloqué, rejeté ? » pour un messageId ou une adresse.
 *
 * LECTURE SEULE. Protégé par un secret partagé (DIAGNOSTIC_SECRET), comme
 * `webhook-emails` : l'historique d'envoi d'une adresse est une donnée
 * personnelle, il ne doit pas être consultable par n'importe quel compte.
 * Sans secret configuré, la fonction refuse tout.
 *
 * Usage :
 *   GET /functions/v1/diagnostic-email?secret=…&email=adresse@x.fr[&days=7]
 *   GET /functions/v1/diagnostic-email?secret=…&messageId=<…>
 */

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps, null, 2), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const secretAttendu = Deno.env.get("DIAGNOSTIC_SECRET");
  if (!secretAttendu || url.searchParams.get("secret") !== secretAttendu) {
    return json({ error: "Forbidden" }, 403);
  }

  const cle = Deno.env.get("BREVO_API_KEY");
  if (!cle) return json({ error: "BREVO_API_KEY absente de l'environnement" }, 500);

  const email = url.searchParams.get("email")?.trim().toLowerCase();
  const messageId = url.searchParams.get("messageId")?.trim();
  if (!email && !messageId) return json({ error: "Paramètre email ou messageId requis" }, 400);

  const jours = Math.min(Math.max(Number(url.searchParams.get("days")) || 7, 1), 90);
  const params = new URLSearchParams({ limit: "100", sort: "desc", days: String(jours) });
  if (email) params.set("email", email);
  if (messageId) params.set("messageId", messageId);

  const res = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${params}`, {
    headers: { "api-key": cle, Accept: "application/json" },
  });
  const texte = await res.text();
  if (!res.ok) return json({ error: `Brevo ${res.status}`, detail: texte.slice(0, 500) }, 502);

  const evenements = (JSON.parse(texte || "{}").events ?? []).map((e: any) => ({
    date: e.date, evenement: e.event, sujet: e.subject, destinataire: e.email,
    raison: e.reason ?? null, messageId: e.messageId,
  }));

  // Lecture rapide : le dernier événement de chaque message suffit le plus
  // souvent à trancher (requests = accepté, delivered = livré, blocked /
  // hardBounces / error = jamais arrivé).
  return json({
    periode_jours: jours,
    nb_evenements: evenements.length,
    aide: {
      requests: "Brevo a accepté l'envoi",
      delivered: "le serveur du destinataire a accepté le message",
      deferred: "livraison retardée, Brevo réessaie",
      softBounces: "rejet temporaire",
      hardBounces: "adresse rejetée définitivement",
      blocked: "Brevo a refusé d'envoyer (adresse sur sa liste de blocage)",
      invalid: "adresse invalide",
      spam: "le destinataire a signalé comme spam",
      error: "erreur d'envoi côté Brevo",
    },
    evenements,
  });
});
