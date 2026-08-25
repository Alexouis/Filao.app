#!/usr/bin/env bash
# =============================================================================
# FILAO — Tests de cloisonnement inter-entreprises (C1 → C8)
# =============================================================================
#
# Vérifie qu'un compte ne peut accéder ni aux dossiers, ni aux groupements, ni
# aux pièces d'une autre entreprise. Les appels sont faits DIRECTEMENT sur
# l'API REST, sans passer par l'application : c'est le seul moyen de tester les
# policies elles-mêmes et non les filtres de l'interface.
#
# À REJOUER À CHAQUE LIVRAISON touchant une policy.
#
# PRÉREQUIS — deux comptes de test appartenant à DEUX entreprises différentes,
# et un dossier créé par chacun.
#
# USAGE
#   cp tests/cloisonnement.env.example tests/cloisonnement.env
#   # renseigner les variables, puis :
#   ./tests/cloisonnement.sh
#
# Sortie : une ligne par test, OK ou ÉCHEC, et un code de retour non nul si au
# moins un test échoue (utilisable en intégration continue).

set -uo pipefail

ENV_FILE="$(dirname "$0")/cloisonnement.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${SUPABASE_URL:?SUPABASE_URL manquant}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY manquant}"
: "${C1_EMAIL:?C1_EMAIL manquant}"
: "${C1_PASSWORD:?C1_PASSWORD manquant}"
: "${C2_EMAIL:?C2_EMAIL manquant}"
: "${C2_PASSWORD:?C2_PASSWORD manquant}"

REST="$SUPABASE_URL/rest/v1"
AUTH="$SUPABASE_URL/auth/v1"

echecs=0
total=0

resultat() { # $1 = libellé, $2 = ok|ko, $3 = détail
  total=$((total + 1))
  if [[ "$2" == "ok" ]]; then
    printf '  \033[32mOK\033[0m    %s\n' "$1"
  else
    echecs=$((echecs + 1))
    printf '  \033[31mÉCHEC\033[0m %s\n        → %s\n' "$1" "$3"
  fi
}

connexion() { # $1 = email, $2 = mot de passe ; renvoie le jeton
  curl -s -X POST "$AUTH/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
}

appel() { # $1 = jeton, $2 = chemin REST ; renvoie le corps
  curl -s "$REST/$2" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $1"
}

nb_lignes() { # compte les objets d'un tableau JSON (approximation suffisante)
  local corps="$1"
  if [[ "$corps" == "[]" ]]; then echo 0
  else echo "$corps" | grep -o '"id"' | wc -l | tr -d ' '
  fi
}

echo "── Connexion des deux comptes ─────────────────────────────"
T1="$(connexion "$C1_EMAIL" "$C1_PASSWORD")"
T2="$(connexion "$C2_EMAIL" "$C2_PASSWORD")"
[[ -n "$T1" ]] || { echo "Connexion C1 impossible"; exit 1; }
[[ -n "$T2" ]] || { echo "Connexion C2 impossible"; exit 1; }
echo "  deux jetons obtenus"
echo

echo "── C1..C4 — Cloisonnement des écrans (lecture via REST) ───"

# C1 — Tableau de bord / Mes AO : chaque compte ne voit que ses dossiers.
ao1="$(appel "$T1" 'reponses_ao?select=id,createur_id')"
ao2="$(appel "$T2" 'reponses_ao?select=id,createur_id')"
if [[ -n "${C2_AO_ID:-}" ]] && echo "$ao1" | grep -q "$C2_AO_ID"; then
  resultat "C1 Mes AO — C1 ne voit pas le dossier de C2" ko "le dossier $C2_AO_ID apparaît chez C1"
else
  resultat "C1 Mes AO — C1 ne voit pas le dossier de C2" ok ""
fi

# C2 — Symétrie : C2 ne voit pas le dossier de C1.
if [[ -n "${C1_AO_ID:-}" ]] && echo "$ao2" | grep -q "$C1_AO_ID"; then
  resultat "C2 Mes AO — C2 ne voit pas le dossier de C1" ko "le dossier $C1_AO_ID apparaît chez C2"
else
  resultat "C2 Mes AO — C2 ne voit pas le dossier de C1" ok ""
fi

# C3 — Calendrier : mêmes données source, donc même cloisonnement attendu.
cal1="$(appel "$T1" 'reponses_ao?select=id,date_limite')"
if [[ -n "${C2_AO_ID:-}" ]] && echo "$cal1" | grep -q "$C2_AO_ID"; then
  resultat "C3 Calendrier — aucune échéance d'un tiers" ko "échéance du dossier de C2 visible"
else
  resultat "C3 Calendrier — aucune échéance d'un tiers" ok ""
fi

# C4 — Messagerie : aucun message d'un dossier tiers.
msg1="$(appel "$T1" 'chat_messages?select=id,tender_id')"
if [[ -n "${C2_AO_ID:-}" ]] && echo "$msg1" | grep -q "$C2_AO_ID"; then
  resultat "C4 Messagerie — aucun message d'un dossier tiers" ko "messages du dossier de C2 visibles"
else
  resultat "C4 Messagerie — aucun message d'un dossier tiers" ok ""
fi

echo
echo "── C5..C6 — Accès REST direct à un objet précis ───────────"

# C5 — GET /reponses_ao sur l'identifiant exact d'un dossier tiers.
if [[ -n "${C2_AO_ID:-}" ]]; then
  direct="$(appel "$T1" "reponses_ao?id=eq.$C2_AO_ID&select=id,montant_estime")"
  if [[ "$(nb_lignes "$direct")" == "0" ]]; then
    resultat "C5 GET /reponses_ao?id=<dossier tiers> — 0 ligne" ok ""
  else
    resultat "C5 GET /reponses_ao?id=<dossier tiers> — 0 ligne" ko "réponse : $direct"
  fi
else
  resultat "C5 GET /reponses_ao?id=<dossier tiers>" ko "C2_AO_ID non renseigné"
fi

# C6 — GET /groupements sur un dossier tiers : la composition de l'équipe est
# une information concurrentielle.
if [[ -n "${C2_AO_ID:-}" ]]; then
  grp="$(appel "$T1" "groupements?projet_id=eq.$C2_AO_ID&select=id,entreprise_id")"
  if [[ "$(nb_lignes "$grp")" == "0" ]]; then
    resultat "C6 GET /groupements?projet_id=<dossier tiers> — 0 ligne" ok ""
  else
    resultat "C6 GET /groupements?projet_id=<dossier tiers> — 0 ligne" ko "réponse : $grp"
  fi
else
  resultat "C6 GET /groupements?projet_id=<dossier tiers>" ko "C2_AO_ID non renseigné"
fi

echo
echo "── C7..C8 — Jetons d'invitation ───────────────────────────"
# L'accès d'un invité sans compte ne passe pas par une Edge Function mais par la
# fonction RPC `get_invitation_by_token`, qui valide le jeton et ne renvoie que
# les informations non confidentielles du dossier. C'est donc elle qu'on teste.
#
# Une RPC PostgREST renvoie HTTP 200 même quand elle ne trouve rien : on juge sur
# le CONTENU (aucune donnée exploitable), pas sur le code de statut.

rpc_invitation() { # $1 = jeton
  curl -s -X POST "$REST/rpc/get_invitation_by_token" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"p_token\":\"$1\"}"
}

# C7 — Jeton appartenant à un tiers : ne doit rien renvoyer d'exploitable.
if [[ -n "${TOKEN_TIERS:-}" ]]; then
  corps="$(rpc_invitation "$TOKEN_TIERS")"
  if [[ "$corps" == "[]" || "$corps" == "null" || -z "$corps" ]]; then
    resultat "C7 Jeton d'un tiers — aucune donnée renvoyée" ok ""
  else
    resultat "C7 Jeton d'un tiers — aucune donnée renvoyée" ko "réponse : ${corps:0:200}"
  fi
else
  echo "  (ignoré) C7 — TOKEN_TIERS non renseigné"
fi

# C8 — Jeton expiré : refus, sans divulguer le contenu du dossier.
if [[ -n "${TOKEN_EXPIRE:-}" ]]; then
  corps="$(rpc_invitation "$TOKEN_EXPIRE")"
  if [[ "$corps" == "[]" || "$corps" == "null" || -z "$corps" ]]; then
    resultat "C8 Jeton expiré — aucune donnée renvoyée" ok ""
  elif echo "$corps" | grep -qi "expir"; then
    # Certaines implémentations renvoient un statut explicite plutôt qu'un vide :
    # acceptable tant qu'aucune donnée du dossier n'accompagne le message.
    if echo "$corps" | grep -qiE "montant|acheteur|titre"; then
      resultat "C8 Jeton expiré — aucune donnée renvoyée" ko "le refus expose des données : ${corps:0:200}"
    else
      resultat "C8 Jeton expiré — refus explicite sans données" ok ""
    fi
  else
    resultat "C8 Jeton expiré — aucune donnée renvoyée" ko "réponse : ${corps:0:200}"
  fi
else
  echo "  (ignoré) C8 — TOKEN_EXPIRE non renseigné"
fi

# C9 — Le jeton ne doit JAMAIS exposer de montant, même valide. C'est la limite
# de ce que voit un invité : intitulé, acheteur, date limite, mandataire, rôle
# proposé, pièces demandées — rien de plus.
if [[ -n "${TOKEN_VALIDE:-}" ]]; then
  corps="$(rpc_invitation "$TOKEN_VALIDE")"
  if echo "$corps" | grep -qiE '"montant|budget|prix'; then
    resultat "C9 Jeton valide — aucun montant exposé" ko "un montant figure dans la réponse"
  else
    resultat "C9 Jeton valide — aucun montant exposé" ok ""
  fi
else
  echo "  (ignoré) C9 — TOKEN_VALIDE non renseigné"
fi

echo
echo "──────────────────────────────────────────────────────────"
if [[ "$echecs" -eq 0 ]]; then
  printf '\033[32m%d/%d tests passés — cloisonnement vérifié\033[0m\n' "$total" "$total"
  exit 0
else
  printf '\033[31m%d/%d tests en échec — NE PAS LIVRER\033[0m\n' "$echecs" "$total"
  exit 1
fi
