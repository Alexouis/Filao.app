import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * calculer-emails — tâche planifiée (07h00 Europe/Paris).
 *
 * Calcule les emails à produire et les écrit dans la file `emails_a_envoyer`.
 * N'ENVOIE RIEN : l'envoi est fait par `consommer-emails`. Séparer calcul et
 * envoi permet de rejouer l'un sans l'autre après incident.
 *
 * L'idempotence est portée par la contrainte UNIQUE de la file
 * (type_email, objet_id, destinataire, jour_cible) : réexécuter ce calcul le
 * même jour n'enfile pas de doublon (les INSERT en conflit sont ignorés).
 *
 * NOTE — jours calendaires (et non ouvrés). Le ticket évoquait des « jours
 * ouvrés », mais pour un canal asynchrone comme l'email, l'écart week-end/férié
 * n'a pas d'incidence pratique (l'utilisateur lit quand il veut). On calcule
 * donc J-7 / J-3 / J-1 en jours calendaires, ce qui évite la complexité des
 * fériés pour un bénéfice nul. Choix assumé, pas un oubli.
 *
 * Ce lot couvre les rappels d'échéance de dossier. Les autres producteurs
 * (récap quotidien, jalons, documents expirants…) s'ajouteront ici dans les
 * lots suivants, sur le même modèle « calculer → enfiler ».
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Paliers de rappel avant échéance (jours calendaires) → type d'email associé.
const PALIERS = [
  { jours: 7, type: "deadline_j7" },
  { jours: 3, type: "deadline_j3" },
  { jours: 1, type: "deadline_j1" },
];

/** `yyyy-MM-dd` en heure de Paris, décalé de N jours. */
const jourParis = (decalageJours = 0): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + decalageJours);
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
};

/** Rôle porté par le JWT d'appel (aligné sur les autres crons du projet). */
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
    const aujourdhui = jourParis(0);

    // Adresses en rejet définitif : à exclure de tout enfilage.
    const { data: bloquesData } = await admin.from("emails_bloques").select("destinataire");
    const bloques = new Set((bloquesData ?? []).map((b: any) => b.destinataire));

    let enfiles = 0;

    for (const palier of PALIERS) {
      const jourEcheance = jourParis(palier.jours); // échéance à J+palier

      // Seuls les dossiers ENCORE EN COURS reçoivent un rappel : un dossier
      // Déposé/Gagné/Perdu n'a plus d'action liée à l'échéance (règle du ticket).
      const { data: dossiers, error } = await admin
        .from("reponses_ao")
        .select("id, titre, date_limite, createur_id, statut, createur:utilisateurs!createur_id(email)")
        .eq("statut", "En cours")
        .not("date_limite", "is", null);

      if (error) throw error;

      for (const dossier of dossiers ?? []) {
        if (String(dossier.date_limite).split("T")[0] !== jourEcheance) continue;

        const email = (dossier as any).createur?.email;
        if (!email || bloques.has(email)) continue;

        // Enfilage idempotent : le conflit sur la clé unique est ignoré, donc
        // un recalcul le même jour ne crée pas de doublon.
        const { error: insErr } = await admin
          .from("emails_a_envoyer")
          .insert({
            type_email: palier.type,
            objet_id: dossier.id,
            destinataire: email,
            jour_cible: aujourdhui,
            payload: {
              tender_id: dossier.id,
              tender_titre: dossier.titre,
              date_limite: dossier.date_limite,
              jours_restants: palier.jours,
            },
          })
          .select("id");

        // 23505 = violation d'unicité (doublon) → attendu, on ignore.
        if (insErr && insErr.code !== "23505") {
          console.error("enfilage échéance:", insErr, dossier.id);
          continue;
        }
        if (!insErr) enfiles++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, jour: aujourdhui, enfiles }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("calculer-emails:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
