-- =============================================
-- FILAO: Migration 105 — Un mandat transmis ne retire plus l'accès
-- =============================================
--
-- PROBLÈME
-- La 092 a ajouté, dans `app.est_convie` et `app.est_membre`, un filet :
--
--     AND COALESCE(g.role_groupement, '') <> 'Mandataire'
--
-- Il supposait que la ligne « Mandataire » est toujours celle de l'entreprise
-- porteuse. C'est faux depuis que le mandat est cessible (TenderWizard,
-- `transmettreMandat` / `promouvoirMandataire`) : quand le porteur transmet
-- le mandat à un partenaire, la ligne de CE partenaire passe à « Mandataire »
-- et le filet l'écarte. Le nouveau mandataire perd alors tout : le dossier
-- disparaît de sa liste (policy `reponses_ao_select_convie_ou_entreprise`),
-- et avec lui le groupement, les échanges et les dépôts.
--
-- CORRECTIF
-- Le filet n'était utile que pour les dossiers anciens dont l'entreprise
-- porteuse n'a pas pu être reprise (`reponses_ao.entreprise_id IS NULL`).
-- Quand la colonne est renseignée, `g.entreprise_id IS DISTINCT FROM
-- r.entreprise_id` suffit à écarter la ligne du porteur — quel que soit le
-- rôle qu'elle porte après une transmission. On restreint donc le filet à ce
-- seul cas. Rien ne s'ouvre aux collègues du porteur : leur ligne reste
-- écartée par l'entreprise figée.
--
-- ⚠️ DÉPEND de la migration 092.

CREATE OR REPLACE FUNCTION app.est_convie(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao AND r.createur_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
      FROM public.groupements g
      JOIN public.reponses_ao r ON r.id = g.projet_id
     WHERE g.projet_id = p_ao
       AND g.entreprise_id = app.entreprise_courante()
       -- « refuse » est volontairement exclu : une invitation déclinée ne
       -- redonne pas accès au dossier.
       AND g.statut IN ('accepte', 'invite')
       AND g.entreprise_id IS DISTINCT FROM r.entreprise_id
       -- Filet réservé aux dossiers sans entreprise porteuse figée.
       AND (r.entreprise_id IS NOT NULL
            OR COALESCE(g.role_groupement, '') <> 'Mandataire')
  );
$$;

CREATE OR REPLACE FUNCTION app.est_membre(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao AND r.createur_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
      FROM public.groupements g
      JOIN public.reponses_ao r ON r.id = g.projet_id
     WHERE g.projet_id = p_ao
       AND g.entreprise_id = app.entreprise_courante()
       AND g.statut = 'accepte'
       AND g.entreprise_id IS DISTINCT FROM r.entreprise_id
       -- Filet réservé aux dossiers sans entreprise porteuse figée.
       AND (r.entreprise_id IS NOT NULL
            OR COALESCE(g.role_groupement, '') <> 'Mandataire')
  );
$$;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Dossiers dont le mandat a été transmis à une entreprise partenaire, donc
-- ceux que la 092 rendait invisibles à leur mandataire :
--   select r.id, r.titre, g.entreprise_id as mandataire
--     from reponses_ao r
--     join groupements g on g.projet_id = r.id and g.role_groupement = 'Mandataire'
--    where g.entreprise_id is distinct from r.entreprise_id;
--
-- Avec le compte du nouveau mandataire :
--   select app.est_membre('<dossier>');   -- true
-- Avec le compte d'un COLLÈGUE du porteur, non convié :
--   select app.est_membre('<dossier>');   -- false (inchangé)
