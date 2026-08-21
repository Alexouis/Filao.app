-- =============================================
-- FILAO: Migration 066 — Journal des connexions
-- =============================================
--
-- CONTEXTE
-- L'écran Sécurité doit présenter un historique des connexions récentes, pour
-- qu'un utilisateur repère un accès qu'il ne reconnaît pas. Supabase Auth ne
-- journalise pas ces événements de façon exploitable côté application ; on tient
-- donc notre propre journal.
--
-- Une ligne est écrite à chaque connexion réussie (e-mail comme Google), depuis
-- l'edge function `log-connexion` — qui seule voit l'adresse IP (en-tête de la
-- requête) et peut la renseigner. Le user-agent est transmis par le client.
--
-- RÉTENTION
-- Journal glissant : on ne conserve pas indéfiniment. Une purge (> 90 jours)
-- pourra être branchée en cron ; la donnée reste minimale (pas de contenu, juste
-- des métadonnées d'accès).

CREATE TABLE IF NOT EXISTS connexions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Métadonnées d'accès. Toutes nullables : on préfère une ligne incomplète à
  -- une connexion non tracée.
  ip          TEXT,
  user_agent  TEXT,
  -- Plateforme/nom lisible dérivé du user-agent côté serveur (ex. « Chrome sur
  -- macOS »), pour un affichage sans parsing côté client.
  appareil    TEXT,
  -- Méthode d'authentification : 'password' | 'google' | autre.
  methode     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Parcours principal : « mes connexions, les plus récentes d'abord ».
CREATE INDEX IF NOT EXISTS idx_connexions_user_date
  ON connexions (user_id, created_at DESC);

-- RLS : chacun ne voit QUE ses propres connexions. L'écriture passe par l'edge
-- function (service-role), pas par le client — mais on autorise aussi un insert
-- pour ses propres lignes par prudence si le flux évoluait.
ALTER TABLE connexions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "connexions_select" ON connexions;
CREATE POLICY "connexions_select"
  ON connexions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "connexions_insert" ON connexions;
CREATE POLICY "connexions_insert"
  ON connexions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE connexions IS
  'Journal des connexions réussies (métadonnées d''accès). Alimenté par log-connexion. Lecture cloisonnée au propriétaire.';
