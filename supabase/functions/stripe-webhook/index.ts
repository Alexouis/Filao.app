import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-06-20",
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Map Stripe price IDs to plan names
const PRICE_TO_PLAN: Record<string, string> = {
    "price_1T2999LxJkH1ubMfNCul93Um": "solo",
    "price_1T2999LxJkH1ubMfVCD0OB7F": "equipe",
};

function getPlanFromPriceId(priceId: string): string {
    return PRICE_TO_PLAN[priceId] || "partenaire";
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { status: 200 });
    }

    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
        return new Response("Missing stripe-signature", { status: 400 });
    }

    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(body, sig, endpointSecret);
    } catch (err: any) {
        console.error("Webhook signature verification failed:", err.message);
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object as Stripe.Checkout.Session;
                const entrepriseId = session.metadata?.entreprise_id;
                const userId = session.metadata?.user_id;
                const subscriptionId = session.subscription as string;

                if (!entrepriseId || !subscriptionId) {
                    console.error("Missing metadata or subscription ID");
                    break;
                }

                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const priceId = subscription.items.data[0]?.price.id;
                const plan = getPlanFromPriceId(priceId);

                const { error } = await supabase
                    .from("entreprises")
                    .update({
                        plan,
                        stripe_subscription_id: subscriptionId,
                        stripe_customer_id: session.customer as string,
                        subscription_status: "active",
                        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    })
                    .eq("id", entrepriseId);

                if (error) console.error("Error updating entreprises:", error);
                console.log(`Checkout completed: entreprise=${entrepriseId}, user=${userId}, plan=${plan}`);
                break;
            }

            case "customer.subscription.updated": {
                const subscription = event.data.object as Stripe.Subscription;
                const entrepriseId = subscription.metadata?.entreprise_id;

                if (!entrepriseId) {
                    console.error("Missing entreprise_id in subscription metadata");
                    break;
                }

                const priceId = subscription.items.data[0]?.price.id;
                const plan = getPlanFromPriceId(priceId);

                await supabase
                    .from("entreprises")
                    .update({
                        plan,
                        subscription_status: subscription.status,
                        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    })
                    .eq("id", entrepriseId);

                console.log(`Subscription updated: entreprise=${entrepriseId}, plan=${plan}, status=${subscription.status}`);
                break;
            }

            case "customer.subscription.deleted": {
                const subscription = event.data.object as Stripe.Subscription;
                const entrepriseId = subscription.metadata?.entreprise_id;

                if (!entrepriseId) {
                    console.error("Missing entreprise_id in subscription metadata");
                    break;
                }

                await supabase
                    .from("entreprises")
                    .update({
                        plan: "partenaire",
                        stripe_subscription_id: null,
                        subscription_status: "canceled",
                        current_period_end: null,
                    })
                    .eq("id", entrepriseId);

                console.log(`Subscription deleted: entreprise=${entrepriseId}, downgraded to partenaire`);
                break;
            }

            case "invoice.payment_failed": {
                const invoice = event.data.object as Stripe.Invoice;
                const subscriptionId = invoice.subscription as string;

                if (!subscriptionId) break;

                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const entrepriseId = subscription.metadata?.entreprise_id;

                if (!entrepriseId) break;

                await supabase
                    .from("entreprises")
                    .update({ subscription_status: "past_due" })
                    .eq("id", entrepriseId);

                console.log(`Payment failed: entreprise=${entrepriseId}`);
                break;
            }

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
    } catch (err: any) {
        console.error("Webhook handler error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ received: true }), {
        headers: { "Content-Type": "application/json" },
    });
});
