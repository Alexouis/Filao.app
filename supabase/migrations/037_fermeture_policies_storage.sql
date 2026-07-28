-- =============================================
-- FILAO: Migration 037 — Fermeture des policies Storage en écriture
-- =============================================
--
-- CONTEXTE (bug B4)
-- Sept policies régissaient le bucket `documents`. Trois problèmes :
--
-- 1. Les trois policies « guest » sont en `{public}` — donc `anon` compris — et
--    leur condition ne référence jamais l'appelant :
--
--      EXISTS (SELECT 1 FROM invitations
--               WHERE invitations.email = (storage.foldername(objects.name))[1])
--
--    Elle vérifie qu'il existe *une* invitation portant l'e-mail du dossier
--    visé, pas que l'appelant est cette personne. Un inconnu muni de la clé
--    publique pouvait donc déposer un fichier dans le dossier de n'importe quel
--    invité, et la policy UPDATE jumelle lui permettait de l'écraser.
--
-- 2. Les policies `{authenticated}` en INSERT et UPDATE ne testent que
--    `bucket_id = 'documents'` : tout compte pouvait écraser le fichier de
--    n'importe quelle autre entreprise.
--
-- 3. La policy DELETE attend un dossier nommé d'après `auth.uid()`, alors que
--    les chemins réellement produits sont `{email}/`, `documents/{id}/`,
--    `tenders/…` ou `logos/`. Elle n'est donc jamais vraie : personne ne peut
--    supprimer ses propres fichiers.
--
-- PRÉREQUIS — à ne PAS jouer avant :
--   * l'edge function `upload-document` est déployée ;
--   * le front est déployé et tous ses dépôts passent par elle ;
--   * la recette des onze points de dépôt est concluante.
--
-- Sans cela, cette migration casse tous les envois de fichiers. L'edge function
-- écrit avec la clé de service, qui contourne la RLS : elle n'est pas affectée.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------
-- 1. Suppression des accès anonymes
-- ---------------------------------------------------------------
-- Les invités passent désormais par `upload-document`, qui exige le jeton
-- d'invitation ou le code d'accès et vérifie l'identité côté serveur.

DROP POLICY IF EXISTS "Allow guest upload if invited"  ON storage.objects;
DROP POLICY IF EXISTS "Allow guest update if invited"  ON storage.objects;

-- ⚠️ La lecture invité est conservée pour l'instant : le bucket étant PUBLIC,
--    la supprimer ne protégerait rien (les objets restent téléchargeables par
--    URL directe) mais casserait l'espace partenaire. Elle disparaîtra avec le
--    passage du bucket en privé — voir la note finale.
-- DROP POLICY IF EXISTS "Allow guest read if invited" ON storage.objects;

-- ---------------------------------------------------------------
-- 2. Suppression de l'écriture directe par les comptes
-- ---------------------------------------------------------------
-- Plus aucun `storage.upload()` ne subsiste dans le front : tout passe par
-- l'edge function. Laisser ces policies rendrait la validation contournable
-- par une simple requête depuis la console du navigateur.

DROP POLICY IF EXISTS "Allow authenticated uploads to documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to documents" ON storage.objects;

-- ---------------------------------------------------------------
-- 3. Suppression : une policy qui fonctionne enfin
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Allow users to delete their own documents" ON storage.objects;

CREATE POLICY "Suppression de ses propres documents"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    -- Dossier personnel. Comparaison en minuscules : les e-mails sont stockés
    -- tels que saisis dans `utilisateurs`, alors que le JWT les normalise.
    lower((storage.foldername(name))[1]) = lower(auth.jwt() ->> 'email')

    -- Coffre-fort de son entreprise : documents/{entreprise_id}/…
    OR (
      (storage.foldername(name))[1] = 'documents'
      AND (storage.foldername(name))[2] = (
        SELECT entreprise_id::text FROM utilisateurs WHERE id = auth.uid()
      )
    )

    -- Pièces d'un AO dont on est le créateur : tenders/dce/{tender_id}/…
    OR (
      (storage.foldername(name))[1] = 'tenders'
      AND (storage.foldername(name))[2] = 'dce'
      AND (storage.foldername(name))[3] IN (
        SELECT id::text FROM reponses_ao WHERE createur_id = auth.uid()
      )
    )

    -- Dépôt temporaire d'avant création : tenders/temp/{user_id}/…
    OR (
      (storage.foldername(name))[1] = 'tenders'
      AND (storage.foldername(name))[2] = 'temp'
      AND (storage.foldername(name))[3] = auth.uid()::text
    )
  )
);

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' order by cmd, policyname;
--
-- Attendu : plus aucune policy INSERT ni UPDATE, plus aucune policy `{public}`
-- en écriture. Restent la lecture `{authenticated}`, la lecture invité, et la
-- suppression ci-dessus.
--
-- Test de non-contournement, depuis la console du navigateur avec un compte
-- connecté — doit désormais échouer :
--   await supabase.storage.from('documents')
--     .upload('victime@exemple.fr/test.txt', new Blob(['x']));

-- ---------------------------------------------------------------
-- 5. Ce qui reste ouvert
-- ---------------------------------------------------------------
-- (a) LECTURE. `Allow authenticated to read documents` ne teste que
--     `bucket_id = 'documents'` : tout compte lit tous les documents de toutes
--     les entreprises — Kbis, attestations fiscales et URSSAF, RIB. La
--     restreindre n'aurait aujourd'hui aucun effet, le bucket étant public :
--     les objets sont de toute façon téléchargeables par URL directe.
--
--     Le correctif est indissociable : passer `documents` en privé, remplacer
--     les `getPublicUrl()` par des URL signées, puis resserrer la lecture. Cela
--     touche tous les écrans affichant un document ou un logo.
--
--     Piste : déplacer logos et photos de profil — seuls éléments réellement
--     publics — dans un bucket dédié, et rendre `documents` privé.
--
-- (b) La suppression des logos n'est volontairement autorisée à personne : le
--     dossier `logos/` n'est pas nominatif, aucune condition ne permet d'y
--     distinguer le propriétaire. Le remplacement se fait par écrasement
--     (upsert) via l'edge function, ce qui couvre l'usage courant.

-- Retour arrière (restaure l'état permissif d'origine) :
--   CREATE POLICY "Allow authenticated uploads to documents"
--     ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'documents');
--   CREATE POLICY "Allow authenticated updates to documents"
--     ON storage.objects FOR UPDATE TO authenticated
--     USING (bucket_id = 'documents');