-- =============================================
-- FILAO: Migration 054 — Consolidation des documents (Lot 3 : nettoyage)
-- =============================================
--
-- CONTEXTE
-- Les lots 1 et 2 ont fait de `documents_candidature` la source unique des
-- documents d'entreprise (standard + personnalisés), avec expiration. Le lot 3
-- a repointé les derniers lecteurs/écrivains applicatifs :
--   • CompanyTab (lot 2) — écritures standard,
--   • TenderCreationWizard — lecture + écriture (upload admin),
--   • TenderWizard — lecture,
--   • Dashboard — compteur (via documents_candidature_view),
--   • Collaborators — code mort supprimé.
-- Plus aucun code ne lit ni n'écrit `documents_entreprise` ni les colonnes
-- `utilisateurs.*_url` / `document_statuses`. Cette migration les supprime.
--
-- ⚠️ DESTRUCTIF ET IRRÉVERSIBLE
-- À n'appliquer qu'APRÈS avoir déployé et vérifié le code des lots 2 et 3 en
-- production. Les données utiles ont été recopiées vers documents_candidature
-- par le backfill du lot 1 (migration 053) ; ce qui est supprimé ici n'est plus
-- référencé. En cas de doute, garder une sauvegarde de `utilisateurs` et
-- `documents_entreprise` avant exécution.
--
-- GARDE-FOU
-- Un bloc de contrôle vérifie d'abord que le backfill a bien peuplé
-- documents_candidature. S'il n'y a AUCUN document standard côté cible alors
-- que des URL existaient encore côté utilisateurs, la migration s'interrompt :
-- supprimer sans cible remplie ferait perdre les documents.

DO $$
DECLARE
    v_cibles INTEGER;
    v_sources INTEGER;
BEGIN
    SELECT count(*) INTO v_cibles
      FROM documents_candidature
     WHERE categorie IN ('kbis','attestation_honneur','attestation_assurance','presentation_societe');

    SELECT count(*) INTO v_sources
      FROM utilisateurs
     WHERE COALESCE(kbis_url,'') <> ''
        OR COALESCE(attestation_honneur_url,'') <> ''
        OR COALESCE(attestation_assurance_url,'') <> ''
        OR COALESCE(presentation_societe_url,'') <> '';

    IF v_sources > 0 AND v_cibles = 0 THEN
        RAISE EXCEPTION
          'Abandon : % utilisateur(s) ont encore des documents, mais documents_candidature n''en contient aucun de standard. Rejouer le backfill (migration 053) avant de supprimer.', v_sources;
    END IF;

    RAISE NOTICE 'Contrôle OK : % document(s) standard côté cible, % source(s) côté utilisateurs.', v_cibles, v_sources;
END $$;

-- ---------------------------------------------------------------
-- 1. Supprimer la table morte documents_entreprise + sa vue
-- ---------------------------------------------------------------
-- Remplacée de fait par documents_candidature dès la migration 039a. Plus aucun
-- INSERT applicatif depuis la 005 ; le seul lecteur restant (Collaborators)
-- était du code mort, retiré au lot 3.
DROP VIEW IF EXISTS documents_entreprise_view;
DROP TABLE IF EXISTS documents_entreprise CASCADE;

-- ---------------------------------------------------------------
-- 2. Supprimer les colonnes documents sur utilisateurs
-- ---------------------------------------------------------------
-- Ces documents d'entreprise n'avaient rien à faire sur une table par
-- utilisateur (cf. discussion lot 1). Migrés vers documents_candidature, ils ne
-- sont plus lus nulle part.
ALTER TABLE utilisateurs
  DROP COLUMN IF EXISTS kbis_url,
  DROP COLUMN IF EXISTS attestation_assurance_url,
  DROP COLUMN IF EXISTS attestation_honneur_url,
  DROP COLUMN IF EXISTS presentation_societe_url,
  DROP COLUMN IF EXISTS document_statuses;

-- ---------------------------------------------------------------
-- 3. Vérification
-- ---------------------------------------------------------------
--   select to_regclass('public.documents_entreprise');        -- attendu : NULL
--   select to_regclass('public.documents_entreprise_view');   -- attendu : NULL
--   select column_name from information_schema.columns
--    where table_name = 'utilisateurs' and column_name like '%_url';
--     -- ne doit plus lister kbis_url / attestation_*_url / presentation_societe_url
--
--   -- La source unique reste peuplée :
--   select categorie, count(*) from documents_candidature group by categorie;