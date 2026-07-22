import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReminderRequest {
  tenderId: string;
  tenderTitle: string;
  email: string;
  senderName: string;
  senderUserId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ReminderRequest = await req.json();
    const { tenderId, tenderTitle, email, senderName, senderUserId } = body;

    if (!tenderId || !email || !senderName) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Resolve Recipient ID (if they have an account)
    const { data: recipient } = await adminClient
      .from("utilisateurs")
      .select("id, notifications, photo_url")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    // 2. Resolve Sender Avatar
    let senderAvatar = "";
    if (senderUserId) {
      const { data: senderData } = await adminClient
        .from("utilisateurs")
        .select("photo_url")
        .eq("id", senderUserId)
        .maybeSingle();
      senderAvatar = senderData?.photo_url || "";
    }

    // 3. In-app notification
    if (recipient) {
      const newNotification = {
        id: crypto.randomUUID(),
        type: "document_reminder",
        titre: "Rappel de documents",
        message: `${senderName} vous a envoyé un rappel pour les pièces manquantes sur`,
        sender_name: senderName,
        sender_avatar: senderAvatar,
        related_tender_id: tenderId,
        related_tender_titre: tenderTitle,
        date: new Date().toISOString(),
        read: false,
      };

      await adminClient
        .from("utilisateurs")
        .update({ notifications: [newNotification, ...(recipient.notifications || [])] })
        .eq("id", recipient.id);
    }

    // 4. Fetch Access Code from Invitation
    const { data: invite } = await adminClient
      .from("invitations")
      .select("access_code")
      .eq("tender_id", tenderId)
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();

    const accessCode = invite?.access_code || "??????";

    // 5. Build Invitation URL
    const origin = req.headers.get("origin") || "https://filao.io";
    const appUrl = recipient
      ? `${origin}/?tab=wizard&id=${tenderId}`
      : `${origin}/collaborator-access?tenderId=${tenderId}`;

    // 6. Send Email via Brevo
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (brevoApiKey) {
      const emailPayload = {
        sender: { name: "Filao", email: "contact@filao.io" },
        to: [{ email: email.toLowerCase().trim() }],
        subject: `Rappel : Documents manquants pour le projet "${tenderTitle}"`,
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #1B5D7A; font-size: 20px;">Rappel : Coordination Documentaire</h2>
            <p>Bonjour,</p>
            <p><strong>${senderName}</strong> vous informe que des documents sont encore manquants pour l'appel d'offres : <strong>"${tenderTitle}"</strong>.</p>
            
            <p style="margin-top: 25px;">Merci de vous connecter pour régulariser votre dossier :</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appUrl}" style="background-color: #00A3E0; color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                Accéder au dossier
              </a>
            </div>

            <div style="background: #eef7f9; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #00A3E0;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #1B5D7A; font-weight: bold;">Rappel de vos identifiants :</p>
              <p style="margin: 0; font-size: 13px;">Email : <strong>${email.toLowerCase().trim()}</strong></p>
              <p style="margin: 5px 0 0 0; font-size: 13px;">Code d'accès : <span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #1B5D7A; letter-spacing: 1px;">${accessCode}</span></p>
            </div>
            
            <p style="font-size: 12px; color: #777; margin-top: 40px; text-align: center; border-top: 1px solid #eee; pt-20">
              Ceci est un message automatique de coordination via <strong>Filao.io</strong>
            </p>
          </div>
        `,
      };

      const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!emailRes.ok) {
        const errorText = await emailRes.text();
        console.error("Brevo Error:", errorText);
        return new Response(JSON.stringify({ error: "Echec de l'envoi de l'email" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
