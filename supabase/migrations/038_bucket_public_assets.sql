-- =============================================
-- FILAO: Migration 038 — Bucket public dédié aux logos et photos
-- =============================================
--
-- CONTEXTE
-- Le bucket `documents` est public. Tout objet y est téléchargeable par URL
-- directe, sans authentification, et les chemins sont prévisibles : ils sont
-- construits à partir de l'adresse e-mail du déposant et du nom du fichier.
-- Sont concernés les Kbis, attestations fiscales et URSSAF, RIB et mémoires
-- techniques.
--
-- Le rendre privé se heurte à un obstacle : les logos d'entreprise et photos de
-- profil y sont mélangés, et leurs URL publiques sont stockées en base
-- (`entreprises.logo_url`, `utilisateurs.photo_url`). Une URL signée expirant,
-- on ne peut pas la stocker.
--
-- D'où cette séparation par nature :
--
--   public-assets   logos, photos de profil     → URL publiques, inchangées
--   documents       tout le reste               → privé, URL signées (039)
--
-- Cette migration ne fait que CRÉER le nouveau bucket. Le déplacement des
-- fichiers existants et le passage de `documents` en privé viennent ensuite :
-- rendre `documents` privé avant le déplacement ferait disparaître tous les
-- logos affichés.

-- ---------------------------------------------------------------
-- 1. Création du bucket
-- ---------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'public-assets',
    'public-assets',
    true,
    2097152,                                      -- 2 Mo, plafond du point de dépôt « logo »
    ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
   SET public             = EXCLUDED.public,
       file_size_limit    = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------------
-- Lecture ouverte : c'est l'objet même de ce bucket. Un logo s'affiche dans le
-- réseau inter-entreprises et sur des pages non authentifiées.
DROP POLICY IF EXISTS "Lecture publique des assets" ON storage.objects;
CREATE POLICY "Lecture publique des assets"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'public-assets');

-- Écriture réservée à la clé de service, donc à l'edge function `upload-document`
-- qui vérifie le type réel du fichier. Aucune policy INSERT/UPDATE n'est créée :
-- la clé de service contourne la RLS, les clients n'ont aucun droit d'écriture.
--
-- Sans cela, ce bucket reproduirait le défaut corrigé par la migration 037 :
-- une écriture directe non validée, contournant la vérification de signature.

-- Suppression : son propre dossier uniquement.
DROP POLICY IF EXISTS "Suppression de ses propres assets" ON storage.objects;
CREATE POLICY "Suppression de ses propres assets"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'public-assets'
  AND (
    -- Photos de profil : photos/{email}/…
    (
      (storage.foldername(name))[1] = 'photos'
      AND lower((storage.foldername(name))[2]) = lower(auth.jwt() ->> 'email')
    )
    -- Logos : logos/{entreprise_id}/…
    OR (
      (storage.foldername(name))[1] = 'logos'
      AND (storage.foldername(name))[2] = (
        SELECT entreprise_id::text FROM utilisateurs WHERE id = auth.uid()
      )
    )
  )
);

-- ---------------------------------------------------------------
-- 3. Convention de nommage
-- ---------------------------------------------------------------
-- Contrairement au `logos/` plat du bucket `documents`, les chemins sont ici
-- nominatifs — sans quoi aucune policy ne peut distinguer un propriétaire, et
-- n'importe qui pourrait supprimer le logo de n'importe quelle entreprise.
--
--   photos/{email}/{fichier}
--   logos/{entreprise_id}/{fichier}

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select id, public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'public-assets';
--
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'storage' and policyname like '%assets%';
--
-- Étapes suivantes, dans cet ordre impératif :
--   a. déplacer les fichiers existants (edge function `migrate-public-assets`) ;
--   b. mettre à jour logo_url et photo_url en base ;
--   c. migration 039 : passer `documents` en privé et resserrer la lecture.