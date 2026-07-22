import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * accept-invitation Edge Function
 * 
 * Handles a user's response to a tender collaboration invitation.
 * When a user accepts:
 *   1. Updates groupements.statut → 'accepte'
 *   2. Updates matching invitation record
 *   3. Notifies the tender owner
 *   4. AUTO-ADDS bidirectional reseau_entreprises rows for all accepted companies in the tender
 * 
 * When a user refuses:
 *   1. Updates groupements.statut → 'refuse'
 *   2. Updates matching invitation record
 *   3. Notifies the tender owner
 */
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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Authenticate the calling user
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenderId, accept } = await req.json();

    if (!tenderId) {
      return new Response(JSON.stringify({ error: "tenderId requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user's company
    const { data: userData, error: userDataErr } = await adminClient
      .from("utilisateurs")
      .select("entreprise_id, prenom, nom, photo_url, email")
      .eq("id", user.id)
      .single();

    if (userDataErr || !userData?.entreprise_id) {
      return new Response(JSON.stringify({ error: "Utilisateur ou entreprise non trouvé" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const myCompanyId = userData.entreprise_id;
    const newStatut = accept ? "accepte" : "refuse";

    // 1. Get invitation details first to ensure we have the role (especially for manual invites)
    const { data: inviteData } = await adminClient
      .from("invitations")
      .select("role, status")
      .eq("tender_id", tenderId)
      .ilike("email", userData.email)
      .single();

    // 2. Upsert groupements row (use role from invite if groupement doesn't exist yet)
    const { error: grpErr } = await adminClient
      .from("groupements")
      .upsert({
        projet_id: tenderId,
        entreprise_id: myCompanyId,
        role_groupement: inviteData?.role || 'Co-traitant',
        statut: newStatut,
        date_reponse: new Date().toISOString(),
        invite_par: (inviteData as any)?.created_by || null,
      }, { onConflict: 'projet_id, entreprise_id' });

    if (grpErr) {
      console.error("Error updating groupement:", grpErr);
      throw grpErr;
    }

    // 3. Update matching invitation record (best-effort)
    const updatePayload: any = {
      status: accept ? "accepted" : "refused",
    };
    if (accept) {
      updatePayload.accepted_at = new Date().toISOString();
    } else {
      updatePayload.refused_at = new Date().toISOString();
    }

    await adminClient
      .from("invitations")
      .update(updatePayload)
      .eq("tender_id", tenderId)
      .ilike("email", userData.email);

    // 5. AUTO-ADD TO NETWORK on acceptance
    if (accept) {
      await autoAddToNetwork(adminClient, tenderId, myCompanyId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("accept-invitation error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Auto-add bidirectional network relationships for all accepted companies in a tender.
 * When company X accepts, create reseau_entreprises rows between X and every other
 * accepted company in the same tender (in both directions).
 */
async function autoAddToNetwork(
  adminClient: ReturnType<typeof createClient>,
  tenderId: string,
  acceptingCompanyId: string
) {
  try {
    // 1. Always include the owner's company (they are not in groupements but own the tender)
    const { data: tender } = await adminClient
      .from("reponses_ao")
      .select("createur_id")
      .eq("id", tenderId)
      .single();

    let ownerCompanyId: string | null = null;
    if (tender?.createur_id) {
      const { data: ownerUser } = await adminClient
        .from("utilisateurs")
        .select("entreprise_id")
        .eq("id", tender.createur_id)
        .single();
      ownerCompanyId = ownerUser?.entreprise_id || null;
    }

    // 2. Find all OTHER accepted groupement members in this tender
    const { data: otherAccepted } = await adminClient
      .from("groupements")
      .select("entreprise_id")
      .eq("projet_id", tenderId)
      .eq("statut", "accepte")
      .neq("entreprise_id", acceptingCompanyId);

    // 3. Build set of all company IDs to link with
    const companyIds = new Set<string>();
    
    // Add owner if it exists and is different from the accepting company
    if (ownerCompanyId && ownerCompanyId !== acceptingCompanyId) {
      companyIds.add(ownerCompanyId);
    }
    
    // Add other accepted partners
    if (otherAccepted) {
      otherAccepted.forEach((g) => companyIds.add(g.entreprise_id));
    }

    if (companyIds.size === 0) {
      console.log("No partners (owner or accepted guests) to add to network.");
      return;
    }

    // Create bidirectional reseau_entreprises rows
    const upsertRows: Array<{
      entreprise_origine_id: string;
      entreprise_cible_id: string;
      statut: string;
    }> = [];

    for (const otherCompanyId of companyIds) {
      // Direction A → B
      upsertRows.push({
        entreprise_origine_id: acceptingCompanyId,
        entreprise_cible_id: otherCompanyId,
        statut: "actif",
      });
      // Direction B → A
      upsertRows.push({
        entreprise_origine_id: otherCompanyId,
        entreprise_cible_id: acceptingCompanyId,
        statut: "actif",
      });
    }

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await adminClient
        .from("reseau_entreprises")
        .upsert(upsertRows, {
          onConflict: "entreprise_origine_id,entreprise_cible_id",
          ignoreDuplicates: true,
        });

      if (upsertErr) {
        console.error("Error upserting network relationships:", upsertErr);
      } else {
        console.log(`Added ${upsertRows.length} network relationships for tender ${tenderId}`);
      }
    }
  } catch (err) {
    // Non-blocking: network auto-add should not break the acceptance flow
    console.error("autoAddToNetwork error:", err);
  }
}
