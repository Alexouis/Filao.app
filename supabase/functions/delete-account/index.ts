import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * delete-account Edge Function
 *
 * CORRECTIF — le contrôle de blocage ne correspondait pas à son message.
 *
 * Ancienne condition : bloquer si l'entreprise de l'utilisateur participe à AU
 * MOINS UN groupement au statut « accepte », quel que soit son RÔLE.
 *
 * Le message affiché disait pourtant « Votre entreprise est le seul membre
 * actif d'un ou plusieurs groupements » — ce que le code ne vérifiait à aucun
 * moment. Résultat : un simple co-traitant ou sous-traitant était bloqué, alors
 * que son départ n'orpheline rien du tout : le mandataire reste aux commandes et
 * peut le retirer du groupement.
 *
 * NOUVELLE RÈGLE
 * Seul cas réellement bloquant : l'utilisateur est le DERNIER membre d'une
 * entreprise MANDATAIRE d'un dossier auquel d'autres entreprises participent.
 * Supprimer son compte laisserait alors ces cotraitants devant un dossier que
 * plus personne ne peut piloter.
 *
 * Ne bloquent donc PAS :
 *   - être co-traitant ou sous-traitant, quel que soit le nombre de dossiers ;
 *   - être mandataire d'un dossier où l'on est seul (personne n'est lésé) ;
 *   - avoir des collègues dans l'entreprise (ils prennent le relais).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reponse = (corps: unknown) =>
  new Response(JSON.stringify(corps), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return reponse({ success: false, error: 'Non autorisé' });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return reponse({ success: false, error: 'Non autorisé' });
    }

    const userId = user.id;

    let reason: string | null = null;
    try {
      const body = await req.json();
      reason = body?.reason ?? null;
    } catch (_) { /* corps vide */ }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Profil — absent n'est pas bloquant.
    const { data: userProfile } = await adminClient
      .from('utilisateurs')
      .select('entreprise_id')
      .eq('id', userId)
      .maybeSingle();

    const entrepriseId = userProfile?.entreprise_id ?? null;

    // 2. Contrôle de blocage.
    if (entrepriseId) {
      // Des collègues restent dans l'entreprise ? Ils gardent la main sur les
      // dossiers portés : rien à bloquer.
      const { count: autresMembres } = await adminClient
        .from('utilisateurs')
        .select('id', { count: 'exact', head: true })
        .eq('entreprise_id', entrepriseId)
        .neq('id', userId);

      if ((autresMembres ?? 0) === 0) {
        // Dossiers dont CET utilisateur est le porteur (mandataire).
        // C'est `reponses_ao.createur_id` qui fait foi : le mandataire n'a pas
        // nécessairement de ligne dans `groupements`, cette table listant les
        // partenaires invités. L'ancien contrôle, qui ne regardait que
        // `groupements`, ne voyait donc jamais le mandataire — et comptait à la
        // place la ligne du co-traitant, d'où le blocage à tort.
        const { data: dossiersPortes } = await adminClient
          .from('reponses_ao')
          .select('id, titre, statut')
          .eq('createur_id', userId);

        const bloquants: string[] = [];

        for (const dossier of dossiersPortes ?? []) {
          // Un dossier clos ne lèse personne : la réponse est jouée.
          // « Expiré » n'est volontairement pas listé : ce statut est calculé
          // depuis `date_limite` et n'est jamais stocké en base.
          if (['Gagné', 'Perdu'].includes(dossier.statut)) continue;

          // D'autres entreprises participent-elles à ce dossier ?
          const { count: partenaires } = await adminClient
            .from('groupements')
            .select('id', { count: 'exact', head: true })
            .eq('projet_id', dossier.id)
            .eq('statut', 'accepte')
            .neq('entreprise_id', entrepriseId);

          if ((partenaires ?? 0) > 0) {
            bloquants.push(dossier.titre || `Dossier ${dossier.id}`);
          }
        }

        if (bloquants.length > 0) {
          return reponse({
            success: false,
            error: 'blocking_groupements',
            message:
              bloquants.length === 1
                ? "Vous êtes mandataire d'un dossier auquel d'autres entreprises participent. Transmettez le rôle de mandataire ou clôturez ce dossier avant de supprimer votre compte."
                : "Vous êtes mandataire de plusieurs dossiers auxquels d'autres entreprises participent. Transmettez le rôle de mandataire ou clôturez ces dossiers avant de supprimer votre compte.",
            aos: bloquants,
          });
        }
      }
    }

    // 3. Fichiers personnels.
    //
    //    À purger AVANT l'anonymisation : le préfixe `{email}/` est construit à
    //    partir de l'adresse, que l'anonymisation remplace. Faire l'inverse
    //    rendrait ces fichiers introuvables — orphelins et indétectables.
    //
    //    Ne sont retirés que les chemins PERSONNELS. Le coffre-fort
    //    (`documents/{entreprise_id}/`) et les pièces de marché
    //    (`tenders/dce/{tender_id}/`) restent : ils appartiennent à l'entreprise
    //    ou sont partagés avec les cotraitants, dont les dossiers peuvent être
    //    encore en cours.
    const emailUtilisateur = (user.email ?? '').toLowerCase().trim();
    const prefixesPersonnels = [
      emailUtilisateur,                    // pièces personnelles et dépôts
      `documents/${userId}`,               // pièces rattachées au compte
      `tenders/temp/${userId}`,            // dépôts avant création d'un dossier
    ].filter(Boolean);

    for (const prefixe of prefixesPersonnels) {
      try {
        const { data: objets } = await adminClient.storage.from('documents').list(prefixe);
        const chemins = (objets ?? []).map((o) => `${prefixe}/${o.name}`);
        // Par lots : l'API refuse les listes trop longues.
        for (let i = 0; i < chemins.length; i += 100) {
          await adminClient.storage.from('documents').remove(chemins.slice(i, i + 100));
        }
      } catch (err) {
        // Best-effort : un échec de purge ne doit pas empêcher la suppression du
        // compte, sous peine de bloquer l'exercice du droit à l'effacement.
        console.error('Purge du stockage personnel échouée', prefixe, err);
      }
    }

    // Photo de profil, dans le bucket public.
    if (emailUtilisateur) {
      try {
        const { data: photos } = await adminClient.storage
          .from('public-assets').list(`photos/${emailUtilisateur}`);
        const chemins = (photos ?? []).map((o) => `photos/${emailUtilisateur}/${o.name}`);
        if (chemins.length > 0) {
          await adminClient.storage.from('public-assets').remove(chemins);
        }
      } catch (err) {
        console.error('Purge de la photo de profil échouée', err);
      }
    }

    // 4. Clé de reprise : produite quand le DERNIER membre actif s'en va.
    //
    // L'entreprise n'est pas supprimée (`groupements.entreprise_id` est en
    // CASCADE : l'effacer retirerait sa ligne des groupements d'autres
    // entreprises). Elle devient orpheline, et cette clé est le seul moyen sûr
    // d'en reprendre la main — le SIRET, lui, est public et ne prouve rien.
    //
    // Elle n'est lisible qu'ici : la base n'en garde que l'empreinte.
    let cleReprise: string | null = null;
    if (entrepriseId) {
      const { count: autresMembresActifs } = await adminClient
        .from('utilisateurs')
        .select('id', { count: 'exact', head: true })
        .eq('entreprise_id', entrepriseId)
        .neq('id', userId)
        .is('compte_supprime_le', null);

      if ((autresMembresActifs ?? 0) === 0) {
        const { data, error } = await adminClient.rpc('generer_cle_reprise', {
          p_entreprise: entrepriseId,
        });
        if (error) console.error('Génération de la clé de reprise échouée', error);
        else cleReprise = data as string | null;
      }
    }

    // 5. Profil : anonymisation plutôt que suppression quand l'utilisateur
    //    porte des dossiers.    //
    //    `reponses_ao.createur_id` référence `utilisateurs`. Supprimer la ligne
    //    emporterait les dossiers — et le travail des cotraitants avec eux. La
    //    migration 083 interdit d'ailleurs désormais cette suppression au niveau
    //    de la base.
    //
    //    L'anonymisation satisfait le droit à l'effacement (art. 17) : les
    //    données personnelles disparaissent, seule subsiste une référence vide
    //    qui maintient l'intégrité des dossiers — que la réglementation des
    //    marchés publics impose par ailleurs de conserver.
    if (userProfile) {
      const { count: dossiersPortesTotal } = await adminClient
        .from('reponses_ao')
        .select('id', { count: 'exact', head: true })
        .eq('createur_id', userId);

      if ((dossiersPortesTotal ?? 0) > 0) {
        const { error: anonymiseError } = await adminClient
          .from('utilisateurs')
          .update({
            prenom: 'Compte',
            nom: 'supprimé',
            email: `supprime+${userId}@filao.invalid`,
            telephone: null,
            photo_url: null,
            date_naissance: null,
            notification_preferences: null,
            compte_supprime_le: new Date().toISOString(),
          })
          .eq('id', userId);

        if (anonymiseError) {
          console.error('Error anonymizing profile:', anonymiseError);
          return reponse({ success: false, error: "Erreur lors de l'anonymisation du profil" });
        }
      } else {
        // Aucun dossier porté : la suppression pure ne casse rien.
        const { error: deleteProfileError } = await adminClient
          .from('utilisateurs')
          .delete()
          .eq('id', userId);

        if (deleteProfileError) {
          console.error('Error deleting profile:', deleteProfileError);
          return reponse({ success: false, error: 'Erreur lors de la suppression du profil' });
        }
      }
    }

    // 6. Suppression du compte d'authentification.
    const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteAuthError) {
      console.error('Error deleting auth user:', deleteAuthError);
      return reponse({ success: false, error: 'Erreur lors de la suppression du compte auth' });
    }

    if (reason) {
      console.log(`Account deleted — userId: ${userId}, reason: ${reason}`);
    }

    // La clé est remise UNE SEULE FOIS : elle n'est plus lisible ensuite.
    return reponse({ success: true, cleReprise });
  } catch (err) {
    console.error('Unexpected error:', err);
    return reponse({ success: false, error: 'Erreur interne du serveur' });
  }
});
