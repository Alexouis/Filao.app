-- =============================================
-- FILAO: Migration 036 — Durcissement des buckets Storage
-- =============================================
--
-- CONTEXTE (bug B4)
-- Les trois buckets sont créés sans aucune contrainte :
--
--   id             public   file_size_limit   allowed_mime_types
--   test           false    null              null
--   Fichiers AO    true     null              null
--   documents      true     null              null
--
-- Conséquences immédiates : n'importe quel type de fichier est accepté, de
-- n'importe quelle taille. Un `.exe` renommé `.pdf` passe sans obstacle, et un
-- fichier de plusieurs gigaoctets aussi.
--
-- PORTÉE DE CETTE MIGRATION
-- Elle pose les garde-fous natifs de Supabase Storage, applicables sans changer
-- une ligne de code applicatif. Ils sont nécessaires mais pas suffisants :
-- `allowed_mime_types` compare le Content-Type **déclaré par le client**, donc
-- falsifiable. La vérification de la signature binaire reste à faire dans une
-- edge function (voir helpers/fileValidation.ts).
--
-- Cette migration ne touche PAS à la visibilité publique des buckets, qui est
-- un sujet distinct et plus lourd — voir la note en fin de fichier.

-- ---------------------------------------------------------------
-- 1. Plafond de taille
-- ---------------------------------------------------------------
-- 100 Mo : calé sur le point de dépôt le plus permissif (le DCE, souvent une
-- archive volumineuse fournie par l'acheteur). Les plafonds plus stricts par
-- point de dépôt — 2 Mo pour un logo, 25 Mo pour une pièce de candidature —
-- sont appliqués en amont, un bucket ne sachant pas d'où vient le fichier.

UPDATE storage.buckets
   SET file_size_limit = 104857600   -- 100 Mo
 WHERE id IN ('documents', 'Fichiers AO', 'test')
   AND (file_size_limit IS NULL OR file_size_limit > 104857600);

-- ---------------------------------------------------------------
-- 2. Liste blanche de types déclarés
-- ---------------------------------------------------------------
-- Premier filtre, gratuit : il écarte le déposant qui ne cherche pas à
-- contourner (mauvais fichier sélectionné), et impose à un attaquant de mentir
-- explicitement sur le Content-Type — ce que la vérification par signature
-- attrapera ensuite.
--
-- ⚠️ Un navigateur déduit le Content-Type de l'extension. Pour une extension
--    inconnue il envoie une chaîne vide, refusée par cette liste. C'est le
--    comportement voulu, mais cela peut faire échouer un dépôt qui passait
--    auparavant : à surveiller en recette.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
        -- Documents
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.spreadsheet',
        -- Images
        'image/png', 'image/jpeg', 'image/webp',
        -- Archives : le DCE est fréquemment livré ainsi
        'application/zip', 'application/x-zip-compressed'
   ]
 WHERE id IN ('documents', 'Fichiers AO', 'test')
   AND allowed_mime_types IS NULL;

-- ---------------------------------------------------------------
-- 3. Vérification
-- ---------------------------------------------------------------
--   select id, public, file_size_limit, array_length(allowed_mime_types, 1)
--     from storage.buckets;
--
-- Pour revenir en arrière sur un bucket :
--   update storage.buckets
--      set file_size_limit = null, allowed_mime_types = null
--    where id = 'documents';

-- ---------------------------------------------------------------
-- 4. Ce qui reste ouvert — à traiter séparément
-- ---------------------------------------------------------------
-- (a) `documents` et `Fichiers AO` sont PUBLICS. Tout objet y est
--     téléchargeable par quiconque connaît son URL, sans authentification. Or
--     les chemins sont prévisibles : ils contiennent l'adresse e-mail du
--     déposant et le nom du fichier. Les pièces de candidature — Kbis,
--     attestations fiscales et URSSAF, RIB — sont concernées.
--
--     Le correctif consiste à passer le bucket en privé et à remplacer les
--     appels `getPublicUrl()` par des URL signées à durée limitée. Il touche
--     tous les écrans qui affichent un document ou un logo : c'est un chantier
--     à part, pas une ligne de SQL.
--
--     Piste intermédiaire : séparer les logos et photos de profil — seuls
--     éléments réellement publics — dans un bucket dédié, et rendre
--     `documents` privé.
--
-- (b) La vérification du contenu réel (signature binaire) reste à implémenter
--     dans une edge function. `allowed_mime_types` ne contrôle que le type
--     annoncé par le client.