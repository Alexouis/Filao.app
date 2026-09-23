-- =============================================
-- FILAO: Migration 119 — Le badge « SIRET vérifié » ne vient que du serveur
-- =============================================
--
-- `entreprises.siret_verified` était écrit par le navigateur, dans la
-- sauvegarde de la fiche : n'importe qui pouvait afficher le badge sur une
-- fiche saisie à la main. La vérification passe désormais par l'Edge Function
-- `verifier-siret`, qui interroge le registre, réécrit les champs officiels
-- et pose le badge (en clé de service).
--
-- Reprise de `app.proteger_entreprise` (112), avec deux règles de plus pour
-- les écritures DIRECTES du client :
--   - le badge ne peut pas passer à vrai ;
--   - modifier un champ officiel (SIRET, raison sociale, adresse, forme
--     juridique, NAF, date de création) le fait retomber à faux : la fiche
--     n'est plus garantie conforme au registre.
-- Ni refus, ni erreur : la sauvegarde passe, le badge suit la réalité.

CREATE OR REPLACE FUNCTION app.proteger_entreprise()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  k TEXT;
  v_protegees TEXT[] := ARRAY[
    'plan', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status',
    'current_period_end', 'sans_membre_depuis', 'cle_reprise_hash',
    'cle_reprise_creee_le', 'created_by'
  ];
  -- Champs issus du registre : leur modification lève la garantie du badge.
  v_officiels TEXT[] := ARRAY[
    'siret', 'nom', 'adresse', 'ville', 'code_postal', 'forme_juridique', 'code_naf', 'date_creation'
  ];
  v_neutre   JSONB := '{}'::jsonb;
  v_modifie  BOOLEAN := FALSE;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    FOREACH k IN ARRAY v_protegees LOOP
      v_neutre := v_neutre || jsonb_build_object(k, NULL);
    END LOOP;
    NEW := jsonb_populate_record(NEW, v_neutre || jsonb_build_object(
      'plan', 'partenaire',
      'created_by', auth.uid(),
      'siret_verified', FALSE
    ));
    RETURN NEW;
  END IF;

  FOREACH k IN ARRAY v_protegees LOOP
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
      RAISE EXCEPTION 'La colonne « % » ne se modifie pas depuis l''application.', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF to_jsonb(NEW) ? 'siret_verified' THEN
    FOREACH k IN ARRAY v_officiels LOOP
      IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
        v_modifie := TRUE;
      END IF;
    END LOOP;
    NEW := jsonb_populate_record(NEW, jsonb_build_object(
      'siret_verified',
      COALESCE((to_jsonb(OLD) ->> 'siret_verified')::BOOLEAN, FALSE) AND NOT v_modifie
    ));
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------
-- Badges existants
-- ---------------------------------------------------------------
-- Ils ont été posés par le navigateur, sans garantie. On ne les retire pas
-- d'office — ce serait visible de tous les utilisateurs du jour au lendemain —
-- mais on peut les faire revérifier : chaque sauvegarde de fiche par un
-- administrateur rappelle `verifier-siret`. Pour lister ceux à contrôler :
--   select id, nom, siret from entreprises where siret_verified;
