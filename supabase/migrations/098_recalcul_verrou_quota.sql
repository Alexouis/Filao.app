-- =============================================
-- FILAO: Migration 098 — Les verrous de quota se recalculent seuls
-- =============================================
--
-- SYMPTÔME
-- Un dossier reste `verrouille_par_quota = TRUE` alors que l'entreprise est
-- largement sous sa limite (6 dossiers pour une offre à 10). Toute écriture est
-- refusée par `reponses_ao_update_porteur_ou_admin`, qui exige
-- `NOT verrouille_par_quota` : PostgREST répond 403.
--
-- CAUSE
-- `appliquer_quota_entreprise` (migration 050) est la seule fonction qui pose et
-- lève les verrous, et elle n'est appelée QUE par `stripe-webhook`. Le verrou
-- est donc un état figé, recalculé sur les seuls événements Stripe. Trois
-- situations le laissent périmé :
--
--   - le forfait d'une entreprise est changé en base sans passer par Stripe —
--     c'est le cas de tout compte de test, et de toute correction manuelle ;
--   - `plan_limits.max_ao_simultanes` est modifié. Depuis que la table est la
--     source de vérité, changer un quota ne demande plus de livrer une version.
--     Mais rien ne recalculait les verrous : le quota changeait, les dossiers
--     restaient bloqués ;
--   - un dossier est clôturé, libérant une place. Le message d'erreur du quota
--     conseille pourtant « finalisez-en un » — un conseil qui ne produisait
--     aucun effet.
--
-- CORRECTIF
-- Recalculer là où le quota change réellement : le forfait d'une entreprise, la
-- définition d'un forfait, le statut d'un dossier. Le verrou redevient une
-- conséquence, non un état à entretenir.
--
-- ⚠️ DÉPEND des migrations 048, 049, 050 et 068.

-- ---------------------------------------------------------------
-- 1. La levée du verrou doit être plus large que sa pose
-- ---------------------------------------------------------------
-- La version 050 ne considère que les dossiers « En cours » : un dossier
-- verrouillé qui change de statut sort du périmètre de la fonction et reste
-- verrouillé pour toujours, sans qu'aucun appel puisse le libérer. On dissocie
-- donc les deux gestes — on lève partout, on pose sur les seuls dossiers en
-- cours au-delà du rang autorisé.
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
    IF p_entreprise_id IS NULL THEN
        RETURN 0;
    END IF;

    v_max := quota_entreprise(p_entreprise_id);

    -- Levée systématique de tout verrou devenu sans objet : offre illimitée,
    -- ou dossier qui n'est plus « En cours ». Fail-open assumé — un dossier
    -- verrouillé à tort est invisible et irréparable pour l'utilisateur, alors
    -- qu'un dossier ouvert à tort se voit et se corrige au recalcul suivant.
    UPDATE reponses_ao r
       SET verrouille_par_quota = FALSE, verrouille_le = NULL
      FROM utilisateurs u
     WHERE u.id = r.createur_id
       AND u.entreprise_id = p_entreprise_id
       AND r.verrouille_par_quota
       AND (v_max IS NULL OR r.statut <> 'En cours');

    IF v_max IS NULL THEN
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

-- ---------------------------------------------------------------
-- 2. Changement de forfait d'une entreprise
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.recalculer_quota_entreprise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.appliquer_quota_entreprise(NEW.id);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcul_quota_plan ON entreprises;
CREATE TRIGGER trg_recalcul_quota_plan
    AFTER UPDATE OF plan ON entreprises
    FOR EACH ROW
    WHEN (OLD.plan IS DISTINCT FROM NEW.plan)
    EXECUTE FUNCTION app.recalculer_quota_entreprise();

-- ---------------------------------------------------------------
-- 3. Changement de la définition d'un forfait
-- ---------------------------------------------------------------
-- C'est le cas qui manquait le plus : `plan_limits` est la source de vérité des
-- quotas, modifiable sans redéploiement. Sans ce recalcul, relever une limite
-- laissait les dossiers verrouillés — et l'abaisser n'en verrouillait aucun.
CREATE OR REPLACE FUNCTION app.recalculer_quota_forfait()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entreprise UUID;
BEGIN
    FOR v_entreprise IN
        SELECT id FROM public.entreprises WHERE COALESCE(plan, 'partenaire') = NEW.plan
    LOOP
        PERFORM public.appliquer_quota_entreprise(v_entreprise);
    END LOOP;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcul_quota_forfait ON plan_limits;
CREATE TRIGGER trg_recalcul_quota_forfait
    AFTER UPDATE OF max_ao_simultanes ON plan_limits
    FOR EACH ROW
    WHEN (OLD.max_ao_simultanes IS DISTINCT FROM NEW.max_ao_simultanes)
    EXECUTE FUNCTION app.recalculer_quota_forfait();

-- ---------------------------------------------------------------
-- 4. Clôture d'un dossier
-- ---------------------------------------------------------------
-- « Finalisez-en un ou changez d'offre » : le premier terme du conseil ne
-- produisait aucun effet, rien ne recalculant après une clôture.
--
-- Pas de récursion : `appliquer_quota_entreprise` n'écrit que
-- `verrouille_par_quota`, et ce déclencheur ne réagit qu'à `statut`.
CREATE OR REPLACE FUNCTION app.recalculer_quota_apres_statut()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entreprise UUID;
BEGIN
    SELECT entreprise_id INTO v_entreprise
      FROM public.utilisateurs WHERE id = NEW.createur_id;
    IF v_entreprise IS NOT NULL THEN
        PERFORM public.appliquer_quota_entreprise(v_entreprise);
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcul_quota_statut ON reponses_ao;
CREATE TRIGGER trg_recalcul_quota_statut
    AFTER UPDATE OF statut ON reponses_ao
    FOR EACH ROW
    WHEN (OLD.statut IS DISTINCT FROM NEW.statut)
    EXECUTE FUNCTION app.recalculer_quota_apres_statut();

-- ---------------------------------------------------------------
-- 5. Rattrapage de l'existant
-- ---------------------------------------------------------------
-- Les verrous périmés déjà en base ne se lèveront pas seuls : aucune des
-- opérations ci-dessus ne s'est produite depuis. On repasse une fois sur toutes
-- les entreprises concernées.
DO $$
DECLARE
    v_entreprise UUID;
BEGIN
    FOR v_entreprise IN
        SELECT DISTINCT u.entreprise_id
          FROM reponses_ao r
          JOIN utilisateurs u ON u.id = r.createur_id
         WHERE r.verrouille_par_quota
           AND u.entreprise_id IS NOT NULL
    LOOP
        PERFORM appliquer_quota_entreprise(v_entreprise);
    END LOOP;
END $$;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Dossiers encore verrouillés, et le quota de leur entreprise :
--   select e.nom, quota_entreprise(e.id) as quota,
--          count(*) filter (where r.verrouille_par_quota) as verrouilles,
--          count(*) filter (where r.statut = 'En cours')  as en_cours
--     from reponses_ao r
--     join utilisateurs u on u.id = r.createur_id
--     join entreprises  e on e.id = u.entreprise_id
--    group by e.nom, e.id
--   having count(*) filter (where r.verrouille_par_quota) > 0;
--
-- Attendu : aucune ligne où `verrouilles > 0` alors que `en_cours <= quota`.
--
--   update plan_limits set max_ao_simultanes = 10 where plan = 'equipe';
--   -- les dossiers des entreprises « equipe » se déverrouillent d'eux-mêmes.
