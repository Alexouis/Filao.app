-- =============================================
-- FILAO: Migration 120 — Pièces d'un partenaire : seulement celles de SES dossiers
-- =============================================
--
-- PROBLÈME
-- Dernière branche de la policy de lecture (039b, reprise en 096) :
--
--     OR EXISTS (SELECT 1 FROM invitations i
--                 WHERE lower(i.email) = lower(<dossier de fichiers>)
--                   AND i.tender_id IN (dossiers dont je suis créateur))
--
-- Elle ouvre TOUT le dossier de fichiers d'un partenaire dès qu'on l'a invité
-- sur UN dossier. Or les pièces sont rangées par déposant, tous dossiers
-- confondus (`{email}/{type}-{collab}-{id_ao}`) : inviter quelqu'un donnait
-- accès aux pièces qu'il a déposées pour les dossiers d'AUTRES entreprises,
-- potentiellement concurrentes (DC2, attestations, Kbis…), et `list()` en
-- révélait l'inventaire.
--
-- Inversement, un partenaire invité par son ENTREPRISE (ligne de groupement,
-- sans invitation nominative) n'était pas couvert : le porteur ne pouvait pas
-- lire ses pièces par cette voie.
--
-- CORRECTIF
-- Le dossier visé se lit dans le nom même de la pièce (ses 36 derniers
-- caractères). La branche ne vaut plus que si ce dossier est l'un de ceux de
-- l'appelant (créateur, ou administrateur qui peut l'écrire — 093), ET si le
-- déposant y est lié (invitation nominative ou entreprise au groupement).
--
-- Le reste de la policy est repris à l'identique de la 096.

CREATE OR REPLACE FUNCTION app.piece_de_mon_dossier(p_objet TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM reponses_ao r
     WHERE r.id = app.uuid_ou_null(right(p_objet, 36))
       AND (r.createur_id = auth.uid() OR app.peut_ecrire_dossier(r.id))
       AND (
         EXISTS (SELECT 1 FROM invitations i
                  WHERE i.tender_id = r.id
                    AND lower(i.email) = lower(split_part(p_objet, '/', 1)))
         OR EXISTS (SELECT 1 FROM utilisateurs u
                      JOIN groupements g ON g.entreprise_id = u.entreprise_id
                     WHERE g.projet_id = r.id
                       AND lower(u.email) = lower(split_part(p_objet, '/', 1)))
       )
  );
$$;

REVOKE ALL ON FUNCTION app.piece_de_mon_dossier(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.piece_de_mon_dossier(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Lecture des documents autorises" ON storage.objects;

CREATE POLICY "Lecture des documents autorises"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    -- Son propre dossier de fichiers.
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

    -- Pièces du marché : porteur, cotraitant accepté, ou administrateur de
    -- l'entreprise porteuse.
    OR (
      (storage.foldername(name))[1] = 'tenders'
      AND (storage.foldername(name))[2] = 'dce'
      AND (
        app.est_membre(app.uuid_ou_null((storage.foldername(name))[3]))
        OR app.peut_ecrire_dossier(app.uuid_ou_null((storage.foldername(name))[3]))
      )
    )

    -- Dépôt temporaire d'avant création du dossier.
    OR (
      (storage.foldername(name))[1] = 'tenders'
      AND (storage.foldername(name))[2] = 'temp'
      AND (storage.foldername(name))[3] = auth.uid()::text
    )

    -- Pièces déposées par un partenaire POUR UN DOSSIER DE L'APPELANT.
    OR app.piece_de_mon_dossier(name)
  )
);

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Avec le porteur A, pour un partenaire P invité sur un dossier de A ET sur un
-- dossier d'une entreprise B :
--   await supabase.storage.from('documents').list('<email de P>')
--   → attendu : seulement les pièces dont le nom finit par l'id d'un dossier de A.
--   await supabase.storage.from('documents').createSignedUrl('<email de P>/<pièce du dossier de B>', 60)
--   → attendu : refusé.
