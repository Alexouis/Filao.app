import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * purge-stockage-orphelin Edge Function
 *
 * POURQUOI
 * Quand le dernier membre d'une entreprise supprime son compte, l'entreprise et
 * son coffre-fort sont conservés : ses pièces peuvent être rattachées à des
 * dossiers encore en cours chez des cotraitants, et la reprise reste possible
 * par clé (migration 085).
 *
 * Mais si personne ne reprend l'entreprise, ces fichiers occupent du stockage
 * indéfiniment, sans que quiconque puisse jamais y accéder. Cette fonction les
 * retire au terme d'un délai de conservation.
 *
 * CE QUI EST PURGÉ
 * Uniquement `documents/{entreprise_id}/` — le coffre-fort administratif, dont
 * les pièces (Kbis, attestations, URSSAF) sont périmées depuis longtemps au
 * terme du délai.
 *
 * CE QUI EST CONSERVÉ
 * `tenders/dce/{tender_id}/` : les pièces de marché sont partagées avec les
 * cotraitants et relèvent de la prescription de dix ans en marchés publics.
 * Elles ne sont jamais touchées ici.
 *
 * SÉCURITÉ
 * Fonction d'administration, appelée uniquement par le planificateur. Elle exige
 * un secret partagé : sans lui, toute personne connaissant l'URL pourrait
 * déclencher une purge.
 *
 * ⚠️ À déployer avec `--no-verify-jwt` (appel par pg_cron, sans session
 *    utilisateur) et avec le secret `PURGE_SECRET` configuré.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-purge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Délai de conservation avant purge du coffre-fort d'une entreprise orpheline. */
const MOIS_DE_CONSERVATION = 12;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const secretAttendu = Deno.env.get("PURGE_SECRET") ?? "";
    const secretFourni = req.headers.get("x-purge-secret") ?? "";
    if (!secretAttendu || secretFourni !== secretAttendu) {
      return json({ error: "Non autorisé" }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Mode simulation : permet de vérifier le périmètre avant d'effacer.
    const { dryRun = false } = await req.json().catch(() => ({ dryRun: false }));

    const seuil = new Date();
    seuil.setMonth(seuil.getMonth() - MOIS_DE_CONSERVATION);

    const { data: entreprises, error } = await admin
      .from("entreprises")
      .select("id, nom, sans_membre_depuis")
      .not("sans_membre_depuis", "is", null)
      .lt("sans_membre_depuis", seuil.toISOString());

    if (error) {
      console.error("Lecture des entreprises orphelines échouée:", error);
      return json({ error: "Lecture impossible" }, 500);
    }

    let fichiersSupprimes = 0;
    let octetsLiberes = 0;
    const traitees: string[] = [];

    for (const entreprise of entreprises ?? []) {
      const prefixe = `documents/${entreprise.id}`;
      const { data: objets, error: listErr } = await admin.storage
        .from("documents").list(prefixe);

      if (listErr) {
        console.warn("Listage impossible", prefixe, listErr.message);
        continue;
      }
      if (!objets || objets.length === 0) continue;

      const chemins = objets.map((o) => `${prefixe}/${o.name}`);
      octetsLiberes += objets.reduce((t, o) => t + Number(o.metadata?.size ?? 0), 0);

      if (!dryRun) {
        // Par lots : l'API refuse les listes trop longues.
        for (let i = 0; i < chemins.length; i += 100) {
          const lot = chemins.slice(i, i + 100);
          const { error: removeErr } = await admin.storage.from("documents").remove(lot);
          if (removeErr) console.error("Suppression partielle", removeErr.message);
          else fichiersSupprimes += lot.length;
        }

        // Les lignes de la table suivent, sinon l'interface listerait des pièces
        // dont le fichier n'existe plus.
        await admin.from("documents_candidature").delete().eq("entreprise_id", entreprise.id);
      } else {
        fichiersSupprimes += chemins.length;
      }

      traitees.push(entreprise.nom || entreprise.id);
    }

    console.log(
      `purge-stockage-orphelin : ${traitees.length} entreprise(s), ` +
      `${fichiersSupprimes} fichier(s), ${Math.round(octetsLiberes / 1024 / 1024)} Mo` +
      (dryRun ? " (simulation)" : "")
    );

    return json({ ok: true, dryRun, entreprises: traitees.length, fichiersSupprimes, octetsLiberes });
  } catch (erreur) {
    console.error("purge-stockage-orphelin:", erreur);
    return json({ error: "Erreur interne" }, 500);
  }
});
