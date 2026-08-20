-- =============================================
-- FILAO: Migration 060 — Email de bienvenue à la création du profil (Lot 5)
-- =============================================
--
-- Enfile un email « bienvenue » dans la file quand un profil utilisateur est
-- créé. Passe par un trigger côté serveur plutôt que par le front : la RLS de
-- `emails_a_envoyer` réserve l'écriture au service_role, et un trigger
-- SECURITY DEFINER a les privilèges nécessaires quel que soit le chemin de
-- création (email/password, Google OAuth…).
--
-- Idempotence assurée par la clé unique de la file
-- (type_email, objet_id, destinataire, jour_cible) : même si le trigger se
-- déclenchait deux fois, un seul « bienvenue » serait enfilé le même jour.

CREATE OR REPLACE FUNCTION fn_enfiler_bienvenue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Un email de bienvenue nécessite une adresse.
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO emails_a_envoyer (type_email, objet_id, destinataire, jour_cible, payload)
  VALUES (
    'bienvenue',
    NEW.id,
    NEW.email,
    CURRENT_DATE,
    jsonb_build_object('prenom', COALESCE(NEW.prenom, ''))
  )
  ON CONFLICT DO NOTHING;  -- idempotent : pas de doublon

  RETURN NEW;
END;
$$;

-- Se déclenche une fois, à la création du profil.
DROP TRIGGER IF EXISTS trg_enfiler_bienvenue ON utilisateurs;
CREATE TRIGGER trg_enfiler_bienvenue
  AFTER INSERT ON utilisateurs
  FOR EACH ROW
  EXECUTE FUNCTION fn_enfiler_bienvenue();

-- Vérification :
--   insert into utilisateurs (id, email, prenom) values (gen_random_uuid(), 'x@y.fr', 'Alex');
--   select type_email, destinataire, payload from emails_a_envoyer where type_email = 'bienvenue';
