-- =============================================
-- FILAO: Migration 046 — Limitation de la réinitialisation de mot de passe
-- =============================================
--
-- CONTEXTE
-- La conception fixe 3 demandes par heure et par adresse, 10 par heure et par
-- IP. Sans limite, le formulaire de mot de passe oublié devient un moyen
-- d'inonder une boîte de réception : il suffit de connaître l'adresse d'une
-- personne pour lui envoyer autant de courriels que l'on veut, signés Filao.
-- Notre domaine finit signalé en spam, ce qui dégrade la délivrabilité de tous
-- les envois du produit.
--
-- Les compteurs de la migration 044 sont réutilisés : même table, même fonction,
-- une portée supplémentaire.

-- ---------------------------------------------------------------
-- 1. Nouvelles portées
-- ---------------------------------------------------------------
ALTER TABLE acces_invite_debit DROP CONSTRAINT IF EXISTS acces_invite_debit_portee_check;

ALTER TABLE acces_invite_debit
  ADD CONSTRAINT acces_invite_debit_portee_check
  CHECK (portee IN ('jeton_minute', 'ip_heure', 'email_heure', 'renvoi_jour'));

COMMENT ON TABLE acces_invite_debit IS
  'Compteurs de requêtes : accès invité, réinitialisation de mot de passe, renvoi de lien de vérification. Fenêtres glissantes, purgées au fil de l''eau.';

-- ---------------------------------------------------------------
-- 2. Fenêtres correspondantes
-- ---------------------------------------------------------------
-- `consommer_quota_invite` calcule la fenêtre d'après la portée : les deux
-- nouvelles doivent y être connues, sinon elles retombent sur la branche
-- « portée inconnue » qui laisse tout passer.

CREATE OR REPLACE FUNCTION consommer_quota_invite(
    p_cle     TEXT,
    p_portee  TEXT,
    p_limite  INTEGER
)
RETURNS TABLE (autorise BOOLEAN, restant INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_fenetre TIMESTAMPTZ;
    v_compteur INTEGER;
BEGIN
    v_fenetre := CASE p_portee
        WHEN 'jeton_minute' THEN date_trunc('minute', now())
        WHEN 'ip_heure'     THEN date_trunc('hour', now())
        WHEN 'email_heure'  THEN date_trunc('hour', now())
        -- Renvoi du lien de vérification : 5 par jour, la fenêtre suit.
        WHEN 'renvoi_jour'  THEN date_trunc('day', now())
        ELSE NULL
    END;

    IF v_fenetre IS NULL OR p_cle IS NULL OR p_cle = '' THEN
        RETURN QUERY SELECT TRUE, p_limite;
        RETURN;
    END IF;

    INSERT INTO acces_invite_debit (cle, fenetre, portee, compteur)
         VALUES (p_cle, v_fenetre, p_portee, 1)
    ON CONFLICT (cle, fenetre, portee)
      DO UPDATE SET compteur = acces_invite_debit.compteur + 1
      RETURNING compteur INTO v_compteur;

    RETURN QUERY SELECT v_compteur <= p_limite, GREATEST(p_limite - v_compteur, 0);
END;
$$;

-- ---------------------------------------------------------------
-- 3. Contrôle appelable depuis le navigateur
-- ---------------------------------------------------------------
-- La demande de réinitialisation part du client, sans session : elle ne peut
-- pas passer par une edge function protégée. Cette fonction est donc ouverte à
-- `anon`, mais ne renvoie qu'un booléen et n'expose aucune donnée — surtout
-- pas l'existence de l'adresse, qui reste indécelable.

CREATE OR REPLACE FUNCTION peut_demander_reinitialisation(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_autorise BOOLEAN;
BEGIN
    IF p_email IS NULL OR btrim(p_email) = '' THEN
        RETURN FALSE;
    END IF;

    -- L'adresse est hachée avant comptage : cette table n'a pas à contenir
    -- d'adresses en clair, et l'empreinte suffit à compter.
    SELECT autorise INTO v_autorise
      FROM consommer_quota_invite(
             encode(digest(lower(btrim(p_email)), 'sha256'), 'hex'),
             'email_heure',
             3);

    RETURN COALESCE(v_autorise, TRUE);
END;
$$;

REVOKE ALL ON FUNCTION peut_demander_reinitialisation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peut_demander_reinitialisation(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 4. Renvoi du lien de vérification
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION peut_renvoyer_verification(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
    v_jour BOOLEAN;
BEGIN
    IF p_email IS NULL OR btrim(p_email) = '' THEN
        RETURN FALSE;
    END IF;

    -- 5 par jour. La limite d'un envoi par minute est tenue côté interface,
    -- par un compte à rebours : c'est une gêne d'ergonomie, pas une protection.
    SELECT autorise INTO v_jour
      FROM consommer_quota_invite(
             encode(digest(lower(btrim(p_email)), 'sha256'), 'hex'),
             'renvoi_jour',
             5);

    RETURN COALESCE(v_jour, TRUE);
END;
$$;

REVOKE ALL ON FUNCTION peut_renvoyer_verification(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peut_renvoyer_verification(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------
-- 5. Vérification
-- ---------------------------------------------------------------
--   select peut_demander_reinitialisation('test@exemple.fr');  -- true, 3 fois
--   select peut_demander_reinitialisation('test@exemple.fr');  -- false ensuite
--
--   select portee, count(*) from acces_invite_debit group by 1;