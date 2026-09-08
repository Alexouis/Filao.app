-- ============================================================================
-- 104 — Un seul comptage du stockage
-- ============================================================================
--
-- LE PROBLÈME
-- Deux chiffres coexistaient, et ils ne mesuraient pas la même chose :
--
--   `utilisateurs.storage_used`        sert à BLOQUER un envoi qui dépasse le
--                                      forfait. Incrémenté à chaque dépôt, il
--                                      n'est décrémenté QU'À la suppression
--                                      d'un appel d'offres — pas quand on
--                                      remplace ou supprime une pièce. Il ne
--                                      fait donc que monter, et finit par
--                                      refuser des envois légitimes.
--
--   `stockage_consomme_entreprise`     sert à AFFICHER la consommation. Il lit
--                                      `storage.objects`, donc il est juste —
--                                      mais il ne regarde que le coffre-fort
--                                      `documents/{entreprise_id}/`, en
--                                      ignorant les pièces de candidature,
--                                      rangées par déposant.
--
-- Conséquence vécue : un utilisateur se voit refuser un dépôt à cause d'un
-- compteur gonflé par des fichiers qu'il a pourtant supprimés, tout en lisant
-- un chiffre rassurant dans sa facturation.
--
-- CE QUE FAIT CETTE MIGRATION
-- Elle étend `stockage_consomme_entreprise` aux pièces de dossier, pour qu'elle
-- devienne la SEULE source. Le principe de la 078 est conservé et poussé à son
-- terme : « aucun compteur à maintenir », donc rien qui puisse dériver.
--
-- `utilisateurs.storage_used` n'est pas supprimé ici : des écrans le lisent
-- encore, et une colonne se retire une fois qu'plus personne ne l'interroge.
-- Il cesse en revanche d'être consulté pour autoriser un envoi.
-- ============================================================================

CREATE OR REPLACE FUNCTION stockage_consomme_entreprise(p_entreprise UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = storage, public, pg_temp
AS $$
  -- `metadata->>'size'` porte la taille en octets renseignée par Supabase
  -- Storage à l'envoi. COALESCE : un objet sans métadonnée compte pour zéro
  -- plutôt que d'annuler toute la somme.
  SELECT COALESCE(SUM((o.metadata->>'size')::BIGINT), 0)
    FROM storage.objects o
   WHERE o.bucket_id = 'documents'
     AND (
       -- 1. Coffre-fort de l'entreprise : `documents/{entreprise_id}/…`
       o.name LIKE 'documents/' || p_entreprise::TEXT || '/%'

       -- 2. Pièces de candidature de ses membres : `documents/{email}/…`
       --
       -- Elles sont rangées PAR DÉPOSANT et non par entreprise — c'est ce qui
       -- les faisait échapper au comptage. On rattache donc chaque dossier
       -- personnel à l'entreprise de son propriétaire.
       OR EXISTS (
         SELECT 1
           FROM utilisateurs u
          WHERE u.entreprise_id = p_entreprise
            AND u.email IS NOT NULL
            AND lower((storage.foldername(o.name))[1]) = lower(u.email)
       )
     );
$$;

COMMENT ON FUNCTION stockage_consomme_entreprise(UUID) IS
  'Octets réellement occupés par une entreprise : coffre-fort ET pièces de dossier de ses membres. Lu depuis storage.objects, aucun compteur à maintenir.';

REVOKE ALL ON FUNCTION stockage_consomme_entreprise(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stockage_consomme_entreprise(UUID) TO authenticated;


-- ---------------------------------------------------------------
-- Contrôle du forfait, à partir de la même source
-- ---------------------------------------------------------------
-- L'interface vérifiait le dépassement contre `storage_used`. Elle interroge
-- désormais cette fonction, de sorte que le chiffre qui BLOQUE soit celui qui
-- s'AFFICHE. Deux mesures différentes pour une même limite, c'est la garantie
-- qu'au moins l'une des deux ment.
--
-- Renvoie l'espace restant en octets, ou NULL si le forfait est illimité.

CREATE OR REPLACE FUNCTION stockage_restant_entreprise(p_entreprise UUID)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_limite   BIGINT;
  v_consomme BIGINT;
BEGIN
  -- Limite du forfait souscrit par l'entreprise. `plan_limits` est la source
  -- de vérité des quotas ; la table `PLANS_CONFIG` du front n'en est qu'un
  -- repli, et les deux ont déjà divergé d'un facteur quatre par le passé.
  SELECT pl.max_stockage_octets
    INTO v_limite
    FROM entreprises e
    JOIN plan_limits pl ON pl.plan = e.plan
   WHERE e.id = p_entreprise;

  -- Illimité, ou entreprise/forfait introuvable : aucun refus.
  IF v_limite IS NULL THEN
    RETURN NULL;
  END IF;

  v_consomme := stockage_consomme_entreprise(p_entreprise);
  RETURN GREATEST(0, v_limite - v_consomme);
END;
$$;

COMMENT ON FUNCTION stockage_restant_entreprise(UUID) IS
  'Octets encore disponibles pour une entreprise, ou NULL si le forfait est illimité. Même source que l''affichage.';

REVOKE ALL ON FUNCTION stockage_restant_entreprise(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stockage_restant_entreprise(UUID) TO authenticated;


-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select stockage_consomme_entreprise('<mon entreprise>');
--   -- attendu : coffre-fort + pièces de dossier, donc SUPÉRIEUR à la valeur
--   --           d'avant migration si des pièces ont été déposées.
--
--   select stockage_restant_entreprise('<mon entreprise>');
--   -- attendu : limite du forfait moins la valeur ci-dessus, ou NULL.
--
-- Écart avec l'ancien compteur, pour mesurer la dérive accumulée :
--   select u.email,
--          u.storage_used                              as compteur_derivant,
--          stockage_consomme_entreprise(u.entreprise_id) as reel_entreprise
--     from utilisateurs u
--    where u.entreprise_id is not null;
