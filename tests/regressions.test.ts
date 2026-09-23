/**
 * Non-régression des corrections de la revue de septembre 2026.
 *
 * Deux familles :
 *   1. les règles métier extraites en helpers (calendrier, filtres réseau,
 *      messagerie, rappels d'échéance, accès invité) ;
 *   2. des GARDE-FOUS STATIQUES : ils lisent le code source et échouent si un
 *      schéma de bug déjà corrigé réapparaît (joker ILIKE, date UTC, Edge
 *      Function inexistante…). Moins élégants qu'un test de comportement, ils
 *      attrapent ce qu'aucun test unitaire ne verrait : un nouvel appel écrit
 *      à l'ancienne.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
    lundiDe, libelleSemaine, premierMoisTrimestre, decaler, ancrageChangementVue,
} from '../src/helpers/calendrierHelpers.ts';
import {
    competencesDerivees, correspondCriteres, optionsFiltre, type CriteresReseau,
} from '../src/helpers/reseauFiltresHelpers.ts';
import { dossiersDeMessagerie, totalNonLus, entreprisesPartenaires } from '../src/helpers/messagerieHelpers.ts';
import { dateLocaleISO } from '../src/helpers/dateHelpers.ts';
import { messageErreurFonction } from '../src/helpers/erreurFonction.ts';
import { SEUILS, ecartJours, libelles, dejaEmis } from '../supabase/functions/send-deadline-reminders/rappelsEcheance.ts';
import { invitationParCode } from '../supabase/functions/guest-files/invitationCode.ts';
import { listeIn } from '../src/helpers/postgrestHelpers.ts';

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

const d = (a: number, m: number, j: number) => new Date(a, m - 1, j);
const iso = (x: Date) => dateLocaleISO(x);

test('calendrier : le lundi d’un dimanche est celui de la semaine qui finit', () => {
    assert.equal(iso(lundiDe(d(2026, 9, 27))), '2026-09-21'); // dimanche
    assert.equal(iso(lundiDe(d(2026, 9, 21))), '2026-09-21'); // lundi
    assert.equal(iso(lundiDe(d(2026, 9, 23))), '2026-09-21'); // mercredi
    assert.equal(iso(lundiDe(d(2026, 10, 1))), '2026-09-28'); // chevauchement de mois
});

test('calendrier : le libellé de semaine donne la plage exacte', () => {
    const l = libelleSemaine(d(2026, 9, 23));
    assert.match(l, /21/);
    assert.match(l, /27/);
    assert.match(l, /2026/);
});

test('calendrier : trimestre CIVIL (sept. → juillet), pas trois mois glissants', () => {
    assert.equal(premierMoisTrimestre(d(2026, 9, 23)), 6);  // juillet
    assert.equal(premierMoisTrimestre(d(2026, 1, 1)), 0);
    assert.equal(premierMoisTrimestre(d(2026, 12, 31)), 9);
    // Navigation depuis le milieu d'un trimestre : on saute au trimestre voisin.
    assert.equal(iso(decaler('quarter', d(2026, 9, 23), 1)), '2026-10-01');
    assert.equal(iso(decaler('quarter', d(2026, 9, 23), -1)), '2026-04-01');
});

test('calendrier : passer en vue Semaine s’ancre sur aujourd’hui si le mois affiché le contient', () => {
    const aujourdhui = d(2026, 9, 23);
    // Après une navigation par mois, la date affichée est le 1er.
    const affichee = d(2026, 9, 1);
    assert.equal(iso(ancrageChangementVue('week', 'month', affichee, aujourdhui)), '2026-09-23');
    // Autre mois : on garde la date affichée.
    assert.equal(iso(ancrageChangementVue('week', 'month', d(2026, 11, 1), aujourdhui)), '2026-11-01');
    // Depuis la vue Trimestre contenant aujourd'hui.
    assert.equal(iso(ancrageChangementVue('week', 'quarter', d(2026, 7, 1), aujourdhui)), '2026-09-23');
    // Vers une autre vue que Semaine : inchangé.
    assert.equal(iso(ancrageChangementVue('month', 'week', affichee, aujourdhui)), '2026-09-01');
});

// ---------------------------------------------------------------------------
// Filtres de la page Réseau
// ---------------------------------------------------------------------------

const refSpec = [
    { id: 'dev', domain_id: 'info' },
    { id: 'maint', domain_id: 'info' },
    { id: 'autre-info', domain_id: 'info' },
    { id: 'transp', domain_id: 'logi' },
];
const refZones = [{ id: 'z04', label: 'Alpes-de-Haute-Provence' }];
const vide = { natures: [], domains: [], specialties: [], geo_zones: [], expertise_tags: [] };
const taxo = {
    a: { ...vide, specialties: ['dev'] },                    // spécialité sans domaine coché
    b: { ...vide, domains: ['info'], geo_zones: ['z04'] },   // domaine sans spécialité
    c: { ...vide, specialties: ['transp'], expertise_tags: ['qualibat'] },
};
const entreprises = [
    { id: 'a', nom: 'Alpha', ville: 'Digne' },
    { id: 'b', nom: 'Beta', ville: 'Manosque' },
    { id: 'c', nom: 'Gamma', ville: 'Digne' },
];
const sansCritere: CriteresReseau = { domaine: '', specialite: '', tag: '', zone: '' };
const comp = competencesDerivees(taxo, refSpec, refZones);

test('réseau : une spécialité implique son domaine (cause des filtres vides)', () => {
    assert.ok(comp.a.domaines.has('info'));
    assert.ok(correspondCriteres(entreprises[0], comp.a, { ...sansCritere, domaine: 'info' }));
    assert.equal(correspondCriteres(entreprises[2], comp.c, { ...sansCritere, domaine: 'info' }), false);
});

test('réseau : zone = ville OU zone d’intervention, comparaison exacte', () => {
    assert.ok(correspondCriteres(entreprises[1], comp.b, { ...sansCritere, zone: 'alpes-de-haute-provence' }));
    assert.ok(correspondCriteres(entreprises[0], comp.a, { ...sansCritere, zone: 'Digne' }));
    assert.equal(correspondCriteres(entreprises[0], comp.a, { ...sansCritere, zone: 'Dig' }), false);
});

test('réseau : options = valeurs présentes dans l’onglet, comptées sous les autres critères', () => {
    const lib = (id: string) => ({ info: 'Informatique', logi: 'Logistique' } as Record<string, string>)[id];
    const opts = optionsFiltre(entreprises, comp, sansCritere, 'domaine', (_, c) => [...(c?.domaines ?? [])], lib);
    assert.deepEqual(opts.map(o => [o.id, o.n]), [['info', 2], ['logi', 1]]);

    // Sous le critère « ville = Digne », Informatique ne compte plus que Alpha.
    const sousZone = optionsFiltre(entreprises, comp, { ...sansCritere, zone: 'Digne' }, 'domaine',
        (_, c) => [...(c?.domaines ?? [])], lib);
    assert.deepEqual(sousZone.map(o => [o.id, o.n]), [['info', 1], ['logi', 1]]);
});

test('réseau : la sélection reste proposée à zéro, et les « Autre… » sont écartés', () => {
    const libSpec = (id: string) => ({ dev: 'Développement', maint: 'Maintenance', 'autre-info': 'Autre (informatique)', transp: 'Transport' } as Record<string, string>)[id];
    const taxoAutre = { ...taxo, d: { ...vide, specialties: ['autre-info'] } };
    const compAutre = competencesDerivees(taxoAutre, refSpec, refZones);
    const src = [...entreprises, { id: 'd', nom: 'Delta', ville: null }];
    const opts = optionsFiltre(src, compAutre, { ...sansCritere, specialite: 'maint' }, 'specialite',
        (_, c) => [...(c?.specialites ?? [])], libSpec);
    const ids = opts.map(o => o.id);
    assert.ok(ids.includes('maint'), 'la sélection doit rester visible');
    assert.equal(opts.find(o => o.id === 'maint')?.n, 0);
    assert.ok(!ids.includes('autre-info'), '« Autre » ne doit pas être proposé');
});

// ---------------------------------------------------------------------------
// Messagerie
// ---------------------------------------------------------------------------

test('messagerie : seuls mes dossiers et ceux où MON entreprise a accepté', () => {
    const dossiers = [
        { id: 'mien', createur_id: 'u1', groupements: [] },
        { id: 'accepte', createur_id: 'u9', groupements: [{ entreprise_id: 'e9', statut: 'accepte' }, { entreprise_id: 'e1', statut: 'accepte' }] },
        // Ancienne règle : « une » entreprise a accepté (le porteur) → compté à tort.
        { id: 'invite', createur_id: 'u9', groupements: [{ entreprise_id: 'e9', statut: 'accepte' }, { entreprise_id: 'e1', statut: 'invite' }] },
    ];
    assert.deepEqual(dossiersDeMessagerie(dossiers, 'u1', 'e1'), ['mien', 'accepte']);
    assert.deepEqual(dossiersDeMessagerie(dossiers, 'u1', null), ['mien']);
});

test('messagerie : les collègues du porteur ne sont pas des destinataires', () => {
    const groupements = [
        { entreprise_id: 'porteur', statut: 'accepte' },
        { entreprise_id: 'p1', statut: 'accepte' },
        { entreprise_id: 'p1', statut: 'accepte' },
        { entreprise_id: 'p2', statut: 'invite' },
        { entreprise_id: null, statut: 'accepte' },
    ];
    assert.deepEqual(entreprisesPartenaires(groupements, 'porteur'), ['p1']);
});

test('messagerie : total des non-lus dérivé, jamais négatif', () => {
    assert.equal(totalNonLus({ a: 2, b: 0, c: 3 }), 5);
    assert.equal(totalNonLus({ a: -1 }), 0);
    assert.equal(totalNonLus({}), 0);
});

// ---------------------------------------------------------------------------
// Dates et erreurs de fonctions
// ---------------------------------------------------------------------------

test('dateLocaleISO : date du fuseau local, pas la date UTC', () => {
    // 00:30 le 24 : en UTC+2 ce serait encore le 23 avec toISOString().
    assert.equal(dateLocaleISO(new Date(2026, 8, 24, 0, 30)), '2026-09-24');
    assert.equal(dateLocaleISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('messageErreurFonction : lit le motif du corps plutôt que « non-2xx »', async () => {
    const reponse = new Response(JSON.stringify({ error: 'Adresse bloquée' }), { status: 409 });
    const erreur = { message: 'Edge Function returned a non-2xx status code', context: reponse };
    assert.equal(await messageErreurFonction(erreur, 'repli'), 'Adresse bloquée');
    // Corps illisible : message générique remplacé par le repli.
    assert.equal(await messageErreurFonction({ message: 'Edge Function returned a non-2xx status code' }, 'repli'), 'repli');
    // Message utile conservé.
    assert.equal(await messageErreurFonction(new Error('Réseau indisponible'), 'repli'), 'Réseau indisponible');
});

// ---------------------------------------------------------------------------
// Rappels d'échéance
// ---------------------------------------------------------------------------

test('rappels d’échéance : seuils J-7, J-3, J-1, J-0', () => {
    assert.deepEqual([...SEUILS], [7, 3, 1, 0]);
    assert.equal(ecartJours('2026-09-23', '2026-09-30'), 7);
    assert.equal(ecartJours('2026-10-24', '2026-10-25'), 1); // passage à l'heure d'hiver
    assert.equal(libelles(0).titre, "Échéance aujourd'hui");
    assert.equal(libelles(1).titre, 'Échéance demain');
    assert.equal(libelles(3).titre, 'Échéance dans 3 jours');
});

test('rappels d’échéance : idempotence par seuil, anciens formats reconnus', () => {
    const base = { type: 'deadline_reminder', related_tender_id: 'T' };
    // Nouveau format.
    assert.ok(dejaEmis([{ ...base, id: 'x', seuil_jours: 3 }], 'T', 3));
    assert.equal(dejaEmis([{ ...base, id: 'x', seuil_jours: 3 }], 'T', 1), false);
    // Ancienne fonction SQL.
    assert.ok(dejaEmis([{ ...base, id: 'deadline_T_1d' }], 'T', 1));
    // Ancienne version de l'Edge Function : sans seuil = J-7 uniquement.
    assert.ok(dejaEmis([{ ...base, id: 'uuid-1' }], 'T', 7));
    assert.equal(dejaEmis([{ ...base, id: 'uuid-1' }], 'T', 3), false);
    // Autre dossier.
    assert.equal(dejaEmis([{ ...base, related_tender_id: 'U', seuil_jours: 3 }], 'T', 3), false);
});

// ---------------------------------------------------------------------------
// Accès invité par code
// ---------------------------------------------------------------------------

test('invité : comparaison exacte, les jokers ILIKE ne passent plus', () => {
    const lignes = [{ email: 'Alexandre_Louis@outlook.fr', access_code: 'Q67PHG6N' }];
    assert.ok(invitationParCode(lignes, ' alexandre_louis@OUTLOOK.fr ', 'q67phg6n'));
    assert.equal(invitationParCode(lignes, '%', '%%%%%%'), null);
    assert.equal(invitationParCode(lignes, 'alexandreXlouis@outlook.fr', 'Q67PHG6N'), null);
    assert.equal(invitationParCode(lignes, 'alexandre_louis@outlook.fr', 'Q67PH'), null); // code trop court
});

test('invité : invitation révoquée ou expirée refusée', () => {
    const maintenant = Date.parse('2026-09-23T12:00:00Z');
    const base = { email: 'a@x.fr', access_code: 'ABCDEF12' };
    assert.equal(invitationParCode([{ ...base, revoked_at: '2026-09-01T00:00:00Z' }], 'a@x.fr', 'ABCDEF12', maintenant), null);
    assert.equal(invitationParCode([{ ...base, expires_at: '2026-09-22T00:00:00Z' }], 'a@x.fr', 'ABCDEF12', maintenant), null);
    assert.ok(invitationParCode([{ ...base, expires_at: '2026-10-22T00:00:00Z' }], 'a@x.fr', 'ABCDEF12', maintenant));
});

test('listeIn : liste PostgREST quotée, guillemets et antislashs échappés', () => {
    assert.equal(listeIn(['dev', 'maint']), '("dev","maint")');
    assert.equal(listeIn(['a"b']), '("a\\"b")');
    assert.equal(listeIn(['a\\b']), '("a\\\\b")');
});

// ---------------------------------------------------------------------------
// Garde-fous statiques
// ---------------------------------------------------------------------------

const racine = process.cwd();
const lire = (chemin: string) => readFileSync(join(racine, chemin), 'utf8');
const fichiers = (dossier: string, ext: RegExp): string[] => {
    const res: string[] = [];
    const parcourir = (d: string) => {
        for (const nom of readdirSync(join(racine, d))) {
            const rel = join(d, nom);
            if (statSync(join(racine, rel)).isDirectory()) parcourir(rel);
            else if (ext.test(nom)) res.push(rel);
        }
    };
    parcourir(dossier);
    return res;
};
/** Le code sans ses commentaires, pour ne pas s'arrêter aux explications. */
const sansCommentaires = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const FONCTIONS = 'supabase/functions';
const dossiersFonctions = readdirSync(join(racine, FONCTIONS))
    .filter(n => existsSync(join(racine, FONCTIONS, n, 'index.ts')));

test('garde-fou : aucune recherche d’e-mail par ILIKE sans échappement des jokers', () => {
    const fautifs: string[] = [];
    for (const f of [...fichiers('src', /\.tsx?$/), ...dossiersFonctions.map(n => `${FONCTIONS}/${n}/index.ts`)]) {
        const src = sansCommentaires(lire(f));
        for (const m of src.matchAll(/\.ilike\(\s*['"]email['"]\s*,\s*([^)]*)/g)) {
            if (!/motif(Exact|IlikeExact)\(/.test(m[1])) fautifs.push(`${f} : ${m[0].trim()}`);
        }
    }
    assert.deepEqual(fautifs, [], `« _ » et « % » sont des jokers pour ILIKE :\n${fautifs.join('\n')}`);
});

test('garde-fou : pas de date du jour calculée en UTC côté front', () => {
    const fautifs = fichiers('src', /\.tsx?$/)
        .filter(f => /toISOString\(\)\s*\.\s*(split\(\s*['"`]T['"`]\s*\)\s*\[0\]|slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\))/.test(sansCommentaires(lire(f))));
    assert.deepEqual(fautifs, [], 'Utiliser dateLocaleISO() : en France, entre minuit et 2 h, la date UTC est la veille.');
});

test('garde-fou : toute Edge Function appelée par le front existe', () => {
    const appelees = new Set<string>();
    for (const f of fichiers('src', /\.tsx?$/)) {
        const src = lire(f);
        for (const m of src.matchAll(/functions\.invoke\(\s*['"]([a-z0-9-]+)['"]/g)) appelees.add(m[1]);
        for (const m of src.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) appelees.add(m[1]);
    }
    const absentes = [...appelees].filter(n => !dossiersFonctions.includes(n));
    assert.deepEqual(absentes, []);
});

test('garde-fou : les copies partagées entre Edge Functions restent identiques', () => {
    const paires: Array<[string, string]> = [
        [`${FONCTIONS}/guest-files/invitationCode.ts`, `${FONCTIONS}/upload-document/invitationCode.ts`],
    ];
    // emailConfig.ts : une seule adresse d'expéditeur pour toutes les fonctions.
    const configs = dossiersFonctions
        .map(n => `${FONCTIONS}/${n}/emailConfig.ts`)
        .filter(f => existsSync(join(racine, f)));
    for (let i = 1; i < configs.length; i++) paires.push([configs[0], configs[i]]);
    for (const [a, b] of paires) assert.equal(lire(b), lire(a), `${b} diverge de ${a}`);
});

test('garde-fou : l’expéditeur des e-mails est sur un domaine authentifié', () => {
    // `contact@mail.filao.io` n'existait pas dans Brevo : tous les e-mails
    // étaient acceptés puis rejetés en silence.
    const config = lire(`${FONCTIONS}/send-reminder/emailConfig.ts`);
    const adresse = config.match(/email:\s*"([^"]+)"/)?.[1] ?? '';
    assert.match(adresse, /@(filao\.io|filao-app\.fr)$/, `expéditeur inattendu : ${adresse}`);
});

test('garde-fou : les liens des e-mails ne pointent pas vers le site vitrine', () => {
    // filao.io est le site vitrine ; l'application est sur filao-app.fr.
    const fautifs = dossiersFonctions
        .map(n => `${FONCTIONS}/${n}/index.ts`)
        .filter(f => /\|\|\s*["']https:\/\/filao\.io["']|\?\?\s*["']https:\/\/filao\.io["']/.test(sansCommentaires(lire(f))));
    assert.deepEqual(fautifs, []);
});

test('garde-fou : le retour Stripe vise une route existante de l’application', () => {
    const src = lire(`${FONCTIONS}/create-checkout-session/index.ts`);
    assert.ok(!/\/settings\?/.test(src), '`/settings` n’existe pas : page 404 après paiement');
    assert.match(src, /\?tab=settings&section=billing/);
});

test('garde-fou : les e-mails d’authentification passent par /confirmer', () => {
    for (const [fichier, type] of [['confirm-signup.html', 'signup'], ['reset-password.html', 'recovery']]) {
        const html = lire(`supabase/email-templates/${fichier}`);
        assert.ok(!html.includes('{{ .ConfirmationURL }}'), `${fichier} : lien consommé par les antivirus`);
        assert.ok(html.includes(`/confirmer?token_hash={{ .TokenHash }}&amp;type=${type}`), fichier);
    }
});

test('garde-fou : les compétences ne s’écrivent que par les helpers sans fenêtre de perte', () => {
    // Vider puis re-remplir, sans lire les erreurs, effaçait les compétences
    // d'une entreprise ou d'un dossier au premier refus d'écriture.
    const tables = /from\(\s*['"](company_(natures|domains|specialties|expertise_tags|geo_zones)|reponses_ao_specialties)['"]\s*\)\s*\.\s*(insert|delete|upsert|update)\(/;
    const fautifs = fichiers('src', /\.tsx?$/)
        .filter(f => !f.endsWith('taxonomieEntreprise.ts'))
        .filter(f => tables.test(sansCommentaires(lire(f))));
    assert.deepEqual(fautifs, [], 'Passer par enregistrerTaxonomie / enregistrerCompetencesDossier');
});

// ---------------------------------------------------------------------------
// Existence des objets de base appelés par le code
// ---------------------------------------------------------------------------
const sqlMigrations = fichiers('supabase/migrations', /\.sql$/).map(lire).join('\n');

/**
 * Objets créés directement en base, hors migrations. Chaque entrée est une
 * dette : l'objet serait perdu à une reconstruction de la base. La liste ne
 * doit que diminuer — un NOUVEL appel à un objet inconnu fait échouer le test,
 * ce qui aurait signalé `generer_cle_reprise` ou
 * `respond_to_invitation_by_code`, appelées sans jamais avoir été créées.
 */
const RPC_HORS_MIGRATIONS = new Set(['get_tender_owner_info', 'update_tender_file_count', 'toggle_comment_like']);
const TABLES_HORS_MIGRATIONS = new Set(['comments', 'comments_with_user', 'user_integrations']);

test('garde-fou : toute RPC appelée existe (migrations ou liste documentée)', () => {
    const sources = [...fichiers('src', /\.tsx?$/), ...fichiers(FONCTIONS, /\.ts$/)];
    const appelees = new Set<string>();
    for (const f of sources) {
        for (const m of lire(f).matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]/g)) appelees.add(m[1]);
    }
    const inconnues = [...appelees].filter(nom =>
        !RPC_HORS_MIGRATIONS.has(nom)
        && !new RegExp(`FUNCTION\\s+(public\\.|app\\.)?${nom}\\s*\\(`, 'i').test(sqlMigrations));
    assert.deepEqual(inconnues, [], 'RPC appelée mais jamais créée par une migration');
});

test('garde-fou : toute table utilisée existe (migrations ou liste documentée)', () => {
    const sources = [...fichiers('src', /\.tsx?$/), ...fichiers(FONCTIONS, /\.ts$/)];
    const tables = new Set<string>();
    for (const f of sources) {
        const src = sansCommentaires(lire(f));
        // `storage.from('documents')` désigne un bucket, pas une table.
        for (const m of src.matchAll(/(?<!storage\s*)\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)/g)) tables.add(m[1]);
    }
    const inconnues = [...tables].filter(t =>
        !TABLES_HORS_MIGRATIONS.has(t)
        && !new RegExp(`(TABLE|VIEW)\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(public\\.)?${t}\\b`, 'i').test(sqlMigrations));
    assert.deepEqual(inconnues, []);
});

test('garde-fou : numéros de migration uniques', () => {
    const numeros = readdirSync(join(racine, 'supabase/migrations'))
        .filter(n => n.endsWith('.sql'))
        .map(n => n.match(/^(\d+[a-z]?)_/)?.[1]);
    const doublons = numeros.filter((n, i) => n && numeros.indexOf(n) !== i);
    assert.deepEqual(doublons, [], 'deux migrations portent le même numéro : ordre d’application ambigu');
});

// ---------------------------------------------------------------------------
// Sécurité des Edge Functions appelables par n'importe quel compte
// ---------------------------------------------------------------------------
import { peutRepondre } from '../supabase/functions/accept-invitation/decision.ts';
import { regleDestinataire, TITRES } from '../supabase/functions/notify-user/regles.ts';

test('accept-invitation : sans invitation, impossible de rejoindre un dossier', () => {
    // Faille corrigée : n'importe quel compte devenait membre « accepte »
    // de n'importe quel dossier dont il connaissait l'identifiant.
    const base = { accept: true, entrepriseDossier: 'porteur', monEntreprise: 'moi', maintenant: Date.parse('2026-09-23T12:00:00Z') };
    assert.equal(peutRepondre({ ...base, groupement: null, invitations: [] }), false);
    assert.equal(peutRepondre({ ...base, groupement: { statut: 'refuse' }, invitations: [] }), false);
});

test('accept-invitation : invitations reconnues, révoquées ou expirées refusées', () => {
    const base = { accept: true, entrepriseDossier: 'porteur', monEntreprise: 'moi', maintenant: Date.parse('2026-09-23T12:00:00Z') };
    assert.ok(peutRepondre({ ...base, groupement: { statut: 'invite' }, invitations: [] }));
    assert.ok(peutRepondre({ ...base, groupement: null, invitations: [{ status: 'pending' }] }));
    assert.ok(peutRepondre({ ...base, groupement: { statut: 'accepte' }, invitations: [] }), 'idempotence');
    assert.equal(peutRepondre({ ...base, groupement: null, invitations: [{ status: 'pending', revoked_at: '2026-09-01' }] }), false);
    assert.equal(peutRepondre({ ...base, groupement: null, invitations: [{ status: 'pending', expires_at: '2026-09-01T00:00:00Z' }] }), false);
    // Refuser une invitation déjà acceptée n'est pas une « réponse » : c'est un départ.
    assert.equal(peutRepondre({ ...base, accept: false, groupement: { statut: 'accepte' }, invitations: [] }), false);
    // Le porteur ne répond pas à une invitation sur son propre dossier.
    assert.equal(peutRepondre({ ...base, monEntreprise: 'porteur', groupement: { statut: 'invite' }, invitations: [] }), false);
});

test('notify-user : types et relations exigées', () => {
    assert.equal(regleDestinataire('tender_won'), null, 'les résultats sont émis par le serveur');
    assert.equal(regleDestinataire('inventé'), null);
    assert.equal(regleDestinataire('network_invite_accepted'), 'reseau');
    assert.equal(regleDestinataire('collaboration_left'), 'porteur');
    assert.equal(regleDestinataire('chat_message'), 'dossier');
});

test('notify-user : tout type envoyé par le front est accepté par le serveur', () => {
    // Sans ce croisement, durcir la liste côté serveur casserait en silence
    // une notification du front (refus 403 journalisé, rien d'affiché).
    const src = lire('src/helpers/notificationHelpers.ts');
    const envoyes = [...src.matchAll(/type:\s*'([a-z_]+)'/g)].map(m => m[1]);
    assert.ok(envoyes.length > 5);
    const refuses = envoyes.filter(t => !(t in TITRES));
    assert.deepEqual(refuses, []);
});

// ---------------------------------------------------------------------------
// Protections côté base : la DERNIÈRE définition doit les conserver
// ---------------------------------------------------------------------------
const migrationsTriees = readdirSync(join(racine, 'supabase/migrations'))
    .filter(n => n.endsWith('.sql')).sort()
    .map(n => ({ nom: n, sql: lire(`supabase/migrations/${n}`) }));

/** Corps de la dernière définition d'une fonction SQL, toutes migrations confondues. */
const derniereDefinition = (fonction: string): string => {
    let corps = '';
    for (const { sql } of migrationsTriees) {
        const re = new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+(public\\.|app\\.)?${fonction}\\s*\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$`, 'gi');
        for (const m of sql.matchAll(re)) corps = m[4];
    }
    return corps;
};

test('base : un client ne change ni son rôle, ni son entreprise, ni son e-mail directement', () => {
    const corps = derniereDefinition('proteger_profil');
    assert.ok(corps, 'app.proteger_profil introuvable');
    assert.match(corps, /current_user\s*<>\s*'authenticated'/);
    assert.match(corps, /NEW\.role_id IS DISTINCT FROM OLD\.role_id/);
    assert.match(corps, /entreprise_creee_par_moi/);
    assert.match(corps, /email_authentifie/);
    const trigger = migrationsTriees.map(m => m.sql).join('\n');
    assert.match(trigger, /CREATE TRIGGER trg_0_proteger_profil[\s\S]*?ON utilisateurs/);
});

test('base : le forfait et la facturation ne s’écrivent pas depuis l’application', () => {
    const corps = derniereDefinition('proteger_entreprise');
    for (const col of ['plan', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status']) {
        assert.ok(corps.includes(`'${col}'`), `colonne ${col} non protégée`);
    }
    assert.match(migrationsTriees.map(m => m.sql).join('\n'), /CREATE TRIGGER trg_0_proteger_entreprise[\s\S]*?ON entreprises/);
});

test('base : une invitation réseau ne relie que l’entreprise de l’appelant', () => {
    const corps = derniereDefinition('consommer_invitation_reseau');
    assert.match(corps, /entreprise_id\s*=\s*p_entreprise/);
    assert.match(corps, /created_by\s*=\s*auth\.uid\(\)/);
});

test('base : répondre par code exige une invitation non révoquée', () => {
    assert.match(derniereDefinition('respond_to_invitation_by_code'), /revoked_at IS NULL/);
    assert.match(derniereDefinition('get_invitation_by_code'), /revoked_at IS NULL/);
});

test('base : un mandat transmis ne retire pas l’accès du nouveau mandataire', () => {
    // Migration 105 : le filet « Mandataire » n'est gardé que pour les
    // dossiers sans entreprise porteuse figée.
    for (const f of ['est_membre', 'est_convie']) {
        assert.match(derniereDefinition(f), /r\.entreprise_id IS NOT NULL\s*OR/, f);
    }
});

import { seulAdministrateurBloquant } from '../supabase/functions/delete-account/regles.ts';

test('suppression de compte : seul administrateur d’une équipe bloqué AVANT toute suppression', () => {
    const admin = { name: 'admin' }, membre = { name: 'user' };
    // Seul admin, deux autres membres : la base refuserait → on bloque en amont.
    assert.ok(seulAdministrateurBloquant([{ id: 'moi', roles: admin }, { id: 'a', roles: membre }, { id: 'b', roles: membre }], 'moi'));
    // Un seul autre membre : promu automatiquement, pas de blocage.
    assert.equal(seulAdministrateurBloquant([{ id: 'moi', roles: admin }, { id: 'a', roles: membre }], 'moi'), false);
    // Un autre administrateur existe.
    assert.equal(seulAdministrateurBloquant([{ id: 'moi', roles: admin }, { id: 'a', roles: admin }, { id: 'b', roles: membre }], 'moi'), false);
    // Simple membre.
    assert.equal(seulAdministrateurBloquant([{ id: 'moi', roles: membre }, { id: 'a', roles: admin }, { id: 'b', roles: membre }], 'moi'), false);
});

test('base : les policies héritées trop larges sont retirées', () => {
    const sql = migrationsTriees.map(m => m.sql).join('\n');
    assert.match(sql, /DROP POLICY IF EXISTS "Users can update own company" ON entreprises/);
    assert.match(sql, /DROP POLICY IF EXISTS "Self delete utilisateur" ON utilisateurs/);
});

import { construireFiltreBoamp } from '../src/helpers/boampHelpers.ts';

test('BOAMP : un guillemet dans les mots-clés ne casse plus la requête', () => {
    const f = construireFiltreBoamp({ motsCles: ' "transport  scolaire" \\ lot ', aujourdhui: '2026-09-23' });
    assert.equal(f, 'search("\\"transport scolaire\\" \\\\ lot") AND datelimitereponse >= "2026-09-23"');
});

test('BOAMP : critères assemblés, plancher de date toujours présent', () => {
    const f = construireFiltreBoamp({
        typeMarche: 'SERVICES', typeProcedure: 'Procédure adaptée', codeDepartement: '04',
        dateLimiteMin: '2026-10-01', aujourdhui: '2026-09-23',
    });
    assert.equal(f, 'type_marche:"SERVICES" AND type_procedure:"Procédure adaptée" AND code_departement="04" AND datelimitereponse >= "2026-10-01"');
    // Une date passée ne supprime pas le plancher.
    assert.match(construireFiltreBoamp({ dateLimiteMin: '2026-01-01', aujourdhui: '2026-09-23' }), /datelimitereponse >= "2026-09-23"$/);
    // Mots-clés vides : pas de clause search().
    assert.ok(!construireFiltreBoamp({ motsCles: '   ', aujourdhui: '2026-09-23' }).includes('search('));
});
