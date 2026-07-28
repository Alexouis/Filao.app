import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Rappel de jalon à J-2.
 *
 * Contrairement à `send-reminder`, déclenchée à la main depuis l'application,
 * cette fonction est **planifiée** : elle balaie chaque jour les jalons tombant
 * dans deux jours et notifie les personnes concernées.
 *
 * Planification (à exécuter une fois, via pg_cron) :
 *
 *   select cron.schedule(
 *     'rappels-jalons-j2', '0 7 * * *',
 *     $$ select net.http_post(
 *          url     := '<SUPABASE_URL>/functions/v1/send-milestone-reminders',
 *          headers := jsonb_build_object(
 *            'Content-Type','application/json',
 *            'Authorization','Bearer <SERVICE_ROLE_KEY>')
 *        ) $$);
 *
 * Idempotence : `jalons` est un JSONB sans table de suivi des envois. On marque
 * donc le jalon avec `rappel_envoye_le` après notification. Sans cette marque,
 * deux exécutions le même jour — un rejeu manuel, par exemple — enverraient le
 * rappel en double.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Jalons purement informatifs : les rappeler serait du bruit. */
const JALONS_SANS_RAPPEL = new Set(["Retrait du DCE"]);

/** `yyyy-MM-dd` en heure de Paris — le serveur tourne en UTC. */
const jourParis = (decalageJours = 0): string => {
  const maintenant = new Date();
  maintenant.setUTCDate(maintenant.getUTCDate() + decalageJours);
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(maintenant);
};

/**
 * @returns le rôle porté par le jeton d'appel, ou null.
 *
 * Comparer le jeton reçu à `SUPABASE_SERVICE_ROLE_KEY` caractère par caractère
 * paraissait plus simple, mais cassait dès que la clé enregistrée dans le Vault
 * différait de celle de l'environnement de la fonction — au moindre écart, une
 * rotation de clé, ou l'une des variantes de clé du projet. On lit le rôle
 * revendiqué par le JWT à la place.
 *
 * La signature n'est pas revérifiée ici : la passerelle Supabase la valide en
 * amont (`verify_jwt`). Ce contrôle sert à écarter un appelant authentifié mais
 * non habilité — un client muni de la clé anon, notamment.
 */
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
    // Appelée par le planificateur avec la clé de service, jamais par un client.
    const role = roleDuJeton(req.headers.get("Authorization"));
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (role !== "service_role") {
      // Le motif est explicité : un 401 nu ne permet pas de distinguer un
      // en-tête absent d'une clé anon envoyée par erreur.
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

    const cible = jourParis(2);   // J+2
    const aujourdhui = jourParis(0);

    // Les dossiers clos ou perdus n'ont plus de jalon à rappeler.
    const { data: dossiers, error: errDossiers } = await admin
      .from("reponses_ao")
      .select("id, titre, createur_id, jalons, statut")
      .not("jalons", "is", null)
      .in("statut", ["Brouillon", "En cours"]);

    if (errDossiers) throw errDossiers;

    let notifies = 0;
    let dossiersMisAJour = 0;
    /** Motifs de non-envoi, remontés dans la réponse pour le diagnostic. */
    const motifs: any[] = [];

    for (const dossier of dossiers ?? []) {
      const jalons = Array.isArray(dossier.jalons) ? dossier.jalons : [];

      const aRappeler = jalons.filter((j: any) =>
        j?.date &&
        String(j.date).split("T")[0] === cible &&
        j.statut !== "fait" &&
        !JALONS_SANS_RAPPEL.has(j.label) &&
        j.rappel_envoye_le !== aujourdhui
      );

      if (aRappeler.length === 0) continue;

      // Ne seront marqués que les jalons dont au moins un envoi a abouti.
      // Marquer sur la seule base des candidats — ce que faisait la version
      // précédente — perdait définitivement un rappel dont l'envoi avait échoué.
      const notifiesAvecSucces: any[] = [];

      // Destinataires : le responsable désigné s'il y en a un, sinon le
      // créateur du dossier. Notifier tout le groupement à chaque jalon
      // produirait un volume de mails contre-productif.
      for (const jalon of aRappeler) {
        const destinataires = new Set<string>();

        if (jalon.responsable) {
          destinataires.add(String(jalon.responsable).toLowerCase());
        } else {
          const { data: createur } = await admin
            .from("utilisateurs")
            .select("email")
            .eq("id", dossier.createur_id)
            .single();
          if (createur?.email) destinataires.add(createur.email.toLowerCase());
        }

        if (destinataires.size === 0) {
          motifs.push({ dossier: dossier.id, jalon: jalon.label, motif: "aucun destinataire résolu" });
          continue;
        }

        let auMoinsUnEnvoi = false;

        for (const email of destinataires) {
          const { data: utilisateur } = await admin
            .from("utilisateurs")
            .select("id, notifications_on")
            .ilike("email", email)
            .maybeSingle();

          // Respecte la désinscription globale aux notifications.
          if (utilisateur && utilisateur.notifications_on === false) {
            motifs.push({ dossier: dossier.id, jalon: jalon.label, email, motif: "notifications désactivées" });
            continue;
          }

          // `send-reminder` crée elle-même la notification in-app, dans le
          // tableau `utilisateurs.notifications`, en plus d'envoyer l'e-mail.
          // Un appel séparé produirait deux notifications pour un rappel.
          const { error: errMail } = await admin.functions.invoke("send-reminder", {
            // En-tête passé explicitement : depuis l'intérieur d'une edge
            // function, `functions.invoke` n'attache pas systématiquement
            // l'Authorization du client, et `send-reminder` refuse alors
            // l'appel avec un 401.
            headers: { Authorization: `Bearer ${serviceKey}` },
            body: {
              tenderId: dossier.id,
              tenderTitle: dossier.titre,
              email,
              senderName: "Filao",
              milestoneLabel: jalon.label,
              milestoneDate: jalon.date,
            },
          });
          if (errMail) {
            // Le message de FunctionsHttpError se borne à « non-2xx » : sans le
            // corps de la réponse, la cause reste invisible.
            let detail = errMail.message ?? String(errMail);
            try {
              const reponse = (errMail as any)?.context;
              if (reponse && typeof reponse.text === "function") {
                detail = `${reponse.status} ${await reponse.text()}`;
              }
            } catch { /* corps déjà consommé ou illisible */ }

            console.error("send-reminder a échoué", { dossier: dossier.id, email, detail });
            motifs.push({ dossier: dossier.id, jalon: jalon.label, email, motif: `send-reminder: ${detail}` });
            continue;
          }

          auMoinsUnEnvoi = true;
          notifies++;
        }

        if (auMoinsUnEnvoi) notifiesAvecSucces.push(jalon);
      }

      if (notifiesAvecSucces.length === 0) continue;

      // Marquage après envoi : une exécution supplémentaire le même jour ne
      // renverra rien. Les jalons non notifiés restent non marqués et seront
      // retentés à la prochaine exécution.
      const jalonsMarques = jalons.map((j: any) =>
        notifiesAvecSucces.includes(j) ? { ...j, rappel_envoye_le: aujourdhui } : j
      );
      const { error: errMaj } = await admin
        .from("reponses_ao")
        .update({ jalons: jalonsMarques })
        .eq("id", dossier.id);
      if (errMaj) console.error("Marquage rappel impossible", dossier.id, errMaj);
      else dossiersMisAJour++;
    }

    return new Response(
      // `motifs` explique un `notifies: 0` : sans lui, un envoi qui ne part pas
      // est indiscernable d'une absence de jalon à rappeler.
      JSON.stringify({ ok: true, cible, notifies, dossiersMisAJour, motifs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (erreur) {
    console.error("send-milestone-reminders:", erreur);
    return new Response(JSON.stringify({ error: String(erreur) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});