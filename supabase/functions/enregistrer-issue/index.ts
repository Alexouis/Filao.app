import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * enregistrer-issue — un dossier est gagné ou perdu.
 *
 * POURQUOI CÔTÉ SERVEUR
 * Deux écrans enregistraient l'issue, avec deux comportements :
 *   - depuis le dossier, toute l'équipe était notifiée, mais à partir
 *     d'identifiants d'interface (souvent ceux d'un groupement ou d'une
 *     invitation, pas d'un utilisateur : notification perdue) ;
 *   - depuis la liste, seul l'auteur du clic était notifié — de sa propre
 *     action — et les partenaires n'apprenaient jamais le résultat.
 * Résoudre les destinataires exige de lire les comptes des entreprises
 * partenaires, ce que le client ne peut pas (migration 070).
 *
 * DROITS
 * La mise à jour du statut est faite AVEC LE JETON DE L'APPELANT : RLS,
 * verrou de quota (049) et déclencheurs s'appliquent comme depuis l'écran.
 * Aucune ligne modifiée = refus.
 *
 * DESTINATAIRES
 *   - le créateur du dossier ;
 *   - les comptes des entreprises PARTENAIRES au statut « accepte » — pas les
 *     collègues du porteur, qui ne voient pas le contenu du dossier (092) ;
 *   - les invités nominatifs ayant accepté et possédant un compte.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Motif ILIKE exact : `_` et `%` sont des jokers. */
const motifExact = (valeur: string): string =>
  String(valeur ?? "").trim().replace(/[\\%_]/g, (c) => "\\" + c);

const STATUT = { won: "Gagné", lost: "Perdu" } as const;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const enTete = req.headers.get("Authorization");
    if (!enTete) return json({ error: "Non autorisé." }, 401);

    const { tenderId, issue } = await req.json();
    if (!tenderId || !(issue in STATUT)) return json({ error: "Paramètres invalides." }, 400);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: enTete } },
    });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: "Non autorisé." }, 401);

    // 1. Statut, sous l'identité de l'appelant.
    const { data: maj, error: errMaj } = await client
      .from("reponses_ao")
      .update({ statut: STATUT[issue as keyof typeof STATUT] })
      .eq("id", tenderId)
      .select("id, titre, montant_estime, createur_id, entreprise_id");
    if (errMaj) return json({ error: errMaj.message }, 400);
    const dossier = maj?.[0];
    if (!dossier) {
      return json({ error: "Vous ne pouvez pas modifier ce dossier (droits insuffisants ou dossier en lecture seule)." }, 403);
    }

    // 2. Destinataires.
    const destinataires = new Set<string>();
    if (dossier.createur_id) destinataires.add(dossier.createur_id);

    const { data: partenaires } = await admin
      .from("groupements").select("entreprise_id")
      .eq("projet_id", tenderId).eq("statut", "accepte");
    const entreprises = (partenaires ?? [])
      .map((g: { entreprise_id: string | null }) => g.entreprise_id)
      .filter((e): e is string => !!e && e !== dossier.entreprise_id);
    if (entreprises.length > 0) {
      const { data: comptes } = await admin
        .from("utilisateurs").select("id").in("entreprise_id", entreprises);
      (comptes ?? []).forEach((c: { id: string }) => destinataires.add(c.id));
    }

    const { data: invites } = await admin
      .from("invitations").select("email")
      .eq("tender_id", tenderId).eq("status", "accepted").is("revoked_at", null);
    for (const inv of invites ?? []) {
      if (!inv.email) continue;
      const { data: compte } = await admin
        .from("utilisateurs").select("id").ilike("email", motifExact(inv.email)).maybeSingle();
      if (compte?.id) destinataires.add(compte.id);
    }

    // 3. Notifications (type « résultats » : pas de préférence de désactivation).
    const montant = Number(dossier.montant_estime) > 0
      ? ` (${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(dossier.montant_estime))})`
      : "";
    const gagne = issue === "won";
    const notification = {
      type: gagne ? "tender_won" : "tender_lost",
      titre: gagne ? "Appel d'offres remporté !" : "Appel d'offres non remporté",
      message: gagne
        ? "Félicitations ! Vous avez remporté l'appel d'offres"
        : "Malheureusement, l'appel d'offres n'a pas été remporté :",
      related_tender_id: tenderId,
      related_tender_titre: gagne ? `${dossier.titre}${montant}` : dossier.titre,
    };

    let notifies = 0;
    for (const id of destinataires) {
      const { data: u } = await admin.from("utilisateurs").select("notifications").eq("id", id).maybeSingle();
      if (!u) continue;
      const { error } = await admin.from("utilisateurs").update({
        notifications: [
          { id: crypto.randomUUID(), ...notification, date: new Date().toISOString(), read: false },
          ...(u.notifications || []),
        ],
      }).eq("id", id);
      if (error) console.error("enregistrer-issue (notification):", id, error);
      else notifies++;
    }

    return json({ ok: true, statut: STATUT[issue as keyof typeof STATUT], notifies });
  } catch (err) {
    console.error("enregistrer-issue:", err);
    return json({ error: "Erreur interne." }, 500);
  }
});
