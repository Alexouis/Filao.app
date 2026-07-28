-- =============================================
-- FILAO: Migration 039b — Bucket `documents` en privé
-- =============================================
--
-- C'est l'étape qui ferme la fuite de confidentialité identifiée pendant le
-- traitement du bug B4.
--
-- ÉTAT DE DÉPART
-- `documents` était PUBLIC : tout objet y était téléchargeable par simple URL,
-- sans authentification. Les chemins sont prévisibles — ils contiennent
-- l'adresse e-mail du déposant — et le contenu comprend Kbis, attestations
-- fiscales et URSSAF, RIB et mémoires techniques.
--
-- S'y ajoutait une policy de lecture ne testant que `bucket_id = 'documents'` :
-- tout compte authentifié pouvait lire les documents de toutes les entreprises.
--
-- PRÉREQUIS — à ne PAS jouer avant :
--   * migration 038 jouée (bucket `public-assets` créé) ;
--   * logos et photos servis depuis `public-assets` ;
--   * migration 039a jouée (URL converties en chemins) ;
--   * front déployé : plus aucun `getPublicUrl` sur `documents`.
--
-- Vérification préalable — doit renvoyer 0 :
--   select count(*) from utilisateurs
--    where kbis_url like 'http%' or attestation_assurance_url like 'http%'
--       or attestation_honneur_url like 'http%' or presentation_societe_url like 'http%';

SET lock_timeout = '5s';

-- ---------------------------------------------------------------
-- 1. Passage en privé
-- ---------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- ---------------------------------------------------------------
-- 2. Lecture restreinte
-- ---------------------------------------------------------------
-- Jusqu'ici : `USING (bucket_id = 'documents')`, soit tout, pour tout compte.
-- Désormais, l'accès suit le chemin, dont la forme dit à qui appartient l'objet.

DROP POLICY IF EXISTS "Allow authenticated to read documents" ON storage.objects;

CREATE POLICY "Lecture des documents autorises"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    -- Son propre dossier. Comparaison en minuscules : les e-mails sont stockés
    -- tels que saisis dans `utilisateurs`, le JWT les normalise.
    lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email')

    -- Coffre-fort de son entreprise, ou pièces rattachées à son compte.
    OR (
      (storage.foldername(name))[1] = 'documents'
      AND (storage.foldername(name))[2] IN (
        SELECT entreprise_id::text FROM utilisateurs WHERE id = auth.uid()
        UNION ALL
        SELECT auth.uid()::text
      )
    )

    -- Pièces du marché d'un AO auquel on participe : créateur, ou membre d'un
    -- groupement rattaché. Sans cette branche, un co-traitant ne pourrait plus
    -- consulter le DCE du dossier sur lequel il travaille.
    OR (
      (storage.foldername(name))[1] = 'tenders'
      AND (storage.foldername(name))[2] = 'dce'
      AND (storage.foldername(name))[3] IN (
        SELECT r.id::text FROM reponses_ao r WHERE r.createur_id = auth.uid()
        UNION
        SELECT g.projet_id::text FROM groupements g
         WHERE g.entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
           AND g.statut = 'accepte'
      )
    )

    -- Dépôt temporaire d'avant création du dossier.
    OR (
      (storage.foldername(name))[1] = 'tenders'
      AND (storage.foldername(name))[2] = 'temp'
      AND (storage.foldername(name))[3] = auth.uid()::text
    )

    -- Pièces déposées par un partenaire sur un AO dont on est créateur : le
    -- mandataire doit pouvoir consulter ce que ses co-traitants ont fourni.
    OR EXISTS (
      SELECT 1 FROM invitations i
       WHERE lower(i.email) = lower((storage.foldername(name))[1])
         AND i.tender_id IN (SELECT id FROM reponses_ao WHERE createur_id = auth.uid())
    )
  )
);

-- ---------------------------------------------------------------
-- 3. Lecture invité
-- ---------------------------------------------------------------
-- La policy `Allow guest read if invited` ne référençait pas l'appelant : elle
-- suffisait à un `anon` quelconque dès qu'une invitation portait l'e-mail du
-- dossier visé. Elle n'était conservée jusqu'ici que parce que le bucket public
-- rendait sa suppression sans effet.
--
-- L'espace partenaire passe désormais par `createSignedUrl`, appelé depuis un
-- contexte authentifié par jeton ou code d'accès.

DROP POLICY IF EXISTS "Allow guest read if invited" ON storage.objects;

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select id, public from storage.buckets where id = 'documents';   -- false
--
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' order by cmd, policyname;
--
-- Une URL publique ne doit plus résoudre :
--   https://<ref>.supabase.co/storage/v1/object/public/documents/<chemin>
--   → attendu : 400 « Object not found »
--
-- ⚠️ Si l'espace partenaire cesse de fonctionner, c'est la section 3 : le
--    parcours invité s'appuyait peut-être encore sur cette policy. Rétablir
--    temporairement avec :
--      CREATE POLICY "Allow guest read if invited" ON storage.objects
--        FOR SELECT TO public
--        USING (bucket_id = 'documents' AND EXISTS (
--          SELECT 1 FROM invitations WHERE invitations.email = (storage.foldername(objects.name))[1]));
--    puis router la lecture invité par une fonction SECURITY DEFINER.

-- Retour arrière complet :
--   UPDATE storage.buckets SET public = true WHERE id = 'documents';
--   CREATE POLICY "Allow authenticated to read documents" ON storage.objects
--     FOR SELECT TO authenticated USING (bucket_id = 'documents');