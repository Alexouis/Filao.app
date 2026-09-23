import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TITRES, regleDestinataire } from "./regles.ts";

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

const motifExact = (v: string) => String(v ?? "").trim().replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * L'utilisateur est-il lié au dossier ? Même règle que `app.est_convie`
 * (migrations 092 et 094) : créateur, entreprise PARTENAIRE présente au
 * groupement (hors refus), administrateur de l'entreprise porteuse, ou
 * invitation nominative non révoquée. La ligne de l'entreprise porteuse ne
 * rend pas « lié » : les collègues du porteur ne lisent pas le dossier.
 */
const estLieAuDossier = async (
  admin: any, dossier: { id: string; createur_id: string | null; entreprise_id: string | null },
  u: { id: string; entreprise_id: string | null; email: string | null },
): Promise<boolean> => {
  if (dossier.createur_id === u.id) return true;
  if (u.entreprise_id && u.entreprise_id === dossier.entreprise_id) {
    const { data: profil } = await admin.from("utilisateurs").select("roles(name)").eq("id", u.id).maybeSingle();
    return (profil?.roles as { name?: string } | null)?.name === "admin";
  }
  if (u.entreprise_id) {
    const { data } = await admin.from("groupements").select("statut")
      .eq("projet_id", dossier.id).eq("entreprise_id", u.entreprise_id);
    if ((data ?? []).some((g: { statut: string }) => g.statut !== "refuse")) return true;
  }
  if (u.email) {
    const { data } = await admin.from("invitations").select("id")
      .eq("tender_id", dossier.id).ilike("email", motifExact(u.email)).is("revoked_at", null).limit(1);
    if ((data ?? []).length > 0) return true;
  }
  return false;
};

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
      .select("notifications, notification_preferences, entreprise_id, email")
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

    // ── Autorisation ──
    // Jusqu'ici, être connecté suffisait : n'importe quel compte pouvait écrire
    // chez n'importe qui (titre, message et expéditeur au choix) ou effacer
    // ses notifications.
    const refus = (motif: string) => new Response(JSON.stringify({ error: motif }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // Suppression : uniquement ses propres notifications. (Les purges pour
    // autrui passent par les fonctions serveur, avec la clé de service.)
    if (action === "delete" && userId !== user.id) {
      return refus("Vous ne pouvez supprimer que vos propres notifications.");
    }

    let expediteur: { nom: string; avatar: string } | null = null;
    let titreDossier: string | undefined;

    if (action !== "delete") {
      const type = notification?.type ?? "";
      if (!(type in TITRES)) return refus(`Type de notification non autorisé : « ${type} ».`);

      const { data: appelant } = await adminClient.from("utilisateurs")
        .select("id, prenom, nom, email, photo_url, entreprise_id").eq("id", user.id).maybeSingle();
      if (!appelant) return refus("Profil introuvable.");
      expediteur = {
        nom: [appelant.prenom, appelant.nom].filter(Boolean).join(" ") || appelant.email || "Un utilisateur",
        avatar: appelant.photo_url || "",
      };
      const cible = { id: userId, entreprise_id: userData.entreprise_id ?? null, email: userData.email ?? null };

      if (regleDestinataire(type) === "reseau") {
        const a = appelant.entreprise_id, b = cible.entreprise_id;
        if (!a || !b) return refus("Aucune relation de réseau entre ces entreprises.");
        const { data: lien } = await adminClient.from("reseau_entreprises").select("id")
          .or(`and(entreprise_origine_id.eq.${a},entreprise_cible_id.eq.${b}),and(entreprise_origine_id.eq.${b},entreprise_cible_id.eq.${a})`)
          .limit(1);
        if (!lien?.length) return refus("Aucune relation de réseau entre ces entreprises.");
      } else {
        const idDossier = notification?.related_tender_id;
        if (!idDossier) return refus("Dossier manquant.");
        const { data: dossier } = await adminClient.from("reponses_ao")
          .select("id, titre, createur_id, entreprise_id").eq("id", idDossier).maybeSingle();
        if (!dossier) return refus("Dossier introuvable.");
        titreDossier = dossier.titre;

        if (regleDestinataire(type) === "porteur") {
          // Réponse ou départ : l'appelant peut ne plus figurer au groupement
          // (il vient de le quitter). Seul le destinataire est contraint.
          if (dossier.createur_id !== userId) return refus("Destinataire non autorisé.");
        } else {
          if (!(await estLieAuDossier(adminClient, dossier, appelant))) return refus("Vous n'êtes pas lié à ce dossier.");
          if (!(await estLieAuDossier(adminClient, dossier, cible))) return refus("Ce destinataire n'est pas lié au dossier.");
        }
      }
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
      // Titre, expéditeur et intitulé du dossier viennent du serveur ; seul le
      // message (extrait, nom de pièce) vient du client, et il est borné.
      const newNotification = {
        id: crypto.randomUUID(),
        type: notification.type,
        titre: TITRES[notification.type],
        message: String(notification.message ?? "").slice(0, 300),
        sender_name: expediteur?.nom ?? "",
        sender_avatar: expediteur?.avatar ?? "",
        ...(notification.related_tender_id ? { related_tender_id: notification.related_tender_id } : {}),
        ...(titreDossier !== undefined ? { related_tender_titre: titreDossier } : {}),
        date: new Date().toISOString(),
        read: false,
      };

      // Ajout atomique (migration 116) : réécrire le tableau lu plus haut
      // écrasait une notification arrivée entre-temps.
      const { error: updateError } = await adminClient.rpc("ajouter_notification", {
        p_utilisateur: userId,
        p_notification: newNotification,
      });

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
