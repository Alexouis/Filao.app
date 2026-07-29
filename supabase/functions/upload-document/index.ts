import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifierFichier,
  OCTETS_A_LIRE,
  REGLES,
  type PointDepot,
} from "./fileValidation.ts";

/**
 * Point d'entrée unique des dépôts de fichiers (bug B4).
 *
 * POURQUOI PASSER PAR ICI
 * Les onze appels `supabase.storage.upload()` du front écrivaient directement
 * dans le bucket. Or :
 *
 *  - l'attribut HTML `accept` ne filtre que la boîte de dialogue du navigateur
 *    et disparaît au glisser-déposer ;
 *  - `allowed_mime_types` sur le bucket ne compare que le Content-Type déclaré
 *    par le client, donc falsifiable ;
 *  - une policy Storage voit le chemin et le bucket, jamais le contenu.
 *
 * Seul un composant serveur peut lire les premiers octets et décider. Il écrit
 * ensuite avec la clé de service, ce qui permettra de retirer au client tout
 * droit d'écriture directe.
 *
 * IDENTITÉ
 * Deux appelants légitimes :
 *  - un utilisateur authentifié, identifié par son JWT ;
 *  - un partenaire non inscrit, identifié par le jeton de son invitation ou par
 *    le couple e-mail + code d'accès.
 *
 * Le chemin de destination n'est jamais accepté tel quel : il est confronté aux
 * préfixes autorisés pour l'identité résolue. Sans cela, un appelant légitime
 * pourrait écrire dans le dossier d'un autre.
 */

/**
 * ⚠️ Cette fonction doit être déployée avec `--no-verify-jwt`.
 *
 * Avec la vérification de jeton de la passerelle, la requête `OPTIONS` du
 * préflight CORS est rejetée avant d'atteindre ce code : un préflight ne porte
 * jamais d'en-tête `Authorization`. Le navigateur signale alors
 * « Response to preflight request doesn't pass access control check ».
 *
 * Ce n'est pas un affaiblissement : la fonction vérifie elle-même l'identité de
 * l'appelant — JWT utilisateur, jeton d'invitation ou code d'accès — et répond
 * 401 sans identité résolue. La passerelle, elle, ne saurait pas valider un
 * invité sans compte.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Évite un préflight à chaque envoi de fichier.
  "Access-Control-Max-Age": "86400",
};

const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Identité résolue de l'appelant. */
interface Identite {
  email: string;
  userId: string | null;
  entrepriseId: string | null;
  /** Un invité n'a pas de compte : ses droits sont plus étroits. */
  invite: boolean;
}

/**
 * Neutralise le nom de fichier : séparateurs, séquences de remontée et
 * caractères de contrôle. Un nom comme `../../logos/logo.png` doit devenir
 * inoffensif avant toute concaténation.
 */
const nettoyerNom = (nom: string): string => {
  const base = nom.split(/[/\\]/).pop() ?? "fichier";
  const propre = base
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .trim();

  if (!propre) return "fichier";
  if (propre.length <= 120) return propre;

  // Tronquer bêtement ferait disparaître l'extension d'un nom très long, et le
  // fichier ne s'ouvrirait plus côté utilisateur.
  const point = propre.lastIndexOf(".");
  const extension = point > 0 && propre.length - point <= 12 ? propre.slice(point) : "";
  return propre.slice(0, 120 - extension.length) + extension;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    if (!serviceKey || !url) return json({ error: "Configuration serveur incomplète" }, 500);

    const admin = createClient(url, serviceKey);

    const formulaire = await req.formData();
    const fichier = formulaire.get("file");
    const point = String(formulaire.get("point") ?? "") as PointDepot;
    const dossierDemande = String(formulaire.get("dossier") ?? "");
    // Nom imposé par l'appelant. Permet d'écraser un document existant plutôt
    // que d'en empiler un nouveau à chaque envoi : sans nom stable, `upsert`
    // n'a rien à remplacer.
    const nomImpose = String(formulaire.get("nom") ?? "");
    const jeton = String(formulaire.get("token") ?? "");
    const tenderId = String(formulaire.get("tenderId") ?? "");
    const emailInvite = String(formulaire.get("email") ?? "");
    const codeAcces = String(formulaire.get("accessCode") ?? "");

    if (!(fichier instanceof File)) return json({ error: "Aucun fichier transmis" }, 400);
    if (!REGLES[point]) return json({ error: `Point de dépôt inconnu : « ${point} »` }, 400);

    // --- 1. Identité ---------------------------------------------------
    let identite: Identite | null = null;

    const enTete = req.headers.get("Authorization") ?? "";
    if (enTete.startsWith("Bearer ")) {
      const { data } = await admin.auth.getUser(enTete.slice(7));
      if (data?.user?.email) {
        const { data: profil } = await admin
          .from("utilisateurs")
          .select("entreprise_id")
          .ilike("email", data.user.email)
          .maybeSingle();
        identite = {
          email: data.user.email.toLowerCase(),
          userId: data.user.id,
          entrepriseId: profil?.entreprise_id ?? null,
          invite: false,
        };
      }
    }

    if (!identite && (jeton || (tenderId && emailInvite && codeAcces))) {
      // Le secret est exigé côté serveur : la policy « guest upload » ne
      // vérifiait que l'existence d'une invitation portant l'e-mail du dossier
      // visé, sans jamais confronter cela à l'appelant.
      // Résolution par empreinte : la base ne stocke plus le jeton en clair.
      let invitation: { email?: string } | null = null;

      if (jeton) {
        const { data } = await admin.rpc("resoudre_invitation_par_jeton", { p_token: jeton });
        invitation = data?.[0] ?? null;
      } else {
        const { data } = await admin.from("invitations")
          .select("email, tender_id")
          .eq("tender_id", tenderId)
          .ilike("email", emailInvite.trim())
          .ilike("access_code", codeAcces.trim())
          .limit(1).maybeSingle();
        invitation = data;
      }
      if (invitation?.email) {
        identite = { email: String(invitation.email).toLowerCase(), userId: null, entrepriseId: null, invite: true };
      }
    }

    if (!identite) return json({ error: "Accès refusé : identité non vérifiée." }, 401);

    // --- 2. Destination ------------------------------------------------
    // Les préfixes autorisés découlent de l'identité, jamais de la demande.
    // Ils reprennent les conventions réellement produites par le front :
    //   {email}/                      pièces personnelles et dépôts d'invités
    //   documents/{entreprise_id}/    coffre-fort d'entreprise
    //   documents/{user_id}/          pièces rattachées à un utilisateur
    //   tenders/temp/{user_id}/       dépôt avant création du dossier
    //   tenders/dce/{tender_id}/      pièces du marché — accès vérifié plus bas
    //   logos/                        logos et photos, point de dépôt « logo »
    // Les logos et photos vont dans `public-assets` : eux seuls sont
    // légitimement publics, et les en séparer permet de rendre `documents`
    // privé sans casser leur affichage.
    const bucket = point === 'logo' ? 'public-assets' : 'documents';

    if (bucket === 'public-assets') {
      // Chemins nominatifs, sans quoi aucune policy ne peut distinguer un
      // propriétaire au moment de la suppression.
      if (identite.invite) return json({ error: "Dépôt non autorisé." }, 403);
      const prefixesAssets = [`photos/${identite.email}/`];
      if (identite.entrepriseId) prefixesAssets.push(`logos/${identite.entrepriseId}/`);

      const dossierAsset = dossierDemande.replace(/^\/+|\/+$/g, "");
      const cibleAsset = `${dossierAsset}/`;
      if (!prefixesAssets.some((p) => cibleAsset.startsWith(p)) || cibleAsset.includes("..")) {
        return json({
          error: "Destination non autorisée.",
          detail: `Emplacements permis : ${prefixesAssets.join(", ")}`,
        }, 403);
      }

      const debutAsset = new Uint8Array(await fichier.slice(0, OCTETS_A_LIRE).arrayBuffer());
      const verdictAsset = verifierFichier(debutAsset, fichier.size, point);
      if (!verdictAsset.accepte) {
        // La taille vue par le serveur est remontée : si elle vaut 0 alors que
        // le fichier ne l'est pas, le problème est dans la transmission
        // multipart, pas dans le fichier lui-même.
        return json({
          error: verdictAsset.motif, typeDetecte: verdictAsset.type,
          tailleRecue: fichier.size, nomRecu: fichier.name,
        }, 422);
      }

      // Nom canonique : un utilisateur n'a qu'un avatar, une entreprise qu'un
      // logo. Conserver le nom d'origine créait un objet par envoi — l'`upsert`
      // ne pouvant écraser que le même nom, les anciennes images s'accumulaient
      // indéfiniment sans jamais être référencées.
      const extension = (verdictAsset.type === 'jpeg' ? 'jpg' : verdictAsset.type);
      const nomCanonique = `${cibleAsset.startsWith('logos/') ? 'logo' : 'avatar'}.${extension}`;

      // Purge préalable du dossier : sans elle, un changement de format
      // (png → jpg) laisserait l'ancien fichier derrière lui.
      const { data: existants } = await admin.storage.from('public-assets').list(cibleAsset.slice(0, -1));
      const aSupprimer = (existants ?? [])
        .map((o) => `${cibleAsset}${o.name}`)
        .filter((chemin) => chemin !== `${cibleAsset}${nomCanonique}`);
      if (aSupprimer.length > 0) {
        const { error: errPurge } = await admin.storage.from('public-assets').remove(aSupprimer);
        if (errPurge) console.warn('Purge des anciens assets impossible', errPurge.message);
      }

      const cheminAsset = `${cibleAsset}${nomCanonique}`;
      const { error: errAsset } = await admin.storage
        .from('public-assets')
        .upload(cheminAsset, fichier, {
          // Toujours écraser : le nom étant canonique, un envoi remplace le
          // précédent au lieu de créer un doublon.
          upsert: true,
          contentType: fichier.type || "application/octet-stream",
          cacheControl: "3600",
        });
      if (errAsset) {
        console.error("upload-document (assets):", errAsset);
        return json({ error: "Le dépôt a échoué.", detail: errAsset.message }, 500);
      }
      // Le nom étant canonique, l'URL ne change plus d'un envoi à l'autre : le
      // navigateur et le CDN continueraient de servir l'image précédente
      // pendant toute la durée de `cacheControl`. On renvoie donc une URL
      // versionnée, que l'appelant stocke telle quelle.
      const { data: pub } = admin.storage.from('public-assets').getPublicUrl(cheminAsset);
      const urlPublique = `${pub.publicUrl}?v=${Date.now()}`;

      return json({
        ok: true, chemin: cheminAsset, bucket, urlPublique,
        type: verdictAsset.type, taille: fichier.size,
      });
    }

    const prefixesAutorises = [`${identite.email}/`];
    if (!identite.invite) {
      if (identite.entrepriseId) prefixesAutorises.push(`documents/${identite.entrepriseId}/`);
      if (identite.userId) {
        prefixesAutorises.push(`documents/${identite.userId}/`);
        prefixesAutorises.push(`tenders/temp/${identite.userId}/`);
      }

    }

    const dossier = dossierDemande.replace(/^\/+|\/+$/g, "");
    const cible = dossier ? `${dossier}/` : `${identite.email}/`;

    // `tenders/dce/{tender_id}/` n'est pas nominatif : l'appartenance ne se lit
    // pas dans le chemin, il faut la vérifier en base.
    const dce = cible.match(/^tenders\/dce\/([0-9a-f-]{36})\//i);
    if (dce && !identite.invite) {
      const tid = dce[1];
      const { data: autorise } = await admin
        .from("reponses_ao")
        .select("id")
        .eq("id", tid)
        .or(`createur_id.eq.${identite.userId}`)
        .maybeSingle();

      let membre = Boolean(autorise);
      if (!membre && identite.entrepriseId) {
        const { data: g } = await admin
          .from("groupements")
          .select("id")
          .eq("projet_id", tid)
          .eq("entreprise_id", identite.entrepriseId)
          .maybeSingle();
        membre = Boolean(g);
      }
      if (membre) prefixesAutorises.push(cible);
    }

    if (!prefixesAutorises.some((p) => cible.startsWith(p)) || cible.includes("..")) {
      return json({
        error: "Destination non autorisée.",
        detail: `Emplacements permis : ${prefixesAutorises.join(", ")}`,
      }, 403);
    }

    // --- 3. Contenu ----------------------------------------------------
    const debut = new Uint8Array(await fichier.slice(0, OCTETS_A_LIRE).arrayBuffer());
    const verdict = verifierFichier(debut, fichier.size, point);
    if (!verdict.accepte) {
      // 422 plutôt que 400 : la requête est bien formée, c'est son contenu qui
      // est refusé — la distinction aide au diagnostic côté client.
      return json({ error: verdict.motif, typeDetecte: verdict.type }, 422);
    }

    // --- 4. Écriture ---------------------------------------------------
    // Le nom imposé passe par le même nettoyage : il vient du client, il n'est
    // pas plus digne de confiance que le nom d'origine du fichier.
    const chemin = `${cible}${nettoyerNom(nomImpose || fichier.name)}`;
    const { error: erreurDepot } = await admin.storage
      .from("documents")
      .upload(chemin, fichier, {
        upsert: String(formulaire.get("upsert") ?? "") === "true",
        // Le type est celui déduit du contenu, jamais celui annoncé par le client.
        contentType: fichier.type || "application/octet-stream",
        cacheControl: "3600",
      });

    if (erreurDepot) {
      console.error("upload-document:", erreurDepot);
      return json({ error: "Le dépôt a échoué.", detail: erreurDepot.message }, 500);
    }

    return json({ ok: true, chemin, bucket, type: verdict.type, taille: fichier.size });
  } catch (erreur) {
    console.error("upload-document:", erreur);
    return json({ error: "Erreur interne", detail: String(erreur) }, 500);
  }
});