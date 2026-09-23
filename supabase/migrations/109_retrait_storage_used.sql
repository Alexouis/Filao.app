-- =============================================
-- FILAO: Migration 109 — Retrait du compteur `utilisateurs.storage_used`
-- =============================================
--
-- La 104 a fait de `stockage_consomme_entreprise` la seule mesure du stockage,
-- pour l'affichage comme pour le blocage. `storage_used` n'était plus
-- qu'entretenu par l'application, sans être lu. Il est retiré, avec la
-- fonction qui l'incrémentait.
--
-- `increment_storage_usage` n'a jamais été versionnée (créée à la main) :
-- sa signature exacte est inconnue, d'où la suppression par nom, toutes
-- surcharges confondues. Elle était appelée depuis l'espace invité, donc
-- probablement ouverte à `anon` : n'importe qui pouvait gonfler le compteur
-- d'un utilisateur.
--
-- ⚠️ À déployer APRÈS le front qui cesse de l'appeler.

DO $$
DECLARE
  f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'increment_storage_usage' AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', f.signature);
    RAISE NOTICE 'Supprimée : %', f.signature;
  END LOOP;
END $$;

-- La colonne n'est retirée que si plus rien en base ne la lit : une fonction
-- ou une vue créée à la main (par exemple `get_tender_owner_info`) casserait
-- sinon en silence, ou ferait échouer la migration entière.
DO $$
DECLARE
  v_fonctions TEXT;
  v_vues      TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_fonctions
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app') AND p.prosrc ILIKE '%storage_used%';

  SELECT string_agg(viewname, ', ') INTO v_vues
    FROM pg_views
   WHERE schemaname = 'public' AND definition ILIKE '%storage_used%';

  IF v_fonctions IS NULL AND v_vues IS NULL THEN
    ALTER TABLE utilisateurs DROP COLUMN IF EXISTS storage_used;
    RAISE NOTICE 'Colonne utilisateurs.storage_used supprimée.';
  ELSE
    RAISE WARNING 'storage_used conservée, encore lue par : fonctions [%], vues [%]. À adapter avant suppression.',
      coalesce(v_fonctions, '-'), coalesce(v_vues, '-');
  END IF;
END $$;
