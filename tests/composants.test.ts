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

// Le DOM de `happy-dom` laisse des minuteurs et un `window` ouverts : sans
// fermeture explicite, le processus de test ne rend jamais la main et la CI
// resterait bloquée jusqu'au délai d'expiration.
after(async () => {
    cleanup();
    const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
    await GlobalRegistrator.unregister();
});
