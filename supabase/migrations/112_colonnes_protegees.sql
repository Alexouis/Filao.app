-- =============================================
-- FILAO: Migration 112 — Colonnes sensibles protégées des écritures directes
-- =============================================
--
-- PROBLÈME
-- La policy de mise à jour de `utilisateurs` (« chacun sa ligne », créée hors
-- migrations) laisse le navigateur écrire TOUTES les colonnes de son profil.
-- Et celle d'`entreprises` (089) laisse un administrateur écrire toutes les
-- colonnes de sa fiche. D'où, par un simple appel à l'API :
--
--   - `utilisateurs.entreprise_id` : rejoindre N'IMPORTE QUELLE entreprise,
--     sans demande de rattachement — ses dossiers, son coffre-fort ;
--   - `utilisateurs.role_id`       : se nommer administrateur ;
--   - `utilisateurs.email`         : prendre l'adresse d'un invité. Plusieurs
--     fonctions identifient l'utilisateur par l'e-mail de son PROFIL
--     (accept-invitation, notify-user, send-reminder) : on acceptait alors
--     l'invitation d'un autre ;
--   - `entreprises.plan` et les champs Stripe : passer soi-même à l'offre
--     supérieure, sans paiement.
--
-- RÈGLE
-- Un déclencheur n'encadre que les écritures DIRECTES du client, reconnues à
-- `current_user = 'authenticated'`. Les chemins légitimes ne sont pas
-- concernés : les fonctions SECURITY DEFINER (rattachement, reprise, départ,
-- promotion du créateur) s'exécutent sous le rôle propriétaire, les Edge
-- Functions et le webhook Stripe sous `service_role`.
--
-- Côté client, restent permis :
--   - se rattacher à une entreprise QU'ON VIENT DE CRÉER, quand on n'en a pas ;
--   - un e-mail de profil égal à celui du compte d'authentification.
--
-- Les colonnes sont lues via `to_jsonb` : plusieurs ont été créées hors
-- migrations, et une colonne absente ne doit pas faire échouer toute écriture.
--
-- Les déclencheurs sont nommés `trg_0_…` pour passer AVANT ceux des 062 et
-- 090 (ordre alphabétique) : on contrôle la demande du client, puis la base
-- applique ses propres règles (rôle par défaut, promotion du créateur).

-- ---------------------------------------------------------------
-- Aides (SECURITY DEFINER : lecture de auth.users et d'entreprises)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.email_authentifie()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION app.entreprise_creee_par_moi(p_entreprise UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT EXISTS (SELECT 1 FROM entreprises WHERE id = p_entreprise AND created_by = auth.uid()) $$;

REVOKE ALL ON FUNCTION app.email_authentifie() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app.entreprise_creee_par_moi(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.email_authentifie() TO authenticated;
GRANT EXECUTE ON FUNCTION app.entreprise_creee_par_moi(UUID) TO authenticated;

-- ---------------------------------------------------------------
-- 1. Profil utilisateur
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_profil()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER          -- indispensable : `current_user` doit être l'appelant
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  v_email := app.email_authentifie();

  IF TG_OP = 'INSERT' THEN
    -- Création du profil à l'inscription : aucun rôle ni aucune entreprise
    -- choisis par le client. Le rôle par défaut est posé par la 062.
    NEW.role_id := NULL;
    NEW.entreprise_id := NULL;
    IF v_email IS NOT NULL THEN NEW.email := v_email; END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object('compte_supprime_le', NULL));
    RETURN NEW;
  END IF;

  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    RAISE EXCEPTION 'Le rôle ne se modifie pas directement.' USING ERRCODE = '42501';
  END IF;

  IF NEW.entreprise_id IS DISTINCT FROM OLD.entreprise_id THEN
    IF OLD.entreprise_id IS NOT NULL
       OR NEW.entreprise_id IS NULL
       OR NOT app.entreprise_creee_par_moi(NEW.entreprise_id) THEN
      RAISE EXCEPTION 'Rattachement à une entreprise : passez par une demande de rattachement.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email
     AND lower(coalesce(NEW.email, '')) IS DISTINCT FROM lower(coalesce(v_email, '')) THEN
    RAISE EXCEPTION 'L''adresse du profil doit être celle du compte.' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) -> 'compte_supprime_le') IS DISTINCT FROM (to_jsonb(OLD) -> 'compte_supprime_le') THEN
    RAISE EXCEPTION 'Colonne non modifiable.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_0_proteger_profil ON utilisateurs;
CREATE TRIGGER trg_0_proteger_profil
  BEFORE INSERT OR UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION app.proteger_profil();

-- ---------------------------------------------------------------
-- 2. Fiche entreprise : forfait, facturation, état de reprise
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.proteger_entreprise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  k TEXT;
  -- Colonnes que seuls le serveur (Stripe, fonctions) peut écrire.
  v_protegees TEXT[] := ARRAY[
    'plan', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status',
    'current_period_end', 'sans_membre_depuis', 'cle_reprise_hash',
    'cle_reprise_creee_le', 'created_by'
  ];
  v_neutre JSONB := '{}'::jsonb;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Une entreprise créée depuis l'application démarre sans abonnement, et
    -- appartient à celui qui la crée.
    FOREACH k IN ARRAY v_protegees LOOP
      v_neutre := v_neutre || jsonb_build_object(k, NULL);
    END LOOP;
    -- Offre gratuite (« partenaire ») plutôt que NULL : la colonne peut être
    -- NOT NULL, et 098 traite déjà NULL comme « partenaire ».
    NEW := jsonb_populate_record(NEW, v_neutre || jsonb_build_object(
      'plan', 'partenaire',
      'created_by', auth.uid()
    ));
    RETURN NEW;
  END IF;

  FOREACH k IN ARRAY v_protegees LOOP
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
      RAISE EXCEPTION 'La colonne « % » ne se modifie pas depuis l''application.', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_0_proteger_entreprise ON entreprises;
CREATE TRIGGER trg_0_proteger_entreprise
  BEFORE INSERT OR UPDATE ON entreprises
  FOR EACH ROW EXECUTE FUNCTION app.proteger_entreprise();

-- ---------------------------------------------------------------
-- Contrôle après application (avec un compte de test, depuis l'application
-- ou via l'API avec son jeton) :
--   update utilisateurs set role_id = (select id from roles where name='admin') where id = auth.uid();
--     -- attendu : « Le rôle ne se modifie pas directement. »
--   update utilisateurs set entreprise_id = '<autre entreprise>' where id = auth.uid();
--     -- attendu : « passez par une demande de rattachement »
--   update entreprises set plan = 'organisation' where id = '<la sienne>';
--     -- attendu : « La colonne « plan » ne se modifie pas… »
-- Et vérifier que l'onboarding complet (création d'entreprise) passe toujours.
