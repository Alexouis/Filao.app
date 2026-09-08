import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * recap-messages — récapitulatif quotidien de la messagerie.
 *
 * POURQUOI CETTE FONCTION
 * La case « Messages » des paramètres proposait un envoi par e-mail qui
 * n'existait pas : aucun type au catalogue de la file, donc aucun producteur,
 * donc rien envoyé. L'interrupteur promettait quelque chose qu'il ne faisait
 * pas — on l'avait grisé en attendant. Cette fonction le rend enfin réel.
 *
 * LE PRINCIPE, REPRIS DE `recap-depots`
 * Un e-mail par destinataire et par jour, jamais un par message. Une
 * conversation animée produirait autrement des dizaines d'envois — c'est
 * exactement ce que la file cherche à éviter : « regrouper plutôt que
 * spammer ».
 *
 * QUI EST DESTINATAIRE
 * Les participants du dossier, hors AUTEUR du message : le créateur et les
 * entreprises ayant accepté. Un invité qui n'a pas rejoint le groupement n'a
 * pas à recevoir le fil de discussion.
 *
 * IDEMPOTENCE
 * La clé (type_email, objet_id, jour_cible) est unique dans la file : deux
 * exécutions le même jour n'enfilent qu'un seul récapitulatif. Le conflit
 * `23505` est donc attendu et ignoré, comme dans `recap-depots`.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Rôle porté par le jeton, pour réserver l'appel au cron. */
const roleDuJeton = (entete: string | null): string | null => {
  try {
    const jeton = (entete ?? "").replace("Bearer ", "");
    const charge = jeton.split(".")[1];
    if (!charge) return null;
    return JSON.parse(atob(charge.padEnd(Math.ceil(charge.length / 4) * 4, "=")))?.role ?? null;
  } catch {
    return null;
  }
};

const jourParis = (): string =>
  new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const role = roleDuJeton(req.headers.get("Authorization"));
    if (role !== "service_role") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const debutJour = new Date();
    debutJour.setUTCHours(0, 0, 0, 0);

    // Messages du jour. Les messages « system » sont écartés : ce sont des
    // traces de l'application (arrivée d'un membre, changement de statut), pas
    // des paroles de partenaires — les récapituler serait du bruit.
    const { data: messages, error } = await admin
      .from("chat_messages")
      .select("id, tender_id, sender_id, content, created_at, type")
      .neq("type", "system")
      .gte("created_at", debutJour.toISOString());
    if (error) throw error;

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, enfiles: 0, motif: "aucun message" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Titres des dossiers concernés, en une requête.
    const idsDossiers = [...new Set(messages.map(m => m.tender_id))];
    const { data: dossiers } = await admin
      .from("reponses_ao")
      .select("id, titre, createur_id")
      .in("id", idsDossiers);
    const parDossier = new Map((dossiers ?? []).map(d => [d.id, d]));

    // Participants par dossier : créateur + comptes des entreprises acceptées.
    const { data: groupements } = await admin
      .from("groupements")
      .select("projet_id, entreprise_id, statut")
      .in("projet_id", idsDossiers)
      .eq("statut", "accepte");

    const entreprises = [...new Set((groupements ?? []).map(g => g.entreprise_id))];
    const { data: comptes } = entreprises.length > 0
      ? await admin
          .from("utilisateurs")
          .select("id, email, entreprise_id, notification_preferences")
          .in("entreprise_id", entreprises)
      : { data: [] as any[] };

    const { data: createurs } = await admin
      .from("utilisateurs")
      .select("id, email, entreprise_id, notification_preferences")
      .in("id", [...new Set((dossiers ?? []).map(d => d.createur_id))]);

    const tousComptes = [...(comptes ?? []), ...(createurs ?? [])];
    const compteParId = new Map(tousComptes.map(u => [u.id, u]));

    const participantsDe = (tenderId: string): any[] => {
      const dossier = parDossier.get(tenderId);
      const ids = new Set<string>();
      if (dossier?.createur_id) ids.add(dossier.createur_id);
      const entreprisesDuDossier = (groupements ?? [])
        .filter(g => g.projet_id === tenderId)
        .map(g => g.entreprise_id);
      tousComptes
        .filter(u => entreprisesDuDossier.includes(u.entreprise_id))
        .forEach(u => ids.add(u.id));
      return [...ids].map(id => compteParId.get(id)).filter(Boolean);
    };

    // Regroupement par destinataire : un récapitulatif par personne.
    const parDestinataire = new Map<string, { email: string; items: any[] }>();

    for (const m of messages) {
      for (const participant of participantsDe(m.tender_id)) {
        // Jamais l'auteur de son propre message.
        if (participant.id === m.sender_id) continue;
        if (!participant.email) continue;

        // Préférence « Messages ». Absente = activée, comme partout ailleurs.
        // La file revérifiera à la consommation ; on filtre déjà ici pour ne
        // pas enfiler un envoi voué à être annulé.
        if (participant.notification_preferences?.messages_feed?.email === false) continue;

        if (!parDestinataire.has(participant.id)) {
          parDestinataire.set(participant.id, { email: participant.email, items: [] });
        }
        parDestinataire.get(participant.id)!.items.push({
          tender_id: m.tender_id,
          titre: parDossier.get(m.tender_id)?.titre ?? "un appel d'offres",
          extrait: (m.content ?? "").slice(0, 120),
        });
      }
    }

    const jour = jourParis();
    let enfiles = 0;

    for (const [destinataireId, groupe] of parDestinataire) {
      if (groupe.items.length === 0) continue;
      const dossiersConcernes = [...new Set(groupe.items.map(i => i.tender_id))];

      const { error: insErr } = await admin
        .from("emails_a_envoyer")
        .insert({
          type_email: "recap_messages",
          objet_id: destinataireId, // un récap par destinataire et par jour
          destinataire: groupe.email,
          jour_cible: jour,
          payload: {
            nb_messages: groupe.items.length,
            nb_dossiers: dossiersConcernes.length,
            // Détail borné : un e-mail n'a pas vocation à rejouer la
            // conversation, seulement à donner envie d'aller la lire.
            messages: groupe.items.slice(0, 20),
          },
        })
        .select("id");

      // 23505 = doublon sur la clé d'idempotence : le récap du jour existe déjà.
      if (insErr && insErr.code !== "23505") {
        console.error("enfilage récap messages:", insErr, destinataireId);
        continue;
      }
      if (!insErr) enfiles++;
    }

    console.log(`Récapitulatif messages : ${enfiles} e-mail(s) enfilé(s) pour le ${jour}.`);

    return new Response(JSON.stringify({ ok: true, jour, enfiles }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
