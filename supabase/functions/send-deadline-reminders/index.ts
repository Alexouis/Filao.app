import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SEUILS, ecartJours, libelles, dejaEmis } from "./rappelsEcheance.ts";

/**
 * Rappels « date limite proche » à J-7, J-3, J-1 et le jour même.
 *
 * Seule source des rappels d'échéance. Une fonction SQL non versionnée,
 * `send_deadline_reminders()` (tâche `filao-deadline-reminders`, 8 h), faisait
 * le même travail en parallèle : doublon à J-7, préférence « Rappels »
 * ignorée, et notification de TOUS les comptes des entreprises du groupement
 * — collègues du porteur compris, contre le cloisonnement de la 092. Ses
 * seuils multiples sont repris ici ; elle est supprimée par la migration 110.
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

    const aujourdhui = jourParis(0);

    // Seuls les dossiers encore actifs ont une échéance qui compte. Un dossier
    // déposé n'a plus d'action liée à la date limite, un clôturé non plus.
    const { data: dossiers, error: errDossiers } = await admin
      .from("reponses_ao")
      .select("id, titre, date_limite, createur_id, entreprise_id, statut, groupements(entreprise_id, statut)")
      .eq("statut", "En cours")
      .not("date_limite", "is", null);

    if (errDossiers) throw errDossiers;

    let notifies = 0;
    const motifs: any[] = [];

    for (const dossier of dossiers ?? []) {
      // La date_limite peut être un timestamp : on compare la partie date.
      const restant = ecartJours(aujourdhui, String(dossier.date_limite).split("T")[0]);
      if (!(SEUILS as readonly number[]).includes(restant)) continue;

      // Destinataires : le créateur, et les comptes des entreprises
      // PARTENAIRES ayant accepté — ce sont elles qui doivent déposer leurs
      // pièces avant l'échéance. Pas les collègues du porteur, qui ne voient
      // pas le contenu du dossier (092).
      const destinataireIds = new Set<string>();
      if (dossier.createur_id) destinataireIds.add(dossier.createur_id);

      const partenaires = ((dossier as any).groupements ?? [])
        .filter((g: any) => g?.statut === "accepte" && g?.entreprise_id && g.entreprise_id !== dossier.entreprise_id)
        .map((g: any) => g.entreprise_id as string);
      if (partenaires.length > 0) {
        const { data: comptes } = await admin.from("utilisateurs").select("id").in("entreprise_id", partenaires);
        (comptes ?? []).forEach((c: { id: string }) => destinataireIds.add(c.id));
      }

      const { titre, message } = libelles(restant);

      for (const uid of destinataireIds) {
        const { data: utilisateur } = await admin
          .from("utilisateurs")
          .select("id, notifications, notification_preferences")
          .eq("id", uid)
          .maybeSingle();
        if (!utilisateur) continue;

        // Respecte la préférence « Rappels » (`notification_preferences`, la
        // même que consulte `notify-user`). Absente = activée. On ne lit pas
        // `notifications_on`, que l'application met à `false` quand le
        // NAVIGATEUR refuse les notifications système — sans rapport.
        const prefs = utilisateur.notification_preferences as any;
        if (prefs?.rappels?.app === false) {
          motifs.push({ dossier: dossier.id, uid, motif: "rappels désactivés dans les préférences" });
          continue;
        }

        const existantes: any[] = Array.isArray(utilisateur.notifications) ? utilisateur.notifications : [];

        // Idempotence par (dossier, seuil) : un rappel à J-3 n'empêche plus
        // celui de J-1, et un cron rejoué ne double rien.
        if (dejaEmis(existantes, dossier.id, restant)) {
          motifs.push({ dossier: dossier.id, uid, motif: `déjà notifié (J-${restant})` });
          continue;
        }

        const notif = {
          id: crypto.randomUUID(),
          type: "deadline_reminder",
          seuil_jours: restant,
          titre,
          message,
          related_tender_id: dossier.id,
          related_tender_titre: `${dossier.titre} (${new Date(dossier.date_limite).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })})`,
          date: new Date().toISOString(),
          read: false,
        };

        // Ajout atomique (migration 116).
        const { error: errMaj } = await admin.rpc("ajouter_notification", {
          p_utilisateur: uid,
          p_notification: notif,
        });

        if (errMaj) {
          console.error("écriture notification échéance impossible", dossier.id, uid, errMaj);
          motifs.push({ dossier: dossier.id, uid, motif: `update: ${errMaj.message}` });
          continue;
        }
        notifies++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, aujourdhui, notifies, motifs }),
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