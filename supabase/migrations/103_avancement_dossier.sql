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
-- Variante groupée, pour le tableau de bord
-- ---------------------------------------------------------------
-- Le tableau de bord affiche plusieurs dossiers à la fois : un appel par
-- dossier ferait autant d'allers-retours. Cette variante renvoie le TOTAL de
-- pièces par dossier, pour une liste d'identifiants, en une seule requête.
--
-- Elle remplace la lecture de `nb_fichiers_recus`, un compteur dénormalisé qui
-- n'était qu'incrémenté — jamais décrémenté à la suppression, et incrémenté
-- même lors d'un remplacement. Il dérivait vers le haut, et le tableau de bord
-- affichait 100 % pour un dossier réellement à 21 %.
--
-- Le filtrage d'accès est le même que ci-dessus, appliqué dossier par dossier :
-- un identifiant auquel l'appelant n'a pas droit est simplement absent du
-- résultat, sans erreur — la liste peut contenir des dossiers hétérogènes.

CREATE OR REPLACE FUNCTION public.avancement_dossiers(p_tender_ids UUID[])
RETURNS TABLE (
  tender_id     UUID,
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
    SELECT id
      FROM reponses_ao r
     WHERE r.id = ANY(p_tender_ids)
       AND (
         r.createur_id = v_uid
         OR app.est_convie(r.id)
         OR app.peut_ecrire_dossier(r.id)
       )
  )
  SELECT a.id,
         count(o.name)::int
    FROM autorises a
    LEFT JOIN storage.objects o
           ON o.bucket_id = 'documents'
          AND array_length(storage.foldername(o.name), 1) = 1
          AND o.name LIKE '%-' || a.id::text
   GROUP BY a.id;
END;
$$;

COMMENT ON FUNCTION public.avancement_dossiers(UUID[]) IS
  'Total de pièces déposées par dossier, pour une liste d''identifiants. Même règle d''accès que avancement_dossier ; les dossiers non autorisés sont omis.';

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
