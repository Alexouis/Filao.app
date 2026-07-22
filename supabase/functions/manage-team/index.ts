import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', // Use SERVICE ROLE KEY to bypass RLS
    )

    // Authenticate the user calling the function (using the user's token)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) throw new Error('Non autorisé')

    const { action, tenderId, upsertGroupements, upsertInvitations, insertInvitations, deletions, invitationDeletions } = await req.json()
    console.log(`[Edge] Received manage-team request for tender: ${tenderId}`)
    console.log(`[Edge] Payloads - groupements: ${upsertGroupements?.length || 0}, invitations: ${upsertInvitations?.length || 0}`)

    if (!tenderId) throw new Error('ID Tender manquant.')

    // 1. Verify user is owner (creator) of this tender
    const { data: tender, error: tenderErr } = await supabaseClient
      .from('reponses_ao')
      .select('createur_id')
      .eq('id', tenderId)
      .single()

    if (tenderErr || !tender) throw new Error('Appel d\'offres non trouvé.')
    
    console.log(`Verifying permissions for user ${user.id} on tender ${tenderId} (creator: ${tender.createur_id})`)
    if (tender.createur_id !== user.id) {
      console.error(`Permission denied: User ${user.id} is not creator ${tender.createur_id}`)
      throw new Error('Seul le propriétaire du marché peut modifier l\'équipe.')
    }

    // 2. Perform deletions (Groupements)
    if (deletions && deletions.length > 0) {
      console.log(`Deleting ${deletions.length} groupement records...`)
      await supabaseClient.from('groupements').delete().in('id', deletions)
    }

    // 2b. Perform deletions (Invitations)
    if (invitationDeletions && invitationDeletions.length > 0) {
      console.log(`Deleting ${invitationDeletions.length} invitation records...`)
      await supabaseClient.from('invitations').delete().eq('tender_id', tenderId).in('email', invitationDeletions)
    }

    // 3. Perform UPSERTs for groupements
    if (upsertGroupements && upsertGroupements.length > 0) {
      console.log(`Upserting ${upsertGroupements.length} groupements...`)
      
      // Clean entries: ensure id is either a valid string or completely removed (omitted) to let DB handle it
      const cleanedUpserts = upsertGroupements.map((g: any) => {
        const entry = { ...g };
        if (!entry.id || (typeof entry.id === 'string' && entry.id.length < 5)) {
          // If the DB default is failing, we generate one here
          entry.id = crypto.randomUUID();
        }
        return entry;
      });
      
      console.log(`[Edge] Executing upsert with cleaned data:`, JSON.stringify(cleanedUpserts))

      const { error: upsertErr } = await supabaseClient
        .from('groupements')
        .upsert(cleanedUpserts, { onConflict: 'projet_id, entreprise_id' })
      if (upsertErr) {
        console.error('Upsert Error details:', JSON.stringify(upsertErr))
        throw upsertErr
      }
    }

    // 3b. Perform UPSERTs for existing invitations (role updates)
    if (upsertInvitations && upsertInvitations.length > 0) {
      console.log(`Updating roles for ${upsertInvitations.length} invitations...`)
      for (const inv of upsertInvitations) {
        // Corrected column name for invitations: role
        const { error: invErr } = await supabaseClient
          .from('invitations')
          .update({ role: inv.role })
          .eq('id', inv.id)
        
        if (invErr) {
          console.error(`Error updating invitation ${inv.id}:`, invErr)
        }
      }
    }

    // 4. Perform MERGE for invitations (handle duplicates)
    let insertedInvs = []
    if (insertInvitations && insertInvitations.length > 0) {
      console.log(`Handling ${insertInvitations.length} invitations...`)
      const { data, error: invErr } = await supabaseClient
        .from('invitations')
        .insert(insertInvitations.map(inv => ({ ...inv, token: inv.token || crypto.randomUUID() })))
        .select('email, role, token')
      if (invErr) {
        console.error('Invitation Error:', invErr)
        throw invErr
      }
      insertedInvs = data || []
    }

    return new Response(JSON.stringify({ 
      success: true, 
      insertedInvitations: insertedInvs 
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('manage-team error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
