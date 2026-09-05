import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * purge-pieces-orphelines — retire les pièces de dossier devenues inaccessibles.
 *
 * LE PROBLÈME
 * Les pièces de candidature sont rangées par déposant : `documents/{email}/`,
 * sous un nom canonique `type-collabId-tenderId`. Quand un partenaire quitte un
 * groupement (ou en est retiré), rien ne touche à ses fichiers. Ils ne sont pas
 * supprimés — ils deviennent seulement INVISIBLES : l'écran Équipe ne parcourt
 * que les dossiers des membres actuels. Le déposant les paie encore sans
 * pouvoir les consulter ni les effacer.
 *
 * CE QUI EST CONSIDÉRÉ COMME ORPHELIN
 * Une pièce `type-collabId-tenderId` l'est si, POUR CE COUPLE (déposant,
 * dossier) :
 *   - le dossier n'existe plus, OU
 *   - il ne reste ni ligne `groupements` ni invitation active reliant le
 *     déposant au dossier.
 *
 * LE DÉLAI, ET POURQUOI IL COMPTE
 * Un départ n'est pas toujours définitif : un partenaire réinvité retrouve ses
 * pièces telles quelles, puisque le nommage est canonique. Supprimer aussitôt
 * détruirait des attestations encore valables sur une brouille passagère. On
 * attend donc `DELAI_JOURS` (30 par défaut) après la dernière modification du
 * fichier.
 *
 * CE QUI N'EST JAMAIS TOUCHÉ
 *   - `documents/{entreprise_id}/` : le coffre-fort administratif, traité par
 *     `purge-stockage-orphelin` avec ses propres règles.
 *   - `tenders/dce/{tender_id}/` : pièces de marché, partagées et soumises à la
 *     prescription de dix ans en marchés publics.
 *   - tout fichier dont le nom ne suit pas la convention : on ne devine pas à
 *     quoi il se rattache, donc on n'y touche pas.
 *
 * APPEL
 * Réservé au cron, via le secret `PURGE_SECRET` en en-tête `x-purge-secret`,
 * comme `purge-stockage-orphelin`. Toujours lancer une première fois avec
 * `{"dryRun": true}` pour lire ce qui SERAIT supprimé.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-purge-secret",
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Délai de conservation après le départ, en jours. */
const DELAI_JOURS_DEFAUT = 30;

/**
 * Lit un nom de pièce `type-collabId-tenderId`.
 *
 * Les identifiants sont des UUID, qui contiennent eux-mêmes des tirets : on ne
 * peut donc pas découper naïvement. Les deux UUID occupent les 36 derniers
 * caractères chacun, séparés par un tiret.
 */
const lireNomPiece = (nom: string): { tenderId: string } | null => {
  const sansExtension = nom.replace(/\.[^.]+$/, "");
  // …-<36 car>-<36 car> en fin de chaîne.
  const m = sansExtension.match(
    /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  );
  return m ? { tenderId: m[1] } : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const secretAttendu = Deno.env.get("PURGE_SECRET") ?? "";
    const secretFourni = req.headers.get("x-purge-secret") ?? "";
    if (!secretAttendu || secretFourni !== secretAttendu) {
      return json({ error: "Forbidden" }, 403);
    }

    const { dryRun = false, delaiJours = DELAI_JOURS_DEFAUT } = await req
      .json()
      .catch(() => ({ dryRun: false, delaiJours: DELAI_JOURS_DEFAUT }));

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const limite = new Date();
    limite.setDate(limite.getDate() - Number(delaiJours));

    // 1. Les déposants possibles : un dossier `documents/{email}/` par personne.
    const { data: utilisateurs, error: errUtilisateurs } = await admin
      .from("utilisateurs")
      .select("id, email, entreprise_id");
    if (errUtilisateurs) throw errUtilisateurs;

    let fichiersSupprimes = 0;
    let octetsLiberes = 0;
    const detail: Array<{ email: string; fichier: string; tenderId: string; octets: number }> = [];

    for (const u of utilisateurs ?? []) {
      if (!u.email) continue;
      const prefixe = `documents/${u.email}`;

      const { data: objets, error: errListe } = await admin.storage
        .from("documents")
        .list(prefixe, { limit: 1000 });
      if (errListe || !objets?.length) continue;

      const aSupprimer: string[] = [];

      for (const objet of objets) {
        const lu = lireNomPiece(objet.name);
        // Nom hors convention : on ne sait pas à quoi il se rattache.
        if (!lu) continue;

        // Délai de conservation : on ne touche pas à un fichier récent.
        const modifie = new Date(
          (objet as any).updated_at ?? (objet as any).created_at ?? Date.now()
        );
        if (modifie > limite) continue;

        // Le dossier existe-t-il encore ?
        const { data: dossier } = await admin
          .from("reponses_ao")
          .select("id")
          .eq("id", lu.tenderId)
          .maybeSingle();

        let orphelin = !dossier;

        if (dossier) {
          // Reste-t-il un lien entre ce déposant et ce dossier ?
          const { count: liensGroupement } = u.entreprise_id
            ? await admin
                .from("groupements")
                .select("id", { count: "exact", head: true })
                .eq("projet_id", lu.tenderId)
                .eq("entreprise_id", u.entreprise_id)
            : { count: 0 };

          const { count: liensInvitation } = await admin
            .from("invitations")
            .select("id", { count: "exact", head: true })
            .eq("tender_id", lu.tenderId)
            .ilike("email", u.email)
            .is("revoked_at", null);

          orphelin = (liensGroupement ?? 0) === 0 && (liensInvitation ?? 0) === 0;
        }

        if (!orphelin) continue;

        const octets = Number((objet as any).metadata?.size ?? 0);
        aSupprimer.push(`${prefixe}/${objet.name}`);
        octetsLiberes += octets;
        detail.push({ email: u.email, fichier: objet.name, tenderId: lu.tenderId, octets });
      }

      if (aSupprimer.length === 0) continue;

      if (!dryRun) {
        // Par lots : `remove` accepte une liste, on borne pour rester dans les
        // limites d'exécution.
        for (let i = 0; i < aSupprimer.length; i += 100) {
          const lot = aSupprimer.slice(i, i + 100);
          const { error: errSuppr } = await admin.storage.from("documents").remove(lot);
          if (errSuppr) {
            console.error(`Suppression partielle pour ${u.email}:`, errSuppr);
            continue;
          }
          fichiersSupprimes += lot.length;
        }
      } else {
        fichiersSupprimes += aSupprimer.length;
      }
    }

    console.log(
      `Purge des pièces orphelines : ${fichiersSupprimes} fichier(s), ${octetsLiberes} octet(s)` +
        (dryRun ? " (simulation)" : "")
    );

    return json({ ok: true, dryRun, delaiJours, fichiersSupprimes, octetsLiberes, detail });
  } catch (err: any) {
    console.error(err);
    return json({ error: err.message || "Internal Server Error" }, 500);
  }
});
