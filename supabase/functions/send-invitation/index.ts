import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitationRequest {
  tenderId: string;
  tenderTitle: string;
  // Either email (direct) or entrepriseId (company-based invite) must be provided
  email?: string;
  entrepriseId?: string;
  // Optional: sender's user ID for in-app notification
  senderUserId?: string;
  role: string;
  message?: string;
  senderName: string;
  accessCode?: string;
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

    const body: InvitationRequest = await req.json();
    const { tenderId, tenderTitle, role, message, senderName, accessCode, senderUserId } = body;
    let { email, entrepriseId } = body;

    if (!tenderId || !role) {
      return new Response(JSON.stringify({ error: "Missing required fields: tenderId, role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!email && !entrepriseId) {
      return new Response(JSON.stringify({ error: "Either email or entrepriseId must be provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use SERVICE ROLE KEY for server-side operations (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Also create an authed client for operations that should respect RLS
    const authedClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    let recipientId: string | undefined;

    // Resolve email from entrepriseId if needed (uses service role to bypass RLS)
    if (!email && entrepriseId) {
      const { data: referent, error: refErr } = await adminClient
        .from("utilisateurs")
        .select("id, email")
        .eq("entreprise_id", entrepriseId)
        .limit(1)
        .maybeSingle();

      if (refErr) {
        console.error("Error fetching referent:", refErr);
        return new Response(JSON.stringify({ error: "Could not resolve referent for company" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!referent?.email) {
        console.warn("No registered user found for entrepriseId:", entrepriseId);
        return new Response(JSON.stringify({ error: "No registered user found for this company" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      email = referent.email;
      recipientId = referent.id;
    }

    // If we have an email but not yet a recipientId, check if user exists
    if (!recipientId) {
      const { data: existingUser } = await adminClient
        .from("utilisateurs")
        .select("id")
        .eq("email", email!)
        .maybeSingle();
      recipientId = existingUser?.id;
    }

    // ── In-app notification ──
    if (recipientId) {
      const { data: recipientData } = await adminClient
        .from("utilisateurs")
        .select("notifications")
        .eq("id", recipientId)
        .maybeSingle();

      // Fetch sender avatar if senderUserId provided
      let senderAvatar = "";
      if (senderUserId) {
        const { data: senderData } = await adminClient
          .from("utilisateurs")
          .select("photo_url")
          .eq("id", senderUserId)
          .maybeSingle();
        senderAvatar = senderData?.photo_url || "";
      }

      if (recipientData) {
        const currentNotifications = recipientData.notifications || [];
        const newNotification = {
          id: crypto.randomUUID(),
          type: "collaborator_invited",
          titre: "Invitation à collaborer",
          message: `${senderName} vous a invité à collaborer sur`,
          sender_name: senderName,
          sender_avatar: senderAvatar,
          related_tender_id: tenderId,
          related_tender_titre: tenderTitle,
          date: new Date().toISOString(),
          read: false,
        };

        await adminClient
          .from("utilisateurs")
          .update({ notifications: [newNotification, ...currentNotifications] })
          .eq("id", recipientId);
      }
    }

    // ── Insert or Update invitation record ──
    const token = crypto.randomUUID();
    const { error: inviteError } = await adminClient
      .from("invitations")
      .upsert({
        tender_id: tenderId,
        email: email!,
        role: role,
        token: token,
        access_code: accessCode,
        status: "pending",
        created_by: senderUserId || (await authedClient.auth.getUser()).data.user?.id,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, {
        onConflict: 'tender_id, email'
      });

    if (inviteError) {
      console.error("Error upserting invitation:", inviteError);
      throw inviteError;
    }

    // ── Determine Invitation URL entry point ──
    // If recipientId exists -> magic link (token)
    // If guest -> manual login (no token)
    // ── Determine Invitation URL ──
    const origin = req.headers.get("origin") || "https://filao.io";
    
    // REDIRECTION LOGIC:
    // Filao members are sent directly to the app's Tender Wizard
    // Guests are sent to the manual verification portal
    const invitationUrl = recipientId
      ? `${origin}/?tab=wizard&id=${tenderId}`
      : `${origin}/collaborator-access?tenderId=${tenderId}`;

    // ── Send Email via Brevo ──
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoApiKey) {
      throw new Error("BREVO_API_KEY is not set");
    }

    const emailPayload = {
      sender: { name: "Filao", email: "contact@filao.io" },
      to: [{ email: email! }],
      subject: `Collaboration : ${senderName} vous invite sur le projet "${tenderTitle}"`,
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #1B5D7A;">Filao - Collaboration</h2>
          <p>Bonjour,</p>
          <p><strong>${senderName}</strong> vous invite à collaborer sur l'appel d'offres : <strong>"${tenderTitle}"</strong> en tant que <strong>${role}</strong>.</p>
          
          ${message ? `<div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #1B5D7A; margin: 20px 0; font-style: italic;">"${message}"</div>` : ""}
          
          <p style="margin-top: 25px;">Pour accéder au dossier et déposer vos pièces administratives :</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${invitationUrl}" style="background-color: #F06A50; color: white; padding: 15px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Accéder au dossier
            </a>
          </div>

          <div style="background: #eef7f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #1B5D7A;"><strong>Identifiants d'accès :</strong></p>
            <p style="margin: 10px 0 0 0;">Email : <strong>${email!}</strong></p>
            <p style="margin: 5px 0 0 0;">Code d'accès : <span style="font-family: monospace; font-size: 18px; font-weight: bold; letter-spacing: 2px; color: #1B5D7A;">${accessCode}</span></p>
          </div>
          
          <p style="font-size: 12px; color: #777; margin-top: 30px; text-align: center;">
            Ce lien est valable pendant 30 jours.
          </p>
        </div>
      `,
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
      console.error("Brevo Error:", await res.text());
      throw new Error("Echec de l'envoi de l'email");
    }

    return new Response(JSON.stringify({ success: true, token, recipientId }), {
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
