-- =============================================
-- FILAO: Migration 099 — Créer un dossier ne doit pas exiger qu'il existe déjà
-- =============================================
--
-- SYMPTÔME
-- Créer un dossier depuis l'assistant échoue en 403 :
--   « new row violates row-level security policy for table "reponses_ao" »
-- pour un utilisateur sous son quota, sur une ligne qui n'existe pas encore.
--
-- CAUSE — REPRODUITE, PUIS ISOLÉE PAR ÉLIMINATION
-- L'assistant crée le dossier par `upsert()`, soit `INSERT ... ON CONFLICT DO
-- UPDATE`. Un `INSERT` nu passe ; le même avec `ON CONFLICT` échoue. La clause
-- impose à PostgreSQL le droit de LECTURE sur la relation — il devra relire la
-- ligne en cas de conflit — et il applique donc la policy SELECT à la ligne
-- insérée, comme une condition d'insertion.
--
-- Or la policy SELECT n'était faite que de fonctions qui cherchent la ligne DANS
-- LA TABLE :
--
--     app.est_convie(id) OR app.voit_dossier_entreprise(id)
--
-- Sur une création, la table ne contient pas encore la ligne : les deux
-- renvoient false, la lecture est refusée, l'insertion avec. La policy de la
-- 068 (`app.est_membre`) avait la même structure ; la 074 et la 092 l'ont
-- conservée. Le défaut ne vient pas d'une migration récente.
--
-- CORRECTIF
-- Ajouter à la policy SELECT un critère lisible SUR LA LIGNE, sans recherche :
-- `createur_id = auth.uid()`. Le créateur voit ce qu'il insère, dès
-- l'insertion. Les autres branches sont conservées telles quelles.
--
-- On profite du passage pour écrire la policy UPDATE sur les colonnes elle
-- aussi. Ce n'était pas la cause — vérifié — mais c'est plus juste (on juge la
-- ligne qu'on écrit, pas celle qu'on remplace) et moins coûteux (aucune
-- sous-requête par ligne). `entreprise_id` est fiable : le déclencheur 092 la
-- pose avant l'évaluation et ignore la valeur fournie par le client.
--
-- ⚠️ DÉPEND des migrations 049, 068, 074, 092 et 093.

-- ---------------------------------------------------------------
-- 1. Lecture : le créateur voit sa ligne sans qu'elle ait à être trouvée
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "reponses_ao_select_convie_ou_entreprise" ON reponses_ao;
CREATE POLICY "reponses_ao_select_convie_ou_entreprise"
  ON reponses_ao FOR SELECT TO authenticated
  USING (
    createur_id = auth.uid()
    OR app.est_convie(id)
    OR app.voit_dossier_entreprise(id)
  );

-- ---------------------------------------------------------------
-- 2. Écriture : sur les colonnes de la ligne
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "reponses_ao_update_porteur_ou_admin" ON reponses_ao;
CREATE POLICY "reponses_ao_update_porteur_ou_admin"
  ON reponses_ao FOR UPDATE TO authenticated
  USING (
    NOT verrouille_par_quota
    AND (
      createur_id = auth.uid()
      OR (
        entreprise_id IS NOT NULL
        AND entreprise_id = app.entreprise_courante()
        AND public.est_admin_entreprise()
      )
    )
  )
  WITH CHECK (
    NOT verrouille_par_quota
    AND (
      createur_id = auth.uid()
      OR (
        entreprise_id IS NOT NULL
        AND entreprise_id = app.entreprise_courante()
        AND public.est_admin_entreprise()
      )
    )
  );

-- `app.peut_ecrire_dossier` reste en service : `depots_pieces`, `comments`,
-- `chat_messages`, `groupements` et la policy de stockage (094, 095, 096) s'en
-- servent sur des dossiers qui EXISTENT, où sa recherche est légitime.

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- Depuis l'application, créer un dossier depuis l'assistant : l'enregistrement
-- doit passer. C'est le test qui compte. Puis, dans la console du navigateur, avec un compte MEMBRE
-- (non admin), sur un dossier porté par un collègue :
--   await supabase.from('reponses_ao').update({ titre: 'X' }).eq('id', '<id>')
--   → 0 ligne modifiée.
-- Avec un ADMINISTRATEUR de l'entreprise porteuse : 1 ligne.
