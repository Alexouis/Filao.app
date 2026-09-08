import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Rappel « date limite proche » à J-7.
 *
 * Fonction **planifiée** (pg_cron), sur le modèle de `send-milestone-reminders` :
 * chaque jour, elle balaie les dossiers dont la `date_limite` tombe dans 7 jours
 * et notifie le créateur (et, si présents, les partenaires du groupement).
 *
 * Le seuil J-7 est aligné sur la définition d'« urgent » du tableau de bord et
 * du filtre « Urgents » de Mes AO (helpers/tenderHelpers : URGENCE_SEUIL_JOURS).
 *
 * Planification (à exécuter une fois, via pg_cron) :
 *
 *   select cron.schedule(
 *     'rappels-echeance-j7', '0 7 * * *',
 *     $$ select net.http_post(
 *          url     := '<SUPABASE_URL>/functions/v1/send-deadline-reminders',
 *          headers := jsonb_build_object(
 *            'Content-Type','application/json',
 *            'Authorization','Bearer <SERVICE_ROLE_KEY>')
 *        ) $$);
 *
 * Idempotence : plutôt qu'une colonne de suivi dédiée, on vérifie qu'aucune
 * notification `deadline_reminder` pour ce dossier n'existe déjà côté
 * destinataire. Une `date_limite` étant unique par dossier (contrairement aux
 * jalons), ce contrôle suffit et évite une migration.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEUIL_JOURS = 7;

/** `yyyy-MM-dd` en heure de Paris — le serveur tourne en UTC. */
const jourParis = (decalageJours = 0): string => {
  const maintenant = new Date();
  maintenant.setUTCDate(maintenant.getUTCDate() + decalageJours);
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(maintenant);
};

/** Rôle porté par le JWT d'appel (cf. send-milestone-reminders). */
const roleDuJeton = (enTete: string | null): string | null => {
  if (!enTete?.startsWith("Bearer ")) return null;
  const segments = enTete.slice(7).trim().split(".");
  if (segments.length !== 3) return null;
  try {
    const charge = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(charge.padEnd(Math.ceil(charge.length / 4) * 4, "=")))?.role ?? null;
  } catch {
    return null;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const role = roleDuJeton(req.headers.get("Authorization"));
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (role !== "service_role") {
      return new Response(
        JSON.stringify({
          error: "Unauthorized",
          motif: role
            ? `rôle « ${role} » insuffisant, « service_role » attendu`
            : "en-tête Authorization absent ou jeton illisible",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!serviceKey) {
      return new Response(
        JSON.stringify({ error: "SUPABASE_SERVICE_ROLE_KEY absente de l'environnement" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

    const cible = jourParis(SEUIL_JOURS); // échéance à J+7

    // Seuls les dossiers encore actifs ont une échéance qui compte. Un dossier
    // déposé n'a plus d'action liée à la date limite, un clôturé non plus.
    const { data: dossiers, error: errDossiers } = await admin
      .from("reponses_ao")
      .select("id, titre, date_limite, createur_id, statut, groupements(entreprise_id, statut)")
      .eq("statut", "En cours")
      .not("date_limite", "is", null);

    if (errDossiers) throw errDossiers;

    let notifies = 0;
    const motifs: any[] = [];

    for (const dossier of dossiers ?? []) {
      // La date_limite peut être un timestamp : on compare la partie date.
      if (String(dossier.date_limite).split("T")[0] !== cible) continue;

      // Destinataires : le créateur. (Les partenaires reçoivent déjà les
      // rappels de jalons/documents ; on garde le rappel d'échéance ciblé sur
      // le porteur pour éviter le sur-envoi. Extensible si besoin.)
      const destinataireIds = new Set<string>();
      if (dossier.createur_id) destinataireIds.add(dossier.createur_id);

      for (const uid of destinataireIds) {
        const { data: utilisateur } = await admin
          .from("utilisateurs")
          .select("id, notifications, notification_preferences")
          .eq("id", uid)
          .maybeSingle();
        if (!utilisateur) continue;

        // Respecte la préférence « Rappels » de l'utilisateur.
        //
        // On lisait auparavant `notifications_on`, qui n'est PAS une
        // préférence : l'application la met à `false` toute seule quand le
        // NAVIGATEUR refuse les notifications système (voir AuthContext).
        // Refuser la fenêtre surgissante de Chrome coupait donc aussi les
        // rappels d'échéance en base — deux choses sans rapport. À l'inverse,
        // décocher « Rappels » dans les paramètres ne les arrêtait pas.
        //
        // La source de vérité est `notification_preferences`, la même que
        // consulte `notify-user` pour les notifications de l'application.
        // Préférence absente = activée, comme partout ailleurs.
        const prefs = utilisateur.notification_preferences as any;
        if (prefs?.rappels?.app === false) {
          motifs.push({ dossier: dossier.id, uid, motif: "rappels désactivés dans les préférences" });
          continue;
        }

        const existantes: any[] = Array.isArray(utilisateur.notifications) ? utilisateur.notifications : [];

        // Idempotence : une seule notification d'échéance par dossier.
        const dejaNotifie = existantes.some(
          (n) => n?.type === "deadline_reminder" && n?.related_tender_id === dossier.id
        );
        if (dejaNotifie) {
          motifs.push({ dossier: dossier.id, uid, motif: "déjà notifié" });
          continue;
        }

        const notif = {
          id: crypto.randomUUID(),
          type: "deadline_reminder",
          titre: "Date limite proche",
          message: "La date limite approche (dans 7 jours) pour l'appel d'offres",
          related_tender_id: dossier.id,
          related_tender_titre: `${dossier.titre} (${new Date(dossier.date_limite).toLocaleDateString("fr-FR")})`,
          date: new Date().toISOString(),
          read: false,
        };

        const { error: errMaj } = await admin
          .from("utilisateurs")
          .update({ notifications: [notif, ...existantes] })
          .eq("id", uid);

        if (errMaj) {
          console.error("écriture notification échéance impossible", dossier.id, uid, errMaj);
          motifs.push({ dossier: dossier.id, uid, motif: `update: ${errMaj.message}` });
          continue;
        }
        notifies++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, cible, notifies, motifs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-deadline-reminders:", err);
    return new Response(
      JSON.stringify({ error: String((err as any)?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});