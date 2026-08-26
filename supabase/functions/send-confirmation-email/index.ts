import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXPEDITEUR } from "./emailConfig.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { email } = await req.json();

        if (!email) {
            return new Response(JSON.stringify({ error: "Missing email" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // Generate the signup confirmation link
        //
        // ⚠️ CONFLIT AVEC L'E-MAIL NATIF DE SUPABASE
        // `generateLink` produit un NOUVEAU jeton, ce qui INVALIDE celui déjà
        // envoyé par `signUp`. Si l'e-mail natif de Supabase est actif, le
        // destinataire reçoit deux messages : cliquer sur le premier donne
        // « Email link is invalid or has expired ».
        //
        // Il faut donc DÉSACTIVER l'envoi natif dans les réglages Auth du
        // projet (« Confirm signup » → template désactivé), pour que cet e-mail
        // de marque soit le seul émis.
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: "signup",
            email,
            options: {
                // Même destination que `signUp` côté client : sans elle, le lien
                // ramène à la racine du site, où rien ne traite le jeton.
                redirectTo: `${Deno.env.get("APP_URL") ?? ""}/login`,
            },
        });

        if (linkError || !linkData?.properties?.hashed_token) {
            console.error("Error generating link:", linkError);
            throw new Error("Impossible de générer le lien de confirmation");
        }

        // Lien vers NOTRE page de confirmation, et non vers le lien d'action de
        // Supabase.
        //
        // POURQUOI CE DÉTOUR
        // Le lien d'action consomme le jeton DÈS SA VISITE. Or les analyseurs
        // de liens des messageries professionnelles (Outlook Safe Links,
        // Proofpoint, antivirus) ouvrent les URL avant le destinataire pour les
        // inspecter : le jeton, à usage unique, était donc déjà brûlé quand
        // l'utilisateur cliquait — d'où « Email link is invalid or has expired »
        // sur un lien pourtant tout neuf.
        //
        // En transmettant le `hashed_token` à une page qui exige un CLIC pour
        // appeler `verifyOtp`, un robot peut charger la page sans rien
        // consommer. Seule une action humaine valide le compte.
        const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
        const confirmationUrl =
            `${appUrl}/confirmer?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=signup`;

        // Send via Brevo API using template ID 1
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (!brevoApiKey) {
            throw new Error("BREVO_API_KEY is not set");
        }

        const emailPayload = {
            sender: EXPEDITEUR,
            to: [{ email }],
            subject: "Confirmez votre compte Filao",
            templateId: 1,
            params: {
                confirmationUrl,
            },
        };

        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
                "api-key": brevoApiKey,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            body: JSON.stringify(emailPayload),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error("Brevo Error:", errText);
            throw new Error("Échec de l'envoi de l'email de confirmation");
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

    } catch (err: any) {
        console.error(err);
        return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});