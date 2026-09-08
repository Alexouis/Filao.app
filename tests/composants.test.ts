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

// Le DOM de `happy-dom` laisse des minuteurs et un `window` ouverts : sans
// fermeture explicite, le processus de test ne rend jamais la main et la CI
// resterait bloquée jusqu'au délai d'expiration.
after(async () => {
    cleanup();
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
    await GlobalRegistrator.unregister();
});
