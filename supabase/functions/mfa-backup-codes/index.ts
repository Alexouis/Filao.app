import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * mfa-backup-codes Edge Function
 *
 * Gère les codes de secours 2FA. Deux actions :
 *
 *  • generate — appelée juste après l'activation du TOTP. Crée 10 codes, stocke
 *    leur hachage SHA-256, et renvoie les codes EN CLAIR une seule fois (ils ne
 *    seront jamais réaffichables).
 *
 *  • recover — appelée depuis l'écran de connexion 2FA quand l'utilisateur n'a
 *    plus accès à son application. Vérifie un code de secours ; s'il est valide,
 *    le consomme ET retire le facteur TOTP du compte. L'utilisateur retrouve
 *    ainsi l'accès (session ramenée à AAL1) puis pourra ré-enrôler un facteur.
 *
 * POURQUOI « recover » plutôt qu'une élévation AAL2
 * Supabase n'élève une session en AAL2 que via un challenge TOTP. Un code de
 * secours ne peut donc pas se substituer au TOTP en session ; il sert à
 * reprendre la main en retirant le facteur, ce qui est le modèle de
 * récupération standard.
 *
 * ⚠️ À déployer SANS --no-verify-jwt : l'appelant doit être authentifié (la
 *    session AAL1 issue du mot de passe / OAuth suffit).
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

// Alphabet sans caractères ambigus (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const NB_CODES = 10;
const LONGUEUR = 8;

const genererCode = (): string => {
  const octets = new Uint8Array(LONGUEUR);
  crypto.getRandomValues(octets);
  let s = "";
  for (let i = 0; i < LONGUEUR; i++) s += ALPHABET[octets[i] % ALPHABET.length];
  // Format XXXX-XXXX pour la lisibilité ; le séparateur est retiré avant hachage.
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};

const normaliser = (code: string): string =>
  code.replace(/[\s-]/g, "").toUpperCase();

const hacher = async (codeNormalise: string): Promise<string> => {
  const data = new TextEncoder().encode(codeNormalise);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
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

    // Authentifie l'appelant (session AAL1 suffit).
    const userClient = createClient(urlProjet, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Non autorisé" }, 401);

    const admin = createClient(urlProjet, serviceKey);
    const { action, code } = await req.json();

    // ── GENERATE ──
    if (action === "generate") {
      // Repart de zéro : on efface les anciens codes (une régénération invalide
      // les précédents, comportement attendu d'un jeu de codes de secours).
      await admin.from("mfa_backup_codes").delete().eq("user_id", user.id);

      const clairs: string[] = [];
      const lignes: { user_id: string; code_hash: string }[] = [];
      for (let i = 0; i < NB_CODES; i++) {
        const c = genererCode();
        clairs.push(c);
        lignes.push({ user_id: user.id, code_hash: await hacher(normaliser(c)) });
      }

      const { error: insertError } = await admin.from("mfa_backup_codes").insert(lignes);
      if (insertError) {
        console.error("mfa-backup-codes generate:", insertError);
        return json({ error: "Génération impossible" }, 500);
      }

      // Les codes clairs ne sont renvoyés qu'ici, une seule fois.
      return json({ success: true, codes: clairs });
    }

    // ── RECOVER ──
    if (action === "recover") {
      if (!code || typeof code !== "string") return json({ error: "invalid_code" }, 200);

      const hash = await hacher(normaliser(code));
      const { data: match } = await admin
        .from("mfa_backup_codes")
        .select("id")
        .eq("user_id", user.id)
        .eq("code_hash", hash)
        .is("consumed_at", null)
        .maybeSingle();

      if (!match) return json({ success: false, error: "invalid_code" }, 200);

      // Consomme le code (usage unique).
      await admin
        .from("mfa_backup_codes")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", match.id);

      // Retire le(s) facteur(s) TOTP : l'utilisateur reprend la main en AAL1 et
      // pourra ré-enrôler un nouveau facteur depuis les paramètres.
      const { data: factorsList } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
      for (const f of factorsList?.factors || []) {
        await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
      }

      return json({ success: true });
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (err) {
    console.error("mfa-backup-codes:", err);
    return json({ error: "Erreur interne" }, 500);
  }
});
