import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * recap-depots — tâche planifiée (18h00 Europe/Paris).
 *
 * Agrège les dépôts de pièces du jour (table `depots_pieces`) par destinataire
 * et enfile UN SEUL email récapitulatif par destinataire dans `emails_a_envoyer`
 * — au lieu d'un email par pièce. C'est la règle anti-harcèlement du ticket :
 * regrouper plutôt que spammer.
 *
 * N'envoie pas : comme les autres producteurs, il enfile ; `consommer-emails`
 * enverra (en appliquant préférences + plafond). Idempotent via la clé unique
 * de la file (type_email=recap_documents, objet_id=destinataire, jour).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Dépôts depuis le début de la journée (heure serveur UTC ; suffisant pour un
    // récap de fin de journée).
    const debutJour = new Date();
    debutJour.setUTCHours(0, 0, 0, 0);

    const { data: depots, error } = await admin
      .from("depots_pieces")
      .select("destinataire_id, tender_id, auteur_libelle, type_piece, nom_piece, created_at, destinataire:utilisateurs!destinataire_id(email)")
      .gte("created_at", debutJour.toISOString());
    if (error) throw error;

    // Regrouper par destinataire.
    const parDestinataire = new Map<string, { email: string | null; items: any[] }>();
    for (const d of depots ?? []) {
      const email = (d as any).destinataire?.email ?? null;
      const cle = d.destinataire_id;
      if (!parDestinataire.has(cle)) parDestinataire.set(cle, { email, items: [] });
      parDestinataire.get(cle)!.items.push(d);
    }

    const jour = jourParis();
    let enfiles = 0;

    for (const [destinataireId, groupe] of parDestinataire) {
      if (!groupe.email || groupe.items.length === 0) continue;

      const nb = groupe.items.length;
      // Résumé compact : nb de pièces + dossiers concernés (dédupliqués).
      const dossiers = [...new Set(groupe.items.map((i: any) => i.tender_id))];

      const { error: insErr } = await admin
        .from("emails_a_envoyer")
        .insert({
          type_email: "recap_documents",
          objet_id: destinataireId, // un récap par destinataire et par jour
          destinataire: groupe.email,
          jour_cible: jour,
          payload: {
            nb_pieces: nb,
            nb_dossiers: dossiers.length,
            // Détail léger pour le gabarit (auteur + pièce + dossier).
            pieces: groupe.items.slice(0, 20).map((i: any) => ({
              auteur: i.auteur_libelle,
              type: i.type_piece,
              nom: i.nom_piece,
              tender_id: i.tender_id,
            })),
          },
        })
        .select("id");

      if (insErr && insErr.code !== "23505") {
        console.error("enfilage récap:", insErr, destinataireId);
        continue;
      }
      if (!insErr) enfiles++;
    }

    return new Response(JSON.stringify({ ok: true, jour, destinataires: parDestinataire.size, enfiles }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("recap-depots:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
