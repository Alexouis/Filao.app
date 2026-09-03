-- =============================================
-- FILAO: Migration 096 — Lecture du stockage alignée sur le cloisonnement
-- =============================================
--
-- PROBLÈME
-- La policy de lecture du bucket `documents` (migration 039b) autorise les
-- pièces de marché à qui appartient à une entreprise inscrite au groupement :
--
--     SELECT g.projet_id::text FROM groupements g
--      WHERE g.entreprise_id = (SELECT entreprise_id FROM utilisateurs WHERE id = auth.uid())
--        AND g.statut = 'accepte'
--
-- C'est exactement le raisonnement à l'échelle de l'ENTREPRISE que la migration
-- 092 a corrigé dans `app.est_membre` : le mandataire étant inscrit dans
-- `groupements` avec sa propre entreprise, tous ses collègues satisfont ce test.
-- La policy de stockage n'a pas suivi, et les deux règles ont divergé.
--
-- PORTÉE RÉELLE, POUR NE PAS SURVENDRE CE CORRECTIF
-- Faible aujourd'hui. Le préfixe `tenders/dce/` ne reçoit que le dossier de
-- consultation publié par l'ACHETEUR — RC, CCTP, CCAP, DPGF, acte d'engagement,
-- avis, plans. Ces pièces sont publiques : tout candidat les télécharge sur la
-- plateforme de l'acheteur. Qu'un collègue du porteur y accède ne révèle rien.
--
-- Ce qu'on corrige, c'est la divergence elle-même. Deux règles censées dire la
-- même chose, écrites à deux endroits, dont une seule a été mise à jour : le
-- jour où un autre type de fichier se rangera sous ce préfixe, la faille se
-- rouvrira avec du contenu qui, lui, comptera. On remplace donc la condition
-- recopiée par l'appel de fonction, pour qu'il n'y ait plus qu'un seul endroit
-- où la règle vit.
--
-- Les pièces réellement sensibles ne passent pas par cette branche : le
-- coffre-fort d'entreprise est sous `documents/{entreprise_id}/`, et les dépôts
-- de partenaires sous le dossier nominatif du déposant. Les deux branches
-- correspondantes sont reprises inchangées ci-dessous.
--
-- ⚠️ DÉPEND des migrations 039b, 092 et 093.

-- ---------------------------------------------------------------
-- 1. Conversion de chemin sans exception
-- ---------------------------------------------------------------
-- `(storage.foldername(name))[3]` est du texte, et rien ne garantit qu'il
-- s'agisse d'un UUID : un objet mal rangé sous `tenders/dce/n-importe-quoi/`
-- ferait échouer le cast au milieu de l'évaluation de la policy. Une policy qui
-- lève une exception ne « refuse » pas proprement, elle casse la requête —
-- y compris pour les objets parfaitement légitimes listés au même moment.
CREATE OR REPLACE FUNCTION app.uuid_ou_null(p_texte TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_texte::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app.uuid_ou_null(TEXT) IS
  'Convertit en UUID, ou NULL si la valeur n''en est pas un. Évite qu''un chemin de stockage malformé fasse échouer une policy.';

GRANT EXECUTE ON FUNCTION app.uuid_ou_null(TEXT) TO authenticated;

-- ---------------------------------------------------------------
-- 2. Policy de lecture
-- ---------------------------------------------------------------
-- Reprise intégrale de la 039b. SEULE la branche `tenders/dce/` change : la
-- sous-requête sur `groupements` cède la place à `app.est_membre`, complétée de
-- `app.peut_ecrire_dossier` pour que l'administrateur qui peut modifier le
-- dossier (093) puisse aussi en ouvrir les pièces de marché.
DROP POLICY IF EXISTS "Lecture des documents autorises" ON storage.objects;

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

    -- Pièces du marché : porteur, cotraitant accepté, ou administrateur de
    -- l'entreprise porteuse. Même règle que pour le dossier lui-même.
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
-- Contrôle après application
-- ---------------------------------------------------------------
-- Depuis la console, avec un COLLÈGUE du porteur non convié au dossier :
--   await supabase.storage.from('documents')
--     .createSignedUrl('tenders/dce/<id ao>/<fichier>', 60)
--   → attendu : erreur, plus aucune URL signée.
--
-- Avec le PORTEUR, un COTRAITANT accepté, ou un ADMINISTRATEUR de l'entreprise
-- porteuse : l'URL doit être délivrée comme avant.
--
-- Le coffre-fort reste inchangé — à vérifier tout de même, la policy ayant été
-- réécrite en entier :
--   .createSignedUrl('documents/<son entreprise>/<fichier>', 60)   → OK
--   .createSignedUrl('documents/<autre entreprise>/<fichier>', 60) → refusé
--
-- Chemin malformé, qui doit refuser sans lever d'exception :
--   .createSignedUrl('tenders/dce/pas-un-uuid/x.pdf', 60)          → refusé
