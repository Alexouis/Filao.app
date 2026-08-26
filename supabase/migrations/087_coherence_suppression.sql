-- =============================================
-- FILAO: Migration 087 — Cohérence du processus de suppression
-- =============================================
--
-- Deux défauts apparus en relisant l'enchaînement complet.
--
-- ---------------------------------------------------------------
-- DÉFAUT 1 — le garde-fou d'administrateur était contournable
-- ---------------------------------------------------------------
-- `garantir_admin_entreprise` (migration 080) ne se déclenche que sur
-- `AFTER UPDATE OF role_id, entreprise_id OR DELETE`.
--
-- Or `delete-account` ANONYMISE le profil : il modifie `prenom`, `nom`, `email`,
-- … et `compte_supprime_le` — jamais `role_id` ni `entreprise_id`. Le
-- déclencheur ne voyait donc rien passer.
--
-- Conséquence : l'administrateur d'une entreprise à plusieurs membres pouvait
-- supprimer son compte, et l'entreprise se retrouvait SANS AUCUN ADMINISTRATEUR.
-- Plus personne ne pouvait alors valider une demande de rattachement — la règle
-- « une entreprise garde toujours un administrateur » était énoncée mais pas
-- appliquée.
--
-- On étend le déclenchement à `compte_supprime_le`, et on traite l'anonymisation
-- comme un départ : la succession s'applique (promotion automatique s'il ne
-- reste qu'un membre, refus explicite au-delà).

CREATE OR REPLACE FUNCTION garantir_admin_entreprise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entreprise UUID;
  v_id_admin   UUID;
  v_admins     INTEGER;
  v_membres    INTEGER;
  v_seul       UUID;
  v_part       BOOLEAN;
BEGIN
  v_entreprise := OLD.entreprise_id;
  IF v_entreprise IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT id INTO v_id_admin FROM roles WHERE name = 'admin';

  IF OLD.role_id IS DISTINCT FROM v_id_admin THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- L'ancienne ligne cesse-t-elle d'administrer cette entreprise ?
  -- Trois façons : suppression, changement de rôle ou d'entreprise, et
  -- désormais anonymisation — un compte anonymisé ne peut plus se connecter.
  v_part := TG_OP = 'DELETE'
         OR NEW.role_id IS DISTINCT FROM v_id_admin
         OR NEW.entreprise_id IS DISTINCT FROM v_entreprise
         OR (OLD.compte_supprime_le IS NULL AND NEW.compte_supprime_le IS NOT NULL);

  IF NOT v_part THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) FILTER (WHERE u.role_id = v_id_admin), count(*)
    INTO v_admins, v_membres
    FROM utilisateurs u
   WHERE u.entreprise_id = v_entreprise
     AND u.id <> OLD.id
     -- Les comptes anonymisés ne comptent pas : ils ne peuvent rien valider.
     AND u.compte_supprime_le IS NULL;

  IF v_admins > 0 OR v_membres = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_membres = 1 THEN
    SELECT u.id INTO v_seul
      FROM utilisateurs u
     WHERE u.entreprise_id = v_entreprise
       AND u.id <> OLD.id
       AND u.compte_supprime_le IS NULL;
    UPDATE utilisateurs SET role_id = v_id_admin WHERE id = v_seul;
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION
    'Designez un autre administrateur avant de quitter ce role : % membres sont rattaches a cette entreprise.',
    v_membres
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_garantir_admin ON utilisateurs;
CREATE TRIGGER trg_garantir_admin
  AFTER UPDATE OF role_id, entreprise_id, compte_supprime_le OR DELETE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION garantir_admin_entreprise();

-- ---------------------------------------------------------------
-- DÉFAUT 2 — une entreprise inutilisée n'était jamais supprimée
-- ---------------------------------------------------------------
-- `supprimer_entreprise_si_inutilisee` (migration 085) refuse de supprimer une
-- entreprise à laquelle un utilisateur est encore rattaché. Or `delete-account`
-- l'appelle AVANT de traiter le profil : l'appelant y figure donc toujours, et
-- la fonction renvoyait systématiquement FALSE.
--
-- Résultat : une entreprise jamais engagée — créée par erreur, abandonnée
-- aussitôt — restait indéfiniment en base avec son SIRET verrouillé, alors que
-- rien ne justifiait de la conserver.
--
-- On ignore désormais l'utilisateur en cours de suppression, transmis en
-- paramètre.
CREATE OR REPLACE FUNCTION supprimer_entreprise_si_inutilisee(
  p_entreprise UUID,
  p_hors_utilisateur UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_entreprise IS NULL THEN RETURN FALSE; END IF;

  IF EXISTS (SELECT 1 FROM groupements WHERE entreprise_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM documents_candidature WHERE entreprise_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM reseau_entreprises
                 WHERE entreprise_origine_id = p_entreprise
                    OR entreprise_cible_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM reponses_ao r
                  JOIN utilisateurs u ON u.id = r.createur_id
                 WHERE u.entreprise_id = p_entreprise)
     OR EXISTS (SELECT 1 FROM utilisateurs
                 WHERE entreprise_id = p_entreprise
                   AND (p_hors_utilisateur IS NULL OR id <> p_hors_utilisateur))
  THEN
    RETURN FALSE;
  END IF;

  -- Détacher l'utilisateur avant de supprimer : `utilisateurs.entreprise_id`
  -- est en CASCADE, sa ligne partirait avec l'entreprise alors qu'elle doit
  -- être traitée ensuite par `delete-account`.
  IF p_hors_utilisateur IS NOT NULL THEN
    UPDATE utilisateurs SET entreprise_id = NULL WHERE id = p_hors_utilisateur;
  END IF;

  DELETE FROM entreprises WHERE id = p_entreprise;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION supprimer_entreprise_si_inutilisee(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Aucune entreprise avec des membres actifs ne doit être sans admin :
--   select e.id, e.nom from entreprises e
--    where exists (select 1 from utilisateurs u
--                   where u.entreprise_id = e.id and u.compte_supprime_le is null)
--      and not exists (select 1 from utilisateurs u
--                        join roles r on r.id = u.role_id
--                       where u.entreprise_id = e.id
--                         and u.compte_supprime_le is null
--                         and r.name = 'admin');
--   -- attendu : aucune ligne.
