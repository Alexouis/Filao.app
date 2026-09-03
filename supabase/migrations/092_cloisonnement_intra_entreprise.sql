-- =============================================
-- FILAO: Migration 092 — Cloisonnement intra-entreprise des dossiers
-- =============================================
--
-- PROBLÈME
-- Un membre ajouté à une entreprise accédait à l'intégralité des dossiers
-- portés par ses collègues : le dossier, la composition du groupement, les
-- échanges, et les pièces déposées par les entreprises tierces.
--
-- Ce n'était pas un choix, c'est un effet de bord. À la création d'un dossier,
-- le mandataire est inscrit dans `groupements` avec SA PROPRE entreprise au
-- statut « accepte » (TenderWizard, l.2117-2122). Or `app.est_membre` et
-- `app.est_convie` raisonnent à l'échelle de l'ENTREPRISE :
--
--     AND g.entreprise_id = app.entreprise_courante()
--
-- La règle est juste pour un cotraitant — une entreprise participe en tant
-- qu'entité, et n'importe lequel de ses salariés doit pouvoir travailler sur le
-- dossier. Appliquée à l'entreprise du mandataire, elle transmet son accès à
-- tous ses collègues.
--
-- `matrice-droits.md` porte `reponses_ao` SELECT ⛔ pour « Utilisateur de
-- l'entreprise » : le comportement contredisait la spécification.
-- `tests/cloisonnement.sh` ne l'a pas vu, car il éprouve le cloisonnement
-- INTER-entreprises et jamais deux collègues.
--
-- RÈGLE RETENUE
-- Séparer deux choses que le code confondait :
--
--   VOIR QU'UN DOSSIER EXISTE — intitulé, statut, échéance, porteur, montant
--   estimé. Ouvert à toute l'entreprise : le quota est compté à l'entreprise
--   (`dossiers_portes_entreprise`), un membre peut le saturer pour tous ; et si
--   le porteur s'en va (migrations 084, 089), quelqu'un doit pouvoir reprendre.
--
--   ACCÉDER À SON CONTENU — groupement, échanges, messagerie, pièces. Réservé
--   au mandataire et aux entreprises conviées. Les pièces déposées appartiennent
--   souvent à des tiers qui n'ont consenti qu'au groupement, pas à
--   l'organigramme du mandataire. C'est déjà la règle du coffre-fort
--   `documents_candidature`, non partagé même au sein d'un groupement.
--
-- Le montant estimé reste visible : c'est la valeur estimée DU MARCHÉ, saisie en
-- optionnel, et déjà affichée aux entreprises tierces invitées avant même
-- qu'elles acceptent (InvitationLanding, l.368).
--
-- POURQUOI UNE COLONNE, ET PAS UN SIMPLE TEST
-- Première version écrite : comparer la ligne de groupement à l'entreprise
-- ACTUELLE du porteur (`utilisateurs.entreprise_id` via `createur_id`). Le test
-- l'a démentie. Quand le porteur quitte son entreprise — ce que la migration 089
-- permet explicitement — cette entreprise devient NULL, la comparaison ne
-- distingue plus rien, et ses anciens collègues récupèrent la TOTALITÉ des
-- accès. Le correctif se désarmait précisément dans le cas qu'il devait couvrir.
--
-- L'entreprise porteuse est donc figée sur le dossier à sa création. C'est aussi
-- plus juste sur le fond : un dossier appartient à l'entreprise qui l'a déposé,
-- pas à l'employeur du moment de son auteur.
--
-- ⚠️ DÉPEND des migrations 067, 068, 069 et 074.

-- ---------------------------------------------------------------
-- 1. Ancrer l'entreprise porteuse sur le dossier
-- ---------------------------------------------------------------
ALTER TABLE reponses_ao
  ADD COLUMN IF NOT EXISTS entreprise_id UUID REFERENCES entreprises(id);

COMMENT ON COLUMN reponses_ao.entreprise_id IS
  'Entreprise qui porte le dossier, figée à la création. Ne suit pas les changements d''entreprise du créateur.';

-- Reprise de l'existant, en deux passes.
-- Passe 1 : l'entreprise actuelle du créateur, valable pour la quasi-totalité.
UPDATE reponses_ao r
   SET entreprise_id = u.entreprise_id
  FROM utilisateurs u
 WHERE u.id = r.createur_id
   AND r.entreprise_id IS NULL
   AND u.entreprise_id IS NOT NULL;

-- Passe 2 : pour les dossiers dont le créateur est déjà parti, on retrouve
-- l'entreprise par sa ligne de groupement « Mandataire ».
UPDATE reponses_ao r
   SET entreprise_id = g.entreprise_id
  FROM groupements g
 WHERE g.projet_id = r.id
   AND r.entreprise_id IS NULL
   AND g.role_groupement = 'Mandataire';

CREATE INDEX IF NOT EXISTS idx_reponses_ao_entreprise
  ON reponses_ao (entreprise_id);

-- ---------------------------------------------------------------
-- 2. Renseigner et verrouiller la colonne
-- ---------------------------------------------------------------
-- Par trigger et non côté client : le client ne peut pas l'oublier, et surtout
-- ne peut pas la choisir. Sans ce verrou, un membre pourrait rattacher son
-- dossier à l'entreprise d'un tiers et lui en ouvrir la visibilité.
CREATE OR REPLACE FUNCTION app.fixer_entreprise_dossier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- La valeur transmise par le client est ignorée, jamais reprise.
    SELECT u.entreprise_id INTO NEW.entreprise_id
      FROM public.utilisateurs u WHERE u.id = NEW.createur_id;
    RETURN NEW;
  END IF;

  -- Immuable : un transfert de dossier entre entreprises n'est pas un UPDATE
  -- de colonne, ce serait une opération métier à part entière.
  NEW.entreprise_id := OLD.entreprise_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fixer_entreprise_dossier ON reponses_ao;
CREATE TRIGGER trg_fixer_entreprise_dossier
  BEFORE INSERT OR UPDATE ON reponses_ao
  FOR EACH ROW EXECUTE FUNCTION app.fixer_entreprise_dossier();

-- ---------------------------------------------------------------
-- 3. Visibilité d'entreprise : l'existence du dossier
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.voit_dossier_entreprise(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao
       AND r.entreprise_id IS NOT NULL
       AND r.entreprise_id = app.entreprise_courante()
  );
$$;

COMMENT ON FUNCTION app.voit_dossier_entreprise(UUID) IS
  'Vrai si le dossier est porté par l''entreprise de l''appelant. N''ouvre que la LECTURE du dossier, jamais son contenu.';

GRANT EXECUTE ON FUNCTION app.voit_dossier_entreprise(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION app.voit_dossier_entreprise(UUID) FROM anon, public;

-- ---------------------------------------------------------------
-- 4. La ligne du mandataire ne vaut plus que pour lui
-- ---------------------------------------------------------------
-- Reprise de `app.est_convie` (074) et `app.est_membre` (067), à une condition
-- près : la ligne de groupement de l'entreprise PORTEUSE est écartée de la
-- clause « mon entreprise participe ». Le mandataire garde son accès par la
-- première clause (`createur_id`) ; ce sont ses collègues qui cessent d'en
-- hériter.
--
-- Deux garde-fous cumulés, tous deux fail-closed :
--   - l'entreprise porteuse figée sur le dossier (colonne ci-dessus) ;
--   - le rôle « Mandataire » de la ligne de groupement, en filet pour les
--     dossiers anciens dont la colonne n'aurait pu être reprise. Une ligne
--     mal étiquetée « Mandataire » RETIRE un accès, elle n'en accorde jamais :
--     l'erreur se paie en ticket support, pas en fuite de données.
CREATE OR REPLACE FUNCTION app.est_convie(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao AND r.createur_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
      FROM public.groupements g
      JOIN public.reponses_ao r ON r.id = g.projet_id
     WHERE g.projet_id = p_ao
       AND g.entreprise_id = app.entreprise_courante()
       -- « refuse » est volontairement exclu : une invitation déclinée ne
       -- redonne pas accès au dossier.
       AND g.statut IN ('accepte', 'invite')
       AND g.entreprise_id IS DISTINCT FROM r.entreprise_id
       AND COALESCE(g.role_groupement, '') <> 'Mandataire'
  );
$$;

COMMENT ON FUNCTION app.est_convie(UUID) IS
  'Vrai si l''utilisateur porte le dossier, ou si son entreprise y est conviée SANS en être l''entreprise porteuse. Conditionne la lecture du groupement et des compétences attendues.';

CREATE OR REPLACE FUNCTION app.est_membre(p_ao UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reponses_ao r
     WHERE r.id = p_ao AND r.createur_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
      FROM public.groupements g
      JOIN public.reponses_ao r ON r.id = g.projet_id
     WHERE g.projet_id = p_ao
       AND g.entreprise_id = app.entreprise_courante()
       AND g.statut = 'accepte'
       AND g.entreprise_id IS DISTINCT FROM r.entreprise_id
       AND COALESCE(g.role_groupement, '') <> 'Mandataire'
  );
$$;

COMMENT ON FUNCTION app.est_membre(UUID) IS
  'Vrai si l''utilisateur porte le dossier, ou si son entreprise y participe au statut accepte SANS en être l''entreprise porteuse. Ouvre les échanges et les dépôts.';

-- ---------------------------------------------------------------
-- 5. Lecture du dossier : conviés OU collègues du porteur
-- ---------------------------------------------------------------
-- Seule cette policy s'élargit. `groupements`, `reponses_ao_specialties`,
-- `comments`, `chat_messages` et `depots_pieces` restent sur `est_convie` /
-- `est_membre`, désormais resserrées : un collègue voit que le dossier existe,
-- sans lire la composition du groupement ni les échanges.
DROP POLICY IF EXISTS "reponses_ao_select_convie" ON reponses_ao;
-- Rejouable : sans ce second DROP, une reprise de la migration après un échec
-- partiel s'arrête sur « policy already exists ».
DROP POLICY IF EXISTS "reponses_ao_select_convie_ou_entreprise" ON reponses_ao;
CREATE POLICY "reponses_ao_select_convie_ou_entreprise"
  ON reponses_ao FOR SELECT TO authenticated
  USING (app.est_convie(id) OR app.voit_dossier_entreprise(id));

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Dossiers sans entreprise porteuse (les deux passes ont échoué) : ils ne
-- seront visibles que de leur porteur et des entreprises conviées.
--   select count(*) from reponses_ao where entreprise_id is null;
--
-- Avec le compte d'un COLLÈGUE du porteur, non convié :
--   select count(*) from reponses_ao   where id = '<dossier du collègue>';  -- 1
--   select count(*) from groupements   where projet_id = '<dossier>';       -- 0
--   select count(*) from chat_messages where tender_id = '<dossier>';       -- 0
--   select count(*) from comments      where tender_id = '<dossier>';       -- 0
--   update reponses_ao set titre = 'X' where id = '<dossier>';              -- 0
--
-- Avec un COTRAITANT accepté d'une autre entreprise : tous les accès d'avant
-- la migration doivent être conservés, y compris après départ du porteur.
--
-- NOTE — `dossiers_portes_entreprise` (migration 050) compte toujours les
-- dossiers en joignant `utilisateurs` sur `createur_id`. Un dossier dont le
-- porteur a quitté l'entreprise cesse donc d'être décompté du quota, alors
-- qu'il reste visible. La colonne `reponses_ao.entreprise_id` permettrait
-- d'aligner les deux ; non fait ici, cela modifierait la facturation.
