-- =============================================
-- FILAO: Migration 039a — Conversion des URL stockées en chemins
-- =============================================
--
-- CONTEXTE
-- Le bucket `documents` doit passer en privé (migration 039b). Ses objets ne
-- seront alors accessibles que par URL signée, valable une heure — une URL qui
-- expire ne peut pas être persistée en base. Les colonnes concernées doivent
-- donc contenir un **chemin de stockage**, l'URL étant fabriquée à l'affichage.
--
-- SUR LE NOM DES COLONNES
-- Le suffixe `_url` devient trompeur. Le renommage en `_path` avait été envisagé
-- puis écarté : ces champs sont référencés 32 fois dans 4 composants, servent de
-- clés dans des objets d'état, et ne sont déclarés dans aucune des deux
-- interfaces `UserProfile` du projet. TypeScript ne signalerait donc aucun oubli,
-- et un oubli serait silencieux jusqu'au premier affichage cassé en production.
--
-- Le nom est conservé, la sémantique documentée par les COMMENT ci-dessous et
-- par le type `UserProfile`. Le renommage reste souhaitable, mais après que ces
-- champs auront été typés — pas avant.

-- ---------------------------------------------------------------
-- 1. utilisateurs — pièces administratives
-- ---------------------------------------------------------------
-- `https://…/object/public/documents/alex@x.fr/kbis_123` → `alex@x.fr/kbis_123`
-- Les valeurs ne correspondant pas au motif (URL externe, chemin déjà converti,
-- chaîne vide) sont laissées intactes : la migration est rejouable.

UPDATE utilisateurs
   SET kbis_url = substring(kbis_url from '/object/public/documents/(.*)$')
 WHERE kbis_url LIKE '%/object/public/documents/%';

UPDATE utilisateurs
   SET attestation_assurance_url = substring(attestation_assurance_url from '/object/public/documents/(.*)$')
 WHERE attestation_assurance_url LIKE '%/object/public/documents/%';

UPDATE utilisateurs
   SET attestation_honneur_url = substring(attestation_honneur_url from '/object/public/documents/(.*)$')
 WHERE attestation_honneur_url LIKE '%/object/public/documents/%';

UPDATE utilisateurs
   SET presentation_societe_url = substring(presentation_societe_url from '/object/public/documents/(.*)$')
 WHERE presentation_societe_url LIKE '%/object/public/documents/%';

-- ---------------------------------------------------------------
-- 2. documents_candidature
-- ---------------------------------------------------------------
-- Table vide au moment de la migration, mais le traitement est nécessaire pour
-- les lignes créées entre cette migration et le déploiement du code.

UPDATE documents_candidature
   SET url = substring(url from '/object/public/documents/(.*)$')
 WHERE url LIKE '%/object/public/documents/%';

-- ---------------------------------------------------------------
-- 3. Documentation des colonnes
-- ---------------------------------------------------------------
COMMENT ON COLUMN utilisateurs.kbis_url IS
  'CHEMIN de stockage dans le bucket privé `documents`, pas une URL. L''URL signée est générée à l''affichage (voir helpers/storageHelpers).';
COMMENT ON COLUMN utilisateurs.attestation_assurance_url IS
  'CHEMIN de stockage dans le bucket privé `documents`, pas une URL.';
COMMENT ON COLUMN utilisateurs.attestation_honneur_url IS
  'CHEMIN de stockage dans le bucket privé `documents`, pas une URL.';
COMMENT ON COLUMN utilisateurs.presentation_societe_url IS
  'CHEMIN de stockage dans le bucket privé `documents`, pas une URL.';
COMMENT ON COLUMN documents_candidature.url IS
  'CHEMIN de stockage dans le bucket privé `documents`, pas une URL.';

-- Ces deux-là restent de véritables URL : leur bucket est public.
COMMENT ON COLUMN utilisateurs.photo_url IS
  'URL publique complète (bucket `public-assets`), ou URL externe d''un fournisseur d''identité.';
COMMENT ON COLUMN entreprises.logo_url IS
  'URL publique complète (bucket `public-assets`).';

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select count(*) filter (where kbis_url like 'http%')                as reste_url,
--          count(*) filter (where kbis_url <> '' and kbis_url not like 'http%') as chemins
--     from utilisateurs;
--
-- `reste_url` doit valoir 0. Une valeur non nulle signale une URL d'un autre
-- bucket ou d'un domaine externe, à examiner avant de jouer la 039b.
--
-- ⚠️ Un chemin contenant des caractères encodés (%20 pour un espace) reste
--    encodé après conversion. Le décodage est fait côté application, là où
--    l'URL signée est demandée.