/**
 * Tests unitaires de la logique métier pure (helpers).
 *
 * Ne nécessite AUCUN backend : ces fonctions sont déterministes. Lancé avec
 * le runner intégré de Node (node --test via tsx).
 *
 *   npx tsx --test tests/unit.test.ts
 *
 * Couvre les modules sensibles : validation SIREN/SIRET/email/date, détection
 * de type de fichier par octets (sécurité dépôt), quotas de forfait, statut
 * effectif d'un dossier, génération du rétroplanning, nommage des pièces,
 * codes d'accès invité, repli des forfaits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emailValide, normaliserEmail, nettoyerTexteLibre, contientBalise,
  sirenValide, siretValide, messageErreurIdentifiantAcheteur, dateValide,
} from '../src/helpers/validationHelpers.ts';

import {
  detecterType, verifierFichier, REGLES, OCTETS_A_LIRE,
} from '../src/helpers/fileValidation.ts';

import {
  getEffectiveStatus, isActive, isUrgent, joursAvantEcheance, consommeQuota,
  URGENCE_SEUIL_JOURS,
} from '../src/helpers/tenderHelpers.ts';

import {
  genererJalons, estEnRetard, jalonsAffichables, prochainJalon,
} from '../src/helpers/jalonHelpers.ts';

import {
  nomPieceCollaborateur, lirePieceCollaborateur, clePieceCollaborateur, concernePiece,
} from '../src/helpers/documentNaming.ts';

import {
  genererCodeAcces, masquerJeton, masquerJetonDansTexte, genererTokenInvitation,
} from '../src/helpers/inviteCodeHelpers.ts';

import { lienExterne } from '../src/helpers/textHelpers.ts';

import { estDossierDunCollegue, estEnLectureSeule } from '../src/helpers/accesDossier.ts';
import { canCreateTender } from '../src/helpers/planHelpers.ts';
import { buildICalendar } from '../src/helpers/icalHelpers.ts';
import {
  correspondRecherche, correspondCategorie, correspondRole,
  dossierVisible, filtrerEtTrierDossiers,
} from '../src/helpers/listeDossiersHelpers.ts';
import {
  extractCpvCodes, cpvDivision, normaliserPoids, avisEncoreOuvert,
  dedoublonnerAvis, reparerEncodage,
} from '../src/helpers/boampHelpers.ts';

import {
  specialitesCouvertes, specialitesManquantes, lectureCompetencesEchouee,
  scoreSucces, gainPotentiel, joursRestants, roleUtilisateur, dossierTermine,
  jaugeScore,
} from '../src/helpers/decisionHelpers.ts';

import {
  piecesAttenduesPourRole, membreComptabilise, piecesAttendues,
  calculerProgression, progressionDossier, libelleStatut,
} from '../src/helpers/progressionHelpers.ts';

import {
  forfait, tousLesForfaits, illimite, prixLisible, type Forfait,
} from '../src/helpers/planLimits.ts';

import { STATUSES, PLANS_CONFIG } from '../src/config.ts';

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------
const bytes = (...b: number[]) => new Uint8Array(b);
const pad2048 = (head: number[]) => {
  const u = new Uint8Array(64);
  head.forEach((v, i) => (u[i] = v));
  return u;
};
// yyyy-MM-dd en local à n jours d'aujourd'hui
const isoDans = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ===========================================================================
// 1. VALIDATION — email
// ===========================================================================
test('emailValide accepte les adresses courantes', () => {
  for (const e of ['a@b.fr', 'jean.dupont@societe.co.uk', 'x+y@z.io', 'A@B.FR ']) {
    assert.equal(emailValide(e), true, e);
  }
});
test('emailValide rejette les formes manifestement erronées', () => {
  for (const e of ['', '   ', 'abc', 'a@b', 'a@@b.fr', 'a b@c.fr', 'a@b .fr', null, undefined]) {
    assert.equal(emailValide(e as any), false, String(e));
  }
});
test('emailValide rejette au-delà de 254 caractères', () => {
  const long = 'a'.repeat(250) + '@b.fr';
  assert.equal(emailValide(long), false);
});
test('normaliserEmail met en minuscule et retire les espaces', () => {
  assert.equal(normaliserEmail('  Jean.DUPONT@Societe.FR '), 'jean.dupont@societe.fr');
  assert.equal(normaliserEmail(null), '');
});

// ===========================================================================
// 2. VALIDATION — nettoyage texte / balises
// ===========================================================================
test('nettoyerTexteLibre retire balises et caractères de contrôle et borne la longueur', () => {
  assert.equal(nettoyerTexteLibre('  <script>alert(1)</script>Dupont  '), 'alert(1)Dupont');
  assert.equal(nettoyerTexteLibre('a\u0000b\u001Fc'), 'abc');
  assert.equal(nettoyerTexteLibre('x'.repeat(200), 120).length, 120);
});
test('contientBalise détecte balise et caractère de contrôle', () => {
  assert.equal(contientBalise('<b>'), true);
  assert.equal(contientBalise('a\u0007b'), true);
  assert.equal(contientBalise('Dupont & Fils'), false);
});

// ===========================================================================
// 3. VALIDATION — SIREN / SIRET (Luhn)
// ===========================================================================
test('sirenValide : clé de Luhn correcte', () => {
  assert.equal(sirenValide('552100554'), true);   // SIREN valide connu (Renault historique)
  assert.equal(sirenValide('404833048'), true);   // Google France
  assert.equal(sirenValide('552100555'), false);  // clé fausse
  assert.equal(sirenValide('55210055'), false);   // 8 chiffres
  assert.equal(sirenValide('abcdefghi'), false);
  assert.equal(sirenValide('552 100 554'), true);  // espaces tolérés
});
test('siretValide : clé de Luhn sur 14 chiffres', () => {
  assert.equal(siretValide('55210055400013'), true);   // établissement valide
  assert.equal(siretValide('55210055400014'), false);  // clé fausse
  assert.equal(siretValide('5521005540001'), false);   // 13 chiffres
});
test('siretValide : exception La Poste (356000000...) acceptée hors Luhn', () => {
  assert.equal(siretValide('35600000000048'), true);
  assert.equal(siretValide('35600000009999'), true); // préfixe La Poste accepté d'office
});
test('messageErreurIdentifiantAcheteur : nom libre non contrôlé, numéro contrôlé', () => {
  assert.equal(messageErreurIdentifiantAcheteur('Mairie de Paris'), null);
  assert.equal(messageErreurIdentifiantAcheteur(''), null);
  assert.equal(messageErreurIdentifiantAcheteur('552100554'), null);
  assert.ok(messageErreurIdentifiantAcheteur('552100555')); // SIREN clé fausse → message
  assert.ok(messageErreurIdentifiantAcheteur('123'));         // longueur inattendue
});

// ===========================================================================
// 4. VALIDATION — date ISO courte
// ===========================================================================
test('dateValide : formes bien formées et réelles', () => {
  assert.equal(dateValide('2026-09-15'), true);
  assert.equal(dateValide(''), true);            // champ optionnel
  assert.equal(dateValide('2026-02-31'), false); // 31 février inexistant
  assert.equal(dateValide('2026-13-01'), false);
  assert.equal(dateValide('15/09/2026'), false); // mauvais format
  assert.equal(dateValide('2024-02-29'), true);  // année bissextile
  assert.equal(dateValide('2025-02-29'), false); // non bissextile
});

// ===========================================================================
// 5. SÉCURITÉ DÉPÔT — détection de type par signature binaire
// ===========================================================================
test('detecterType reconnaît les formats attendus par leurs octets', () => {
  assert.equal(detecterType(bytes(0x25, 0x50, 0x44, 0x46)), 'pdf');
  assert.equal(detecterType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(detecterType(bytes(0xff, 0xd8, 0xff)), 'jpeg');
  assert.equal(detecterType(bytes(0x47, 0x49, 0x46, 0x38)), 'gif');
  assert.equal(
    detecterType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)),
    'webp',
  );
});
test('detecterType refuse les exécutables (cœur de la protection)', () => {
  assert.equal(detecterType(bytes(0x4d, 0x5a)), 'exe');            // MZ / PE Windows
  assert.equal(detecterType(bytes(0x7f, 0x45, 0x4c, 0x46)), 'elf'); // ELF Linux
  assert.equal(detecterType(bytes(0xcf, 0xfa, 0xed, 0xfe)), 'macho');
  assert.equal(detecterType(bytes(0x23, 0x21, 0x2f, 0x62)), 'script'); // #!/b shebang
});
test('detecterType : fichier vide ou inconnu → inconnu', () => {
  assert.equal(detecterType(bytes()), 'inconnu');
  assert.equal(detecterType(bytes(0x00, 0x01, 0x02, 0x03)), 'inconnu');
});
test('detecterType affine les archives ZIP en docx/xlsx/pptx via le premier membre', () => {
  const zipHead = [0x50, 0x4b, 0x03, 0x04];
  const withName = (name: string) => {
    const arr = new Uint8Array(64);
    zipHead.forEach((v, i) => (arr[i] = v));
    // le nom du premier membre est en clair vers l'octet 30
    for (let i = 0; i < name.length; i++) arr[30 + i] = name.charCodeAt(i);
    return arr;
  };
  assert.equal(detecterType(withName('word/document.xml')), 'docx');
  assert.equal(detecterType(withName('xl/workbook.xml')), 'xlsx');
  assert.equal(detecterType(withName('ppt/presentation.xml')), 'pptx');
  assert.equal(detecterType(withName('random.txt')), 'zip'); // ZIP générique
});

// ===========================================================================
// 6. SÉCURITÉ DÉPÔT — politique par point de dépôt
// ===========================================================================
test('verifierFichier : un exécutable renommé .pdf est refusé au coffre-fort', () => {
  const v = verifierFichier(pad2048([0x4d, 0x5a, 0x90, 0x00]), 1024, 'coffre_fort');
  assert.equal(v.accepte, false);
  assert.equal(v.type, 'exe');
  assert.ok(v.motif);
});
test('verifierFichier : PDF accepté en candidature', () => {
  const v = verifierFichier(pad2048([0x25, 0x50, 0x44, 0x46]), 1024, 'candidature');
  assert.equal(v.accepte, true);
  assert.equal(v.type, 'pdf');
});
test('verifierFichier : ZIP accepté seulement pour le DCE', () => {
  const zip = pad2048([0x50, 0x4b, 0x03, 0x04]);
  assert.equal(verifierFichier(zip, 1024, 'dce').accepte, true);
  assert.equal(verifierFichier(zip, 1024, 'candidature').accepte, false);
});
test('verifierFichier : logo n’accepte que png/jpeg/webp', () => {
  assert.equal(verifierFichier(pad2048([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 1024, 'logo').accepte, true);
  assert.equal(verifierFichier(pad2048([0x25, 0x50, 0x44, 0x46]), 1024, 'logo').accepte, false); // PDF refusé
});
test('verifierFichier : fichier vide (0 octet) refusé', () => {
  const v = verifierFichier(pad2048([0x25, 0x50, 0x44, 0x46]), 0, 'candidature');
  assert.equal(v.accepte, false);
  assert.match(v.motif ?? '', /vide/);
});
test('verifierFichier : dépassement de taille refusé avec la bonne limite', () => {
  const v = verifierFichier(pad2048([0x25, 0x50, 0x44, 0x46]), REGLES.candidature.tailleMaxOctets + 1, 'candidature');
  assert.equal(v.accepte, false);
  assert.match(v.motif ?? '', /limite/);
});
test('OCTETS_A_LIRE couvre la zone d’affinage ZIP (>=2048)', () => {
  assert.ok(OCTETS_A_LIRE >= 2048);
});

// ===========================================================================
// 7. DOSSIERS — statut effectif, activité, urgence, quota
// ===========================================================================
const tender = (o: Partial<any>): any => ({
  id: 't1', statut: STATUSES.on, date_limite: null, createur_id: 'u1', ...o,
});

test('getEffectiveStatus : statuts terminaux renvoyés tels quels', () => {
  assert.equal(getEffectiveStatus(tender({ statut: STATUSES.won })), STATUSES.won);
  assert.equal(getEffectiveStatus(tender({ statut: STATUSES.lost })), STATUSES.lost);
  assert.equal(getEffectiveStatus(tender({ statut: STATUSES.draft })), STATUSES.draft);
  assert.equal(getEffectiveStatus(tender({ statut: STATUSES.submitted })), STATUSES.submitted);
});
test('getEffectiveStatus : En cours + échéance passée → Expiré (virtuel)', () => {
  assert.equal(getEffectiveStatus(tender({ date_limite: isoDans(-2) })), STATUSES.expired);
  assert.equal(getEffectiveStatus(tender({ date_limite: isoDans(5) })), STATUSES.on);
  assert.equal(getEffectiveStatus(tender({ date_limite: null })), STATUSES.on);
});
test('isActive : En cours et Déposé sont actifs, Expiré ne l’est pas', () => {
  assert.equal(isActive(tender({ date_limite: isoDans(5) })), true);
  assert.equal(isActive(tender({ statut: STATUSES.submitted })), true);
  assert.equal(isActive(tender({ date_limite: isoDans(-2) })), false);
});
test('joursAvantEcheance : signe et NaN', () => {
  assert.ok(joursAvantEcheance(tender({ date_limite: isoDans(3) })) >= 2);
  assert.ok(joursAvantEcheance(tender({ date_limite: isoDans(-3) })) < 0);
  assert.ok(Number.isNaN(joursAvantEcheance(tender({ date_limite: null }))));
});
test('isUrgent : En cours et échéance dans [0..7] jours calendaires inclus', () => {
  // Fenêtre corrigée : comparaison de jours calendaires de minuit à minuit.
  // Une échéance à exactement 7 jours est urgente ; à 8 jours, non.
  assert.equal(isUrgent(tender({ date_limite: isoDans(0) })), true);   // aujourd'hui
  assert.equal(isUrgent(tender({ date_limite: isoDans(3) })), true);
  assert.equal(isUrgent(tender({ date_limite: isoDans(URGENCE_SEUIL_JOURS) })), true);      // 7 j inclus
  assert.equal(isUrgent(tender({ date_limite: isoDans(URGENCE_SEUIL_JOURS + 1) })), false); // 8 j exclu
  assert.equal(isUrgent(tender({ date_limite: isoDans(-1) })), false);  // expiré
  assert.equal(isUrgent(tender({ statut: STATUSES.submitted, date_limite: isoDans(3) })), false);
});
test('consommeQuota : seul le créateur, seulement En cours, hors verrou', () => {
  assert.equal(consommeQuota(tender({ date_limite: isoDans(5) }), 'u1'), true);
  assert.equal(consommeQuota(tender({ date_limite: isoDans(5) }), 'autre'), false); // pas créateur
  assert.equal(consommeQuota(tender({ statut: STATUSES.submitted }), 'u1'), false); // déposé
  assert.equal(consommeQuota(tender({ verrouille_par_quota: true, date_limite: isoDans(5) }), 'u1'), false);
});

// ===========================================================================
// 8. RÉTROPLANNING — jalons
// ===========================================================================
test('genererJalons : jamais de jalon daté avant aujourd’hui', () => {
  const maintenant = new Date(2026, 6, 27); // 27/07/2026 local
  const jalons = genererJalons(
    { date_publication: '2026-06-14', date_limite: '2026-09-15' },
    maintenant,
  );
  const auMin = `${maintenant.getFullYear()}-07-27`;
  for (const j of jalons) {
    assert.ok(j.date >= auMin, `${j.label} daté ${j.date} < ${auMin}`);
  }
  // Le dernier jalon reste la date limite officielle.
  assert.equal(jalons[jalons.length - 1].date, '2026-09-15');
});
test('genererJalons : jalons triés par date croissante', () => {
  const jalons = genererJalons({ date_limite: isoDans(40) });
  const dates = jalons.map(j => j.date);
  assert.deepEqual(dates, [...dates].sort((a, b) => a.localeCompare(b)));
});
test('genererJalons : échéance passée → deux jalons obligatoires non tenables', () => {
  const jalons = genererJalons({ date_publication: '2026-01-01', date_limite: '2026-01-10' }, new Date(2026, 5, 1));
  assert.equal(jalons.length, 2);
  assert.ok(jalons.every(j => j.non_tenable));
  assert.ok(jalons.every(j => j.obligatoire));
});
test('genererJalons : sans date limite, fenêtre par défaut de 21 jours', () => {
  const maintenant = new Date(2026, 5, 1);
  const jalons = genererJalons({}, maintenant);
  assert.equal(jalons.length, 5);
  assert.equal(jalons[jalons.length - 1].date, '2026-06-22'); // +21 j
});
test('estEnRetard : date passée non faite = en retard ; faite = non', () => {
  assert.equal(estEnRetard({ date: isoDans(-1), statut: 'a_faire' } as any), true);
  assert.equal(estEnRetard({ date: isoDans(-1), statut: 'fait' } as any), false);
  assert.equal(estEnRetard({ date: isoDans(1), statut: 'a_faire' } as any), false);
});

// ===========================================================================
// 9. NOMMAGE DES PIÈCES — aller-retour avec UUID (contiennent des tirets)
// ===========================================================================
const UUID_A = '7071c80f-322a-4136-8970-15552379f05b';
const UUID_B = '0a2943e7-f8d6-470a-809f-6502e73995fc';

test('nomPieceCollaborateur/lirePieceCollaborateur : aller-retour exact', () => {
  const nom = nomPieceCollaborateur({ docType: 'dc2', collabId: UUID_A, tenderId: UUID_B });
  assert.equal(nom, `dc2-${UUID_A}-${UUID_B}`);
  const lu = lirePieceCollaborateur(nom, UUID_B);
  assert.deepEqual(lu, { docType: 'dc2', collabId: UUID_A, tenderId: UUID_B });
});
test('lirePieceCollaborateur : rejette un nom d’un autre AO', () => {
  const nom = nomPieceCollaborateur({ docType: 'kbis', collabId: UUID_A, tenderId: UUID_B });
  assert.equal(lirePieceCollaborateur(nom, UUID_A), null); // mauvais tenderId
});
test('nomPieceCollaborateur : neutralise les tirets du type', () => {
  const nom = nomPieceCollaborateur({ docType: 'dc-2', collabId: UUID_A, tenderId: UUID_B });
  assert.ok(nom.startsWith('dc_2-'));
});
test('concernePiece : n’est vrai que pour le bon AO', () => {
  const nom = `dc1-${UUID_A}-${UUID_B}`;
  assert.equal(concernePiece(nom, UUID_B), true);
  assert.equal(concernePiece(nom, UUID_A), false);
});
test('clePieceCollaborateur : clé stable et sans tiret de type', () => {
  assert.equal(clePieceCollaborateur('dc-2', UUID_A), `dc_2-${UUID_A}`);
});

// ===========================================================================
// 10. CODES D’ACCÈS INVITÉ — entropie et masquage
// ===========================================================================
test('genererCodeAcces : longueur, alphabet sûr, pas de caractères ambigus', () => {
  const code = genererCodeAcces();
  assert.equal(code.length, 8);
  assert.match(code, /^[ACDEFGHJKMNPQRTUVWXYZ2346789]+$/);
  // L'alphabet écarte uniquement les caractères confondables : O/0, I/1/L, S/5, B.
  // Il conserve volontairement 4 et 8 (non ambigus).
  assert.doesNotMatch(code, /[O0I1LS5B]/);
});
test('genererCodeAcces : deux tirages diffèrent (probabiliste mais quasi sûr)', () => {
  const a = genererCodeAcces(12);
  const b = genererCodeAcces(12);
  assert.notEqual(a, b);
});
test('genererTokenInvitation : ≥16 caractères, hexadécimal', () => {
  const t = genererTokenInvitation();
  assert.ok(t.length >= 16);
  assert.match(t, /^[0-9a-f]+$/);
});
test('masquerJeton : garde 4 caractères + longueur, jamais le jeton complet', () => {
  assert.equal(masquerJeton('abcdef123456'), 'abcd…(12)');
  assert.equal(masquerJeton(null), '(absent)');
});
test('masquerJetonDansTexte : retire le jeton d’une URL d’invitation', () => {
  const txt = 'Erreur sur https://filao.app/invitation/abcdef0123456789abcdef pendant le rendu';
  assert.match(masquerJetonDansTexte(txt), /\/invitation\/…/);
  assert.doesNotMatch(masquerJetonDansTexte(txt), /abcdef0123456789/);
});

// ===========================================================================
// 11. LIENS EXTERNES — normalisation du href (bug localhost/www.google.fr)
// ===========================================================================
test('lienExterne : préfixe https quand le schéma manque', () => {
  assert.equal(lienExterne('www.google.fr'), 'https://www.google.fr');
  assert.equal(lienExterne('exemple.fr/avis/123'), 'https://exemple.fr/avis/123');
  assert.equal(lienExterne('  boamp.fr  '), 'https://boamp.fr');
});
test('lienExterne : conserve http et https existants', () => {
  assert.equal(lienExterne('http://exemple.fr'), 'http://exemple.fr');
  assert.equal(lienExterne('https://exemple.fr/x'), 'https://exemple.fr/x');
  assert.equal(lienExterne('HTTPS://EXEMPLE.FR'), 'HTTPS://EXEMPLE.FR');
});
test('lienExterne : valeur vide → chaîne vide (pas de lien affiché)', () => {
  assert.equal(lienExterne(''), '');
  assert.equal(lienExterne('   '), '');
  assert.equal(lienExterne(null), '');
  assert.equal(lienExterne(undefined), '');
});
test('lienExterne : ne propage pas un schéma dangereux', () => {
  // javascript: / data: ne doivent jamais ressortir comme lien actif.
  assert.doesNotMatch(lienExterne('javascript:alert(1)'), /^javascript:/i);
  assert.doesNotMatch(lienExterne('data:text/html,<script>'), /^data:/i);
  // On repasse par https sur la partie lisible.
  assert.match(lienExterne('javascript:alert(1)'), /^https:\/\//);
});

// ===========================================================================
// 12. PROGRESSION — règle unique dashboard / dossier
// ===========================================================================
test('piecesAttenduesPourRole : mandataire > cotraitant, rôle inconnu = cotraitant', () => {
  const m = piecesAttenduesPourRole('Mandataire');
  const c = piecesAttenduesPourRole('Co-traitant');
  assert.ok(m > 0 && c > 0);
  assert.ok(m > c);
  assert.equal(piecesAttenduesPourRole('Inconnu'), c);
  assert.equal(piecesAttenduesPourRole(null), c);
});
test('membreComptabilise : porteur et acceptés seulement', () => {
  assert.equal(membreComptabilise({ estPorteur: true }), true);
  assert.equal(membreComptabilise({ statut: 'accepte' }), true);
  assert.equal(membreComptabilise({ statut: 'invite' }), false);
  assert.equal(membreComptabilise({ statut: 'refuse' }), false);
  assert.equal(membreComptabilise({}), false);
});
test('piecesAttendues : ignore invités et refusés', () => {
  const c = piecesAttenduesPourRole('Co-traitant');
  const m = piecesAttenduesPourRole('Mandataire');
  const total = piecesAttendues([
    { role: 'Mandataire', estPorteur: true },
    { role: 'Co-traitant', statut: 'accepte' },
    { role: 'Co-traitant', statut: 'invite' },   // ne compte pas
    { role: 'Co-traitant', statut: 'refuse' },   // ne compte pas
  ]);
  assert.equal(total, m + c);
});
test('calculerProgression : bornée, entière, 0 si rien attendu', () => {
  assert.deepEqual(calculerProgression(4, 19), { recues: 4, attendues: 19, percent: 21 });
  assert.equal(calculerProgression(25, 19).percent, 100);   // compteur gonflé → plafonné
  assert.equal(calculerProgression(-3, 10).recues, 0);
  assert.equal(calculerProgression(0, 0).percent, 0);
});
test('progressionDossier : le porteur est ajouté s’il manque des groupements', () => {
  const m = piecesAttenduesPourRole('Mandataire');
  const c = piecesAttenduesPourRole('Co-traitant');
  const avecPorteur = progressionDossier(
    [{ role_groupement: 'Mandataire', statut: 'accepte' }, { role_groupement: 'Co-traitant', statut: 'accepte' }],
    4, true);
  const sansPorteur = progressionDossier(
    [{ role_groupement: 'Co-traitant', statut: 'accepte' }],
    4, false);
  assert.equal(avecPorteur.attendues, m + c);
  assert.equal(sansPorteur.attendues, m + c);
  assert.equal(avecPorteur.percent, sansPorteur.percent);
});
test('libelleStatut : même libellé que la carte, expiration comprise', () => {
  const t = (o: any): any => ({ id: 't', statut: STATUSES.on, date_limite: null, createur_id: 'u', ...o });
  assert.equal(libelleStatut(t({})), STATUSES.on);                       // « En cours », pas « En préparation »
  assert.equal(libelleStatut(t({ date_limite: isoDans(-2) })), STATUSES.expired);
  assert.equal(libelleStatut(t({ statut: STATUSES.won })), STATUSES.won);
});

// ===========================================================================
// 13. VUE DÉCISION — règles métier extraites du JSX
// ===========================================================================
test('specialitesCouvertes : agrège les membres actifs, dédoublonne, ignore les retirés', () => {
  const couvertes = specialitesCouvertes([
    { specialty_ids: ['a', 'b'] },
    { specialty_ids: ['b', 'c'] },
    { specialty_ids: ['z'], deleted: true },   // retiré : ne couvre plus rien
    { },                                        // sans spécialités
  ]);
  assert.deepEqual([...couvertes].sort(), ['a', 'b', 'c']);
});
test('specialitesManquantes : ce que personne ne couvre', () => {
  assert.deepEqual(specialitesManquantes(['a', 'b', 'c'], ['b']), ['a', 'c']);
  assert.deepEqual(specialitesManquantes([], ['b']), []);
  assert.deepEqual(specialitesManquantes(null, []), []);
});
test('lectureCompetencesEchouee : des libellés sans identifiants trahissent un refus de lecture', () => {
  assert.equal(lectureCompetencesEchouee([], ['Génie civil']), true);
  assert.equal(lectureCompetencesEchouee(['id1'], ['Génie civil']), false);
  assert.equal(lectureCompetencesEchouee([], []), false);   // dossier sans exigence
});
test('scoreSucces : 40 % à vide, 95 % tout couvert, proportionnel entre les deux', () => {
  assert.equal(scoreSucces(['a', 'b'], [], []), 40);
  assert.equal(scoreSucces(['a', 'b'], [], ['a', 'b']), 95);
  assert.equal(scoreSucces(['a', 'b'], [], ['a']), 68);      // 40 + 55/2
  assert.equal(scoreSucces([], [], []), 85);                  // aucune exigence
});
test('scoreSucces : null si les compétences n’ont pas pu être lues', () => {
  // Le cas qui faisait diverger cotraitant (85 %) et mandataire (40 %).
  assert.equal(scoreSucces([], ['Génie civil'], []), null);
});
test('gainPotentiel : nul pour une seule compétence requise', () => {
  assert.equal(gainPotentiel(['a']), 0);
  assert.equal(gainPotentiel([]), 0);
  assert.equal(gainPotentiel(['a', 'b', 'c', 'd', 'e']), 11);  // 55/5
});
test('joursRestants : positif, négatif, ou null', () => {
  assert.equal(joursRestants(null), null);
  assert.ok((joursRestants(isoDans(5)) ?? 0) > 0);
  assert.ok((joursRestants(isoDans(-5)) ?? 0) < 0);
});
test('roleUtilisateur : invité, refusé, porteur', () => {
  const moi = { id: 'u1', email: 'moi@x.fr' };
  const invite = roleUtilisateur([{ id: 'u1', status: 'invite' }], moi, 't1');
  assert.equal(invite.estInvite, true);
  assert.equal(invite.aRefuse, false);

  const refuse = roleUtilisateur([{ id: 'u1', status: 'refuse' }], moi, 't1');
  assert.equal(refuse.aRefuse, true);
  assert.equal(refuse.estInvite, true);   // le bandeau reste, pour pouvoir revenir sur son refus

  const porteur = roleUtilisateur([{ id: 'u1', status: 'accepte', is_owner: true }], moi, 't1');
  assert.equal(porteur.estInvite, false, "le porteur n'a pas d'invitation à accepter");

  // Reconnaissance par e-mail quand l'identifiant manque encore.
  const parEmail = roleUtilisateur([{ email: 'moi@x.fr', status: 'invite' }], moi, 't1');
  assert.equal(parEmail.estInvite, true);
});
test('dossierTermine : gagné, perdu, expiré — pas « en cours »', () => {
  const t = (o: any) => ({ id: 't', statut: STATUSES.on, date_limite: null, createur_id: 'u', ...o });
  assert.equal(dossierTermine(t({ statut: STATUSES.won })), true);
  assert.equal(dossierTermine(t({ statut: STATUSES.lost })), true);
  assert.equal(dossierTermine(t({ date_limite: isoDans(-2) })), true);   // expiré
  assert.equal(dossierTermine(t({ date_limite: isoDans(5) })), false);
});

// ===========================================================================
// 14. ACCÈS AUX DOSSIERS — cloisonnement entre collègues
// ===========================================================================
const dossierDe = (createur: string, entreprise: string | null) =>
  ({ createur_id: createur, entreprise_id: entreprise });

test('estDossierDunCollegue : même entreprise, autre porteur', () => {
  const moi = { id: 'u1', entreprise_id: 'e1' };
  assert.equal(estDossierDunCollegue(dossierDe('u2', 'e1'), moi), true);
});
test('estDossierDunCollegue : mon propre dossier n’est pas « d’un collègue »', () => {
  const moi = { id: 'u1', entreprise_id: 'e1' };
  assert.equal(estDossierDunCollegue(dossierDe('u1', 'e1'), moi), false);
});
test('estDossierDunCollegue : entreprise différente → non', () => {
  const moi = { id: 'u1', entreprise_id: 'e1' };
  assert.equal(estDossierDunCollegue(dossierDe('u2', 'e2'), moi), false);
});
test('estDossierDunCollegue : données manquantes → non, jamais d’accès par défaut', () => {
  const moi = { id: 'u1', entreprise_id: 'e1' };
  assert.equal(estDossierDunCollegue(null, moi), false);
  assert.equal(estDossierDunCollegue(dossierDe('u2', 'e1'), null), false);
  assert.equal(estDossierDunCollegue(dossierDe('u2', null), moi), false);
  assert.equal(estDossierDunCollegue(dossierDe('u2', 'e1'), { id: 'u1' }), false);
});
test('estEnLectureSeule : oui pour un collègue, NON pour un administrateur', () => {
  const moi = { id: 'u1', entreprise_id: 'e1' };
  const dossierCollegue = dossierDe('u2', 'e1');
  assert.equal(estEnLectureSeule(dossierCollegue, moi, false), true);
  // Les migrations 093/094 ouvrent l'écriture à l'admin : l'éditeur lui est
  // pleinement utilisable.
  assert.equal(estEnLectureSeule(dossierCollegue, moi, true), false);
});

// ===========================================================================
// 15. QUOTAS DE FORFAIT — création d'un dossier
// ===========================================================================
test('canCreateTender : refuse sans profil', () => {
  const r = canCreateTender(null, []);
  assert.equal(r.allowed, false);
  assert.ok(r.message);
});
test('canCreateTender : le forfait Partenaire (0 dossier) explique la NATURE de l’offre', () => {
  const r = canCreateTender({ id: 'u1', plan: 'partenaire' }, []);
  assert.equal(r.allowed, false);
  // « vous portez déjà 0 dossier » serait absurde : le message doit dire que
  // ce forfait sert à REJOINDRE, pas à porter.
  assert.doesNotMatch(r.message ?? '', /0\s*\/\s*0/);
  assert.ok((r.message ?? '').length > 0);
});
test('canCreateTender : seuls les dossiers qui consomment du quota comptent', () => {
  const dossier = (o: any) => ({
    id: Math.random().toString(), statut: STATUSES.on,
    date_limite: isoDans(10), createur_id: 'u1', ...o,
  });
  const profil = { id: 'u1', plan: 'solo' };
  // Un dossier déposé ne consomme plus d'emplacement (cf. consommeQuota).
  const avecDepose = canCreateTender(profil as any, [
    dossier({ statut: STATUSES.submitted }),
  ] as any);
  assert.equal(avecDepose.allowed, true);

  // Le dossier d'un autre non plus.
  const avecDossierAutrui = canCreateTender(profil as any, [
    dossier({ createur_id: 'u2' }),
  ] as any);
  assert.equal(avecDossierAutrui.allowed, true);
});

// ===========================================================================
// 16. EXPORT ICAL — fichier importable dans un agenda
// ===========================================================================
const aoPourIcal = (o: any = {}) => ({
  id: 'ao1', titre: 'Marché de voirie', statut: STATUSES.on,
  date_limite: '2026-09-15', organisme_acheteur: 'Ville de Lyon',
  jalons: [], ...o,
});

test('buildICalendar : enveloppe VCALENDAR bien formée', () => {
  const ics = buildICalendar([aoPourIcal()]);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.match(ics, /VERSION:2\.0/);
});
test('buildICalendar : un VEVENT par date limite', () => {
  const ics = buildICalendar([aoPourIcal()]);
  const nb = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(nb, 1);
  assert.match(ics, /SUMMARY:Remise/);
});
test('buildICalendar : les dossiers clos sont exclus par défaut, inclus sur demande', () => {
  const clos = [aoPourIcal({ statut: STATUSES.won })];
  assert.equal((buildICalendar(clos).match(/BEGIN:VEVENT/g) || []).length, 0);
  assert.ok((buildICalendar(clos, { includeClosed: true }).match(/BEGIN:VEVENT/g) || []).length > 0);
});
test('buildICalendar : une date invalide ne casse pas le fichier', () => {
  // Un `.ics` malformé est refusé EN BLOC par les agendas : une seule mauvaise
  // date ne doit pas emporter tout l'export.
  const ics = buildICalendar([aoPourIcal({ date_limite: 'pas-une-date' })]);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
});
test('buildICalendar : les caractères spéciaux du titre sont échappés', () => {
  const ics = buildICalendar([aoPourIcal({ titre: 'Lot 1, phase 2; travaux' })]);
  // Virgule et point-virgule sont des séparateurs iCalendar : non échappés,
  // ils décaleraient les champs.
  assert.match(ics, /Lot 1\\,/);
  assert.match(ics, /phase 2\\;/);
});
test('buildICalendar : liste vide → calendrier valide et sans événement', () => {
  const ics = buildICalendar([]);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
});

// ===========================================================================
// 17. BOAMP — analyse des avis publiés (données externes, donc imprévisibles)
// ===========================================================================
const avisBoamp = (objet: any) => ({ donnees: JSON.stringify({ OBJET: objet }) });

test('extractCpvCodes : ne retient que des codes à 8 chiffres', () => {
  const codes = extractCpvCodes(avisBoamp({
    CPV: [
      { PRINCIPAL: '45213000' },
      { PRINCIPAL: '4521' },        // trop court
      { PRINCIPAL: 'ABCDEFGH' },    // non numérique
      { PRINCIPAL: '' },
    ],
  }));
  assert.deepEqual(codes.map(c => c.code), ['45213000']);
});
test('extractCpvCodes : dédoublonne, y compris entre l’objet et les lots', () => {
  const codes = extractCpvCodes(avisBoamp({
    CPV: { PRINCIPAL: '45213000' },
    LOTS: { LOT: [{ CPV: { PRINCIPAL: '45213000' } }, { CPV: { PRINCIPAL: '71000000' } }] },
  }));
  assert.deepEqual(codes.map(c => c.code), ['45213000', '71000000']);
});
test('extractCpvCodes : avis vide ou malformé → liste vide, jamais d’exception', () => {
  // Ces données viennent d'une source externe : un plantage ici casserait
  // l'import d'un avis entier.
  assert.deepEqual(extractCpvCodes(null), []);
  assert.deepEqual(extractCpvCodes({}), []);
  assert.deepEqual(extractCpvCodes({ donnees: 'pas du json' }), []);
  assert.deepEqual(extractCpvCodes({ donnees: JSON.stringify({}) }), []);
});
test('cpvDivision : les deux premiers chiffres', () => {
  assert.equal(cpvDivision('45213000'), '45');
  assert.equal(cpvDivision('60130000'), '60');
});

test('normaliserPoids : ramène à 100 % et ignore les poids absents ou nuls', () => {
  const r = normaliserPoids([
    { libelle: 'Prix', poids: 60 },
    { libelle: 'Technique', poids: 40 },
    { libelle: 'Sans poids' } as any,
    { libelle: 'Poids nul', poids: 0 },
  ]);
  assert.deepEqual(r, [
    { libelle: 'Prix', pourcentage: 60 },
    { libelle: 'Technique', pourcentage: 40 },
  ]);
});
test('normaliserPoids : des poids qui ne totalisent pas 100 sont ramenés à l’échelle', () => {
  // Un acheteur peut publier des points (ex. /20) plutôt que des pourcentages.
  const r = normaliserPoids([
    { libelle: 'Prix', poids: 12 },
    { libelle: 'Technique', poids: 8 },
  ]);
  assert.deepEqual(r.map(c => c.pourcentage), [60, 40]);
});
test('normaliserPoids : aucun poids exploitable → liste vide', () => {
  assert.deepEqual(normaliserPoids([]), []);
  assert.deepEqual(normaliserPoids([{ libelle: 'X' } as any]), []);
});

test('avisEncoreOuvert : une date absente ou illisible ne présume PAS la clôture', () => {
  // Écarter un avis faute de date fiable ferait manquer une opportunité :
  // dans le doute, on le montre.
  const t = new Date(2026, 5, 1);
  assert.equal(avisEncoreOuvert({}, t), true);
  assert.equal(avisEncoreOuvert({ datelimitereponse: 'illisible' }, t), true);
});
test('avisEncoreOuvert : compare à la date limite annoncée', () => {
  const t = new Date(2026, 5, 1);
  assert.equal(avisEncoreOuvert({ datelimitereponse: '2026-12-31' }, t), true);
  assert.equal(avisEncoreOuvert({ datelimitereponse: '2026-01-01' }, t), false);
});

test('dedoublonnerAvis : un même idweb n’apparaît qu’une fois', () => {
  const r = dedoublonnerAvis([
    { idweb: 'A', titre: 'premier' },
    { idweb: 'A', titre: 'doublon' },
    { idweb: 'B' },
  ]);
  assert.equal(r.length, 2);
});
test('dedoublonnerAvis : entrée vide ou nulle → tableau vide', () => {
  assert.deepEqual(dedoublonnerAvis([]), []);
  assert.deepEqual(dedoublonnerAvis(null as any), []);
});

test('reparerEncodage : corrige le mojibake des libellés BOAMP', () => {
  // « Ã© » est la lecture en latin-1 d'un « é » encodé en UTF-8.
  assert.equal(reparerEncodage('MarchÃ© de travaux'), 'Marché de travaux');
  assert.equal(reparerEncodage('CrÃ¨che municipale'), 'Crèche municipale');
});
test('reparerEncodage : laisse intact un texte déjà correct', () => {
  assert.equal(reparerEncodage('Marché de travaux'), 'Marché de travaux');
  assert.equal(reparerEncodage('Rénovation énergétique'), 'Rénovation énergétique');
});
test('reparerEncodage : valeur absente → chaîne vide', () => {
  assert.equal(reparerEncodage(null), '');
  assert.equal(reparerEncodage(undefined), '');
  assert.equal(reparerEncodage(''), '');
});

// ===========================================================================
// 18. LISTE DES DOSSIERS — filtres, visibilité et tri
// ===========================================================================
const ao = (o: any = {}) => ({
  id: 'a1', titre: 'Marché de voirie', organisme_acheteur: 'Ville de Lyon',
  statut: STATUSES.on, date_limite: isoDans(30), createur_id: 'u1',
  type_marche: 'Travaux', secteur_activite: 'BTP',
  groupements: [], invitations: [], ...o,
});
const moiListe = { id: 'u1', email: 'moi@x.fr', entreprise_id: 'e1' };

test('correspondRecherche : titre, acheteur et statut ; pas la description', () => {
  const t = ao({ description: 'renovation complete' });
  assert.equal(correspondRecherche(t, 'voirie'), true);
  assert.equal(correspondRecherche(t, 'lyon'), true);       // insensible à la casse
  assert.equal(correspondRecherche(t, 'en cours'), true);
  // Un mot fréquent dans les descriptions ramènerait presque tout.
  assert.equal(correspondRecherche(t, 'renovation'), false);
  assert.equal(correspondRecherche(t, '   '), true);         // recherche vide = tout
});

test('correspondCategorie : type unique ou liste de types', () => {
  assert.equal(correspondCategorie(ao({ type_marche: 'Travaux' }), 'Travaux'), true);
  assert.equal(correspondCategorie(ao({ type_marche: ['Travaux', 'Services'] }), 'Services'), true);
  assert.equal(correspondCategorie(ao({ type_marche: 'Travaux' }), 'Services'), false);
  assert.equal(correspondCategorie(ao(), 'Tous'), true);
});

test('correspondRole : « Portés » = créateur, « Rejoints » = les autres', () => {
  assert.equal(correspondRole(ao({ createur_id: 'u1' }), 'Portés', 'u1'), true);
  assert.equal(correspondRole(ao({ createur_id: 'u2' }), 'Portés', 'u1'), false);
  assert.equal(correspondRole(ao({ createur_id: 'u2' }), 'Rejoints', 'u1'), true);
  assert.equal(correspondRole(ao(), 'Tous', 'u1'), true);
});

test('dossierVisible : une invitation en attente est MASQUÉE en vue normale', () => {
  const invite = ao({ groupements: [{ entreprise_id: 'e1', statut: 'invite' }] });
  assert.equal(dossierVisible(invite, {}, moiListe), false);
  // …et c'est précisément ce qu'on montre en vue « invitations ».
  assert.equal(dossierVisible(invite, { showInvitationsOnly: true }, moiListe), true);
});

test('dossierVisible : un refus suit la même règle, dans les deux vues', () => {
  const refuse = ao({ invitations: [{ email: 'moi@x.fr', status: 'refused' }] });
  assert.equal(dossierVisible(refuse, {}, moiListe), false);
  assert.equal(dossierVisible(refuse, { showInvitationsOnly: true }, moiListe), true);
});

test('dossierVisible : en vue invitations, « En attente » et « Refusé » se distinguent', () => {
  const enAttente = ao({ groupements: [{ entreprise_id: 'e1', statut: 'invite' }] });
  const refuse = ao({ groupements: [{ entreprise_id: 'e1', statut: 'refuse' }] });
  const vue = { showInvitationsOnly: true, filterStatus: 'En attente' };
  assert.equal(dossierVisible(enAttente, vue, moiListe), true);
  assert.equal(dossierVisible(refuse, vue, moiListe), false);
});

test('dossierVisible : « Urgents » est transverse au statut', () => {
  const urgent = ao({ date_limite: isoDans(2) });
  const lointain = ao({ date_limite: isoDans(60) });
  assert.equal(dossierVisible(urgent, { filterStatus: 'Urgents' }, moiListe), true);
  assert.equal(dossierVisible(lointain, { filterStatus: 'Urgents' }, moiListe), false);
});

test('dossierVisible : les dossiers des collègues sont cachés par défaut', () => {
  const collegue = ao({ createur_id: 'u2' });
  const estCollegue = () => true;
  assert.equal(dossierVisible(collegue, {}, moiListe, estCollegue), false);
  assert.equal(dossierVisible(collegue, { voirToutEntreprise: true }, moiListe, estCollegue), true);
});

test('filtrerEtTrierDossiers : tri par date, croissant et décroissant', () => {
  const proche = ao({ id: 'proche', date_limite: isoDans(5) });
  const lointain = ao({ id: 'lointain', date_limite: isoDans(50) });
  const asc = filtrerEtTrierDossiers([lointain, proche] as any, { sortOption: 'date_asc' }, moiListe);
  assert.deepEqual(asc.map((t: any) => t.id), ['proche', 'lointain']);
  const desc = filtrerEtTrierDossiers([proche, lointain] as any, { sortOption: 'date_desc' }, moiListe);
  assert.deepEqual(desc.map((t: any) => t.id), ['lointain', 'proche']);
});

test('filtrerEtTrierDossiers : tri alphabétique respectant les accents', () => {
  const a = ao({ id: 'a', titre: 'Élagage' });
  const b = ao({ id: 'b', titre: 'Fauchage' });
  const r = filtrerEtTrierDossiers([b, a] as any, { sortOption: 'titre_asc' }, moiListe);
  // `localeCompare` classe « É » avant « F » — un tri sur les codes de
  // caractères l'aurait rejeté en fin de liste.
  assert.deepEqual(r.map((t: any) => t.id), ['a', 'b']);
});

test('filtrerEtTrierDossiers : en vue invitations, les refus passent en dernier', () => {
  const enAttente = ao({ id: 'attente', groupements: [{ entreprise_id: 'e1', statut: 'invite' }] });
  const refuse = ao({ id: 'refuse', groupements: [{ entreprise_id: 'e1', statut: 'refuse' }] });
  const r = filtrerEtTrierDossiers([refuse, enAttente] as any, { showInvitationsOnly: true }, moiListe);
  assert.deepEqual(r.map((t: any) => t.id), ['attente', 'refuse']);
});

test('filtrerEtTrierDossiers : ne modifie pas le tableau reçu', () => {
  const source = [ao({ id: 'b', titre: 'B' }), ao({ id: 'a', titre: 'A' })] as any;
  filtrerEtTrierDossiers(source, { sortOption: 'titre_asc' }, moiListe);
  assert.deepEqual(source.map((t: any) => t.id), ['b', 'a']);
});

test('filtrerEtTrierDossiers : entrée vide ou nulle → liste vide', () => {
  assert.deepEqual(filtrerEtTrierDossiers([], {}, moiListe), []);
  assert.deepEqual(filtrerEtTrierDossiers(null, {}, moiListe), []);
});


// ===========================================================================
// Forfaits — repli local (planLimits)
// ===========================================================================
// `chargerForfaits()` n'est jamais appelé ici : le cache reste vide, donc ces
// tests décrivent le REPLI sur `PLANS_CONFIG`. C'est précisément le chemin
// emprunté au démarrage de l'app et lors d'une indisponibilité de la table —
// celui où une erreur laisse passer un utilisateur au-delà de son offre.

test('forfait : un code inconnu retombe sur le forfait le plus restrictif', () => {
  // Rien ne doit s'ouvrir par défaut : un code absent de la base ou mal
  // orthographié ne doit pas donner accès aux quotas d'une offre payante.
  for (const code of ['inconnu', '', null, undefined]) {
    assert.equal(forfait(code as any).code, 'partenaire');
  }
});

test('forfait : le repli Réseau n’autorise aucun dossier porté', () => {
  // L'écart relevé en recette : `PLANS_CONFIG` annonçait 1 dossier, la base 0,
  // et l'interface affichait « 1/1 » pour un forfait qui n'en permet aucun.
  assert.equal(forfait('partenaire').maxAoSimultanes, 0);
});

test('forfait : le repli n’est jamais plus permissif que la configuration', () => {
  // Une divergence ici rouvrirait le même défaut sur un autre forfait.
  for (const [code, conf] of Object.entries(PLANS_CONFIG)) {
    const f = forfait(code);
    assert.equal(f.maxAoSimultanes, conf.limits.activeTenders, code);
    assert.equal(f.maxUtilisateurs, conf.limits.users, code);
    assert.equal(f.maxStockageOctets, conf.limits.storage, code);
    assert.equal(f.fonctionnalites.ia, conf.limits.aiAccess, code);
  }
});

test('forfait : le repli n’expose pas d’argumentaire commercial', () => {
  // Le comparatif doit venir de la table. Un descriptif en dur donnerait
  // l'illusion d'une offre à jour alors que la source n'a pas répondu.
  assert.deepEqual(forfait('solo').descriptif, []);
  assert.equal(forfait('solo').populaire, false);
});

test('illimite : aucun forfait de repli n’est illimité', () => {
  // `organisation` est borné à 9999 en repli, pas à null : le temps du
  // chargement, on préfère une borne haute à une absence de limite.
  for (const f of tousLesForfaits()) assert.equal(illimite(f), false);
  assert.equal(illimite({ maxAoSimultanes: null } as Forfait), true);
});

test('tousLesForfaits : les quatre offres, triées par ordre croissant', () => {
  const codes = tousLesForfaits().map((f) => f.code);
  assert.deepEqual(codes, ['partenaire', 'solo', 'equipe', 'organisation']);
  const ordres = tousLesForfaits().map((f) => f.ordre);
  assert.deepEqual(ordres, [...ordres].sort((a, b) => a - b));
});

test('prixLisible : centimes convertis en euros, gratuité et devis nommés', () => {
  assert.equal(prixLisible(forfait('partenaire')), 'Gratuit');
  assert.equal(prixLisible(forfait('solo')), '79 € / mois');
  assert.equal(prixLisible(forfait('equipe')), '159 € / mois');
  // « Sur devis » prime sur le prix : `organisation` est à 0 en repli, et
  // afficher « Gratuit » pour une offre négociée serait un contresens.
  assert.equal(prixLisible({ surDevis: true, prixMensuelHt: 0 } as Forfait), 'Sur devis');
});


// ===========================================================================
// Jalons affichés — tri et urgence (jalonHelpers)
// ===========================================================================
// La carte du dossier n'affiche que les TROIS premiers jalons : l'ordre n'est
// pas cosmétique, il décide de ce que l'utilisateur voit.

const LE_15_JUIN = new Date('2026-06-15T12:00:00Z');
const jalon = (o: any = {}) => ({
  label: 'Jalon', date: '2026-06-30', color: '', source: 'auto', editable: true, ...o,
});

test('jalonsAffichables : tri par date, quel que soit l’ordre du tableau', () => {
  // Un jalon ajouté à la main atterrit en FIN de tableau. Sans tri, il ne
  // pouvait jamais entrer dans les trois premiers affichés.
  const r = jalonsAffichables([
    jalon({ label: 'Tardif', date: '2026-08-01' }),
    jalon({ label: 'Ajouté à la main', date: '2026-06-20' }),
    jalon({ label: 'Tôt', date: '2026-06-16' }),
  ], {}, LE_15_JUIN);
  assert.deepEqual(r.map(j => j.label), ['Tôt', 'Ajouté à la main', 'Tardif']);
});

test('jalonsAffichables : c’est le statut qui fait foi, pas la date', () => {
  const r = jalonsAffichables([
    // Daté du futur mais coché fait : il ne doit pas rester « à venir ».
    jalon({ label: 'Fait en avance', date: '2026-07-30', statut: 'fait' }),
    // Daté du passé et NON fait : en retard, jamais « fait ».
    jalon({ label: 'En retard', date: '2026-05-01', statut: 'a_faire' }),
  ], {}, LE_15_JUIN);
  const par = Object.fromEntries(r.map(j => [j.label, j.status]));
  assert.equal(par['Fait en avance'], 'done');
  assert.equal(par['En retard'], 'danger');
});

test('jalonsAffichables : paliers d’urgence à 3 et 7 jours', () => {
  const r = jalonsAffichables([
    jalon({ label: 'j+2', date: '2026-06-17' }),
    jalon({ label: 'j+5', date: '2026-06-20' }),
    jalon({ label: 'j+20', date: '2026-07-05' }),
  ], {}, LE_15_JUIN);
  const par = Object.fromEntries(r.map(j => [j.label, j.status]));
  assert.equal(par['j+2'], 'danger');
  assert.equal(par['j+5'], 'warning');
  assert.equal(par['j+20'], 'upcoming');
});

test('jalonsAffichables : sans rétroplanning, repli sur les dates du dossier', () => {
  // Un panneau vide ne dit rien ; trois dates connues valent un planning.
  const r = jalonsAffichables(null, {
    date_publication: '2026-05-01',
    date_depot_souhaitee: '2026-06-25',
    date_limite: '2026-06-30',
  }, LE_15_JUIN);
  assert.deepEqual(r.map(j => j.label), ['Retrait DCE', 'Dépôt souhaité', 'Date limite']);
  assert.equal(r[0].status, 'done', 'publication passée');
});

test('jalonsAffichables : le repli ignore les dates absentes', () => {
  const r = jalonsAffichables([], { date_limite: '2026-06-30' }, LE_15_JUIN);
  assert.deepEqual(r.map(j => j.label), ['Date limite']);
});

test('jalonsAffichables : sans jalon ni date, liste vide plutôt qu’une erreur', () => {
  assert.deepEqual(jalonsAffichables(null, {}, LE_15_JUIN), []);
});

test('jalonsAffichables : ne modifie pas le tableau reçu', () => {
  const source = [jalon({ label: 'B', date: '2026-07-01' }), jalon({ label: 'A', date: '2026-06-16' })];
  jalonsAffichables(source, {}, LE_15_JUIN);
  assert.deepEqual(source.map(j => j.label), ['B', 'A']);
});

test('prochainJalon : le premier non fait, sinon le dernier', () => {
  const liste = jalonsAffichables([
    jalon({ label: 'Fait', date: '2026-06-16', statut: 'fait' }),
    jalon({ label: 'À faire', date: '2026-06-20' }),
  ], {}, LE_15_JUIN);
  assert.equal(prochainJalon(liste)?.label, 'À faire');

  // Tout est fait : on montre le dernier plutôt que rien.
  const tousFaits = jalonsAffichables([
    jalon({ label: 'Un', date: '2026-06-16', statut: 'fait' }),
    jalon({ label: 'Deux', date: '2026-06-20', statut: 'fait' }),
  ], {}, LE_15_JUIN);
  assert.equal(prochainJalon(tousFaits)?.label, 'Deux');
  assert.equal(prochainJalon([]), undefined);
});

// ===========================================================================
// Jauge de score (decisionHelpers)
// ===========================================================================
test('jaugeScore : score illisible → arc vide et gris, jamais 0 %', () => {
  // Dessiner 0 % en rouge ferait passer un défaut de LECTURE pour un dossier
  // mal couvert : l'utilisateur chercherait à corriger un problème inexistant.
  const j = jaugeScore(null, 40);
  assert.equal(j.decalage, j.circonference, 'arc entièrement vide');
  assert.equal(j.couleur, '#9CA3AF');
});

test('jaugeScore : 0 % est rouge et distinct de l’illisible', () => {
  const zero = jaugeScore(0, 40);
  const illisible = jaugeScore(null, 40);
  assert.equal(zero.decalage, zero.circonference);
  assert.notEqual(zero.couleur, illisible.couleur);
});

test('jaugeScore : paliers de couleur à 40 et 70', () => {
  assert.equal(jaugeScore(39, 40).couleur, '#EF4444');
  assert.equal(jaugeScore(40, 40).couleur, '#F59E0B');
  assert.equal(jaugeScore(69, 40).couleur, '#F59E0B');
  assert.equal(jaugeScore(70, 40).couleur, '#10B981');
});

test('jaugeScore : 100 % remplit l’arc complètement', () => {
  assert.equal(jaugeScore(100, 40).decalage, 0);
});

test('jaugeScore : un score hors bornes ne déborde pas du cercle', () => {
  const j = jaugeScore(150, 40);
  assert.equal(j.decalage, 0);
  assert.ok(jaugeScore(-20, 40).decalage <= jaugeScore(-20, 40).circonference);
});
