-- ============================================================================
-- 103 — Avancement d'un dossier visible par tout le groupement
-- ============================================================================
--
-- LE PROBLÈME
-- « Avancement global du dossier » n'affichait pas la même chose selon qui
-- regardait : 10/19 pour le mandataire, 4/19 pour un cotraitant, sur le MÊME
-- dossier au même instant.
--
-- La cause n'est pas un calcul mais une VISIBILITÉ. Le numérateur était obtenu
-- en listant le bucket depuis le navigateur, or la policy de lecture (096)
-- limite chacun à son propre dossier `documents/{email}/` ; seul le créateur
-- du dossier peut lire ceux de ses partenaires. Chacun comptait donc les
-- pièces qu'il avait le droit de voir, et l'appelait « global ».
--
-- POURQUOI ON N'ÉLARGIT PAS LA POLICY DE LECTURE
-- Les pièces sont rangées PAR PERSONNE (`documents/{email}/`), pas par dossier.
-- Autoriser un cotraitant à lister le dossier d'un autre lui exposerait les
-- pièces de TOUS les autres appels d'offres de cette personne — le nom des
-- objets porte l'identifiant du dossier. Ce serait une fuite entre AO pour
-- résoudre un problème d'affichage.
--
-- CE QUE FAIT CETTE MIGRATION
-- Une fonction qui renvoie des COMPTEURS, jamais des noms de fichiers. Tout
-- membre du dossier l'appelle et obtient le même résultat ; le contenu, lui,
-- reste cloisonné exactement comme avant.
--
--   nom de l'objet : {type}-{collabId}-{tenderId}
--   → on compte les objets de `documents/` dont le nom se termine par
--     l'identifiant du dossier, en les regroupant par déposant.
--
-- CE QUI NE FUIT PAS
-- Ni nom de fichier, ni type de pièce, ni chemin : uniquement « cette personne
-- a déposé N pièces sur CE dossier ». Rien sur ses autres dossiers.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.avancement_dossier(p_tender_id UUID)
RETURNS TABLE (
  email_depositaire TEXT,
  pieces_recues     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, storage
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '28000';
  END IF;

  -- Contrôle d'accès explicite : la fonction contourne la RLS, c'est donc ICI
  -- que le cloisonnement se joue. Même périmètre que la lecture du dossier —
  -- porteur, membre accepté, invité en attente de réponse (074) — de sorte
  -- qu'on n'ouvre rien de plus que ce que l'écran affiche déjà.
  IF NOT (
    app.est_convie(p_tender_id)
    OR app.peut_ecrire_dossier(p_tender_id)
    OR EXISTS (SELECT 1 FROM reponses_ao r
                WHERE r.id = p_tender_id AND r.createur_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'Accès refusé à ce dossier.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    -- Premier segment du chemin : le dossier du déposant, c'est-à-dire son
    -- e-mail. On renvoie en minuscules, l'interface compare ainsi sans risque.
    lower((storage.foldername(o.name))[1])           AS email_depositaire,
    count(*)::int                                    AS pieces_recues
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    -- Pièces de candidature : deux segments seulement (dossier + fichier).
    -- Écarte le coffre-fort (`documents/{entreprise}/…`) et les pièces de
    -- marché (`tenders/dce/…`), qui ne relèvent pas de cet avancement.
    AND array_length(storage.foldername(o.name), 1) = 1
    -- Convention `{type}-{collabId}-{tenderId}` : le nom se termine par
    -- l'identifiant du dossier. Le `-` évite de confondre deux identifiants
    -- dont l'un serait le suffixe de l'autre.
    AND o.name LIKE '%-' || p_tender_id::text
  GROUP BY 1;
END;
$$;

COMMENT ON FUNCTION public.avancement_dossier(UUID) IS
  'Nombre de pièces déposées par personne sur un dossier. Renvoie des compteurs, jamais des noms de fichiers : tout membre du groupement voit l''avancement des autres sans accéder à leurs documents.';

REVOKE ALL ON FUNCTION public.avancement_dossier(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avancement_dossier(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.avancement_dossier(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- Variante groupée : composition ET avancement, pour les listes
-- ---------------------------------------------------------------
-- Le tableau de bord et le calendrier affichent plusieurs dossiers : un appel
-- par dossier ferait autant d'allers-retours.
--
-- Cette fonction ne renvoie pas qu'un total : elle renvoie la COMPOSITION de
-- chaque groupement, une ligne par membre, avec ses pièces reçues. C'est
-- nécessaire, car le dénominateur divergeait autant que le numérateur :
--   - le tableau de bord ne lisait que `groupements` ;
--   - l'écran du dossier fusionne `groupements` ET `invitations`.
-- Un partenaire venu d'une invitation manquait donc au dénominateur du
-- tableau de bord : 10/14 = 71 % au lieu de 10/19 = 53 %.
--
-- Le nombre de pièces attendues par rôle n'est PAS calculé ici : il vit dans
-- `REQUIRED_DOCS_BY_ROLE` côté application, et le dupliquer en SQL créerait
-- exactement le genre de double source qu'on est en train de supprimer. Le
-- serveur dit QUI est membre et COMBIEN il a déposé ; l'application applique
-- la grille des pièces attendues.

-- ⚠️ Suppression préalable indispensable.
--
-- Une première version de cette fonction renvoyait `(tender_id, pieces_recues)`
-- — un simple total par dossier. Elle ne suffisait pas : le dénominateur
-- divergeait autant que le numérateur, faute de connaître la composition du
-- groupement. La nouvelle version renvoie une ligne PAR MEMBRE.
--
-- PostgreSQL refuse de changer le type de retour d'une fonction par
-- `CREATE OR REPLACE` (« cannot change return type of existing function ») :
-- il faut la supprimer d'abord. Sans ce DROP, la migration échoue sur les
-- projets où la première version a déjà été déployée.
DROP FUNCTION IF EXISTS public.avancement_dossiers(UUID[]);

CREATE OR REPLACE FUNCTION public.avancement_dossiers(p_tender_ids UUID[])
RETURNS TABLE (
  tender_id     UUID,
  cle_membre    TEXT,
  role_membre   TEXT,
  statut_membre TEXT,
  pieces_recues INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, storage
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise.' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  WITH autorises AS (
    -- Un identifiant auquel l'appelant n'a pas droit est simplement absent du
    -- résultat, sans erreur : la liste peut mêler des dossiers hétérogènes.
    SELECT r.id
      FROM reponses_ao r
     WHERE r.id = ANY(p_tender_ids)
       AND (
         r.createur_id = v_uid
         OR app.est_convie(r.id)
         OR app.peut_ecrire_dossier(r.id)
       )
  ),
  membres AS (
    -- Membres par ENTREPRISE. Les pièces étant rangées par déposant, on
    -- rattache à l'entreprise toutes les adresses de ses comptes.
    SELECT a.id                                   AS tender_id,
           'g:' || g.entreprise_id::text          AS cle_membre,
           g.role_groupement                      AS role_membre,
           g.statut                               AS statut_membre,
           ARRAY(
             SELECT lower(u.email) FROM utilisateurs u
              WHERE u.entreprise_id = g.entreprise_id AND u.email IS NOT NULL
           )                                      AS emails
      FROM autorises a
      JOIN groupements g ON g.projet_id = a.id

    UNION ALL

    -- Invitations nominatives sans groupement : le partenaire n'a pas encore
    -- d'entreprise rattachée au dossier, mais il peut déjà déposer.
    SELECT a.id,
           'i:' || lower(i.email),
           COALESCE(i.role, 'Co-traitant'),
           CASE i.status
             WHEN 'accepted' THEN 'accepte'
             WHEN 'refused'  THEN 'refuse'
             ELSE 'invite'
           END,
           ARRAY[lower(i.email)]
      FROM autorises a
      JOIN invitations i ON i.tender_id = a.id
     WHERE i.revoked_at IS NULL
       AND i.email IS NOT NULL
       -- Pas de doublon avec la branche « entreprise » ci-dessus.
       AND NOT EXISTS (
         SELECT 1 FROM groupements g2
          JOIN utilisateurs u2 ON u2.entreprise_id = g2.entreprise_id
         WHERE g2.projet_id = a.id AND lower(u2.email) = lower(i.email)
       )
  )
  SELECT m.tender_id,
         m.cle_membre,
         m.role_membre,
         m.statut_membre,
         (
           SELECT count(*)::int
             FROM storage.objects o
            WHERE o.bucket_id = 'documents'
              AND array_length(storage.foldername(o.name), 1) = 1
              AND lower((storage.foldername(o.name))[1]) = ANY(m.emails)
              AND o.name LIKE '%-' || m.tender_id::text
         ) AS pieces_recues
    FROM membres m;
END;
$$;

COMMENT ON FUNCTION public.avancement_dossiers(UUID[]) IS
  'Composition et avancement de plusieurs dossiers : une ligne par membre, avec ses pièces déposées. Mêmes règles d''accès que avancement_dossier.';

REVOKE ALL ON FUNCTION public.avancement_dossiers(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.avancement_dossiers(UUID[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.avancement_dossiers(UUID[]) TO authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- En tant que MANDATAIRE puis en tant que COTRAITANT accepté, sur le même
-- dossier :
--   select * from avancement_dossier('<id ao>');
--   -- attendu : les DEUX obtiennent exactement les mêmes lignes.
--
-- En tant qu'utilisateur étranger au dossier :
--   select * from avancement_dossier('<id ao>');
--   -- attendu : exception 42501.
--
-- Le cloisonnement du CONTENU reste inchangé — à vérifier tout de même :
--   un cotraitant ne doit toujours pas pouvoir lister le dossier d'un autre
--   .list('documents/<email d''un autre>')   → vide ou refusé
