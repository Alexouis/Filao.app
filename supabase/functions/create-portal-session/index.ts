import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Le portail Stripe permet de changer de forfait, de remplacer le moyen de
    // paiement et de RÉSILIER. Ces actions engagent l'entreprise entière.
    //
    // Le corps de la requête n'est plus lu : `entrepriseId` y était fourni par
    // l'appelant, puis comparé à son propre profil — autant lui demander de se
    // désigner lui-même. L'entreprise est désormais déduite du compte. Le client
    // peut continuer à envoyer ce champ, il est simplement ignoré.
    const { data: appelant } = await supabase
      .from("utilisateurs")
      .select("entreprise_id, roles(name)")
      .eq("id", user.id)
      .single();

    if (!appelant?.entreprise_id) {
      return new Response(JSON.stringify({ error: "Access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Contrôle de rôle : c'est CE bloc qui protège l'abonnement.
    //
    // L'interface masque déjà le bouton pour les simples membres, mais cette
    // fonction reste invocable directement par tout compte authentifié. Sans le
    // test ci-dessous, n'importe quel collaborateur pouvait ouvrir le portail et
    // résilier l'abonnement de toute son entreprise.
    if ((appelant.roles as { name?: string } | null)?.name !== "admin") {
      return new Response(
        JSON.stringify({
          error: "Seul un administrateur de votre entreprise peut gérer l'abonnement.",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const entrepriseId = appelant.entreprise_id;

    // Get Stripe customer ID
    const { data: entreprise } = await supabase
      .from("entreprises")
      .select("stripe_customer_id")
      .eq("id", entrepriseId)
      .single();

    if (!entreprise?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "No Stripe customer found. Please subscribe first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "http://localhost:3000";

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: entreprise.stripe_customer_id,
      return_url: `${origin}/?tab=settings`,
    });

    return new Response(JSON.stringify({ url: portalSession.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Portal error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
