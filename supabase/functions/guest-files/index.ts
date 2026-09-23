import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lirePieceCollaborateur, concernePiece } from "./documentNaming.ts";
import { verifierDebit } from "./rateLimit.ts";
import { invitationParCode } from "./invitationCode.ts";

/**
 * Motif ILIKE correspondant EXACTEMENT à `valeur`, casse ignorée.
 * `_` et `%` sont des jokers pour ILIKE : « alexandre_louis@… » désignait aussi
 * « alexandreXlouis@… ». On les échappe.
 */
const motifExact = (valeur: string): string =>
  String(valeur ?? "").trim().replace(/[\\%_]/g, (c) => "\\" + c);


/**
 * Accès en lecture aux fichiers d'un partenaire non inscrit.
 *
 * POURQUOI
 * Depuis la migration 039b, `documents` est privé et sa policy de lecture est
 * réservée aux comptes authentifiés. Un invité n'en est pas un : ses appels à
 * `storage.list()` et `createSignedUrl()` échouent, sans erreur visible pour
 * `list()` qui renvoie simplement une liste vide. Le fichier venait pourtant
 * d'être déposé, mais l'espace partenaire ne l'affichait plus.
 *
 * La policy invité supprimée par la 039b ne peut pas être rétablie : elle
 * s'appliquait à `anon` sans jamais référencer l'appelant, donc n'importe qui
 * lisait le dossier de n'importe quel invité. Une policy ne peut pas faire
 * mieux — un appelant anonyme n'a aucune identité à comparer.
 *
 * D'où cette fonction : elle exige le secret de l'invitation, le vérifie côté
 * serveur, puis agit avec la clé de service.
 *
 * ⚠️ À déployer avec `--no-verify-jwt` : appelée depuis le navigateur par un
 *    utilisateur non authentifié, le préflight CORS serait sinon rejeté.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Invitation correspondant au secret présenté, ou null.
 *
 * Mode code : comparaison EXACTE (insensible à la casse) faite ici. L'ancienne
 * version passait l'e-mail et le code saisis à `.ilike()`, qui les traite
 * comme des MOTIFS : « % » et « % » désignaient n'importe quelle invitation
 * du dossier, et donnaient accès aux pièces d'un autre partenaire à partir du
 * seul identifiant du dossier, présent dans le lien de l'e-mail.
 * Une invitation révoquée ou expirée n'ouvre plus rien, comme en mode jeton.
 */
const resoudreInvitation = async (
  admin: any,
  { token, tenderId, email, accessCode }: { token?: string; tenderId?: string; email?: string; accessCode?: string },
): Promise<{ email: string; tender_id: string; status: string } | null> => {
  if (token) {
    const { data } = await admin.rpc("resoudre_invitation_par_jeton", { p_token: token });
    const ligne = data?.[0];
    return ligne?.email ? { email: String(ligne.email), tender_id: String(ligne.tender_id), status: String(ligne.status) } : null;
  }

  if (!tenderId || !/^[0-9a-f-]{36}$/i.test(String(tenderId))) return null;
  const { data } = await admin.from("invitations")
    .select("email, tender_id, status, access_code, revoked_at, expires_at")
    .eq("tender_id", tenderId);
  const ligne: any = invitationParCode(data ?? [], String(email ?? ""), String(accessCode ?? ""));
  return ligne ? { email: String(ligne.email), tender_id: String(ligne.tender_id), status: String(ligne.status) } : null;
};

/**
 * Ajoute une notification in-app au porteur, en respectant ses préférences
 * (même règle que `notify-user`). `dedup` évite de réécrire la même
 * notification dans les 24 h.
 */
const notifierPorteur = async (
  admin: any, userId: string, notification: Record<string, unknown>,
  prefKey: string | null, dedup = false,
) => {
  const { data: u } = await admin.from("utilisateurs")
    .select("notifications, notification_preferences").eq("id", userId).maybeSingle();
  if (!u) return;
  if (prefKey && u.notification_preferences?.[prefKey]?.app === false) return;
  const actuelles: any[] = u.notifications || [];
  if (dedup) {
    const il_y_a_24h = Date.now() - 24 * 60 * 60 * 1000;
    const doublon = actuelles.some((n) =>
      n?.type === notification.type
      && n?.related_tender_id === notification.related_tender_id
      && n?.sender_name === notification.sender_name
      && n?.date && new Date(n.date).getTime() >= il_y_a_24h);
    if (doublon) return;
  }
  // Ajout atomique (migration 116).
  const { error } = await admin.rpc("ajouter_notification", {
    p_utilisateur: userId,
    p_notification: { id: crypto.randomUUID(), ...notification, date: new Date().toISOString(), read: false },
  });
  if (error) console.error("guest-files (notification):", error);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const urlProjet = Deno.env.get("SUPABASE_URL") ?? "";
    if (!serviceKey || !urlProjet) return json({ error: "Configuration incomplète" }, 500);

    const admin = createClient(urlProjet, serviceKey);
    const { action, token, tenderId, email, accessCode, fichier, evenement } = await req.json();

    // Limitation de débit avant toute lecture : un jeton connu ne doit pas
    // permettre d'énumérer le contenu d'un dossier à volonté.
    const debit = await verifierDebit(admin, req, token);
    if (!debit.autorise) return json({ error: debit.motif }, 429);

    // --- Identité -------------------------------------------------------
    // Le secret est exigé et confronté à la base : c'est lui qui remplace
    // l'identité dont un appelant anonyme ne dispose pas.
    // Le jeton n'est plus comparable en clair : la base n'en garde que
    // l'empreinte. La résolution passe par une fonction dédiée plutôt que de
    // reproduire le hachage ici — un algorithme dupliqué finit par diverger.
    const invitation = await resoudreInvitation(admin, { token, tenderId, email, accessCode });
    if (!invitation) return json({ error: "Accès refusé." }, 401);

    const dossier = invitation.email.toLowerCase();
    const idAo = invitation.tender_id;

    if (action === "list") {
      const { data, error } = await admin.storage.from("documents").list(dossier);
      if (error) return json({ error: "Lecture impossible", detail: error.message }, 500);

      // Restreint à l'appel d'offres de l'invitation : le dossier de l'invité
      // peut contenir des pièces déposées pour d'autres AO, qui ne regardent
      // pas le porteur de ce jeton.
      // Convention partagée : voir _shared/documentNaming. Un `split('-')`
      // suffisait pour le type, mais découpait un UUID en morceaux dès qu'on
      // voulait autre chose — et divergeait de la lecture faite par TenderWizard.
      const fichiers = (data ?? [])
        .filter((o) => concernePiece(o.name, idAo))
        .map((o) => {
          const piece = lirePieceCollaborateur(o.name, idAo);
          return {
            name: o.name,
            docType: piece?.docType ?? "",
            collabId: piece?.collabId ?? "",
            created_at: o.created_at,
            updated_at: o.updated_at,
            metadata: o.metadata,
          };
        })
        .filter((f) => f.docType);

      return json({ ok: true, fichiers });
    }

    if (action === "sign") {
      const nom = String(fichier ?? "");
      // Le chemin est reconstruit à partir de l'identité vérifiée : accepter
      // celui fourni par l'appelant permettrait de signer n'importe quel objet.
      if (!nom || nom.includes("/") || !concernePiece(nom, idAo)) {
        return json({ error: "Fichier non autorisé." }, 403);
      }

      const { data, error } = await admin.storage
        .from("documents")
        .createSignedUrl(`${dossier}/${nom}`, 300);   // 5 min, le temps d'ouvrir

      if (error || !data?.signedUrl) {
        return json({ error: "Lien indisponible", detail: error?.message }, 500);
      }
      return json({ ok: true, url: data.signedUrl });
    }

    // Notifications au porteur pour les actions d'un invité.
    //
    // `addNotification` et l'insertion dans `depots_pieces` exigent une session
    // (notify-user, policy `authenticated`) : pour un invité sans compte, ils
    // échouaient en silence. Le porteur n'était prévenu ni de l'acceptation,
    // ni des dépôts, et le récapitulatif de 18 h ne les voyait pas. On les fait
    // ici, après vérification du secret, avec la clé de service.
    if (action === "notifier") {
      const { data: ao } = await admin.from("reponses_ao")
        .select("createur_id, titre").eq("id", idAo).maybeSingle();
      if (!ao?.createur_id) return json({ error: "Dossier introuvable." }, 404);

      if (evenement === "depot") {
        const nom = String(fichier ?? "");
        const piece = nom && !nom.includes("/") ? lirePieceCollaborateur(nom, idAo) : null;
        if (!piece?.docType) return json({ error: "Fichier non autorisé." }, 403);
        // Le fichier doit réellement exister : sans quoi n'importe quel
        // détenteur du secret pourrait fabriquer des notifications.
        const { data: trouves } = await admin.storage.from("documents").list(dossier, { search: nom });
        if (!trouves?.some((o) => o.name === nom)) return json({ error: "Fichier introuvable." }, 404);

        const { error: errDepot } = await admin.from("depots_pieces").insert({
          tender_id: idAo,
          destinataire_id: ao.createur_id,
          auteur_libelle: dossier,
          type_piece: piece.docType,
          nom_piece: nom,
        });
        if (errDepot) console.error("guest-files (depots_pieces):", errDepot);

        await notifierPorteur(admin, ao.createur_id, {
          type: "document_added",
          titre: "Document ajouté",
          message: `a ajouté le document "${piece.docType}" à`,
          sender_name: dossier,
          sender_avatar: "",
          related_tender_id: idAo,
          related_tender_titre: ao.titre,
        }, "nouveau_document");
        return json({ ok: true });
      }

      if (evenement === "reponse") {
        // On ne notifie qu'une réponse effectivement enregistrée, et récente :
        // le client ne peut pas annoncer une acceptation qui n'a pas eu lieu.
        const { data: inv } = await admin.from("invitations")
          .select("status, accepted_at, refused_at")
          .eq("tender_id", idAo).ilike("email", motifExact(dossier)).maybeSingle();
        const acceptee = inv?.status === "accepted";
        const quand = acceptee ? inv?.accepted_at : inv?.refused_at;
        const recente = quand && Date.now() - new Date(quand).getTime() < 10 * 60 * 1000;
        if (!inv || !["accepted", "refused"].includes(inv.status) || !recente) {
          return json({ error: "Aucune réponse récente à notifier." }, 409);
        }
        await notifierPorteur(admin, ao.createur_id, {
          type: acceptee ? "collaboration_accepted" : "collaboration_rejected",
          titre: acceptee ? "Collaboration acceptée" : "Collaboration refusée",
          message: acceptee
            ? "a accepté votre demande de collaboration sur"
            : "a refusé votre invitation à collaborer sur",
          sender_name: dossier,
          sender_avatar: "",
          related_tender_id: idAo,
          related_tender_titre: ao.titre,
        }, null, true);
        return json({ ok: true });
      }

      return json({ error: `Événement inconnu : « ${evenement} »` }, 400);
    }

    return json({ error: `Action inconnue : « ${action} »` }, 400);
  } catch (erreur) {
    console.error("guest-files:", erreur);
    return json({ error: "Erreur interne", detail: String(erreur) }, 500);
  }
});