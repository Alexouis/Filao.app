import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { concernePiece } from "./documentNaming.ts";

/**
 * Suppression des pièces d'un appel d'offres.
 *
 * POURQUOI UNE FONCTION
 * Les pièces d'un AO sont réparties dans les dossiers de chaque membre du
 * groupement, y compris des partenaires sans compte. Le créateur n'a de droit
 * de suppression que sur son propre dossier et celui de son entreprise
 * (migration 037) : la suppression depuis le navigateur retirait la ligne en
 * base mais laissait les fichiers des autres membres derrière elle, sans
 * erreur. Des orphelins invisibles, que plus aucune ligne ne désigne — un
 * problème de volumétrie, et de conservation de données personnelles.
 *
 * CONTRÔLE
 * Seul le créateur de l'appel d'offres peut déclencher la purge. Les fichiers
 * retirés sont ceux dont le nom porte l'identifiant de cet AO, dans les
 * dossiers des membres du groupement et des personnes invitées — jamais un
 * chemin fourni par l'appelant.
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
    const userId = auth?.user?.id;
    if (!userId) return json({ error: "Non authentifié." }, 401);

    const { tenderId, dryRun = false } = await req.json();
    const idAo = String(tenderId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(idAo)) return json({ error: "Identifiant d'AO invalide." }, 400);

    // --- Droit : créateur uniquement -------------------------------------
    // Un co-traitant ne doit pas pouvoir effacer les pièces du groupement.
    const { data: ao } = await admin
      .from("reponses_ao")
      .select("id, createur_id")
      .eq("id", idAo)
      .maybeSingle();

    if (!ao) return json({ error: "Appel d'offres introuvable." }, 404);
    if (ao.createur_id !== userId) {
      return json({ error: "Seul le créateur peut supprimer ce dossier." }, 403);
    }

    // --- Dossiers à parcourir --------------------------------------------
    // Les pièces vivent dans le dossier de celui qui les a déposées : membres
    // du groupement, invités sans compte, et le créateur lui-même.
    const dossiers = new Set<string>();

    const { data: createur } = await admin
      .from("utilisateurs").select("email").eq("id", userId).maybeSingle();
    if (createur?.email) dossiers.add(createur.email.toLowerCase());

    const { data: invitations } = await admin
      .from("invitations").select("email").eq("tender_id", idAo);
    for (const i of invitations ?? []) {
      if (i.email) dossiers.add(String(i.email).toLowerCase());
    }

    const { data: groupements } = await admin
      .from("groupements").select("entreprise_id").eq("projet_id", idAo);
    const entrepriseIds = (groupements ?? []).map((g) => g.entreprise_id).filter(Boolean);

    if (entrepriseIds.length > 0) {
      const { data: membres } = await admin
        .from("utilisateurs").select("email").in("entreprise_id", entrepriseIds);
      for (const m of membres ?? []) {
        if (m.email) dossiers.add(String(m.email).toLowerCase());
      }
    }

    // --- Repérage ---------------------------------------------------------
    const aSupprimer: string[] = [];
    let octetsLiberes = 0;

    for (const dossier of dossiers) {
      const { data: objets, error } = await admin.storage.from("documents").list(dossier);
      if (error) {
        console.warn("Listage impossible", dossier, error.message);
        continue;
      }
      for (const o of objets ?? []) {
        // Convention partagée : le nom d'une pièce se termine par l'identifiant
        // de l'AO. Un `includes` attraperait un identifiant apparaissant
        // ailleurs dans le nom.
        if (!concernePiece(o.name, idAo)) continue;
        aSupprimer.push(`${dossier}/${o.name}`);
        octetsLiberes += Number(o.metadata?.size ?? 0);
      }
    }

    // Pièces du marché déposées sur le dossier lui-même.
    for (const prefixe of [`tenders/dce/${idAo}`]) {
      const { data: objets } = await admin.storage.from("documents").list(prefixe);
      for (const o of objets ?? []) {
        aSupprimer.push(`${prefixe}/${o.name}`);
        octetsLiberes += Number(o.metadata?.size ?? 0);
      }
    }

    if (dryRun) {
      return json({ ok: true, dryRun: true, aSupprimer, octetsLiberes });
    }

    // --- Suppression ------------------------------------------------------
    let supprimes = 0;
    if (aSupprimer.length > 0) {
      // Par lots : l'API refuse les listes trop longues.
      for (let i = 0; i < aSupprimer.length; i += 100) {
        const lot = aSupprimer.slice(i, i + 100);
        const { error } = await admin.storage.from("documents").remove(lot);
        if (error) console.error("Suppression partielle", error.message);
        else supprimes += lot.length;
      }
    }

    return json({ ok: true, supprimes, octetsLiberes, dossiers: [...dossiers] });
  } catch (erreur) {
    console.error("delete-tender-documents:", erreur);
    return json({ error: "Erreur interne", detail: String(erreur) }, 500);
  }
});