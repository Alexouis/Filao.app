-- =============================================
-- FILAO: Migration 107 — Les dépôts des invités comptent dans un forfait
-- =============================================
--
-- PROBLÈME
-- Un partenaire invité SANS compte dépose ses pièces sous
-- `documents/{son e-mail}/`. La 104 rattache ces dossiers personnels à
-- l'entreprise de leur propriétaire, via `utilisateurs` — or un invité n'y a
-- pas de ligne. Ses pièces n'étaient donc comptées nulle part : ni affichées
-- dans la consommation, ni soumises à un quota. Un lien d'invitation valait
-- espace de stockage illimité.
--
-- RÈGLE RETENUE
-- Le dépôt d'un invité est imputé à l'entreprise PORTEUSE du dossier sur
-- lequel il a été fait. C'est elle qui a choisi d'inviter, et c'est elle qui
-- bénéficie des pièces. Le dossier se lit dans le nom même de l'objet, fixé
-- par `nomPieceCollaborateur` : `{type}-{collab}-{id_ao}` — l'identifiant de
-- l'AO en occupe les 36 derniers caractères. Un invité travaillant pour deux
-- porteurs voit donc chaque pièce imputée au bon.
--
-- Dès que l'invité crée un compte, son dossier personnel relève de la clause 2
-- (entreprise du propriétaire) et sort de la clause 3 : pas de double compte.
--
-- Le contrôle AVANT écriture est fait par `upload-document`, qui interroge
-- `stockage_restant_entreprise` — même source que l'affichage.

CREATE OR REPLACE FUNCTION stockage_consomme_entreprise(p_entreprise UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = storage, public, pg_temp
AS $$
  SELECT COALESCE(SUM((o.metadata->>'size')::BIGINT), 0)
    FROM storage.objects o
   WHERE o.bucket_id = 'documents'
     AND (
       -- 1. Coffre-fort de l'entreprise : `documents/{entreprise_id}/…`
       o.name LIKE 'documents/' || p_entreprise::TEXT || '/%'

       -- 2. Pièces de dossier de ses membres : `{email}/…`
       OR EXISTS (
         SELECT 1
           FROM utilisateurs u
          WHERE u.entreprise_id = p_entreprise
            AND u.email IS NOT NULL
            AND lower((storage.foldername(o.name))[1]) = lower(u.email)
       )

       -- 3. Pièces déposées par des invités SANS compte sur les dossiers
       --    qu'elle porte : `{email invité}/{type}-{collab}-{id_ao}`.
       OR (
         (storage.foldername(o.name))[1] LIKE '%@%'
         AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u
            WHERE lower(u.email) = lower((storage.foldername(o.name))[1])
         )
         AND EXISTS (
           SELECT 1 FROM reponses_ao r
            WHERE r.entreprise_id = p_entreprise
              AND r.id::TEXT = lower(right(o.name, 36))
         )
       )
     );
$$;

COMMENT ON FUNCTION stockage_consomme_entreprise(UUID) IS
  'Octets réellement occupés par une entreprise : coffre-fort, pièces de ses membres, et pièces déposées par des invités sans compte sur ses dossiers. Lu depuis storage.objects.';

REVOKE ALL ON FUNCTION stockage_consomme_entreprise(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stockage_consomme_entreprise(UUID) TO authenticated, service_role;

-- `upload-document` appelle le contrôle avec la clé de service : on le rend
-- explicite plutôt que de dépendre des privilèges par défaut du projet.
GRANT EXECUTE ON FUNCTION stockage_restant_entreprise(UUID) TO service_role;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Pièces d'invités désormais comptées, par entreprise porteuse :
--   select r.entreprise_id, count(*), sum((o.metadata->>'size')::bigint)
--     from storage.objects o
--     join reponses_ao r on r.id::text = lower(right(o.name, 36))
--    where o.bucket_id = 'documents'
--      and (storage.foldername(o.name))[1] like '%@%'
--      and not exists (select 1 from utilisateurs u
--                       where lower(u.email) = lower((storage.foldername(o.name))[1]))
--    group by 1;
