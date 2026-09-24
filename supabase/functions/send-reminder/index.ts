import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXPEDITEUR } from "./emailConfig.ts";

/** Échappement HTML des valeurs insérées dans un e-mail. */
const echapperHtml = (v: unknown): string => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");


/**
 * Motif ILIKE correspondant EXACTEMENT à `valeur`, casse ignorée.
 * `_` et `%` sont des jokers pour ILIKE : « alexandre_louis@… » désignait aussi
 * « alexandreXlouis@… ». On les échappe.
 */
const motifExact = (valeur: string): string =>
  String(valeur ?? "").trim().replace(/[\\%_]/g, (c) => "\\" + c);


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReminderRequest {
  tenderId: string;
  tenderTitle: string;
  email: string;
  senderName: string;
  senderUserId?: string;
  /**
   * Renseignés par `send-milestone-reminders` pour un rappel de jalon à J-2.
   * Absents, la fonction conserve son comportement d'origine : rappel de
   * documents manquants déclenché manuellement depuis l'application.
   */
  milestoneLabel?: string;
  milestoneDate?: string;
  /**
   * Libellé d'une pièce du marché republiée (nouvelle version). Envoyé par
   * l'écran du dossier ; l'alerte passait auparavant pour un « jalon dans
   * 2 jours », ce qu'elle n'est pas.
   */
  nouvelleVersion?: string;
}

/** Date lisible en français, avec repli sur la valeur brute si non parsable. */
const dateLisible = (iso?: string): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
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

    const body: ReminderRequest = await req.json();
    const { tenderId, tenderTitle: titreFourni, email, senderName, milestoneLabel, milestoneDate, nouvelleVersion } = body;

    // Un même envoi sert deux usages : le gabarit et le libellé de la
    // notification en dépendent entièrement.
    const estVersion = Boolean(nouvelleVersion);
    const estJalon = Boolean(milestoneLabel) && !estVersion;
    const dateJalon = dateLisible(milestoneDate);

    if (!tenderId || !email || !senderName) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 0. Identité et droits de l'appelant.
    //
    // Jusqu'ici la fonction ne testait que la PRÉSENCE de l'en-tête
    // Authorization, jamais sa validité, puis envoyait à l'adresse du corps
    // sous le `senderName` du corps, depuis l'expéditeur Brevo de Filao. Tout
    // compte pouvait donc écrire à n'importe qui, sous n'importe quel nom, avec
    // l'apparence d'un e-mail de l'application.
    //
    // Désormais : l'appelant est authentifié, et doit être lié au dossier —
    // porteur, membre d'une entreprise acceptée au groupement, ou
    // administrateur de l'entreprise porteuse. Le destinataire doit lui aussi
    // être lié au dossier : un rappel ne se destine pas à un inconnu.
    // `senderUserId` n'est plus lu dans le corps : c'est l'appelant.
    //
    // Appel SERVEUR : `send-milestone-reminders` (tâche planifiée) appelle
    // cette fonction avec la clé de service, qui n'est pas un jeton
    // d'utilisateur. Le contrôle ci-dessous la refusait (401) : aucun rappel
    // de jalon à J-2 ne partait. La clé est comparée À L'IDENTIQUE — pas
    // seulement décodée — puis le contrôle d'identité est sauté ; celui du
    // destinataire, lui, s'applique toujours.
    const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const appelServeur = !!cleService && authHeader === `Bearer ${cleService}`;

    const { data: { user: appelantAuth } } = appelServeur
      ? { data: { user: null } }
      : await createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_ANON_KEY") ?? "",
          { global: { headers: { Authorization: authHeader } } },
        ).auth.getUser();
    const appelant = appelServeur ? { id: "" } : appelantAuth;
    if (!appelant) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const senderUserId = appelServeur ? null : appelant.id;

    const { data: dossier } = await adminClient
      .from("reponses_ao").select("id, titre, createur_id, entreprise_id").eq("id", tenderId).maybeSingle();
    if (!dossier) {
      return new Response(JSON.stringify({ error: "Dossier introuvable." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Intitulé lu en base : celui du corps de la requête, choisi par
    // l'appelant, s'affichait tel quel dans l'e-mail et la notification.
    const tenderTitle: string = dossier.titre ?? titreFourni ?? "";

    const { data: profilAppelant } = await adminClient
      .from("utilisateurs").select("entreprise_id, roles(name)").eq("id", appelant.id).maybeSingle();
    const entrepriseAppelant = profilAppelant?.entreprise_id ?? null;
    const estAdminPorteuse = !!entrepriseAppelant
      && entrepriseAppelant === dossier.entreprise_id
      && (profilAppelant?.roles as { name?: string } | null)?.name === "admin";

    // Entreprises acceptées au groupement — sert pour l'appelant ET le
    // destinataire.
    const { data: groupement } = await adminClient
      .from("groupements").select("entreprise_id").eq("projet_id", tenderId).eq("statut", "accepte");
    const entreprisesDuDossier = new Set<string>(
      (groupement ?? []).map((g: { entreprise_id: string }) => g.entreprise_id).filter(Boolean)
    );
    if (dossier.entreprise_id) entreprisesDuDossier.add(dossier.entreprise_id);

    const appelantLie = appelServeur
      || dossier.createur_id === appelant.id
      || estAdminPorteuse
      || (!!entrepriseAppelant && entreprisesDuDossier.has(entrepriseAppelant));
    if (!appelantLie) {
      return new Response(
        JSON.stringify({ error: "Vous n'êtes pas lié à ce dossier." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Le destinataire : membre d'une entreprise du dossier, ou invité par
    // e-mail (partenaire sans compte, qui existe légitimement dans
    // `invitations`).
    const { data: destinataireProfil } = await adminClient
      .from("utilisateurs").select("entreprise_id").ilike("email", motifExact(email.trim())).maybeSingle();
    let destinataireLie = !!destinataireProfil?.entreprise_id
      && entreprisesDuDossier.has(destinataireProfil.entreprise_id);
    if (!destinataireLie) {
      const { data: inv } = await adminClient
        .from("invitations").select("id").eq("tender_id", tenderId).ilike("email", motifExact(email.trim())).maybeSingle();
      destinataireLie = !!inv;
    }
    if (!destinataireLie) {
      return new Response(
        JSON.stringify({ error: "Ce destinataire n'est pas lié au dossier." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Resolve Recipient ID (if they have an account)
    const { data: recipient } = await adminClient
      .from("utilisateurs")
      .select("id, notifications, photo_url")
      // `.eq` est sensible à la casse alors que les e-mails sont stockés tels
      // que saisis (« Alexandre_Louis@outlook.fr »). La comparaison échouait
      // donc silencieusement pour tout utilisateur ayant une majuscule dans son
      // adresse : la notification in-app était simplement sautée.
      .ilike("email", motifExact(email.trim()))
      .maybeSingle();

    // 2. Resolve Sender Avatar
    let senderAvatar = "";
    if (senderUserId) {
      const { data: senderData } = await adminClient
        .from("utilisateurs")
        .select("photo_url")
        .eq("id", senderUserId)
        .maybeSingle();
      senderAvatar = senderData?.photo_url || "";
    }

    // 3. In-app notification
    if (recipient) {
      const type = estVersion ? "document_added" : estJalon ? "deadline_reminder" : "document_reminder";
      const titre = estVersion
        ? "Nouvelle version d'une pièce du marché"
        : estJalon ? `Jalon dans 2 jours : ${milestoneLabel}` : "Rappel de documents";

      // Déduplication : un même rappel (même type + même dossier + même libellé)
      // ne doit pas être réécrit s'il a déjà été émis dans les dernières 24 h.
      // Protège contre toutes les causes de doublon — cron rejoué, marquage
      // d'idempotence échoué, déclenchements manuels rapprochés — puisque
      // send-reminder est le point de passage commun de tous les rappels.
      const existantes: any[] = recipient.notifications || [];
      const il_y_a_24h = Date.now() - 24 * 60 * 60 * 1000;
      const doublon = existantes.some((n) =>
        n?.type === type &&
        n?.related_tender_id === tenderId &&
        n?.titre === titre &&
        n?.date && new Date(n.date).getTime() >= il_y_a_24h
      );

      if (!doublon) {
        const newNotification = {
          id: crypto.randomUUID(),
          type,
          titre,
          message: estVersion
            ? `a publié une nouvelle version de « ${nouvelleVersion} » sur`
            : estJalon
            ? `« ${milestoneLabel} » est prévu le ${dateJalon} sur`
            : `${senderName} vous a envoyé un rappel pour les pièces manquantes sur`,
          sender_name: senderName,
          sender_avatar: senderAvatar,
          related_tender_id: tenderId,
          related_tender_titre: tenderTitle,
          date: new Date().toISOString(),
          read: false,
        };

        // Ajout atomique (migration 116).
        await adminClient.rpc("ajouter_notification", {
          p_utilisateur: recipient.id,
          p_notification: newNotification,
        });
      }
    }

    // 4. Fetch Access Code from Invitation
    const { data: invite } = await adminClient
      .from("invitations")
      .select("access_code")
      .eq("tender_id", tenderId)
      .ilike("email", motifExact(email.trim()))
      .maybeSingle();

    const accessCode = invite?.access_code || "??????";

    // 5. Build Invitation URL
    // Adresse de l'APPLICATION (filao-app.fr), pas du site vitrine (filao.io).
    // `APP_URL` prime : un appel sans navigateur (cron des rappels de jalons)
    // n'a pas d'en-tête Origin, et un envoi lancé depuis un poste de
    // développement mettait sinon « localhost » dans l'e-mail d'un vrai
    // destinataire.
    const origin = (Deno.env.get("APP_URL") || req.headers.get("origin") || "https://filao-app.fr").replace(/\/$/, "");
    const appUrl = recipient
      ? `${origin}/?tab=wizard&id=${tenderId}`
      : `${origin}/collaborator-access?tenderId=${tenderId}`;

    const sujet = estVersion
      ? `Nouvelle version d'une pièce du marché — "${tenderTitle}"`
      : estJalon
      ? `Jalon dans 2 jours : ${milestoneLabel} — "${tenderTitle}"`
      : `Rappel : Documents manquants pour le projet "${tenderTitle}"`;
    const destinataireNormalise = email.toLowerCase().trim();
    const typeEmail = estVersion ? "nouvelle_version_dce" : estJalon ? "rappel_jalon" : "relance_documents";

    /** Journal best-effort : un échec d'écriture ne doit rien bloquer. */
    const journaliser = async (ligne: Record<string, unknown>) => {
      const { error: errJournal } = await adminClient.from("emails_envoyes").insert({
        type_email: typeEmail,
        destinataire: destinataireNormalise,
        destinataire_id: recipient?.id ?? null,
        objet: sujet,
        objet_id: tenderId,
        ...ligne,
      });
      if (errJournal) console.error("Journalisation de la relance échouée:", errJournal);
    };

    // 5bis. Adresse en rejet définitif (hard bounce, plainte, désinscription).
    // Brevo accepte l'appel mais ne délivre pas : l'envoi « réussissait » sans
    // que rien n'arrive. On le dit explicitement à l'appelant.
    const { data: bloque } = await adminClient
      .from("emails_bloques").select("motif").eq("destinataire", destinataireNormalise).maybeSingle();
    if (bloque) {
      await journaliser({ statut: "erreur", erreur: `destinataire bloqué (${bloque.motif})` });
      return new Response(JSON.stringify({
        error: `E-mail non envoyé : l'adresse ${destinataireNormalise} est bloquée (${bloque.motif}). La notification in-app a bien été émise.`,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 6. Send Email via Brevo
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    let messageId: string | null = null;
    if (brevoApiKey) {
      const emailPayload = {
        sender: EXPEDITEUR,
        to: [{ email: destinataireNormalise }],
        subject: sujet,
        // Version texte : un e-mail HTML seul est pénalisé par les filtres
        // anti-spam (Outlook/Hotmail en particulier).
        textContent: estVersion
          ? `Bonjour,\n\n${senderName} a publié une nouvelle version de « ${nouvelleVersion} » sur l'appel d'offres "${tenderTitle}". Pensez à travailler sur cette version.\n\nAccéder au dossier : ${appUrl}\n\nEmail : ${destinataireNormalise}\nCode d'accès : ${accessCode}\n\n— Filao.io`
          : estJalon
          ? `Bonjour,\n\nL'échéance « ${milestoneLabel} » arrive dans 2 jours (${dateJalon}) sur l'appel d'offres "${tenderTitle}".\n\nVoir le rétroplanning : ${appUrl}\n\nEmail : ${destinataireNormalise}\nCode d'accès : ${accessCode}\n\n— Filao.io`
          : `Bonjour,\n\n${senderName} vous informe que des documents sont encore manquants pour l'appel d'offres "${tenderTitle}".\n\nAccéder au dossier : ${appUrl}\n\nEmail : ${destinataireNormalise}\nCode d'accès : ${accessCode}\n\n— Filao.io`,
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #1B5D7A; font-size: 20px;">${estVersion ? "Nouvelle version d'une pièce du marché" : estJalon ? "Rappel d'échéance" : "Rappel : Coordination Documentaire"}</h2>
            <p>Bonjour,</p>
            ${estVersion
              ? `<p><strong>${echapperHtml(senderName)}</strong> a publié une nouvelle version de <strong>« ${echapperHtml(nouvelleVersion)} »</strong> sur l'appel d'offres <strong>"${echapperHtml(tenderTitle)}"</strong>.</p>
                 <p style="margin-top: 25px;">Pensez à travailler sur cette version :</p>`
              : estJalon
              ? `<p>L'échéance <strong>« ${echapperHtml(milestoneLabel)} »</strong> arrive dans 2 jours sur l'appel d'offres <strong>"${echapperHtml(tenderTitle)}"</strong>.</p>
                 <p style="margin: 20px 0; padding: 14px 18px; background: #fff7ed; border-left: 4px solid #EF9F27; border-radius: 8px; font-size: 15px;">
                   <strong>${echapperHtml(milestoneLabel)}</strong><br/>
                   <span style="color:#666;">Échéance : ${echapperHtml(dateJalon)}</span>
                 </p>
                 <p style="margin-top: 25px;">Accédez au rétroplanning du dossier :</p>`
              : `<p><strong>${echapperHtml(senderName)}</strong> vous informe que des documents sont encore manquants pour l'appel d'offres : <strong>"${echapperHtml(tenderTitle)}"</strong>.</p>
                 <p style="margin-top: 25px;">Merci de vous connecter pour régulariser votre dossier :</p>`}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${appUrl}" style="background-color: #00A3E0; color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                ${estJalon && !estVersion ? "Voir le rétroplanning" : "Accéder au dossier"}
              </a>
            </div>

            <div style="background: #eef7f9; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #00A3E0;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #1B5D7A; font-weight: bold;">Rappel de vos identifiants :</p>
              <p style="margin: 0; font-size: 13px;">Email : <strong>${echapperHtml(email.toLowerCase().trim())}</strong></p>
              <p style="margin: 5px 0 0 0; font-size: 13px;">Code d'accès : <span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #1B5D7A; letter-spacing: 1px;">${echapperHtml(accessCode)}</span></p>
            </div>
            
            <p style="font-size: 12px; color: #777; margin-top: 40px; text-align: center; border-top: 1px solid #eee; padding-top: 20px;">
              Ceci est un message automatique de coordination via <strong>Filao.io</strong>
            </p>
          </div>
        `,
      };

      const emailRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!emailRes.ok) {
        const errorText = await emailRes.text();
        console.error("Brevo Error:", errorText);
        await journaliser({ statut: "erreur", erreur: `Brevo ${emailRes.status}: ${errorText.slice(0, 300)}` });
        // Le message générique d'origine obligeait à ouvrir les logs de la
        // fonction pour connaître la cause. L'appelant est soit l'application
        // authentifiée, soit le planificateur de rappels : remonter le détail
        // du fournisseur leur évite un aller-retour.
        return new Response(JSON.stringify({
          error: "Echec de l'envoi de l'email",
          fournisseur: "brevo",
          statut: emailRes.status,
          detail: errorText.slice(0, 500),
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      messageId = (await emailRes.json().catch(() => ({})))?.messageId ?? null;
    } else {
      // Sans clé API, la fonction renvoyait `success: true` alors qu'aucun
      // e-mail ne partait — un envoi manquant devenait indétectable.
      console.error("BREVO_API_KEY absente : aucun e-mail envoyé.");
      return new Response(JSON.stringify({
        error: "BREVO_API_KEY absente de l'environnement",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Journaliser l'envoi.
    // Sans cette trace, la date du dernier rappel n'existait que dans l'état
    // React de l'onglet. Le messageId Brevo permet au webhook de rattacher
    // les événements (livré, rejeté, spam…) à CETTE ligne : sans lui, un
    // « je n'ai rien reçu » était impossible à trancher.
    await journaliser({ statut: "envoye", identifiant_prestataire: messageId });

    return new Response(JSON.stringify({ success: true, messageId }), {
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