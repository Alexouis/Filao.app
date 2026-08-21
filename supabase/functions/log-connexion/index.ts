import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * log-connexion Edge Function
 *
 * Enregistre une connexion réussie dans le journal `connexions`. Appelée par le
 * client juste après un login (e-mail ou Google).
 *
 * POURQUOI UNE FONCTION
 * L'adresse IP n'est pas accessible côté navigateur ; seule la requête HTTP la
 * porte (en-têtes du proxy). La fonction la lit, dérive un libellé d'appareil du
 * user-agent, et insère la ligne avec la service-role — après avoir authentifié
 * l'appelant, de sorte qu'on ne journalise que pour l'utilisateur réel.
 *
 * ⚠️ À déployer SANS --no-verify-jwt : appelant authentifié requis.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Libellé lisible « Navigateur sur OS » à partir du user-agent. Volontairement
// grossier : on veut un repère humain, pas une empreinte précise.
const libelleAppareil = (ua: string): string => {
  if (!ua) return "Appareil inconnu";
  let navigateur = "Navigateur";
  if (/Edg\//.test(ua)) navigateur = "Edge";
  else if (/OPR\/|Opera/.test(ua)) navigateur = "Opera";
  else if (/Chrome\//.test(ua)) navigateur = "Chrome";
  else if (/Firefox\//.test(ua)) navigateur = "Firefox";
  else if (/Safari\//.test(ua)) navigateur = "Safari";

  let os = "";
  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return os ? `${navigateur} sur ${os}` : navigateur;
};

// Première IP de la chaîne X-Forwarded-For (client d'origine).
const extraireIp = (req: Request): string | null => {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const urlProjet = Deno.env.get("SUPABASE_URL") ?? "";
    if (!serviceKey || !urlProjet || !anonKey) return json({ error: "Configuration incomplète" }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Non autorisé" }, 401);

    const userClient = createClient(urlProjet, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Non autorisé" }, 401);

    const body = await req.json().catch(() => ({}));
    const methode = typeof body?.methode === "string" ? body.methode.slice(0, 20) : null;

    const ua = req.headers.get("user-agent") || "";
    const admin = createClient(urlProjet, serviceKey);

    const { error: insertError } = await admin.from("connexions").insert({
      user_id: user.id,
      ip: extraireIp(req),
      user_agent: ua.slice(0, 400),
      appareil: libelleAppareil(ua),
      methode,
    });

    if (insertError) {
      console.error("log-connexion insert:", insertError);
      return json({ error: "Journalisation impossible" }, 500);
    }

    return json({ success: true });
  } catch (err) {
    console.error("log-connexion:", err);
    return json({ error: "Erreur interne" }, 500);
  }
});
