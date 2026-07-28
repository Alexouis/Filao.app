import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Rattachement d'une pièce du coffre-fort à un appel d'offres.
 *
 * POURQUOI UNE FONCTION
 * L'opération est une copie d'objet à objet dans le bucket `documents`. Elle
 * exige un droit d'écriture, et la migration 037 a supprimé toutes les policies
 * INSERT et UPDATE : les dépôts passent désormais par `upload-document`, qui
 * écrit avec la clé de service. La copie faite depuis le navigateur échouait
 * donc, avec un « Object not found » trompeur — l'objet source existe, c'est la
 * création de la destination qui est refusée.
 *
 * Recopier le fichier via un téléchargement suivi d'un dépôt fonctionnerait,
 * mais ferait transiter tout le contenu par le navigateur pour rien. La copie
 * côté serveur reste dans le stockage.
 *
 * CONTRÔLES
 * Le chemin source doit appartenir à l'appelant — son dossier personnel ou
 * celui de son entreprise. La destination est reconstruite ici, jamais reçue :
 * l'accepter telle quelle permettrait d'écrire dans le dossier d'un tiers.
 *
 * ⚠️ À déployer avec `--no-verify-jwt` : appelée depuis le navigateur.
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

    // --- Identité -------------------------------------------------------
    const enTete = req.headers.get("Authorization") ?? "";
    if (!enTete.startsWith("Bearer ")) return json({ error: "Non authentifié." }, 401);

    const { data: auth } = await admin.auth.getUser(enTete.slice(7));
    const email = auth?.user?.email?.toLowerCase();
    if (!email) return json({ error: "Non authentifié." }, 401);

    const { data: profil } = await admin
      .from("utilisateurs")
      .select("id, entreprise_id")
      .ilike("email", email)
      .maybeSingle();

    const { source, nomCible } = await req.json();
    const chemin = String(source ?? "").replace(/^\/+/, "");
    const nom = String(nomCible ?? "");

    if (!chemin || chemin.includes("..")) return json({ error: "Source invalide." }, 400);
    // Le nom cible est produit par la convention de nommage des pièces : il ne
    // contient jamais de séparateur.
    if (!nom || nom.includes("/") || nom.includes("..")) return json({ error: "Cible invalide." }, 400);

    // --- Droits sur la source -------------------------------------------
    const prefixesLisibles = [`${email}/`];
    if (profil?.entreprise_id) prefixesLisibles.push(`documents/${profil.entreprise_id}/`);
    if (profil?.id) prefixesLisibles.push(`documents/${profil.id}/`);

    if (!prefixesLisibles.some((p) => chemin.startsWith(p))) {
      return json({
        error: "Ce document ne vous appartient pas.",
        detail: `Emplacements permis : ${prefixesLisibles.join(", ")}`,
      }, 403);
    }

    // --- Copie ------------------------------------------------------------
    // La pièce est déposée dans le dossier de celui qui la rattache : c'est lui
    // qui en répond, même s'il agit pour un autre membre du groupement.
    const destination = `${email}/${nom}`;

    let { error } = await admin.storage.from("documents").copy(chemin, destination);

    // `copy` échoue si la destination existe déjà : on remplace alors, le
    // rattachement d'une pièce étant par nature une substitution.
    if (error) {
      const { data: contenu, error: errLecture } = await admin.storage
        .from("documents").download(chemin);
      if (errLecture || !contenu) {
        return json({ error: "Document source introuvable.", detail: errLecture?.message }, 404);
      }
      const { error: errEcriture } = await admin.storage
        .from("documents")
        .upload(destination, contenu, { upsert: true, contentType: contenu.type || "application/octet-stream" });
      if (errEcriture) {
        return json({ error: "La copie a échoué.", detail: errEcriture.message }, 500);
      }
      error = null;
    }

    return json({ ok: true, chemin: destination });
  } catch (erreur) {
    console.error("copy-document:", erreur);
    return json({ error: "Erreur interne", detail: String(erreur) }, 500);
  }
});