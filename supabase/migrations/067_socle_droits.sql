-- =============================================
-- FILAO: Migration 067 — Socle de droits : schéma `app` et fonctions
-- =============================================
--
-- CONTEXTE
-- Les policies Postgres se combinent en OR : la plus permissive l'emporte
-- toujours. L'état actuel le montre — `reponses_ao` porte QUATRE policies de
-- lecture qui s'additionnent, si bien que la condition la plus large décide
-- seule de l'accès. Empiler des policies revient à empiler des accès non
-- maîtrisés.
--
-- PRINCIPE RETENU
-- Une seule policy par table et par verbe, dont la condition appelle une
-- fonction nommée. Ajouter un accès = modifier la fonction, pas ajouter une
-- policy. Cette migration installe le socle : le schéma `app` et les trois
-- fonctions de référence.
--
-- SECURITY DEFINER ET search_path
-- Ces fonctions lisent `utilisateurs` et `groupements`, elles-mêmes protégées
-- par RLS. Sans SECURITY DEFINER, leur appel depuis une policy déclencherait
-- l'évaluation récursive des policies de ces tables. Le `search_path` est
-- verrouillé explicitement : une fonction SECURITY DEFINER dont le chemin de
-- recherche est modifiable permettrait à un appelant de détourner la résolution
-- des noms de tables vers des objets qu'il contrôle.
--
-- ⚠️ Cette migration N'ACTIVE aucune policy : elle ne fait qu'installer les
--    fonctions. La bascule des policies est isolée dans la migration suivante,
--    afin que ce socle puisse être posé et vérifié sans rien changer aux accès.

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------
-- app.entreprise_courante() — entreprise de l'utilisateur connecté
-- ---------------------------------------------------------------
-- Renvoie NULL pour un appelant anonyme ou sans entreprise : toute comparaison
-- avec NULL est fausse, donc l'absence d'entreprise n'ouvre aucun accès.
CREATE OR REPLACE FUNCTION app.entreprise_courante()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT entreprise_id FROM public.utilisateurs WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION app.entreprise_courante() IS
  'Entreprise de l''utilisateur authentifié, ou NULL. Socle de toutes les policies de cloisonnement.';

-- ---------------------------------------------------------------
-- app.est_membre(ao) — appartenance au groupement d'un dossier
-- ---------------------------------------------------------------
-- Est membre : le porteur du dossier, ou une entreprise dont la participation
-- au groupement est ACCEPTÉE.
--
-- Le statut 'invite' est volontairement EXCLU, contrairement à la policy
-- `reponses_ao_select_groupement` actuelle qui accepte ARRAY['accepte','invite'].
-- Une invitation non encore acceptée ne doit pas donner accès au contenu du
-- dossier : le prospect voit l'invitation, pas les montants ni les autres
-- membres. C'est ce que la fonction Edge `invitation-view` a vocation à servir.
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
    SELECT 1 FROM public.groupements g
     WHERE g.projet_id = p_ao
       AND g.entreprise_id = app.entreprise_courante()
       AND g.statut = 'accepte'
  );
$$;

COMMENT ON FUNCTION app.est_membre(UUID) IS
  'Vrai si l''utilisateur porte le dossier ou si son entreprise y participe avec le statut accepte. Le statut invite n''ouvre aucun accès.';

-- ---------------------------------------------------------------
-- app.est_mandataire(ao) — pilotage du dossier
-- ---------------------------------------------------------------
-- Le mandataire est le porteur du dossier (createur_id). C'est lui seul qui
-- écrit le dossier, compose le groupement et fait avancer le cycle de vie
-- (finaliser, déposer, saisir le résultat).
CREATE OR REPLACE FUNCTION app.est_mandataire(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao AND r.createur_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION app.est_mandataire(UUID) IS
  'Vrai si l''utilisateur est le porteur du dossier. Seul rôle habilité à écrire le dossier et le groupement.';

-- ---------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------
-- `authenticated` doit pouvoir appeler ces fonctions depuis les policies.
-- `anon` en est exclu : aucun accès anonyme ne passe par les policies, les
-- invités sans compte passent par les Edge Functions dédiées.
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.entreprise_courante() TO authenticated;
GRANT EXECUTE ON FUNCTION app.est_membre(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION app.est_mandataire(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION app.entreprise_courante() FROM anon, public;
REVOKE EXECUTE ON FUNCTION app.est_membre(UUID) FROM anon, public;
REVOKE EXECUTE ON FUNCTION app.est_mandataire(UUID) FROM anon, public;

-- ---------------------------------------------------------------
-- Vérification (à exécuter après application)
-- ---------------------------------------------------------------
--   select app.entreprise_courante();          -- mon entreprise
--   select app.est_membre('<ao d''un tiers>');  -- doit renvoyer false
--   select app.est_mandataire('<mon ao>');      -- doit renvoyer true
