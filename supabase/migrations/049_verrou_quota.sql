-- =============================================
-- FILAO: Migration 049 — Verrouillage des dossiers au-delà du quota
-- =============================================
--
-- CONTEXTE
-- `canCreateTender` empêche d'ouvrir un dossier de trop. Mais rien ne traite le
-- dépassement survenu **rétroactivement** : résiliation, échec de paiement,
-- rétrogradation d'offre. L'utilisateur se retrouve alors avec plus de dossiers
-- portés que son forfait n'en autorise, sans que le système en tienne compte.
--
-- Critère d'acceptation : « un downgrade en dessous de l'usage met les dossiers
-- excédentaires en lecture seule, sans perte de donnée ».
--
-- POURQUOI UNE COLONNE DÉDIÉE
-- Réutiliser `statut` serait une erreur : on perdrait l'état réel du dossier —
-- en cours, déposé — et il ressortirait plus tard avec un statut faux. Le
-- verrou est une couche par-dessus, réversible, qui ne touche pas au métier.
--
-- Aucune donnée n'est jamais supprimée ni masquée : le dossier reste
-- consultable, exportable, et ses pièces téléchargeables.

ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS verrouille_par_quota BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verrouille_le TIMESTAMPTZ;

COMMENT ON COLUMN reponses_ao.verrouille_par_quota IS
  'Dossier au-delà du quota de l''offre : lecture seule, réversible. Distinct de `statut`, qui conserve l''état métier réel.';

-- Les écritures interrogeront ce drapeau à chaque enregistrement.
CREATE INDEX IF NOT EXISTS idx_reponses_ao_verrouille
  ON reponses_ao (createur_id) WHERE verrouille_par_quota;

-- ---------------------------------------------------------------
-- 1. Empêcher l'écriture sur un dossier verrouillé
-- ---------------------------------------------------------------
-- Le contrôle côté interface ne suffit pas : un appel direct à l'API le
-- contournerait. La policy UPDATE de `reponses_ao` est donc resserrée.
--
-- Exception : lever le verrou lui-même doit rester possible, sinon le dossier
-- serait définitivement bloqué. La fonction `basculer_verrou_quota` s'en charge
-- en SECURITY DEFINER, hors RLS.

DROP POLICY IF EXISTS "reponses_ao_update_own" ON reponses_ao;

CREATE POLICY "reponses_ao_update_own"
ON reponses_ao FOR UPDATE TO authenticated
USING (createur_id = auth.uid() AND NOT verrouille_par_quota)
WITH CHECK (createur_id = auth.uid());

-- ---------------------------------------------------------------
-- 2. Verrouillage automatique du dépassement
-- ---------------------------------------------------------------
-- Appelée après tout changement d'offre — webhook Stripe, rétrogradation
-- manuelle. Les dossiers les plus récemment modifiés sont verrouillés en
-- premier : celui sur lequel on travaillait reste ouvert.

CREATE OR REPLACE FUNCTION appliquer_quota_utilisateur(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_max INTEGER;
    v_verrouilles INTEGER := 0;
BEGIN
    SELECT pl.max_ao_simultanes INTO v_max
      FROM utilisateurs u
      JOIN plan_limits pl ON pl.plan = u.plan
     WHERE u.id = p_user_id;

    -- Offre illimitée ou inconnue : on lève tout verrou existant plutôt que de
    -- laisser un dossier bloqué par un quota qui ne s'applique plus.
    IF v_max IS NULL THEN
        UPDATE reponses_ao SET verrouille_par_quota = FALSE, verrouille_le = NULL
         WHERE createur_id = p_user_id AND verrouille_par_quota;
        RETURN 0;
    END IF;

    -- Les dossiers conservés : les plus récemment touchés, dans la limite du
    -- quota. `modified_at` peut être nul sur d'anciennes lignes, d'où le repli
    -- sur `created_at`.
    WITH portes AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   ORDER BY COALESCE(modified_at, created_at) DESC
               ) AS rang
          FROM reponses_ao
         WHERE createur_id = p_user_id
           AND statut = 'En cours'
    )
    UPDATE reponses_ao r
       SET verrouille_par_quota = (p.rang > v_max),
           verrouille_le = CASE WHEN p.rang > v_max THEN now() ELSE NULL END
      FROM portes p
     WHERE r.id = p.id
       AND r.verrouille_par_quota <> (p.rang > v_max);

    SELECT count(*) INTO v_verrouilles
      FROM reponses_ao
     WHERE createur_id = p_user_id AND verrouille_par_quota;

    RETURN v_verrouilles;
END;
$$;

REVOKE ALL ON FUNCTION appliquer_quota_utilisateur(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appliquer_quota_utilisateur(UUID) TO service_role, authenticated;

-- ---------------------------------------------------------------
-- 3. Choix de l'utilisateur
-- ---------------------------------------------------------------
-- « L'utilisateur choisit lequel il rouvre. » Rouvrir un dossier en verrouille
-- donc un autre : le quota reste respecté, mais c'est lui qui arbitre.

CREATE OR REPLACE FUNCTION basculer_verrou_quota(p_tender_id UUID, p_rouvrir BOOLEAN)
RETURNS TABLE (ok BOOLEAN, motif TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_max INTEGER;
    v_ouverts INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM reponses_ao WHERE id = p_tender_id AND createur_id = auth.uid()
    ) THEN
        RETURN QUERY SELECT FALSE, 'Dossier introuvable ou non porté par vous.';
        RETURN;
    END IF;

    IF NOT p_rouvrir THEN
        UPDATE reponses_ao SET verrouille_par_quota = TRUE, verrouille_le = now()
         WHERE id = p_tender_id;
        RETURN QUERY SELECT TRUE, NULL::TEXT;
        RETURN;
    END IF;

    SELECT pl.max_ao_simultanes INTO v_max
      FROM utilisateurs u JOIN plan_limits pl ON pl.plan = u.plan
     WHERE u.id = auth.uid();

    SELECT count(*) INTO v_ouverts
      FROM reponses_ao
     WHERE createur_id = auth.uid()
       AND statut = 'En cours'
       AND NOT verrouille_par_quota;

    -- `v_max` nul signifie illimité : la réouverture est toujours possible.
    IF v_max IS NOT NULL AND v_ouverts >= v_max THEN
        RETURN QUERY SELECT FALSE,
            format('Votre offre permet %s dossier(s) ouvert(s). Refermez-en un avant de rouvrir celui-ci.', v_max);
        RETURN;
    END IF;

    UPDATE reponses_ao SET verrouille_par_quota = FALSE, verrouille_le = NULL
     WHERE id = p_tender_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION basculer_verrou_quota(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION basculer_verrou_quota(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select appliquer_quota_utilisateur('<user_id>');   -- nombre de verrouillés
--   select titre, statut, verrouille_par_quota from reponses_ao
--    where createur_id = '<user_id>' order by verrouille_par_quota;
--
--   select * from basculer_verrou_quota('<tender_id>', true);
--
-- ⚠️ Cette migration ne verrouille rien d'elle-même : elle installe le
--    mécanisme. `appliquer_quota_utilisateur` doit être appelée à chaque
--    changement d'offre — c'est au webhook Stripe de le faire, ce qui reste à
--    câbler.