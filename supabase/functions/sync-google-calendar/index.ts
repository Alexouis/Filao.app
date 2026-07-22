import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // User authentication
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Non autorisé')

    // Read payload
    const payload = await req.json()
    const { action, tender, tenderId } = payload

    // 1. Fetch Google integration
    const { data: integration, error: integrationError } = await supabaseClient
      .from('user_integrations')
      .select('*')
      .eq('user_id', user.id)
      .eq('provider', 'google')
      .maybeSingle()

    if (!integration) {
      console.error('Integration not found for user:', user.id)
      throw new Error('Intégration Google non trouvée. Connectez-vous d\'abord.')
    }

    let accessToken = integration.access_token

    // 2. Refresh token if expired
    const isExpired = !integration.expires_at || new Date(integration.expires_at) < new Date(Date.now() + 5 * 60000)
    console.log(`Action: ${action}, isExpired: ${isExpired}`)
    
    if (isExpired && integration.refresh_token) {
       console.log('Refreshing Google access token...')
       const response = await fetch('https://oauth2.googleapis.com/token', {
         method: 'POST',
         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
         body: new URLSearchParams({
           client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
           client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
           refresh_token: integration.refresh_token,
           grant_type: 'refresh_token'
         })
       })
       
       if (!response.ok) {
         const errorData = await response.json();
         console.error('Refresh token error output:', errorData);
         throw new Error(`Session Google expirée (${errorData.error_description || errorData.error || 'reconnexion requise'}).`);
       }

       const tokens = await response.json()
       accessToken = tokens.access_token
       const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
       console.log('Token refreshed successfully')

       await supabaseClient
         .from('user_integrations')
         .update({ 
            access_token: accessToken,
            expires_at: newExpiresAt
         })
         .eq('id', integration.id)
    }

    // 3. Get Filao Calendar ID
    let calendarId = integration.meta?.calendar_id
    console.log('Using calendarId:', calendarId)

    if (!calendarId) {
       console.log('No calendarId in meta, searching calendar list...')
       const listResp = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
         headers: { Authorization: `Bearer ${accessToken}` }
       })
       if (!listResp.ok) {
         const listErr = await listResp.text()
         console.error('Calendar list fetch failed:', listErr)
         throw new Error('Impossible de charger la liste des calendriers Google.')
       }
       
       const listData = await listResp.json()
       let filaoCal = listData.items?.find((c: any) => c.summary === 'Filao')

       if (!filaoCal) {
         console.log('Filao calendar not found, creating it...')
         const createResp = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
           method: 'POST',
           headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
           body: JSON.stringify({ summary: 'Filao', description: "Échéances de vos Appels d'Offres Filao" })
         })
         if (!createResp.ok) {
           const createErr = await createResp.text()
           console.error('Calendar creation failed:', createErr)
           throw new Error('Échec du renommage/création du calendrier Filao.')
         }
         filaoCal = await createResp.json()
       }

       calendarId = filaoCal.id
       console.log('Setting new calendarId:', calendarId)
       await supabaseClient
         .from('user_integrations')
         .update({ meta: { ...integration.meta, calendar_id: calendarId } })
         .eq('id', integration.id)
    }

    // 4. ACTIONS
    
    // ACTION: PUSH TENDER
    if (action === 'push_tender') {
      console.log('Action: push_tender', tender?.id)
      if (!tender?.id || !tender?.date_limite || !tender?.titre) {
        throw new Error(`Données AO incomplètes: ${JSON.stringify({ id: !!tender?.id, date: !!tender?.date_limite, titre: !!tender?.titre })}`)
      }

      // Search for existing event
      const searchResp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?privateExtendedProperty=filao_tender_id=${tender.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const searchData = await searchResp.json()
      const existingEvent = searchData.items?.[0]

      const eventBody = {
        summary: `AO: ${tender.titre}`,
        description: `Organisme: ${tender.organisme_acheteur || 'N/C'}\nLien: https://app.filao.io/?id=${tender.id}`,
        start: { dateTime: new Date(tender.date_limite).toISOString() },
        end: { dateTime: new Date(new Date(tender.date_limite).getTime() + 3600000).toISOString() },
        extendedProperties: { private: { filao_tender_id: tender.id } }
      }

      const res = await fetch(
        existingEvent 
          ? `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${existingEvent.id}` 
          : `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, 
        {
          method: existingEvent ? 'PUT' : 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody)
        }
      )

      if (!res.ok) {
          const resError = await res.json();
          console.error('Google Push Error:', resError);
          throw new Error(`Échec de l'envoi vers Google Calendar: ${resError.error?.message || res.statusText}`);
      }
      
      return new Response(JSON.stringify({ success: true, eventId: existingEvent?.id || 'new' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ACTION: DELETE TENDER
    if (action === 'delete_tender') {
      const idToDelete = tenderId || tender?.id;
      console.log('Action: delete_tender', idToDelete)
      if (!idToDelete) throw new Error('ID Tender manquant.')

      const searchResp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?privateExtendedProperty=filao_tender_id=${idToDelete}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const searchData = await searchResp.json()
      const events = searchData.items || []

      for (const event of events) {
          await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${event.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` }
          })
      }

      return new Response(JSON.stringify({ success: true, deletedCount: events.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ACTION: PULL EVENTS
    if (action === 'pull_events') {
      console.log('Action: pull_events')
      const now = new Date().toISOString()
      const fetchResp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${now}&singleEvents=true&orderBy=startTime`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!fetchResp.ok) {
        const fetchErr = await fetchResp.text()
        console.error('Pull events failed:', fetchErr)
        throw new Error('Impossible de récupérer les événements Google.')
      }
      
      const eventsData = await fetchResp.json()
      return new Response(JSON.stringify({ success: true, events: eventsData.items || [] }), {
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    throw new Error('Action invalide')

  } catch (err: any) {
    console.error('Sync function error trace:', err);
    let message = err.message;
    if (message.includes('insufficient authentication scopes') || message.includes('scope_insufficient')) {
      message = 'Permissions insuffisantes (Calendrier). Veuillez vous déconnecter et vous reconnecter avec Google dans vos paramètres pour autoriser l\'accès au calendrier.';
    }
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
