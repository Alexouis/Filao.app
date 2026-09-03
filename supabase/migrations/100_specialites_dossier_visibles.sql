-- =============================================
-- FILAO: Migration 100 — Compétences requises : même périmètre que le dossier
-- =============================================
--
-- SYMPTÔME
-- Sur le dossier d'un collègue, l'administrateur voit un potentiel de succès de
-- 85 %, le porteur 40 %. Le score n'est pas calculé différemment : 85 est la
-- valeur de repli quand AUCUNE compétence requise n'est lue. L'administrateur
-- reçoit une liste vide.
--
-- CAUSE
-- `reponses_ao_specialties_select_convie` (074) n'ouvre la table qu'à
-- `app.est_convie` : le porteur et les entreprises du groupement. Ce bug avait
-- déjà frappé les cotraitants — c'est pour eux que la 074 l'a élargie. Puis les
-- migrations 093 et 094 ont donné l'écriture et les échanges à l'administrateur,
-- sans toucher cette table. Il édite donc un dossier dont il ne voit pas les
-- exigences, et le score qu'on lui affiche est faux.
--
-- CE QUE CETTE TABLE PROTÈGE — RIEN
-- Les mêmes compétences sont écrites en clair dans `reponses_ao.required_skills`
-- (JSONB, migration 030), lisible par quiconque lit la ligne. La table de
-- jointure ne porte que les identifiants du référentiel. Restreindre sa lecture
-- ne cache donc rien ; cela ne fait que fausser les calculs qui en dépendent.
--
-- RÈGLE RETENUE
-- Aligner la lecture sur celle du dossier lui-même : qui voit le dossier voit
-- ce qu'il exige. Cela couvre l'administrateur (093), et les membres de
-- l'entreprise porteuse (092) — pour lesquels le panneau de consultation pourra
-- afficher les compétences attendues sans requête supplémentaire.
--
-- L'ÉCRITURE ne change pas : `reponses_ao_specialties` s'écrit avec le dossier,
-- par son porteur.
--
-- ⚠️ DÉPEND des migrations 074, 092, 093.

DROP POLICY IF EXISTS "reponses_ao_specialties_select_convie" ON reponses_ao_specialties;
DROP POLICY IF EXISTS "reponses_ao_specialties_select_dossier" ON reponses_ao_specialties;
CREATE POLICY "reponses_ao_specialties_select_dossier"
  ON reponses_ao_specialties FOR SELECT TO authenticated
  USING (
    app.est_convie(reponse_ao_id)
    OR app.peut_ecrire_dossier(reponse_ao_id)
    OR app.voit_dossier_entreprise(reponse_ao_id)
  );

-- ---------------------------------------------------------------
-- Contrôle après application
-- ---------------------------------------------------------------
-- ADMINISTRATEUR de l'entreprise porteuse, sur le dossier d'un collègue :
--   select count(*) from reponses_ao_specialties where reponse_ao_id = '<id>';
--   → même nombre que pour le porteur. Le score affiché doit coïncider.
--
-- Membre d'une AUTRE entreprise, non conviée : 0.
