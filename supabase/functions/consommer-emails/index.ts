import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXPEDITEUR } from "./emailConfig.ts";
import { metaEmail } from "./emailTypes.ts";
import { composerEmail, type ContenuEmail } from "./emailTemplate.ts";

/**
 * consommer-emails — consomme la file `emails_a_envoyer` et envoie via Brevo.
 *
 * Séparée de `calculer-emails` : peut être rejouée après incident sans
 * recalculer, et inversement. Écrit chaque tentative dans `emails_envoyes`
 * (journal), en conservant le messageId Brevo pour le rapprochement webhook.
 *
 * Peut être appelée par cron (juste après le calcul) et/ou à la demande.
 * Traite un lot borné par appel pour rester dans les limites d'exécution.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TAILLE_LOT = 50;       // emails traités par appel
const MAX_TENTATIVES = 3;    // au-delà, l'email passe en 'echoue'

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

/**
 * Construit sujet + contenu selon le type d'email. Gabarit minimal ici ; le
 * gabarit commun riche (logo, bouton unique, version texte) arrivera dans un
 * lot dédié. On fournit DÉJÀ une version texte systématique (certaines
 * messageries bloquent le HTML) et un seul lien d'action.
 */
const construireEmail = (type: string, payload: any, appUrl: string) => {
  const lien = payload?.tender_id ? `${appUrl}/?tab=tenders&id=${payload.tender_id}` : appUrl;
  const dateFr = (d: any) => (d ? new Date(d).toLocaleDateString("fr-FR") : null);

  // Chaque type produit un CONTENU structuré (titre, paragraphes, un seul
  // bouton, détails). Le gabarit commun (_shared/emailTemplate) l'enveloppe et
  // génère HTML + texte de façon uniforme. Un seul bouton d'action par email.
  let sujet: string;
  let contenu: ContenuEmail;

  switch (type) {
    case "deadline_j7":
    case "deadline_j3":
    case "deadline_j1": {
      const j = payload?.jours_restants ?? "quelques";
      const titre = payload?.tender_titre ?? "votre appel d'offres";
      const pluriel = typeof j === "number" && j > 1 ? "s" : "";
      sujet = `Échéance dans ${j} jour${pluriel} : ${titre}`;
      contenu = {
        titre: "Date limite proche",
        paragraphes: [`La date limite approche (dans ${j} jour${pluriel}) pour « ${titre} ».`],
        action: { label: "Accéder au dossier", url: lien },
      };
      break;
    }

    case "recap_documents": {
      const nb = payload?.nb_pieces ?? 0;
      const nbDossiers = payload?.nb_dossiers ?? 0;
      sujet = `${nb} pièce${nb > 1 ? "s" : ""} déposée${nb > 1 ? "s" : ""} aujourd'hui`;
      contenu = {
        titre: "Récapitulatif des dépôts du jour",
        paragraphes: [`${nb} pièce${nb > 1 ? "s" : ""} déposée${nb > 1 ? "s" : ""} sur ${nbDossiers} dossier${nbDossiers > 1 ? "s" : ""}.`],
        details: (payload?.pieces ?? []).map((p: any) => `${p.auteur ?? "Un partenaire"} a déposé ${p.type ?? "une pièce"}`),
        action: { label: "Voir vos dossiers", url: appUrl },
      };
      break;
    }

    case "document_expirant": {
      const label = payload?.document_label ?? "Un document";
      const dateExp = dateFr(payload?.date_expiration) ?? "prochainement";
      sujet = `Document bientôt expiré : ${label}`;
      contenu = {
        titre: "Un document arrive à expiration",
        paragraphes: [
          `« ${label} » expire le ${dateExp}.`,
          "Pensez à le renouveler pour qu'il reste valide dans vos candidatures.",
        ],
        action: { label: "Gérer mes documents", url: `${appUrl}/?tab=company&id=docs` },
      };
      break;
    }

    case "jalon_echu": {
      const titre = payload?.tender_titre ?? "votre appel d'offres";
      const jalons = payload?.jalons ?? [];
      const nb = jalons.length;
      sujet = `${nb} jalon${nb > 1 ? "s" : ""} en retard : ${titre}`;
      contenu = {
        titre: "Étapes de rétroplanning dépassées",
        paragraphes: [`Des étapes sont dépassées sur « ${titre} » :`],
        details: jalons.map((j: any) => `${j.label}${dateFr(j.date) ? ` — prévu le ${dateFr(j.date)}` : ""}`),
        action: { label: "Mettre à jour le dossier", url: lien },
      };
      break;
    }

    case "bienvenue": {
      const prenom = payload?.prenom ? ` ${payload.prenom}` : "";
      sujet = "Bienvenue sur Filao";
      contenu = {
        titre: `Bienvenue${prenom}`,
        paragraphes: [
          "Votre espace est prêt : centralisez vos appels d'offres, invitez vos partenaires et suivez vos échéances au même endroit.",
        ],
        action: { label: "Commencer", url: appUrl },
      };
      break;
    }

    default:
      sujet = "Notification Filao";
      contenu = {
        titre: "Notification",
        paragraphes: ["Vous avez une nouvelle notification sur Filao."],
        action: { label: "Ouvrir Filao", url: lien },
      };
  }

  return composerEmail(sujet, contenu);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const role = roleDuJeton(req.headers.get("Authorization"));
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (role !== "service_role") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const appUrl = Deno.env.get("APP_URL") ?? "https://filao.io";
    if (!brevoApiKey) throw new Error("BREVO_API_KEY absente");

    // Lot d'emails en attente, les plus anciens d'abord.
    const { data: aTraiter, error: errLot } = await admin
      .from("emails_a_envoyer")
      .select("*")
      .eq("statut", "en_attente")
      .order("created_at", { ascending: true })
      .limit(TAILLE_LOT);
    if (errLot) throw errLot;

    // Liste de blocage : sécurité supplémentaire au moment de l'envoi (une
    // adresse peut être bloquée entre le calcul et la consommation).
    const { data: bloquesData } = await admin.from("emails_bloques").select("destinataire");
    const bloques = new Set((bloquesData ?? []).map((b: any) => b.destinataire));

    let envoyes = 0, echoues = 0, ignores = 0;

    for (const item of aTraiter ?? []) {
      // Verrou optimiste : passe en 'en_cours' seulement si toujours 'en_attente'
      // (évite qu'un second appel concurrent traite le même email).
      const { data: verrou } = await admin
        .from("emails_a_envoyer")
        .update({ statut: "en_cours", updated_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("statut", "en_attente")
        .select("id");
      if (!verrou || verrou.length === 0) continue; // pris par un autre worker

      // Adresse bloquée → on annule sans envoyer.
      if (bloques.has(item.destinataire)) {
        await admin.from("emails_a_envoyer")
          .update({ statut: "annule", derniere_erreur: "destinataire bloqué" })
          .eq("id", item.id);
        ignores++;
        continue;
      }

      const meta = metaEmail(item.type_email);

      // --- Préférence par famille + plafond quotidien ---
      // Les emails de sécurité (auth) ne passent pas par la file : tout ce qui
      // est ici est donc plafonnable et soumis aux préférences. Un email de
      // sécurité éventuel (meta.securite) resterait toutefois exempt.
      if (!meta.securite) {
        // 1. Préférence email de la famille : si l'utilisateur a coupé l'email
        //    pour cette famille, on annule (pas une erreur).
        if (meta.famille) {
          const { data: dest } = await admin
            .from("utilisateurs")
            .select("notification_preferences")
            .eq("email", item.destinataire)
            .maybeSingle();
          const prefEmail = dest?.notification_preferences?.[meta.famille]?.email;
          if (prefEmail === false) {
            await admin.from("emails_a_envoyer")
              .update({ statut: "annule", derniere_erreur: "préférence email désactivée" })
              .eq("id", item.id);
            ignores++;
            continue;
          }
        }

        // 2. Plafond : au plus 5 emails par jour et par destinataire (hors
        //    sécurité). On compte ce qui a DÉJÀ été journalisé aujourd'hui.
        const debutJour = new Date();
        debutJour.setUTCHours(0, 0, 0, 0);
        const { count } = await admin
          .from("emails_envoyes")
          .select("id", { count: "exact", head: true })
          .eq("destinataire", item.destinataire)
          .gte("horodatage", debutJour.toISOString());

        if ((count ?? 0) >= 5) {
          // Plafond atteint : on REPORTE (reste 'en_attente' pour un jour futur)
          // plutôt que d'annuler, pour ne pas perdre l'email. On le laisse en
          // file ; il repartira quand le compteur du destinataire sera retombé.
          await admin.from("emails_a_envoyer")
            .update({ statut: "en_attente", derniere_erreur: "plafond quotidien atteint (reporté)" })
            .eq("id", item.id);
          ignores++;
          continue;
        }
      }

      const contenu = construireEmail(item.type_email, item.payload, appUrl);

      // List-Unsubscribe : requis sur les emails NON transactionnels
      // (communications/marketing). Brevo accepte des en-têtes personnalisés.
      // Le lien de désinscription pointe vers une route applicative qui inscrira
      // l'adresse dans emails_bloques (motif desinscription).
      const enTetes: Record<string, string> = {};
      if (!meta.transactionnel) {
        const lienDesinscription = `${appUrl}/desinscription?email=${encodeURIComponent(item.destinataire)}`;
        enTetes["List-Unsubscribe"] = `<${lienDesinscription}>`;
        enTetes["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
      }

      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoApiKey, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            sender: EXPEDITEUR,
            to: [{ email: item.destinataire }],
            subject: contenu.sujet,
            htmlContent: contenu.html,
            textContent: contenu.texte, // version texte systématique
            ...(Object.keys(enTetes).length > 0 ? { headers: enTetes } : {}),
          }),
        });

        if (!res.ok) {
          const texte = await res.text();
          throw new Error(`Brevo ${res.status}: ${texte}`);
        }

        const reponse = await res.json().catch(() => ({}));
        const messageId = reponse?.messageId ?? null;

        // Marque envoyé + journalise.
        await admin.from("emails_a_envoyer")
          .update({ statut: "envoye", updated_at: new Date().toISOString() })
          .eq("id", item.id);

        await admin.from("emails_envoyes").insert({
          type_email: item.type_email,
          destinataire: item.destinataire,
          objet: contenu.sujet,
          objet_id: item.objet_id,
          statut: "envoye",
          identifiant_prestataire: messageId,
        });
        envoyes++;
      } catch (err) {
        const tentatives = (item.tentatives ?? 0) + 1;
        const statutFinal = tentatives >= MAX_TENTATIVES ? "echoue" : "en_attente"; // re-tentera
        await admin.from("emails_a_envoyer")
          .update({
            statut: statutFinal,
            tentatives,
            derniere_erreur: String((err as any)?.message || err),
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);

        // Journalise l'échec définitif seulement (évite de polluer le journal
        // à chaque retry intermédiaire).
        if (statutFinal === "echoue") {
          await admin.from("emails_envoyes").insert({
            type_email: item.type_email,
            destinataire: item.destinataire,
            objet: contenu.sujet,
            objet_id: item.objet_id,
            statut: "erreur",
            erreur: String((err as any)?.message || err),
          });
        }
        echoues++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, traites: (aTraiter ?? []).length, envoyes, echoues, ignores }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("consommer-emails:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});