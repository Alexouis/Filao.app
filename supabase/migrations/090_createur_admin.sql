-- =============================================
-- FILAO: Migration 090 — Le créateur d'une entreprise en est l'administrateur
-- =============================================
--
-- PROBLÈME
-- La migration 062 a promu administrateurs les créateurs d'entreprises
-- EXISTANTES, mais aucune règle ne couvre les créations FUTURES : un
-- utilisateur qui crée son entreprise reste au rôle « user ».
--
-- Conséquence visible depuis le détachement automatique (migration 089, qui
-- remet le rôle à « user » au départ) : quitter son entreprise pour en créer
-- une nouvelle laisse l'utilisateur simple membre de sa propre société — fiche
-- en lecture seule, aucune possibilité de valider un rattachement, et personne
-- d'autre pour le faire.
--
-- RÈGLE
-- Se rattacher à une entreprise que l'on a soi-même créée (`created_by`) et qui
-- n'a aucun autre administrateur actif confère le rôle admin. Le contrôle est
-- porté par un déclencheur : la règle vaut quel que soit le chemin d'écriture,
-- et le client ne peut pas s'auto-promouvoir ailleurs.

CREATE OR REPLACE FUNCTION promouvoir_createur_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_admin UUID;
BEGIN
  -- Seul un rattachement (changement d'entreprise) est concerné.
  IF NEW.entreprise_id IS NULL
     OR NEW.entreprise_id IS NOT DISTINCT FROM OLD.entreprise_id THEN
    RETURN NEW;
  END IF;

  -- L'entreprise doit avoir été créée par CET utilisateur.
  IF NOT EXISTS (
    SELECT 1 FROM entreprises e
     WHERE e.id = NEW.entreprise_id
       AND e.created_by = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_id_admin FROM roles WHERE name = 'admin';

  -- Un administrateur actif existe déjà ? On ne touche à rien : le créateur
  -- historique peut revenir dans une entreprise qui a vécu sans lui.
  IF EXISTS (
    SELECT 1 FROM utilisateurs u
     WHERE u.entreprise_id = NEW.entreprise_id
       AND u.id <> NEW.id
       AND u.role_id = v_id_admin
       AND u.compte_supprime_le IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  NEW.role_id := v_id_admin;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promouvoir_createur ON utilisateurs;
CREATE TRIGGER trg_promouvoir_createur
  BEFORE INSERT OR UPDATE OF entreprise_id ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION promouvoir_createur_admin();

-- ---------------------------------------------------------------
-- Reprise : créateurs actuellement simples membres de leur entreprise
-- ---------------------------------------------------------------
UPDATE utilisateurs u
   SET role_id = (SELECT id FROM roles WHERE name = 'admin')
  FROM entreprises e
 WHERE e.id = u.entreprise_id
   AND e.created_by = u.id
   AND u.compte_supprime_le IS NULL
   AND u.role_id <> (SELECT id FROM roles WHERE name = 'admin')
   AND NOT EXISTS (
     SELECT 1 FROM utilisateurs a
      WHERE a.entreprise_id = u.entreprise_id
        AND a.id <> u.id
        AND a.role_id = (SELECT id FROM roles WHERE name = 'admin')
        AND a.compte_supprime_le IS NULL
   );

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
--   -- Plus aucun créateur simple membre de sa propre entreprise sans admin :
--   select u.email, e.nom
--     from utilisateurs u
--     join entreprises e on e.id = u.entreprise_id and e.created_by = u.id
--     join roles r on r.id = u.role_id
--    where r.name <> 'admin';
--   -- attendu : uniquement des lignes où un AUTRE admin actif existe.
