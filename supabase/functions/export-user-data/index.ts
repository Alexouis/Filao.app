import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * export-user-data Edge Function
 *
 * Portabilité RGPD (art. 20). Rassemble les données personnelles de l'appelant
 * dans un objet JSON réutilisable, renvoyé en pièce téléchargeable côté client.
 *
 * POURQUOI UNE FONCTION
 * Les données sont réparties sur plusieurs tables protégées par RLS. Plutôt que
 * de multiplier les requêtes côté navigateur (et de dépendre des policies de
 * lecture), on collecte côté serveur avec la service-role, APRÈS avoir
 * authentifié l'appelant — chaque utilisateur n'exporte que ses propres
 * données et celles de son entreprise.
 *
 * PÉRIMÈTRE
 * Profil, entreprise, dossiers créés, groupements, invitations, documents
 * (métadonnées, pas les binaires), commentaires, avis, réseau. Les référentiels
 * partagés (ref_*, plan_limits) et les données d'autres utilisateurs sont
 * exclus : ce ne sont pas les données personnelles de l'appelant.
 *
 * ⚠️ À déployer SANS --no-verify-jwt : réservé à l'utilisateur authentifié.
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

    const admin = createClient(urlProjet, serviceKey);
    const uid = user.id;

    // Profil utilisateur.
    const { data: profil } = await admin
      .from("utilisateurs")
      .select("*")
      .eq("id", uid)
      .maybeSingle();

    const entrepriseId = profil?.entreprise_id ?? null;

    // Collecte en parallèle. Chaque requête est cadrée sur l'utilisateur ou son
    // entreprise. Les erreurs individuelles n'interrompent pas l'export : une
    // table indisponible renvoie un tableau vide plutôt que d'échouer le tout.
    const safe = async <T>(p: PromiseLike<{ data: T | null }>): Promise<T | []> => {
      try { const { data } = await p; return (data as T) ?? ([] as unknown as T); }
      catch { return [] as unknown as T; }
    };

    const [
      entreprise,
      dossiersCrees,
      groupements,
      invitations,
      documentsCandidature,
      depots,
      commentaires,
      avisDonnes,
      reseau,
      integrations,
    ] = await Promise.all([
      entrepriseId
        ? safe(admin.from("entreprises").select("*").eq("id", entrepriseId).maybeSingle())
        : Promise.resolve(null),
      safe(admin.from("reponses_ao").select("*").eq("createur_id", uid)),
      entrepriseId
        ? safe(admin.from("groupements").select("*").eq("entreprise_id", entrepriseId))
        : Promise.resolve([]),
      safe(admin.from("invitations").select("*").eq("email", profil?.email ?? "")),
      entrepriseId
        ? safe(admin.from("documents_candidature").select("id, categorie, created_at, entreprise_id").eq("entreprise_id", entrepriseId))
        : Promise.resolve([]),
      safe(admin.from("depots_pieces").select("*").eq("auteur_id", uid)),
      safe(admin.from("comments").select("*").eq("user_id", uid)),
      entrepriseId
        ? safe(admin.from("avis_partenaires").select("*").eq("evaluateur_id", entrepriseId))
        : Promise.resolve([]),
      entrepriseId
        ? safe(admin.from("reseau_entreprises").select("*").eq("entreprise_id", entrepriseId))
        : Promise.resolve([]),
      // Intégrations : on expose l'existence et le fournisseur, jamais les jetons.
      safe(admin.from("user_integrations").select("provider, created_at, expires_at").eq("user_id", uid)),
    ]);

    const exportData = {
      meta: {
        genere_le: new Date().toISOString(),
        format: "Filao export RGPD v1",
        utilisateur_id: uid,
        note: "Données personnelles au sens de l'art. 20 RGPD. Les documents binaires et les jetons d'intégration ne sont pas inclus.",
      },
      profil: profil ?? null,
      entreprise: entreprise ?? null,
      dossiers_crees: dossiersCrees,
      groupements,
      invitations,
      documents_candidature: documentsCandidature,
      depots_pieces: depots,
      commentaires,
      avis_donnes: avisDonnes,
      reseau,
      integrations,
    };

    return json({ success: true, export: exportData });
  } catch (err) {
    console.error("export-user-data:", err);
    return json({ error: "Erreur interne" }, 500);
  }
});
