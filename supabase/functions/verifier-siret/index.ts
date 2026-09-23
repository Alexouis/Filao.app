import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ficheOfficielle, siretFormatValide } from "./ficheOfficielle.ts";

/**
 * verifier-siret — seule source du badge « SIRET vérifié ».
 *
 * Le badge était posé par le navigateur (`siret_verified: true` dans la
 * sauvegarde de la fiche) : n'importe qui pouvait l'afficher sur une fiche
 * remplie à la main. Désormais, cette fonction interroge elle-même le registre
 * (recherche-entreprises.api.gouv.fr), RÉÉCRIT les champs officiels de la
 * fiche avec les valeurs du registre, puis pose le badge. Une fiche vérifiée
 * est ainsi, par construction, conforme au registre ; la migration 119 fait
 * retomber le badge si un champ officiel est ensuite modifié depuis
 * l'application.
 *
 * « Vérifié » atteste la conformité de la fiche au registre, PAS
 * l'appartenance de l'utilisateur à l'entreprise (voir la contestation, 117).
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
    if (!user) return json({ error: "Non autorisé." }, 401);

    const { entrepriseId } = await req.json();
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const [{ data: entreprise }, { data: profil }] = await Promise.all([
      admin.from("entreprises").select("id, siret, created_by").eq("id", entrepriseId).maybeSingle(),
      admin.from("utilisateurs").select("entreprise_id, roles(name)").eq("id", user.id).maybeSingle(),
    ]);
    if (!entreprise) return json({ error: "Entreprise introuvable." }, 404);

    // Mêmes droits que la modification de la fiche : administrateur de
    // l'entreprise, ou son créateur (onboarding, avant le rattachement).
    const estAdmin = profil?.entreprise_id === entreprise.id
      && (profil?.roles as { name?: string } | null)?.name === "admin";
    if (!estAdmin && entreprise.created_by !== user.id) {
      return json({ error: "Seul un administrateur de l'entreprise peut la faire vérifier." }, 403);
    }

    const refuser = async (motif: string) => {
      await admin.from("entreprises").update({ siret_verified: false }).eq("id", entreprise.id);
      return json({ verifie: false, motif });
    };

    const siret = String(entreprise.siret ?? "").replace(/\s/g, "");
    if (!siretFormatValide(siret)) return refuser("SIRET absent ou invalide.");

    let resultat: any = null;
    try {
      const r = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siret}&page=1&per_page=1`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return json({ verifie: false, motif: "Registre momentanément indisponible. Réessayez plus tard.", indisponible: true }, 503);
      resultat = (await r.json())?.results?.[0] ?? null;
    } catch {
      return json({ verifie: false, motif: "Registre momentanément indisponible. Réessayez plus tard.", indisponible: true }, 503);
    }

    const fiche = resultat ? ficheOfficielle(resultat, siret) : null;
    if (!fiche) return refuser("Ce SIRET ne correspond à aucun établissement du registre.");

    // Champs officiels réécrits depuis le registre ; un champ absent de la
    // réponse garde sa valeur (on n'efface pas une adresse par du vide).
    const maj: Record<string, unknown> = { siret, siret_verified: true };
    for (const [cle, valeur] of Object.entries(fiche)) {
      if (valeur !== undefined) maj[cle] = valeur;
    }
    const { error } = await admin.from("entreprises").update(maj).eq("id", entreprise.id);
    if (error) throw error;

    return json({ verifie: true, fiche });
  } catch (err) {
    console.error("verifier-siret:", err);
    return json({ error: "Erreur interne." }, 500);
  }
});
