-- =============================================
-- FILAO: Migration 044 — Limitation de débit de l'accès invité
-- =============================================
--
-- CONTEXTE
-- La conception l'exige : « 20 requêtes par minute et par token, 100 par heure
-- et par IP. Sans cela, un token connu devient un canal d'upload anonyme. »
--
-- Le risque est réel : `upload-document` accepte des fichiers jusqu'à 25 Mo
-- sans authentification, sur simple présentation d'un jeton. Un jeton fuité —
-- une capture d'écran, un courriel transféré — suffit à faire de l'espace de
-- stockage un dépôt ouvert, aux frais du projet.
--
-- POURQUOI EN BASE
-- Les edge functions sont sans état et s'exécutent en parallèle sur plusieurs
-- instances : un compteur en mémoire ne verrait qu'une fraction du trafic. Le
-- compteur doit être partagé, donc persistant.

-- ---------------------------------------------------------------
-- 1. Table des compteurs
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acces_invite_debit (
    -- Empreinte du jeton ou adresse IP : jamais la valeur en clair, cette table
    -- n'a pas à contenir de secret.
    cle          TEXT NOT NULL,
    -- Début de la fenêtre glissante, arrondi à la minute ou à l'heure.
    fenetre      TIMESTAMPTZ NOT NULL,
    portee       TEXT NOT NULL CHECK (portee IN ('jeton_minute', 'ip_heure')),
    compteur     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (cle, fenetre, portee)
);

COMMENT ON TABLE acces_invite_debit IS
  'Compteurs de requêtes de l''accès invité. Fenêtres glissantes, purgées au fil de l''eau.';

-- Aucune policy : seule la clé de service y accède, via les edge functions.
ALTER TABLE acces_invite_debit ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- 2. Fonction de comptage
-- ---------------------------------------------------------------
-- Incrémente et répond en une seule opération : deux requêtes séparées
-- laisseraient une fenêtre où deux appels simultanés passeraient tous deux
-- sous la limite.

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
        ELSE NULL
    END;

    IF v_fenetre IS NULL OR p_cle IS NULL OR p_cle = '' THEN
        -- Portée inconnue ou clé absente : on laisse passer plutôt que de
        -- bloquer un appel légitime sur une erreur de programmation.
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

REVOKE ALL ON FUNCTION consommer_quota_invite(TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consommer_quota_invite(TEXT, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------
-- 3. Purge
-- ---------------------------------------------------------------
-- Sans purge, la table grossit indéfiniment : une ligne par jeton et par
-- minute. Deux heures de rétention suffisent, la plus longue fenêtre étant
-- l'heure.

CREATE OR REPLACE FUNCTION purger_quota_invite()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_supprimees INTEGER;
BEGIN
    DELETE FROM acces_invite_debit WHERE fenetre < now() - interval '2 hours';
    GET DIAGNOSTICS v_supprimees = ROW_COUNT;
    RETURN v_supprimees;
END;
$$;

-- Purge horaire. `pg_cron` est déjà en place pour les rappels de jalons.
SELECT cron.unschedule('purge-quota-invite')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-quota-invite');

SELECT cron.schedule('purge-quota-invite', '7 * * * *', $$ SELECT purger_quota_invite(); $$);

-- ---------------------------------------------------------------
-- 4. Vérification
-- ---------------------------------------------------------------
--   select * from consommer_quota_invite('test', 'jeton_minute', 3);
--   → autorise = true, restant décroissant ; false au 4ᵉ appel.
--
--   select portee, count(*) from acces_invite_debit group by 1;
--
-- ⚠️ Les limites sont volontairement larges : 20 requêtes par minute couvre un
--    invité qui dépose plusieurs pièces d'affilée. Elles visent l'usage
--    automatisé, pas l'usage pressé.