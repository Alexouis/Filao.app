import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.24.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Identification de l'appelant avec SON jeton.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      throw new Error('User not found')
    }

    // Lecture du profil en service-role : le rôle vit dans `roles`, dont la
    // jointure n'est pas garantie sous RLS pour l'appelant. Un contrôle d'accès
    // ne doit pas dépendre d'une lecture qui peut revenir vide sans erreur.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { priceId } = await req.json()
    if (!priceId) throw new Error('priceId is required')

    // `entrepriseId` n'est PLUS lu depuis le corps de la requête.
    //
    // Il y était accepté sans aucune vérification, puis recopié dans
    // `metadata.entreprise_id`. Or le webhook fait entièrement confiance à cette
    // métadonnée : il écrase `stripe_customer_id` et `stripe_subscription_id` de
    // l'entreprise désignée. N'importe quel compte authentifié pouvait donc
    // souscrire en désignant l'entreprise d'un tiers, et remplacer le client
    // Stripe de celle-ci par le sien — l'abonnement d'origine devenant
    // introuvable depuis le portail de son administrateur légitime.
    //
    // L'entreprise est désormais celle de l'appelant, déduite de son compte.
    const { data: appelant } = await supabaseAdmin
      .from('utilisateurs')
      .select('entreprise_id, roles(name)')
      .eq('id', user.id)
      .single()

    if (!appelant?.entreprise_id) {
      return new Response(
        JSON.stringify({ error: "Aucune entreprise rattachée à ce compte." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 },
      )
    }

    // Souscrire engage l'entreprise : son forfait, son prix et ses limites
    // valent pour tous les membres. L'interface grise déjà le bouton pour les
    // simples membres, mais cette fonction reste invocable directement.
    if ((appelant.roles as { name?: string } | null)?.name !== 'admin') {
      return new Response(
        JSON.stringify({
          error: "Seul un administrateur de votre entreprise peut souscrire un forfait.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 },
      )
    }

    const entrepriseId = appelant.entreprise_id

    const { data: entreprise } = await supabaseAdmin
      .from('entreprises')
      .select('stripe_customer_id, stripe_subscription_id, subscription_status')
      .eq('id', entrepriseId)
      .single()

    // Un abonnement actif existe déjà : passer par Checkout en créerait un
    // SECOND, facturé en parallèle du premier. Le webhook écraserait de surcroît
    // `stripe_subscription_id`, rendant l'ancien abonnement invisible de
    // l'application — donc impossible à résilier depuis l'interface, tout en
    // continuant à prélever.
    //
    // Le changement de forfait se fait dans le portail Stripe, qui remplace
    // l'abonnement au lieu de l'empiler.
    if (
      entreprise?.stripe_subscription_id &&
      ['active', 'trialing', 'past_due'].includes(entreprise.subscription_status ?? '')
    ) {
      return new Response(
        JSON.stringify({
          error: "Un abonnement est déjà actif. Utilisez le portail de paiement pour en changer.",
          code: 'abonnement_actif',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 },
      )
    }

    console.log(`Creating checkout session for user ${user.id} / entreprise ${entrepriseId} / price ${priceId}`);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.get('origin')}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin')}/settings?tab=pricing`,

      // Réutiliser le client Stripe de l'entreprise s'il existe (abonnement
      // résilié puis repris). Sans cela, chaque souscription créait un NOUVEAU
      // client : l'historique de facturation repartait de zéro et le portail
      // n'affichait plus les anciennes factures.
      //
      // Stripe refuse `customer` et `customer_email` ensemble.
      ...(entreprise?.stripe_customer_id
        ? { customer: entreprise.stripe_customer_id }
        : { customer_email: user.email }),

      metadata: {
        entreprise_id: entrepriseId,
        user_id: user.id
      },

      // ⚠️ Métadonnées portées par l'ABONNEMENT, et pas seulement par la session.
      //
      // Stripe ne propage pas les métadonnées d'une session Checkout vers
      // l'abonnement qu'elle crée. Or le webhook lit
      // `subscription.metadata.entreprise_id` pour TOUS les événements de cycle
      // de vie : `customer.subscription.updated`, `.deleted` et
      // `invoice.payment_failed`. Ils sortaient donc systématiquement sur
      // « Missing entreprise_id in subscription metadata ».
      //
      // Conséquence directe : une résiliation depuis le portail Stripe ne
      // rétrogradait jamais l'entreprise. Elle cessait d'être facturée tout en
      // conservant son forfait payant et ses quotas. Un changement de forfait
      // depuis le portail n'était pas répercuté non plus.
      subscription_data: {
        metadata: {
          entreprise_id: entrepriseId,
          user_id: user.id
        },
      },

      allow_promotion_codes: true,
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    console.error('Error creating checkout session:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    )
  }
})
