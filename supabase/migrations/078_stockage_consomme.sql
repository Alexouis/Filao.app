-- =============================================
-- FILAO: Migration 078 — Espace de stockage réellement consommé
-- =============================================
--
-- PROBLÈME
-- L'écran Abonnement affiche « 0 Mo » consommés quel que soit le volume déposé.
-- La valeur provient de `userProfile.storage_used`, un champ manipulé
-- uniquement EN MÉMOIRE par le front : il est incrémenté après un dépôt,
-- décrémenté après une suppression, mais jamais persisté. Aucune colonne
-- `storage_used` n'existe en base. Le compteur retombe donc à zéro à chaque
-- rechargement de page.
--
-- POURQUOI NE PAS AJOUTER UNE COLONNE COMPTEUR
-- Un compteur doit être tenu à jour à chaque dépôt, chaque suppression, chaque
-- échec partiel — y compris ceux qui ne passent pas par l'application (purge
-- manuelle, script de maintenance). Il dérive silencieusement, et rien ne
-- signale qu'il a dérivé.
--
-- `storage.objects` connaît déjà la taille de chaque fichier : c'est la source
-- de vérité. On la lit au moment de l'affichage plutôt que de la recopier.
--
-- COÛT
-- La requête est agrégée sur un préfixe de chemin, appelée une fois à
-- l'ouverture de l'écran Abonnement. À la volumétrie du produit, c'est
-- négligeable ; si cela devait changer, un cache côté application serait le
-- premier recours, avant un compteur.

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
     -- Coffre-fort de l'entreprise : `documents/{entreprise_id}/…`
     AND o.name LIKE 'documents/' || p_entreprise::TEXT || '/%';
$$;

COMMENT ON FUNCTION stockage_consomme_entreprise(UUID) IS
  'Octets réellement occupés par le coffre-fort d''une entreprise, lus depuis storage.objects. Aucun compteur à maintenir.';

-- Réservé aux utilisateurs authentifiés. La fonction ne révèle qu'un total
-- agrégé, mais l'appelant doit tout de même être connecté.
REVOKE ALL ON FUNCTION stockage_consomme_entreprise(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION stockage_consomme_entreprise(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select stockage_consomme_entreprise('<mon entreprise>');
--   -- attendu : la somme en octets des pièces du coffre-fort
--
--   -- Comparaison avec le contenu réel du bucket :
--   select count(*), sum((metadata->>'size')::bigint)
--     from storage.objects
--    where bucket_id = 'documents'
--      and name like 'documents/<mon entreprise>/%';
