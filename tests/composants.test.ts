/**
 * Tests de rendu des composants extraits de `TenderWizard`.
 *
 * POURQUOI CES TESTS
 * Les 53 tests unitaires ne couvrent que des fonctions pures. Les composants
 * sortis du wizard n'étaient validés que par le typage et le build — or ni
 * l'un ni l'autre ne dit si une modale s'affiche, ni si elle respecte les
 * règles de visibilité (porteur / membre, dossier verrouillé).
 *
 * Ces tests ne vérifient pas l'apparence : ils vérifient les DÉCISIONS —
 * qui voit quoi, quelles actions sont proposées, quels rappels partent. C'est
 * ce qu'une extraction risque de casser sans que rien ne le signale.
 *
 * Ils servent de filet avant le découpage des deux grandes vues.
 */
import './setupDom.ts';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { CriteresModal } from '../src/components/CriteresModal.tsx';
import { DocDetailsModal } from '../src/components/DocDetailsModal.tsx';
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog.tsx';
import { IndicateursDossier } from '../src/components/IndicateursDossier.tsx';
import { PanneauxLateraux } from '../src/components/PanneauxLateraux.tsx';
import { EquipeEtPieces } from '../src/components/EquipeEtPieces.tsx';
import { InfoItem, VerifiedBadge, UnverifiedBadge } from '../src/components/settings/CompanyInfoAtoms.tsx';
import { CompanyInfoReadOnly } from '../src/components/settings/CompanyInfoReadOnly.tsx';
import { OnboardingCompanyStep } from '../src/components/OnboardingCompanyStep.tsx';

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------
const rien = () => { /* rappel muet */ };

const proprietesCriteres = (surcharge: any = {}) => ({
    ouvert: true,
    criteresExistants: null,
    isOwner: true,
    isLocked: false,
    loading: false,
    inputGlassPlain: '',
    onFermer: rien,
    onValider: rien,
    ...surcharge,
});

// ===========================================================================
// ConfirmDialog — la brique partagée par toutes les confirmations
// ===========================================================================
test('ConfirmDialog : fermé, il ne rend rien', () => {
    cleanup();
    const { container } = render(
        React.createElement(ConfirmDialog, {
            ouvert: false, titre: 'Supprimer ?', message: 'Irréversible.',
            onConfirmer: rien, onAnnuler: rien,
        })
    );
    assert.equal(container.innerHTML, '');
});

test('ConfirmDialog : ouvert, il affiche titre et message', () => {
    cleanup();
    render(
        React.createElement(ConfirmDialog, {
            ouvert: true, titre: 'Supprimer ce jalon ?', message: '« Retrait du DCE » sera retiré.',
            onConfirmer: rien, onAnnuler: rien,
        })
    );
    assert.ok(screen.getByText('Supprimer ce jalon ?'));
    assert.ok(screen.getByText(/Retrait du DCE/));
});

test('ConfirmDialog : chaque bouton déclenche SON rappel, pas l’autre', () => {
    cleanup();
    let confirme = 0, annule = 0;
    render(
        React.createElement(ConfirmDialog, {
            ouvert: true, titre: 'Titre', message: 'Message',
            libelleConfirmer: 'Supprimer', libelleAnnuler: 'Annuler',
            onConfirmer: () => { confirme++; }, onAnnuler: () => { annule++; },
        })
    );
    fireEvent.click(screen.getByText('Supprimer'));
    assert.equal(confirme, 1);
    assert.equal(annule, 0, "Annuler ne doit pas être déclenché par Supprimer");

    fireEvent.click(screen.getByText('Annuler'));
    assert.equal(annule, 1);
    assert.equal(confirme, 1);
});

// ===========================================================================
// CriteresModal — brouillon local, et règles de modification
// ===========================================================================
test('CriteresModal : fermée, elle ne rend rien', () => {
    cleanup();
    const { container } = render(
        React.createElement(CriteresModal, proprietesCriteres({ ouvert: false }))
    );
    assert.equal(container.innerHTML, '');
});

test('CriteresModal : le porteur peut enregistrer, pas un simple membre', () => {
    cleanup();
    render(React.createElement(CriteresModal, proprietesCriteres({ isOwner: true })));
    assert.ok(screen.queryByText('Enregistrer'), 'le porteur doit pouvoir enregistrer');

    cleanup();
    render(React.createElement(CriteresModal, proprietesCriteres({ isOwner: false })));
    assert.equal(screen.queryByText('Enregistrer'), null, 'un membre ne modifie pas les critères');
});

test('CriteresModal : dossier verrouillé, plus d’enregistrement possible', () => {
    cleanup();
    render(React.createElement(CriteresModal, proprietesCriteres({ isOwner: true, isLocked: true })));
    assert.equal(screen.queryByText('Enregistrer'), null);
});

test('CriteresModal : le brouillon est amorcé depuis les critères existants', () => {
    cleanup();
    render(React.createElement(CriteresModal, proprietesCriteres({
        criteresExistants: {
            kind: 'ponderes',
            criteres: [
                { libelle: 'Prix', poids: 60 },
                { libelle: 'Valeur technique', poids: 40 },
            ],
        },
    })));
    // Les libellés existants doivent apparaître dans les champs de saisie.
    const champs = screen.getAllByDisplayValue(/Prix|Valeur technique/);
    assert.equal(champs.length, 2);
});

test('CriteresModal : sans critères existants, une ligne vierge est proposée', () => {
    cleanup();
    const { container } = render(
        React.createElement(CriteresModal, proprietesCriteres({ criteresExistants: null }))
    );
    // Une seule ligne de saisie de libellé, vide.
    const textes = container.querySelectorAll('input[type="text"]');
    assert.equal(textes.length, 1);
    assert.equal((textes[0] as HTMLInputElement).value, '');
});

// ===========================================================================
// DocDetailsModal — vue réservée au porteur
// ===========================================================================
const proprietesDocDetails = (surcharge: any = {}) => ({
    ouvert: true,
    isOwner: true,
    groupementMembers: [],
    uploadedFiles: {},
    userProfileId: 'u1',
    tenderId: 't1',
    docProgress: { total: 0, uploaded: 0, percent: 0 },
    resentInvitations: {},
    loading: false,
    onFermer: rien,
    onRelancer: rien,
    onTelechargerTout: rien,
    onTelechargerPiece: rien,
    onDeposer: rien,
    ...surcharge,
});

test('DocDetailsModal : un non-porteur ne voit RIEN, même modale ouverte', () => {
    cleanup();
    const { container } = render(
        React.createElement(DocDetailsModal, proprietesDocDetails({ isOwner: false }))
    );
    // Règle de cloisonnement : cette vue croise les pièces de tous les membres.
    assert.equal(container.innerHTML, '');
});

test('DocDetailsModal : le porteur voit la coordination documentaire', () => {
    cleanup();
    render(React.createElement(DocDetailsModal, proprietesDocDetails({ isOwner: true })));
    assert.ok(screen.getByText('Coordination Documentaire'));
});


// ===========================================================================
// Étape 2 du découpage — indicateurs et panneaux latéraux
// ===========================================================================
const proprietesIndicateurs = (surcharge: any = {}) => ({
    successScore: 40,
    potentialGain: 11,
    missingSpecialties: [],
    montantEstime: null,
    criteresAttribution: null,
    nextMilestone: null,
    isOwner: true,
    isLocked: false,
    gaugeRadius: 40,
    gaugeCircumference: 251,
    gaugeOffset: 100,
    gaugeColor: '#F59E0B',
    carouselIndex: 0,
    onOuvrirCriteres: rien,
    onOuvrirRetroplanning: rien,
    ...surcharge,
});

test('IndicateursDossier : le score du dossier est affiché tel quel', () => {
    cleanup();
    render(React.createElement(IndicateursDossier, proprietesIndicateurs({ successScore: 40 })));
    assert.ok(screen.getByText('40%'));
});

test('IndicateursDossier : score illisible → aucun pourcentage affiché', () => {
    cleanup();
    render(React.createElement(IndicateursDossier, proprietesIndicateurs({ successScore: null })));
    // Le cas qui faisait diverger cotraitant et mandataire : mieux vaut ne rien
    // annoncer qu'un chiffre faussement optimiste.
    assert.equal(screen.queryByText('85%'), null);
    assert.equal(screen.queryByText('40%'), null);
});

test('IndicateursDossier : le gain par partenaire n’apparaît que s’il manque une compétence', () => {
    cleanup();
    render(React.createElement(IndicateursDossier, proprietesIndicateurs({
        missingSpecialties: [{ id: 's1', label: 'Logistique' }],
        potentialGain: 28,
    })));
    assert.ok(screen.getByText(/\+28%/));

    cleanup();
    render(React.createElement(IndicateursDossier, proprietesIndicateurs({ missingSpecialties: [] })));
    assert.equal(screen.queryByText(/via partenaire/), null);
});

test('IndicateursDossier : sans critères publiés, le dit explicitement', () => {
    cleanup();
    render(React.createElement(IndicateursDossier, proprietesIndicateurs({ criteresAttribution: null })));
    assert.ok(screen.getByText(/Non communiqués dans l'avis/));
});

const proprietesPanneaux = (surcharge: any = {}) => ({
    referenceMarche: null,
    datePublication: null,
    dateDepotSouhaitee: null,
    secteurActivite: null,
    cpvCodes: null,
    lienTelechargement: null,
    dceDocuments: [],
    milestones: [],
    tenderId: 't1',
    amIInvitee: false,
    isRefused: false,
    isOwner: true,
    isLocked: false,
    onOuvrirContexte: rien,
    onOuvrirDCE: rien,
    onOuvrirRetroplanning: rien,
    ...surcharge,
});

test('PanneauxLateraux : le contexte est toujours visible', () => {
    cleanup();
    render(React.createElement(PanneauxLateraux, proprietesPanneaux()));
    assert.ok(screen.getByText(/Contexte de l'AO/));
});

test('PanneauxLateraux : un membre ayant refusé ne voit ni pièces ni rétroplanning', () => {
    cleanup();
    render(React.createElement(PanneauxLateraux, proprietesPanneaux({ isRefused: true })));
    assert.ok(screen.getByText(/Contexte de l'AO/), 'le contexte reste visible');
    assert.equal(screen.queryByText(/Pièces du marché/), null);
    assert.equal(screen.queryByText('Rétroplanning'), null);
});

test('PanneauxLateraux : sans lien renseigné, aucun lien mort n’est proposé', () => {
    cleanup();
    render(React.createElement(PanneauxLateraux, proprietesPanneaux({ lienTelechargement: null })));
    assert.equal(screen.queryByText(/Lien vers l'appel d'offres/), null);
});


// ===========================================================================
// Étape 3 du découpage — zone Équipe & pièces
// ===========================================================================
const membre = (o: any = {}) => ({
    id: 'm1', email: 'a@b.fr', name: 'Alexandre', company: 'Axero',
    role: 'Co-traitant', status: 'accepte', deleted: false, ...o,
});

const proprietesEquipe = (surcharge: any = {}) => ({
    activeMembers: [membre()],
    globalProgress: { received: 4, total: 19, percent: 21 },
    getMemberProgress: () => ({ received: 4, total: 5, percent: 80 }),
    missingSpecialties: [],
    requiredSpecialtyIds: [],
    refSpecialties: [],
    allCoveredSpecialtyIds: [],
    requiredSkills: [],
    typeGroupement: 'solidaire',
    potentialGain: 11,
    carouselIndex: 0,
    isOwner: true,
    isLocked: false,
    isRefused: false,
    amIInvitee: false,
    userProfileId: 'u1',
    userProfileEmail: 'moi@x.fr',
    onOuvrirMembre: rien,
    onOuvrirCoordination: rien,
    onOuvrirCompetences: rien,
    onAjouterMembre: rien,
    onOuvrirReseau: rien,
    onRetirerMembre: rien,
    onRelancerInvitation: rien,
    onRetirerCompetence: rien,
    ...surcharge,
});

test('EquipeEtPieces : l’avancement global est affiché tel qu’on le lui donne', () => {
    cleanup();
    render(React.createElement(EquipeEtPieces, proprietesEquipe()));
    // Le composant ne recalcule rien : il restitue la valeur unifiée.
    assert.ok(screen.getByText(/4 \/ 19 pièces/));
});

test('EquipeEtPieces : le porteur peut ajouter un membre, pas un simple membre', () => {
    cleanup();
    render(React.createElement(EquipeEtPieces, proprietesEquipe({ isOwner: true })));
    assert.ok(screen.queryByText(/Ajouter un membre/));

    cleanup();
    render(React.createElement(EquipeEtPieces, proprietesEquipe({ isOwner: false })));
    assert.equal(screen.queryByText(/Ajouter un membre/), null);
});

test('EquipeEtPieces : dossier verrouillé, plus d’ajout de membre', () => {
    cleanup();
    render(React.createElement(EquipeEtPieces, proprietesEquipe({ isOwner: true, isLocked: true })));
    assert.equal(screen.queryByText(/Ajouter un membre/), null);
});

test('EquipeEtPieces : ouvrir la fiche d’un membre remonte son index au parent', () => {
    cleanup();
    let indexRecu: number | null = null;
    render(React.createElement(EquipeEtPieces, proprietesEquipe({
        onOuvrirMembre: (i: number) => { indexRecu = i; },
    })));
    fireEvent.click(screen.getByText('Axero'));
    assert.equal(indexRecu, 0, "le parent doit recevoir l'index du membre cliqué");
});

test('EquipeEtPieces : les compétences non couvertes sont signalées', () => {
    cleanup();
    render(React.createElement(EquipeEtPieces, proprietesEquipe({
        requiredSpecialtyIds: ['s1'],
        refSpecialties: [{ id: 's1', label: 'Transport scolaire' }],
        allCoveredSpecialtyIds: [],
        missingSpecialties: [{ id: 's1', label: 'Transport scolaire' }],
    })));
    assert.ok(screen.getByText('Transport scolaire'));
});


// ===========================================================================
// Fiche entreprise — éléments extraits de CompanyTab
// ===========================================================================
test('InfoItem : une valeur absente est SIGNALÉE, pas masquée', () => {
    cleanup();
    render(React.createElement(InfoItem, { label: 'SIRET', value: null }));
    // Un champ escamoté laisse croire qu'il n'existe pas ; « Non renseigné »
    // indique quoi compléter.
    assert.ok(screen.getByText('Non renseigné'));
    assert.ok(screen.getByText('SIRET'));
});

test('InfoItem : une valeur présente est affichée telle quelle', () => {
    cleanup();
    render(React.createElement(InfoItem, { label: 'SIRET', value: '55210055400013' }));
    assert.ok(screen.getByText('55210055400013'));
    assert.equal(screen.queryByText('Non renseigné'), null);
});

test('Badges : vérifié et non vérifié portent des libellés distincts', () => {
    cleanup();
    render(React.createElement(VerifiedBadge));
    assert.ok(screen.getByText(/Vérifié via SIRET/));

    cleanup();
    render(React.createElement(UnverifiedBadge));
    assert.ok(screen.getByText('Non vérifié'));
});

const proprietesFiche = (surcharge: any = {}) => ({
    formData: {
        nom: 'Axero', siret: '55210055400013', adresse: '1 rue de la Paix',
        code_postal: '75002', ville: 'Paris', forme_juridique: 'SAS',
        date_creation: '2020-03-15', site_web: '', tva: '', effectif: '',
        code_naf: '', libelle_naf: '', taille: '', prenom: '', nom_famille: '', poste: '',
    },
    entrepriseData: { id: 'e1', logo_url: null },
    getLegalFormLabel: (_c: string, l: string) => l,
    visibleDansReseau: false,
    depotLogoEnCours: false,
    savingReseau: false,
    onDeposerLogo: rien,
    onBasculerReseau: rien,
    refDomains: [], refSpecialties: [], refExpertiseTags: [], refGeoZones: [],
    selectedNatures: [], selectedDomains: [], selectedSpecialties: [],
    selectedExpertiseTags: [], selectedGeoZones: [],
    ...surcharge,
});

test('CompanyInfoReadOnly : les informations d’identité sont affichées', () => {
    cleanup();
    render(React.createElement(CompanyInfoReadOnly, proprietesFiche()));
    assert.ok(screen.getByText('55210055400013'));
    assert.ok(screen.getByText(/Paris/));
});

test('CompanyInfoReadOnly : les champs vides affichent « Non renseigné »', () => {
    cleanup();
    render(React.createElement(CompanyInfoReadOnly, proprietesFiche()));
    // Plusieurs champs du jeu d'essai sont vides (TVA, effectif, NAF…).
    assert.ok(screen.getAllByText('Non renseigné').length > 0);
});


// ===========================================================================
// Inscription — étape « entreprise »
// ===========================================================================
const proprietesEtape1 = (surcharge: any = {}) => ({
    companyData: { nom: '', siret: '', adresse: '', ville: '', code_postal: '' },
    setCompanyData: rien,
    userData: { prenom: '', nom_famille: '', poste: '' },
    setUserData: rien,
    siretInput: '',
    setSiretInput: rien,
    searching: false,
    searchError: null,
    setSearchError: rien,
    onRechercherSiret: rien,
    entryMode: null,
    setEntryMode: rien,
    setFieldsLocked: rien,
    isVerified: false,
    setIsVerified: rien,
    lectureSeule: false,
    nomRattachement: null,
    entrepriseId: null,
    ...surcharge,
});

test('OnboardingCompanyStep : le mode choisi décide du panneau affiché', () => {
    // `entryMode` à null : ni la recherche ni le formulaire manuel.
    cleanup();
    render(React.createElement(OnboardingCompanyStep, proprietesEtape1({ entryMode: null })));
    assert.equal(screen.queryByText('Recherche par SIRET'), null);

    cleanup();
    render(React.createElement(OnboardingCompanyStep, proprietesEtape1({ entryMode: 'siret' })));
    assert.ok(screen.getByText('Recherche par SIRET'));

    // La saisie manuelle reste offerte : une entreprise absente du répertoire
    // ne doit pas bloquer l'inscription.
    cleanup();
    render(React.createElement(OnboardingCompanyStep, proprietesEtape1({ entryMode: 'manual' })));
    assert.ok(screen.getByText('Saisie manuelle'));
});

test('OnboardingCompanyStep : une erreur de recherche est affichée', () => {
    cleanup();
    render(React.createElement(OnboardingCompanyStep, proprietesEtape1({
        entryMode: 'siret',
        searchError: 'Établissement introuvable',
    })));
    assert.ok(screen.getByText('Établissement introuvable'));
});

test('OnboardingCompanyStep : rattaché à une entreprise, la saisie est expliquée', () => {
    cleanup();
    render(React.createElement(OnboardingCompanyStep, proprietesEtape1({
        lectureSeule: true,
        nomRattachement: 'Axero',
        entrepriseId: 'e1',
    })));
    // L'utilisateur doit comprendre POURQUOI il ne peut pas modifier, sinon il
    // croit à un blocage.
    assert.ok(screen.getByText(/Axero/));
});

// Le DOM de `happy-dom` laisse des minuteurs et un `window` ouverts : sans
// fermeture explicite, le processus de test ne rend jamais la main et la CI
// resterait bloquée jusqu'au délai d'expiration.
after(async () => {
    cleanup();
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
    await GlobalRegistrator.unregister();
});
