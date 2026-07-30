-- =============================================
-- FILAO: Migration 047 — Réseau alimenté à toute acceptation
-- =============================================
--
-- CONTEXTE
-- « Dès qu'un utilisateur accepte une collaboration sur un AO, il est ajouté à
-- Mon réseau. » L'edge function `accept-invitation` le fait déjà, dans les deux
-- sens.
--
-- Mais il existe DEUX chemins d'acceptation :
--
--   1. `accept-invitation`  — utilisateur authentifié, depuis l'application
--   2. `respond_to_invitation` — page d'invitation, y compris après création de
--      compte depuis un lien reçu par courriel
--
-- Seul le premier alimentait le réseau. Or le second est justement le parcours
-- d'acquisition du produit : un partenaire invité qui crée son compte et
-- accepte n'apparaissait dans le réseau de personne. D'où le constat de recette
-- — « Mon Réseau reste à 0 malgré 4 AO en collaboration » — qui n'est pas un
-- problème d'affichage mais une acceptation qui ne relie rien.

-- ---------------------------------------------------------------
-- 1. Liaison réciproque
-- ---------------------------------------------------------------
-- Extraite en fonction : la logique était jusqu'ici écrite dans une edge
-- function, hors de portée de `respond_to_invitation`. La dupliquer en SQL
-- l'exposerait à diverger — les deux chemins doivent produire exactement le
-- même résultat.

CREATE OR REPLACE FUNCTION relier_entreprises(p_a UUID, p_b UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_creees INTEGER := 0;
BEGIN
    -- Rien à relier si l'une des deux entreprises est inconnue — cas d'un
    -- partenaire sans compte — ou s'il s'agit de la même.
    IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
        RETURN 0;
    END IF;

    -- Relation symétrique : appartenir au réseau de quelqu'un implique qu'il
    -- appartienne au vôtre. Deux lignes, pas une, parce que la table est
    -- orientée et que chaque entreprise interroge la sienne.
    INSERT INTO reseau_entreprises (entreprise_origine_id, entreprise_cible_id, statut)
         VALUES (p_a, p_b, 'actif'), (p_b, p_a, 'actif')
    ON CONFLICT (entreprise_origine_id, entreprise_cible_id) DO NOTHING;

    GET DIAGNOSTICS v_creees = ROW_COUNT;
    RETURN v_creees;
END;
$$;

REVOKE ALL ON FUNCTION relier_entreprises(UUID, UUID) FROM PUBLIC;

-- ---------------------------------------------------------------
-- 2. Acceptation par la page d'invitation
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION respond_to_invitation(p_token TEXT, p_status TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_maj INT;
    v_empreinte TEXT := empreinte_jeton(p_token);
    v_tender UUID;
    v_entreprise_invitee UUID;
    v_entreprise_porteuse UUID;
BEGIN
    IF p_status NOT IN ('accepted', 'refused') THEN
        RAISE EXCEPTION 'Statut invalide: %', p_status;
    END IF;
    IF v_empreinte IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE invitations
       SET status      = p_status,
           accepted_at = CASE WHEN p_status = 'accepted' THEN now() ELSE accepted_at END,
           refused_at  = CASE WHEN p_status = 'refused'  THEN now() ELSE refused_at  END
     WHERE token_hash = v_empreinte
       AND status = 'pending'
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
    RETURNING tender_id INTO v_tender;

    GET DIAGNOSTICS v_maj = ROW_COUNT;
    IF v_maj = 0 THEN
        RETURN FALSE;
    END IF;

    -- Mise en relation, uniquement sur acceptation. Un refus ne crée aucun lien.
    IF p_status = 'accepted' AND v_tender IS NOT NULL THEN
        -- L'entreprise de celui qui accepte n'est connue que s'il a un compte :
        -- un invité anonyme n'en a pas, et la liaison se fera à sa première
        -- connexion, par l'autre chemin.
        SELECT entreprise_id INTO v_entreprise_invitee
          FROM utilisateurs WHERE id = auth.uid();

        SELECT u.entreprise_id INTO v_entreprise_porteuse
          FROM reponses_ao r JOIN utilisateurs u ON u.id = r.createur_id
         WHERE r.id = v_tender;

        PERFORM relier_entreprises(v_entreprise_invitee, v_entreprise_porteuse);
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION respond_to_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION respond_to_invitation(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 3. Reprise de l'existant
-- ---------------------------------------------------------------
-- Les collaborations déjà acceptées n'ont créé aucun lien : elles sont passées
-- par le chemin qui ne reliait rien. On les rattrape, sans quoi « Mon réseau »
-- resterait vide pour tous les utilisateurs actuels.

INSERT INTO reseau_entreprises (entreprise_origine_id, entreprise_cible_id, statut)
SELECT DISTINCT g.entreprise_id, uc.entreprise_id, 'actif'
  FROM groupements g
  JOIN reponses_ao r  ON r.id = g.projet_id
  JOIN utilisateurs uc ON uc.id = r.createur_id
 WHERE g.statut = 'accepte'
   AND g.entreprise_id IS NOT NULL
   AND uc.entreprise_id IS NOT NULL
   AND g.entreprise_id <> uc.entreprise_id
ON CONFLICT (entreprise_origine_id, entreprise_cible_id) DO NOTHING;

-- Sens inverse.
INSERT INTO reseau_entreprises (entreprise_origine_id, entreprise_cible_id, statut)
SELECT DISTINCT uc.entreprise_id, g.entreprise_id, 'actif'
  FROM groupements g
  JOIN reponses_ao r  ON r.id = g.projet_id
  JOIN utilisateurs uc ON uc.id = r.createur_id
 WHERE g.statut = 'accepte'
   AND g.entreprise_id IS NOT NULL
   AND uc.entreprise_id IS NOT NULL
   AND g.entreprise_id <> uc.entreprise_id
ON CONFLICT (entreprise_origine_id, entreprise_cible_id) DO NOTHING;

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select count(*) from reseau_entreprises;
--   select e.nom, count(*) from reseau_entreprises r
--     join entreprises e on e.id = r.entreprise_origine_id group by 1;
--
-- ⚠️ Le lien demeure après un retrait du groupement : « avoir accepté une fois
--    met directement dans Mon réseau », y compris si la collaboration cesse.
--    Le retrait du réseau reste une action distincte et volontaire.