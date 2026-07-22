import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: "signup",
            email,
        });

        if (linkError || !linkData?.properties?.action_link) {
            console.error("Error generating link:", linkError);
            throw new Error("Impossible de générer le lien de confirmation");
        }

        const confirmationUrl = linkData.properties.action_link;

        // Send via Brevo API using template ID 1
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (!brevoApiKey) {
            throw new Error("BREVO_API_KEY is not set");
        }

        const emailPayload = {
            sender: { name: "Filao", email: "noreply@filao.io" },
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
