import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { genererJetonInvitation, empreinteJeton } from "./invitationTokens.ts";

/**
 * Échappement HTML.
 *
 * Le gabarit de l'e-mail est construit par concaténation de chaînes : sans
 * échappement, `senderName`, `tenderTitle`, `role` et `message` sont interprétés
 * comme du balisage. Les clients de messagerie filtrent `<script>`, donc le
 * risque n'est pas l'exécution de code — c'est l'injection de contenu : un faux
 * bouton renvoyant vers un site de collecte d'identifiants, dans un message
 * authentiquement envoyé par Filao. Du hameçonnage signé de notre domaine.
 *
 * `tenderTitle` vient du BOAMP et `message` est saisi librement : aucune des
 * deux valeurs n'est maîtrisée.
 */
const echapperHtml = (valeur: unknown): string =>
  String(valeur ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Validation d'adresse. Le contrôle côté navigateur ne protège rien : la
 * fonction est appelable directement.
 */
const emailValide = (valeur: unknown): boolean => {
  const adresse = String(valeur ?? "").trim();
  return adresse.length > 0 && adresse.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(adresse);
};

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

    // Le formulaire refuse déjà une adresse invalide, mais cette fonction est
    // appelable directement : le contrôle qui compte est ici.
    if (email && !emailValide(email)) {
      return new Response(JSON.stringify({ error: `Adresse e-mail invalide : « ${email} »` }), {
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
        .ilike("email", email!.trim())
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
    // 32 octets aléatoires plutôt qu'un UUID : un UUID v4 ne porte que 122 bits
    // d'entropie et sa structure est devinable. Seule l'empreinte est stockée.
    const token = genererJetonInvitation();
    const tokenHash = await empreinteJeton(token);
    const { error: inviteError } = await adminClient
      .from("invitations")
      .upsert({
        tender_id: tenderId,
        // Normalisé : l'unicité (tender_id, email) porte sur la valeur exacte,
        // « Alex@x.fr » et « alex@x.fr » créeraient sinon deux invitations
        // concurrentes pour la même personne, chacune avec son propre code.
        email: email!.toLowerCase().trim(),
        role: role,
        // La base ne conserve que l'empreinte (migration 042). La valeur en
        // clair ne sort d'ici que dans le lien du courriel.
        token_hash: tokenHash,
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
      // Un objet d'e-mail ne peut pas contenir de saut de ligne : il servirait à
      // injecter des en-têtes supplémentaires. Brevo passant par une API JSON le
      // risque est théorique, mais le nettoyage ne coûte rien.
      subject: `Collaboration : ${String(senderName ?? "").replace(/[\r\n]+/g, " ")} vous invite sur le projet "${String(tenderTitle ?? "").replace(/[\r\n]+/g, " ")}"`,
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #1B5D7A;">Filao - Collaboration</h2>
          <p>Bonjour,</p>
          <p><strong>${echapperHtml(senderName)}</strong> vous invite à collaborer sur l'appel d'offres : <strong>"${echapperHtml(tenderTitle)}"</strong> en tant que <strong>${echapperHtml(role)}</strong>.</p>
          
          ${message ? `<div style="background: #f9f9f9; padding: 15px; border-left: 4px solid #1B5D7A; margin: 20px 0; font-style: italic;">"${echapperHtml(message)}"</div>` : ""}
          
          <p style="margin-top: 25px;">Pour accéder au dossier et déposer vos pièces administratives :</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${echapperHtml(invitationUrl)}" style="background-color: #F06A50; color: white; padding: 15px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Accéder au dossier
            </a>
          </div>

          <div style="background: #eef7f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #1B5D7A;"><strong>Identifiants d'accès :</strong></p>
            <p style="margin: 10px 0 0 0;">Email : <strong>${echapperHtml(email)}</strong></p>
            <p style="margin: 5px 0 0 0;">Code d'accès : <span style="font-family: monospace; font-size: 18px; font-weight: bold; letter-spacing: 2px; color: #1B5D7A;">${echapperHtml(accessCode)}</span></p>
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