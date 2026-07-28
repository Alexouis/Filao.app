import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * send-network-invite Edge Function
 *
 * Sends a network invitation by email.
 * - If the recipient has a Filao account: creates an in-app notification + sends email
 * - If the recipient doesn't have an account: sends an email inviting them to join Filao
 *
 * On acceptance (handled by the recipient clicking the notification):
 *   → The frontend creates bidirectional reseau_entreprises rows
 */
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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Authenticate the calling user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email } = await req.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Adresse email invalide" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Get sender info
    const { data: senderData, error: senderErr } = await adminClient
      .from("utilisateurs")
      .select("id, prenom, nom, photo_url, email, entreprise_id, entreprises:entreprise_id(nom)")
      .eq("id", user.id)
      .single();

    if (senderErr || !senderData?.entreprise_id) {
      return new Response(JSON.stringify({ error: "Profil expéditeur non trouvé" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cannot invite yourself
    if (senderData.email?.toLowerCase() === normalizedEmail) {
      return new Response(JSON.stringify({ error: "Vous ne pouvez pas vous inviter vous-même" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderName = [senderData.prenom, senderData.nom].filter(Boolean).join(" ") || senderData.email;
    const senderCompanyName = (senderData as any).entreprises?.nom || "une entreprise";
    const senderCompanyId = senderData.entreprise_id;

    // Check if recipient is an existing Filao user
    const { data: recipientUser } = await adminClient
      .from("utilisateurs")
      .select("id, entreprise_id, prenom, nom, notifications")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    let recipientFound = false;

    if (recipientUser?.entreprise_id) {
      recipientFound = true;

      // Check if already in network
      const { data: existingLink } = await adminClient
        .from("reseau_entreprises")
        .select("id, statut")
        .eq("entreprise_origine_id", senderCompanyId)
        .eq("entreprise_cible_id", recipientUser.entreprise_id)
        .maybeSingle();

      if (existingLink && existingLink.statut === "actif") {
        return new Response(JSON.stringify({ error: "Cette entreprise fait déjà partie de votre réseau" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Cannot invite same company
      if (recipientUser.entreprise_id === senderCompanyId) {
        return new Response(JSON.stringify({ error: "Vous ne pouvez pas inviter votre propre entreprise" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create pending network link (one direction, sender → recipient)
      if (!existingLink) {
        await adminClient.from("reseau_entreprises").insert({
          entreprise_origine_id: senderCompanyId,
          entreprise_cible_id: recipientUser.entreprise_id,
          statut: "en_attente",
        });
      } else {
        // Update existing blocked/pending link
        await adminClient
          .from("reseau_entreprises")
          .update({ statut: "en_attente" })
          .eq("id", existingLink.id);
      }

      // Send in-app notification
      const currentNotifs = recipientUser.notifications || [];
      const newNotification = {
        id: crypto.randomUUID(),
        type: "network_invite",
        titre: "Invitation réseau",
        message: `vous invite à rejoindre son réseau`,
        sender_name: senderName,
        sender_avatar: senderData.photo_url || "",
        sender_company_id: senderCompanyId,
        date: new Date().toISOString(),
        read: false,
      };

      await adminClient
        .from("utilisateurs")
        .update({ notifications: [newNotification, ...currentNotifs] })
        .eq("id", recipientUser.id);
    }

    // Send email via Brevo (both for existing and non-existing users)
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoApiKey) {
      console.error("BREVO_API_KEY not set");
      // Don't fail — the in-app notification was sent
      if (recipientFound) {
        return new Response(JSON.stringify({ success: true, recipientFound, emailSent: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("BREVO_API_KEY non configurée");
    }

    const origin = req.headers.get("origin") || "https://filao-app.vercel.app";
    const loginUrl = `${origin}/login`;

    const emailSubject = recipientFound
      ? `${senderName} (${senderCompanyName}) vous invite à rejoindre son réseau sur Filao`
      : `${senderName} (${senderCompanyName}) vous invite à rejoindre Filao`;

    const emailContent = recipientFound
      ? `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #333;">
<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0E4F70;">Bonjour,</h2>
  <p>
    <strong>${senderName}</strong> de <strong>${senderCompanyName}</strong> souhaite vous ajouter à son réseau professionnel sur Filao.
  </p>
  <p>
    Connectez-vous à votre compte pour consulter cette invitation dans vos notifications.
  </p>
  <div style="text-align: center; margin-top: 32px;">
    <a href="${loginUrl}" style="background-color: #00A3E0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Se connecter à Filao</a>
  </div>
  <p style="text-align: center; color: #A0AEC0; font-size: 12px; margin-top: 40px;">
    Filao — Gestion collaborative d'appels d'offres
  </p>
</div>
</body>
</html>`
      : `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; line-height: 1.6; color: #333;">
<div style="max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0E4F70;">Bonjour,</h2>
  <p>
    <strong>${senderName}</strong> de <strong>${senderCompanyName}</strong> vous invite à rejoindre <strong>Filao</strong>, la plateforme collaborative de gestion d'appels d'offres.
  </p>
  <p>
    Créez votre compte pour rejoindre son réseau et collaborer ensemble sur vos prochains marchés publics.
  </p>
  <div style="text-align: center; margin-top: 32px;">
    <a href="${origin}/register" style="background-color: #00A3E0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Créer mon compte Filao</a>
  </div>
  <p style="text-align: center; color: #A0AEC0; font-size: 12px; margin-top: 40px;">
    Filao — Gestion collaborative d'appels d'offres
  </p>
</div>
</body>
</html>`;

    const emailPayload = {
      sender: { name: "Filao", email: "contact@filao-app.fr" },
      to: [{ email: normalizedEmail }],
      subject: emailSubject,
      htmlContent: emailContent,
    };

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    if (!res.ok) {
      console.error("Brevo Error:", await res.text());
      // Don't fail if in-app notif was sent
      if (recipientFound) {
        return new Response(JSON.stringify({ success: true, recipientFound, emailSent: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("Échec de l'envoi de l'email");
    }

    return new Response(
      JSON.stringify({ success: true, recipientFound, emailSent: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-network-invite error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});