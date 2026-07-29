import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { lirePieceCollaborateur, concernePiece } from "./documentNaming.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const urlProjet = Deno.env.get("SUPABASE_URL") ?? "";
    if (!serviceKey || !urlProjet) return json({ error: "Configuration incomplète" }, 500);

    const admin = createClient(urlProjet, serviceKey);
    const { action, token, tenderId, email, accessCode, fichier } = await req.json();

    // --- Identité -------------------------------------------------------
    // Le secret est exigé et confronté à la base : c'est lui qui remplace
    // l'identité dont un appelant anonyme ne dispose pas.
    // Le jeton n'est plus comparable en clair : la base n'en garde que
    // l'empreinte. La résolution passe par une fonction dédiée plutôt que de
    // reproduire le hachage ici — un algorithme dupliqué finit par diverger.
    let invitation: { email?: string; tender_id?: string } | null = null;

    if (token) {
      const { data } = await admin.rpc("resoudre_invitation_par_jeton", { p_token: token });
      invitation = data?.[0] ?? null;
    } else {
      const { data } = await admin.from("invitations")
        .select("email, tender_id")
        .eq("tender_id", tenderId)
        .ilike("email", String(email ?? "").trim())
        .ilike("access_code", String(accessCode ?? "").trim())
        .limit(1).maybeSingle();
      invitation = data;
    }
    if (!invitation?.email) return json({ error: "Accès refusé." }, 401);

    const dossier = String(invitation.email).toLowerCase();
    const idAo = String(invitation.tender_id);

    // --- Actions --------------------------------------------------------
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

    return json({ error: `Action inconnue : « ${action} »` }, 400);
  } catch (erreur) {
    console.error("guest-files:", erreur);
    return json({ error: "Erreur interne", detail: String(erreur) }, 500);
  }
});