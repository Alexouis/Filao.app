-- =============================================
-- FILAO: Migration 071 — Correctif : privilèges d'écriture sur utilisateurs_publics
-- =============================================
--
-- PROBLÈME CORRIGÉ
-- La migration 070 a créé la vue `utilisateurs_publics` en accordant
-- explicitement `GRANT SELECT ... TO authenticated`, mais sans retirer les
-- autres privilèges. Or Supabase applique des privilèges PAR DÉFAUT sur le
-- schéma `public` : tout objet nouvellement créé y reçoit INSERT, UPDATE,
-- DELETE et TRUNCATE pour les rôles `anon` et `authenticated`. Le GRANT SELECT
-- n'ajoutait donc rien, et les droits d'écriture sont restés en place.
--
-- POURQUOI C'EST UNE FAILLE
-- Cette vue est AUTO-MODIFIABLE au sens de Postgres : elle ne comporte qu'une
-- seule table dans son FROM, sans agrégat, DISTINCT ni GROUP BY. Postgres
-- accepte donc d'y répercuter des écritures sur les colonnes simples
-- (id, prenom, nom, photo_url, entreprise_id).
--
-- Et surtout : une vue s'exécute avec les droits de son PROPRIÉTAIRE
-- (security_invoker = false, comportement par défaut), ce qui CONTOURNE le RLS
-- de la table sous-jacente. Un utilisateur authentifié pouvait ainsi écrire :
--
--     UPDATE utilisateurs_publics SET nom = 'X' WHERE id = <un tiers>;
--     DELETE FROM utilisateurs_publics WHERE id = <un tiers>;
--
-- et modifier ou supprimer le profil de n'importe qui, en contournant la policy
-- `utilisateurs_select_soi` posée par la migration 070.
--
-- La vue doit être STRICTEMENT en lecture seule : elle n'existe que pour
-- exposer des colonnes d'identification. Toute écriture sur un profil passe par
-- la table `utilisateurs`, protégée par ses propres policies.

-- ---------------------------------------------------------------
-- 1. Retrait de tous les privilèges, puis lecture seule
-- ---------------------------------------------------------------
-- REVOKE ALL avant le GRANT : on repart d'une base nette plutôt que d'énumérer
-- les privilèges à retirer, ce qui resterait vulnérable à l'ajout d'un nouveau
-- privilège par défaut côté Supabase.
REVOKE ALL ON public.utilisateurs_publics FROM anon;
REVOKE ALL ON public.utilisateurs_publics FROM authenticated;
REVOKE ALL ON public.utilisateurs_publics FROM public;

GRANT SELECT ON public.utilisateurs_publics TO authenticated;

-- `service_role` conserve ses privilèges : il contourne de toute façon le RLS
-- et n'est utilisé que par les Edge Functions de confiance.

-- ---------------------------------------------------------------
-- 2. Barrière de sécurité sur la vue
-- ---------------------------------------------------------------
-- `security_barrier` empêche Postgres de faire remonter une fonction fournie
-- par l'appelant avant les conditions de la vue. Sans cela, une fonction
-- malicieuse placée dans un WHERE pourrait être évaluée sur des lignes que la
-- vue est censée filtrer, et divulguer leur contenu par un canal auxiliaire
-- (message d'erreur, journalisation).
ALTER VIEW public.utilisateurs_publics SET (security_barrier = true);

-- ---------------------------------------------------------------
-- 3. Même traitement pour les autres vues du projet
-- ---------------------------------------------------------------
-- Le piège des privilèges par défaut vaut pour TOUTE vue du schéma `public`.
-- Vérification faite côté application : aucune de ces vues n'est utilisée en
-- écriture par le front (lectures seules dans CommentsView et Dashboard), on
-- peut donc les verrouiller sans risque fonctionnel.
--
-- `IF EXISTS` implicite : ces vues peuvent ne pas toutes être présentes selon
-- l'environnement, d'où l'exécution conditionnelle.
DO $$
DECLARE
  v_vue TEXT;
BEGIN
  FOREACH v_vue IN ARRAY ARRAY[
    'comments_with_user',
    'documents_candidature_view',
    'documents_entreprise_view'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.views
       WHERE table_schema = 'public' AND table_name = v_vue
    ) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, public', v_vue);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v_vue);
      RAISE NOTICE 'Vue %: privilèges ramenés à SELECT pour authenticated', v_vue;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_name = 'utilisateurs_publics'
--    order by grantee, privilege_type;
--
-- Attendu :
--   - authenticated : SELECT, et RIEN D'AUTRE
--   - anon          : aucune ligne
--   - service_role / postgres : privilèges complets (rôles de confiance)
--
-- Puis, en tant qu'utilisateur authentifié, vérifier que l'écriture est bien
-- refusée :
--   update utilisateurs_publics set nom = 'test' where id = '<un tiers>';
--   -- attendu : ERROR: permission denied for view utilisateurs_publics

-- ---------------------------------------------------------------
-- VÉRIFICATION GLOBALE — aucune vue modifiable par un utilisateur
-- ---------------------------------------------------------------
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee in ('anon','authenticated')
--      and privilege_type <> 'SELECT'
--      and table_name in (select table_name from information_schema.views
--                          where table_schema = 'public');
--
-- Attendu : AUCUNE LIGNE. Toute ligne renvoyée signale une vue à travers
-- laquelle un utilisateur peut écrire en contournant le RLS de la table
-- sous-jacente.
--
-- ⚠️ À REJOUER APRÈS CHAQUE CRÉATION DE VUE : les privilèges par défaut de
--    Supabase s'appliquent automatiquement à tout nouvel objet du schéma
--    `public`. Créer une vue sans REVOKE revient à rouvrir cette faille.
