import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-06-20",
});

const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Correspondance identifiant de prix Stripe → forfait, lue depuis `plan_limits`.
 *
 * Elle était codée en dur ici, avec deux identifiants seulement. Ajouter une
 * offre imposait donc de livrer une version de cette fonction, et un prix
 * inconnu retombait silencieusement sur `partenaire` — un client venant de payer
 * se retrouvait rétrogradé au forfait gratuit.
 *
 * La table porte désormais `stripe_price_id_mensuel` et `_annuel`
 * (migration 048) : c'est la même source de vérité que le front.
 */
async function getPlanFromPriceId(supabase: any, priceId: string): Promise<string | null> {
    if (!priceId) return null;

    const { data, error } = await supabase
        .from("plan_limits")
        .select("plan")
        .or(`stripe_price_id_mensuel.eq.${priceId},stripe_price_id_annuel.eq.${priceId}`)
        .maybeSingle();

    if (error) {
        console.error("Lecture de plan_limits impossible", error);
        return null;
    }
    if (!data) {
        // On ne devine pas : rétrograder un client qui vient de payer parce que
        // son prix n'est pas référencé serait pire que de ne rien faire.
        console.error(`Prix Stripe inconnu dans plan_limits: ${priceId}`);
        return null;
    }
    return data.plan;
}

/**
 * Réaligne les dossiers de l'entreprise sur son quota.
 *
 * À appeler après tout changement d'offre : la migration 049 installe le
 * verrouillage mais ne le déclenche pas. Sans cet appel, une rétrogradation
 * laisserait tous les dossiers ouverts et le quota serait sans effet.
 */
/**
 * Avertit l'entreprise d'un échec de paiement.
 *
 * La conception l'exige à chaque tentative : un abonnement qui s'interrompt sans
 * prévenir se découvre le jour où l'on ne peut plus créer de dossier, souvent
 * pour une carte expirée qu'un simple message aurait permis de corriger.
 *
 * Le destinataire est l'e-mail de facturation s'il est renseigné, sinon le
 * créateur de l'entreprise — c'est lui qui a souscrit.
 */
async function avertirEchecPaiement(
    supabase: any,
    entrepriseId: string,
    tentative: number,
    derniere: boolean,
) {
    const { data: entreprise } = await supabase
        .from("entreprises")
        .select("nom, created_by")
        .eq("id", entrepriseId)
        .maybeSingle();

    if (!entreprise?.created_by) return;

    const { data: souscripteur } = await supabase
        .from("utilisateurs")
        .select("email, email_facturation")
        .eq("id", entreprise.created_by)
        .maybeSingle();

    const destinataire = souscripteur?.email_facturation || souscripteur?.email;
    if (!destinataire) return;

    const libelle = derniere
        ? "Dernier échec de paiement — votre offre a été rétrogradée"
        : `Échec de paiement (tentative ${tentative}) — merci de vérifier votre moyen de paiement`;

    const { error } = await supabase.functions.invoke("send-reminder", {
        body: {
            email: destinataire,
            senderName: "Filao",
            tenderTitle: "votre abonnement",
            milestoneLabel: libelle,
            milestoneDate: new Date().toISOString(),
        },
    });
    // Un avis non parti ne doit pas faire échouer le webhook : Stripe le
    // rejouerait, et la rétrogradation serait appliquée deux fois.
    if (error) console.error("Avis d'échec de paiement non envoyé", error);
}

async function appliquerQuota(supabase: any, entrepriseId: string) {
    const { data, error } = await supabase.rpc("appliquer_quota_entreprise", {
        p_entreprise_id: entrepriseId,
    });
    if (error) console.error("appliquer_quota_entreprise:", error);
    else if (data) console.log(`Quota appliqué: ${data} dossier(s) verrouillé(s)`);
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
                const plan = await getPlanFromPriceId(supabase, priceId);
                if (!plan) break;   // prix inconnu : on ne touche à rien

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
                else await appliquerQuota(supabase, entrepriseId);
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
                const plan = await getPlanFromPriceId(supabase, priceId);
                if (!plan) break;   // prix inconnu : on ne touche à rien

                await supabase
                    .from("entreprises")
                    .update({
                        plan,
                        subscription_status: subscription.status,
                        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    })
                    .eq("id", entrepriseId);

                // Un changement d'offre peut être une montée comme une descente :
                // dans le second cas, l'excédent doit être verrouillé, dans le
                // premier, les verrous levés. La même fonction traite les deux.
                await appliquerQuota(supabase, entrepriseId);
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

                await appliquerQuota(supabase, entrepriseId);
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

                // Stripe relance de lui-même : `attempt_count` porte le numéro de
                // la tentative. La conception prévoit trois relances puis
                // rétrogradation — c'est `next_payment_attempt` qui dit s'il en
                // reste, plutôt qu'un décompte que nous tiendrions en parallèle et
                // qui divergerait du calendrier réel de Stripe.
                const tentative = invoice.attempt_count ?? 1;
                const derniereTentative = !invoice.next_payment_attempt;

                await avertirEchecPaiement(supabase, entrepriseId, tentative, derniereTentative);

                if (derniereTentative) {
                    // Rétrogradation, jamais de suppression : les dossiers
                    // excédentaires passent en lecture seule et restent
                    // consultables.
                    await supabase
                        .from("entreprises")
                        .update({ plan: "partenaire", subscription_status: "unpaid" })
                        .eq("id", entrepriseId);
                    await appliquerQuota(supabase, entrepriseId);
                    console.log(`Payment definitively failed: entreprise=${entrepriseId}, downgraded`);
                } else {
                    console.log(`Payment failed (attempt ${tentative}): entreprise=${entrepriseId}`);
                }
                break;
            }

            case "invoice.payment_succeeded": {
                // N'était pas traité : une entreprise passée en `past_due` y
                // restait après régularisation, et son offre n'était pas
                // rétablie. Un client qui repaie devait attendre un autre
                // événement pour retrouver son accès.
                const invoice = event.data.object as Stripe.Invoice;
                const subscriptionId = invoice.subscription as string;
                if (!subscriptionId) break;

                const subscription = await stripe.subscriptions.retrieve(subscriptionId);
                const entrepriseId = subscription.metadata?.entreprise_id;
                if (!entrepriseId) break;

                const priceId = subscription.items.data[0]?.price.id;
                const plan = await getPlanFromPriceId(supabase, priceId);

                await supabase
                    .from("entreprises")
                    .update({
                        ...(plan ? { plan } : {}),
                        subscription_status: "active",
                        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    })
                    .eq("id", entrepriseId);

                await appliquerQuota(supabase, entrepriseId);
                console.log(`Payment succeeded: entreprise=${entrepriseId}, plan=${plan}`);
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