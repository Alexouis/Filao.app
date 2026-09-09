/**
 * Tests des helpers qui dépendent du navigateur.
 *
 * POURQUOI UN FICHIER À PART
 * `tests/unit.test.ts` couvre des fonctions pures et tourne sous Node nu. Les
 * helpers réunis ici lisent `window.location`, `document.referrer` ou
 * `sessionStorage` : ils ont besoin d'un DOM, donc du même `setupDom.ts` que
 * les tests de composants. Les mêler aux tests purs obligerait à installer
 * happy-dom pour 110 tests qui n'en ont pas l'usage.
 *
 *   npx tsx --test tests/navigateur.test.ts
 */
import './setupDom.ts';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  captureAcquisitionParams, getAcquisitionParams, resolveSourceInscription,
} from '../src/helpers/acquisitionHelpers.ts';

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------
const CLE = 'filao_acquisition';

/** Place le visiteur sur une URL donnée, avec un referrer choisi. */
const arriverSur = (url: string, referrer = '') => {
  (window as any).happyDOM.setURL(url);
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true });
};

beforeEach(() => {
  sessionStorage.clear();
  arriverSur('https://app.filao.io/');
});

// ===========================================================================
// Capture des paramètres d'acquisition
// ===========================================================================
test('captureAcquisitionParams : relève les UTM de l’URL de premier contact', () => {
  arriverSur('https://app.filao.io/inscription?utm_source=linkedin&utm_medium=social&utm_campaign=ao2026');
  captureAcquisitionParams();

  const acq = getAcquisitionParams();
  assert.equal(acq.utm_source, 'linkedin');
  assert.equal(acq.utm_medium, 'social');
  assert.equal(acq.utm_campaign, 'ao2026');
  // Le chemin d'arrivée distingue un lien profond d'une entrée par la racine.
  assert.equal(acq.landing_path, '/inscription');
  assert.ok(acq.captured_at, 'horodatage du premier contact attendu');
});

test('captureAcquisitionParams : first-touch — une seconde visite n’écrase pas la première', () => {
  // C'est toute la raison d'être du module : après la redirection OAuth Google,
  // l'URL a perdu ses UTM. Si la capture s'écrasait, l'origine réelle du
  // visiteur serait remplacée par « rien » au moment précis de l'inscription.
  arriverSur('https://app.filao.io/?utm_source=linkedin');
  captureAcquisitionParams();

  arriverSur('https://app.filao.io/?utm_source=facebook');
  captureAcquisitionParams();

  assert.equal(getAcquisitionParams().utm_source, 'linkedin');
});

test('captureAcquisitionParams : sans signal exploitable, rien n’est figé', () => {
  // Ne pas figer un « direct » prématuré : le visiteur peut recharger la page
  // depuis un lien de campagne quelques instants plus tard.
  captureAcquisitionParams();
  assert.equal(sessionStorage.getItem(CLE), null);
  assert.deepEqual(getAcquisitionParams(), {});
});

test('captureAcquisitionParams : un referrer interne ne compte pas comme provenance', () => {
  // Une navigation d'un écran à l'autre de l'app laisse un referrer sur notre
  // propre domaine — le retenir ferait passer chaque visiteur pour un
  // « referral » venu de nous-mêmes.
  arriverSur('https://app.filao.io/tableau-de-bord', 'https://app.filao.io/connexion');
  captureAcquisitionParams();
  assert.equal(sessionStorage.getItem(CLE), null);
});

test('captureAcquisitionParams : un referrer externe suffit à déclencher la capture', () => {
  arriverSur('https://app.filao.io/', 'https://www.google.com/');
  captureAcquisitionParams();
  assert.equal(getAcquisitionParams().referrer, 'https://www.google.com/');
});

test('captureAcquisitionParams : la valeur d’un UTM est bornée à 200 caractères', () => {
  // Borne défensive : ces valeurs viennent de l'URL, donc de l'extérieur, et
  // finissent en base.
  arriverSur(`https://app.filao.io/?utm_campaign=${'x'.repeat(500)}`);
  captureAcquisitionParams();
  assert.equal(getAcquisitionParams().utm_campaign?.length, 200);
});

// ===========================================================================
// Relecture
// ===========================================================================
test('getAcquisitionParams : session vide → objet vide, jamais d’exception', () => {
  assert.deepEqual(getAcquisitionParams(), {});
});

test('getAcquisitionParams : contenu illisible → objet vide plutôt qu’une erreur', () => {
  // La lecture ne doit jamais interrompre une inscription en cours.
  sessionStorage.setItem(CLE, '{ceci n’est pas du JSON');
  assert.deepEqual(getAcquisitionParams(), {});
});

// ===========================================================================
// Source d'inscription — référentiel contraint en base (migration 045)
// ===========================================================================
const SOURCES_AUTORISEES = ['invitation', 'annuaire', 'landing', 'referral', 'direct'];

test('resolveSourceInscription : une invitation prime sur tout le reste', () => {
  arriverSur('https://app.filao.io/?utm_source=linkedin');
  captureAcquisitionParams();
  assert.equal(resolveSourceInscription('ao-123'), 'invitation');
});

test('resolveSourceInscription : des UTM désignent une campagne', () => {
  arriverSur('https://app.filao.io/?utm_medium=cpc');
  captureAcquisitionParams();
  assert.equal(resolveSourceInscription(null), 'landing');
});

test('resolveSourceInscription : un referrer externe sans UTM est un referral', () => {
  arriverSur('https://app.filao.io/', 'https://www.boamp.fr/');
  captureAcquisitionParams();
  assert.equal(resolveSourceInscription(null), 'referral');
});

test('resolveSourceInscription : sans rien, direct', () => {
  assert.equal(resolveSourceInscription(null), 'direct');
  assert.equal(resolveSourceInscription(undefined), 'direct');
});

test('resolveSourceInscription : toute issue respecte la contrainte CHECK en base', () => {
  // `utilisateurs.source_inscription` porte un CHECK : une valeur hors liste
  // ferait échouer l'inscription elle-même, pas seulement le suivi marketing.
  const cas: [string | null, string][] = [
    ['ao-1', 'avec invitation'],
    [null, 'sans invitation'],
  ];
  for (const [invitation, libelle] of cas) {
    assert.ok(SOURCES_AUTORISEES.includes(resolveSourceInscription(invitation)), libelle);
  }
});
