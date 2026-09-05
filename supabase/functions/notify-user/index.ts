import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * notify-user — notifications DANS L'APPLICATION.
 *
 * Écrit dans `utilisateurs.notifications` (colonne JSONB) pour un utilisateur
 * qui n'est pas l'appelant, ce que la RLS interdit depuis le client : la table
 * est strictement personnelle (migration 070). D'où la clé service-role.
 *
 * ── PÉRIMÈTRE : IN-APP UNIQUEMENT ───────────────────────────────────────────
 * Cette fonction n'envoie PLUS d'e-mail.
 *
 * Elle appelait auparavant `send-notification-email`, qui postait directement à
 * Brevo. Cela court-circuitait la file `emails_a_envoyer` et donc, d'un seul
 * coup : le plafond d'envoi, les préférences appliquées à la consommation, le
 * journal `emails_envoyes`, et surtout la règle de regroupement — un
 * récapitulatif par destinataire et par jour au lieu d'un message par pièce.
 * Deux chaînes d'e-mail coexistaient, avec un risque de doublons.
 *
 * L'e-mail passe désormais par un seul chemin : les producteurs
 * (`calculer-emails`, `recap-depots`) enfilent, `consommer-emails` envoie.
 *
 * Conséquence assumée : un événement sans type dans le catalogue de la file
 * (`emailTypes.ts`) ne donne pas lieu à un e-mail. Pour en ajouter un, il faut
 * un type ET un gabarit côté file — pas un envoi parallèle ici.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationData {
  type: string;
  titre: string;
  message: string;
  sender_name?: string;
  sender_avatar?: string;
  related_tender_id?: string;
  related_tender_titre?: string;
}

interface NotifyUserRequest {
  /** Utilisateur à notifier. DOIT être un `utilisateurs.id`. */
  userId: string;
  /** 'add' (défaut) ou 'delete'. */
  action?: 'add' | 'delete';
  notification?: NotificationData;
  /** Préférence à vérifier avant d'écrire (null = toujours notifier). */
  prefKey?: string | null;
  /** Pour 'delete' : critères des notifications à retirer. */
  deleteFilter?: { type?: string; related_tender_id?: string };
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

    // L'appelant doit être un utilisateur Filao authentifié.
    const authedClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await authedClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId, action = 'add', notification, prefKey = null, deleteFilter }: NotifyUserRequest =
      await req.json();

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing userId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role : contourne la RLS pour lire/écrire la ligne d'autrui.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: userData, error: fetchError } = await adminClient
      .from("utilisateurs")
      .select("notifications, notification_preferences")
      .eq("id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!userData) {
      // 404 « cible introuvable » et non « fonction absente » : c'est
      // l'identifiant transmis qui ne désigne aucun utilisateur. Piège
      // classique : envoyer un id d'invitation ou de groupement.
      return new Response(JSON.stringify({ error: "Target user not found", userId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Suppression ──
    if (action === "delete") {
      if (!deleteFilter) {
        return new Response(JSON.stringify({ error: "Missing deleteFilter for delete action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const current = userData.notifications || [];
      const updated = current.filter((n: any) => {
        const matchType = deleteFilter.type ? n.type === deleteFilter.type : true;
        const matchTender = deleteFilter.related_tender_id
          ? n.related_tender_id === deleteFilter.related_tender_id
          : true;
        return !(matchType && matchTender);
      });

      if (updated.length !== current.length) {
        const { error } = await adminClient
          .from("utilisateurs")
          .update({ notifications: updated })
          .eq("id", userId);
        if (error) throw error;
      }

      return new Response(
        JSON.stringify({ success: true, supprimees: current.length - updated.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Ajout ──
    if (!notification) {
      return new Response(JSON.stringify({ error: "Missing notification for add action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prefs = userData.notification_preferences;
    // Sans `prefKey`, la notification est toujours écrite. Avec, on respecte le
    // choix de l'utilisateur ; l'absence de préférence vaut « activée ».
    const notifierDansApp = !prefKey || prefs?.[prefKey]?.app !== false;

    if (notifierDansApp) {
      const currentNotifications = userData.notifications || [];
      const newNotification = {
        id: crypto.randomUUID(),
        ...notification,
        date: new Date().toISOString(),
        read: false,
      };

      const { error: updateError } = await adminClient
        .from("utilisateurs")
        .update({ notifications: [newNotification, ...currentNotifications] })
        .eq("id", userId);

      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({ success: true, ecrite: notifierDansApp }), {
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
