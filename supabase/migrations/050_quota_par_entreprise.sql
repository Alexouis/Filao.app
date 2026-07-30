-- =============================================
-- FILAO: Migration 050 — Quota par entreprise
-- =============================================
--
-- DEUX CORRECTIONS
--
-- 1. Le quota se compte par ENTREPRISE, pas par utilisateur.
--    Le forfait appartient à `entreprises`, et `equipe` autorise 5 membres. Le
--    décompte portant sur `createur_id`, deux collègues en forfait Solo
--    pouvaient porter 3 dossiers chacun — soit 6 pour une offre qui en autorise
--    3. Le quota était contournable en invitant un collègue.
--
-- 2. Ce qui compte est le CRÉATEUR du dossier, pas le mandataire.
--    Le rôle de mandataire est cessible : il se transmet à un autre membre du
--    groupement. Fonder le quota dessus le rendrait transférable, et un dossier
--    changerait de facturation en changeant de porteur. La création, elle, est
--    un fait qui ne se cède pas.
--
--    La règle implémentée était déjà celle-ci ; c'est le vocabulaire des
--    messages qui parlait à tort de « mandataire ».
--
-- 3. Le contrôle est désormais posé EN BASE.
--    Il n'existait que côté interface, donc contournable par un appel direct à
--    l'API. Un quota qui ne tient qu'à un bouton grisé n'est pas un quota.

-- ---------------------------------------------------------------
-- 1. Décompte de référence
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION dossiers_portes_entreprise(p_entreprise_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    -- Créés par un membre de l'entreprise, encore en cours, et non déjà
    -- verrouillés — un dossier verrouillé ne consomme plus sa place, sinon il
    -- serait impossible d'en rouvrir un.
    SELECT count(*)::INTEGER
      FROM reponses_ao r
      JOIN utilisateurs u ON u.id = r.createur_id
     WHERE u.entreprise_id = p_entreprise_id
       AND r.statut = 'En cours'
       AND NOT r.verrouille_par_quota;
$$;

REVOKE ALL ON FUNCTION dossiers_portes_entreprise(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dossiers_portes_entreprise(UUID) TO authenticated, service_role;

/** Quota de l'entreprise. NULL = illimité. */
CREATE OR REPLACE FUNCTION quota_entreprise(p_entreprise_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT pl.max_ao_simultanes
      FROM entreprises e
      JOIN plan_limits pl ON pl.plan = e.plan
     WHERE e.id = p_entreprise_id;
$$;

REVOKE ALL ON FUNCTION quota_entreprise(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quota_entreprise(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 2. Contrôle à la création
-- ---------------------------------------------------------------
-- Un déclencheur plutôt qu'une policy : une policy ne peut pas produire de
-- message explicatif, et le message est ici la moitié de la fonctionnalité —
-- « vous portez déjà 3 dossiers » vaut mieux qu'un refus muet.

CREATE OR REPLACE FUNCTION verifier_quota_avant_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entreprise UUID;
    v_max INTEGER;
    v_portes INTEGER;
BEGIN
    -- Seuls les dossiers en cours consomment : un brouillon ou un dossier
    -- importé au statut déposé n'a rien à décompter.
    IF NEW.statut <> 'En cours' THEN
        RETURN NEW;
    END IF;

    SELECT entreprise_id INTO v_entreprise FROM utilisateurs WHERE id = NEW.createur_id;
    IF v_entreprise IS NULL THEN
        -- Utilisateur sans entreprise : on laisse passer plutôt que de bloquer
        -- un compte en cours d'intégration.
        RETURN NEW;
    END IF;

    v_max := quota_entreprise(v_entreprise);
    IF v_max IS NULL THEN
        RETURN NEW;   -- offre illimitée
    END IF;

    v_portes := dossiers_portes_entreprise(v_entreprise);

    IF v_portes >= v_max THEN
        RAISE EXCEPTION
          'QUOTA_DOSSIERS: votre entreprise porte déjà % dossier(s) en cours, la limite de votre offre. Finalisez-en un ou changez d''offre.',
          v_portes
          USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quota_avant_creation ON reponses_ao;
CREATE TRIGGER trg_quota_avant_creation
    BEFORE INSERT ON reponses_ao
    FOR EACH ROW EXECUTE FUNCTION verifier_quota_avant_creation();

-- ---------------------------------------------------------------
-- 3. Verrouillage à l'échelle de l'entreprise
-- ---------------------------------------------------------------
-- Remplace `appliquer_quota_utilisateur`, qui ne traitait que les dossiers d'un
-- membre : une baisse de forfait laissait ceux des collègues ouverts.

CREATE OR REPLACE FUNCTION appliquer_quota_entreprise(p_entreprise_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_max INTEGER;
    v_verrouilles INTEGER := 0;
BEGIN
    v_max := quota_entreprise(p_entreprise_id);

    -- Offre illimitée ou inconnue : on lève tout verrou, sans quoi un dossier
    -- resterait bloqué par un quota qui ne s'applique plus.
    IF v_max IS NULL THEN
        UPDATE reponses_ao r SET verrouille_par_quota = FALSE, verrouille_le = NULL
          FROM utilisateurs u
         WHERE u.id = r.createur_id
           AND u.entreprise_id = p_entreprise_id
           AND r.verrouille_par_quota;
        RETURN 0;
    END IF;

    WITH portes AS (
        SELECT r.id,
               ROW_NUMBER() OVER (
                   ORDER BY COALESCE(r.modified_at, r.created_at) DESC
               ) AS rang
          FROM reponses_ao r
          JOIN utilisateurs u ON u.id = r.createur_id
         WHERE u.entreprise_id = p_entreprise_id
           AND r.statut = 'En cours'
    )
    UPDATE reponses_ao r
       SET verrouille_par_quota = (p.rang > v_max),
           verrouille_le = CASE WHEN p.rang > v_max THEN now() ELSE NULL END
      FROM portes p
     WHERE r.id = p.id
       AND r.verrouille_par_quota <> (p.rang > v_max);

    SELECT count(*) INTO v_verrouilles
      FROM reponses_ao r JOIN utilisateurs u ON u.id = r.createur_id
     WHERE u.entreprise_id = p_entreprise_id AND r.verrouille_par_quota;

    RETURN v_verrouilles;
END;
$$;

REVOKE ALL ON FUNCTION appliquer_quota_entreprise(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION appliquer_quota_entreprise(UUID) TO service_role, authenticated;

-- Conservée pour compatibilité : elle délègue désormais à l'entreprise.
CREATE OR REPLACE FUNCTION appliquer_quota_utilisateur(p_user_id UUID)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT appliquer_quota_entreprise(u.entreprise_id)
      FROM utilisateurs u WHERE u.id = p_user_id;
$$;

-- ---------------------------------------------------------------
-- 4. Réouverture, au niveau de l'entreprise
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION basculer_verrou_quota(p_tender_id UUID, p_rouvrir BOOLEAN)
RETURNS TABLE (ok BOOLEAN, motif TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entreprise UUID;
    v_max INTEGER;
    v_portes INTEGER;
BEGIN
    -- Un membre de l'entreprise peut arbitrer, pas seulement le créateur : le
    -- quota est partagé, la décision l'est aussi.
    SELECT u_moi.entreprise_id INTO v_entreprise
      FROM utilisateurs u_moi
     WHERE u_moi.id = auth.uid();

    IF v_entreprise IS NULL OR NOT EXISTS (
        SELECT 1 FROM reponses_ao r JOIN utilisateurs u ON u.id = r.createur_id
         WHERE r.id = p_tender_id AND u.entreprise_id = v_entreprise
    ) THEN
        RETURN QUERY SELECT FALSE, 'Dossier introuvable ou hors de votre entreprise.';
        RETURN;
    END IF;

    IF NOT p_rouvrir THEN
        UPDATE reponses_ao SET verrouille_par_quota = TRUE, verrouille_le = now()
         WHERE id = p_tender_id;
        RETURN QUERY SELECT TRUE, NULL::TEXT;
        RETURN;
    END IF;

    v_max := quota_entreprise(v_entreprise);
    v_portes := dossiers_portes_entreprise(v_entreprise);

    IF v_max IS NOT NULL AND v_portes >= v_max THEN
        RETURN QUERY SELECT FALSE,
            format('Votre offre permet %s dossier(s) ouvert(s), et votre entreprise en a déjà %s. Refermez-en un avant de rouvrir celui-ci.', v_max, v_portes);
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
-- 5. Vérification
-- ---------------------------------------------------------------
--   select e.nom, quota_entreprise(e.id) as quota,
--          dossiers_portes_entreprise(e.id) as portes
--     from entreprises e order by 3 desc;
--
-- Un dépassement existant se corrige par :
--   select appliquer_quota_entreprise('<entreprise_id>');
--
-- ⚠️ Le déclencheur refuse désormais la création au-delà du quota, y compris
--    par appel direct à l'API. Le message porte le préfixe `QUOTA_DOSSIERS:`
--    pour que le front puisse le reconnaître et l'afficher tel quel.