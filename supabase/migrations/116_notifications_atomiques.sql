-- =============================================
-- FILAO: Migration 116 — Notifications : modifications atomiques
-- =============================================
--
-- PROBLÈME
-- `utilisateurs.notifications` (jsonb[]) était modifiée en « lire puis
-- réécrire » : le client lisait le tableau, marquait une notification comme
-- lue ou la supprimait, puis RÉÉCRIVAIT tout le tableau. Une notification
-- arrivée entre la lecture et l'écriture était écrasée — perdue. Les
-- fonctions serveur (notify-user, rappels, dépôts d'invités…) faisaient de
-- même pour ajouter : deux ajouts simultanés, et l'un disparaissait.
--
-- CORRECTIF
-- Chaque modification tient en UNE instruction UPDATE, calculée à partir de
-- la valeur courante de la ligne : Postgres la verrouille le temps de
-- l'écriture, les modifications concurrentes s'enchaînent au lieu de
-- s'écraser.

-- ---------------------------------------------------------------
-- 1. Pour l'utilisateur : lire / supprimer SES notifications
-- ---------------------------------------------------------------
-- `p_ids` NULL = toutes. SECURITY INVOKER : la policy de mise à jour (sa
-- propre ligne) et les protections de la 112 s'appliquent normalement.
CREATE OR REPLACE FUNCTION modifier_mes_notifications(p_action TEXT, p_ids TEXT[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_nb INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  IF p_action NOT IN ('lire', 'supprimer') THEN
    RAISE EXCEPTION 'Action inconnue : %', p_action;
  END IF;

  UPDATE utilisateurs u
     SET notifications = COALESCE((
           SELECT array_agg(
                    CASE WHEN p_action = 'lire' AND (p_ids IS NULL OR t.n ->> 'id' = ANY (p_ids))
                         THEN jsonb_set(t.n, '{read}', 'true'::jsonb)
                         ELSE t.n END
                    ORDER BY t.o)
             FROM unnest(u.notifications) WITH ORDINALITY AS t(n, o)
            WHERE NOT (p_action = 'supprimer' AND (p_ids IS NULL OR t.n ->> 'id' = ANY (p_ids)))
         ), '{}'::jsonb[])
   WHERE u.id = auth.uid();

  GET DIAGNOSTICS v_nb = ROW_COUNT;
  RETURN v_nb;
END;
$$;

REVOKE ALL ON FUNCTION modifier_mes_notifications(TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION modifier_mes_notifications(TEXT, TEXT[]) TO authenticated;

-- ---------------------------------------------------------------
-- 2. Pour le serveur : ajouter une notification en tête
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION ajouter_notification(p_utilisateur UUID, p_notification JSONB)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE utilisateurs
     SET notifications = array_prepend(p_notification, COALESCE(notifications, '{}'::jsonb[]))
   WHERE id = p_utilisateur
  RETURNING TRUE;
$$;

-- Réservée aux fonctions serveur : un client passe par `notify-user`, qui
-- contrôle la relation entre expéditeur et destinataire.
REVOKE ALL ON FUNCTION ajouter_notification(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ajouter_notification(UUID, JSONB) TO service_role;
