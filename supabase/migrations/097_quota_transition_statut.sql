-- =============================================
-- FILAO: Migration 097 — Le quota s'applique au passage « En cours »
-- =============================================
--
-- DEUX DÉFAUTS, TROUVÉS EN REPRODUISANT UN REFUS 403 À LA CRÉATION D'UN DOSSIER.
--
-- 1. LE QUOTA SE CONTOURNE PAR LE BROUILLON
-- `verifier_quota_avant_creation` est un déclencheur BEFORE **INSERT** seul, et
-- il ne se prononce que sur `statut = 'En cours'`. Or l'assistant crée d'abord
-- un brouillon, puis le bascule en « En cours » par un UPDATE — sur lequel
-- aucun contrôle ne s'exerce.
--
-- Vérifié en reproduction : avec une offre à 0 dossier, l'insertion directe en
-- « En cours » est bien refusée, mais « brouillon puis bascule » passe. Le
-- quota n'était donc opposable qu'à un parcours que l'application n'emprunte
-- pas.
--
-- 2. LE QUOTA SE DÉCLENCHE SUR UNE MISE À JOUR
-- PostgREST traduit `upsert()` en `INSERT ... ON CONFLICT DO UPDATE`, et
-- PostgreSQL exécute les déclencheurs BEFORE INSERT sur la ligne proposée AVANT
-- de détecter le conflit. Le contrôle de quota s'exécutait donc à chaque
-- enregistrement d'un dossier existant, et pouvait refuser une simple
-- modification avec un message absurde : « votre entreprise porte déjà 0
-- dossier(s) ».
--
-- CE QUE CETTE MIGRATION NE CORRIGE PAS
-- Le refus 403 lui-même. Il vient de `reponses_ao_update_porteur_ou_admin`, qui
-- exige `NOT verrouille_par_quota` (règle issue de la migration 068) : un
-- dossier verrouillé n'accepte plus aucune écriture, et PostgREST renvoie 42501
-- sans message exploitable. C'est le comportement voulu ; c'est son EXPLICATION
-- qui manquait, et elle est ajoutée côté client.
--
-- ⚠️ DÉPEND des migrations 049, 050 et 068.

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

    -- Sur INSERT, ne rien vérifier si la ligne EXISTE déjà : c'est alors un
    -- `ON CONFLICT DO UPDATE` déguisé, traité par la branche UPDATE ci-dessous.
    -- Sans ce test, enregistrer un dossier déjà « En cours » rejouait le
    -- contrôle et pouvait le refuser alors que rien n'était créé.
    IF TG_OP = 'INSERT'
       AND EXISTS (SELECT 1 FROM public.reponses_ao r WHERE r.id = NEW.id) THEN
        RETURN NEW;
    END IF;

    -- Sur UPDATE, ne vérifier qu'au FRANCHISSEMENT. Un dossier déjà « En
    -- cours » se modifie librement : le décompter à chaque enregistrement le
    -- rendrait immodifiable dès que l'entreprise atteint sa limite, y compris
    -- pour le refermer.
    IF TG_OP = 'UPDATE' AND OLD.statut IS NOT DISTINCT FROM 'En cours' THEN
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
        -- Message distinct quand l'offre n'autorise AUCUN dossier : « vous en
        -- portez déjà 0 » n'a aucun sens, et c'est le cas de l'offre Réseau.
        IF v_max = 0 THEN
            RAISE EXCEPTION
              'QUOTA_DOSSIERS: votre offre ne permet pas de porter de dossier. Elle donne accès aux groupements auxquels vous êtes invité. Changez d''offre pour déposer vos propres réponses.'
              USING ERRCODE = 'check_violation';
        END IF;

        RAISE EXCEPTION
          'QUOTA_DOSSIERS: votre entreprise porte déjà % dossier(s) en cours, la limite de votre offre. Finalisez-en un ou changez d''offre.',
          v_portes
          USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- Le déclencheur couvre désormais les deux opérations.
DROP TRIGGER IF EXISTS trg_quota_avant_creation ON reponses_ao;
CREATE TRIGGER trg_quota_avant_creation
    BEFORE INSERT OR UPDATE OF statut ON reponses_ao
    FOR EACH ROW EXECUTE FUNCTION verifier_quota_avant_creation();

-- `UPDATE OF statut` restreint le déclenchement aux écritures touchant cette
-- colonne. L'assistant écrit `statut` à chaque enregistrement, la garde
-- ci-dessus sur `OLD.statut` reste donc indispensable — ce filtre n'est qu'une
-- économie, pas une protection.

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Avec un compte dont l'offre autorise 0 dossier :
--   insert into reponses_ao (id, titre, createur_id, statut)
--        values (gen_random_uuid(), 'x', auth.uid(), 'Brouillon');   -- accepté
--   update reponses_ao set statut = 'En cours' where id = '<ci-dessus>';
--   -- refusé, message « votre offre ne permet pas de porter de dossier »
--
-- Avec une offre à 3 dossiers et 1 seul en cours : la même bascule passe.
-- Sur un dossier DÉJÀ « En cours », modifier le titre reste possible même si
-- l'entreprise est à sa limite.
