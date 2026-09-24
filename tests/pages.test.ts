/**
 * Tests de rendu des PAGES : chaque page est affichée avec un faux client
 * Supabase, puis on exerce ses gestes principaux. Un « error boundary » capte
 * tout plantage de rendu — ce que ni le typecheck ni les tests unitaires ne
 * voient (ex. : « Modifier l'entreprise » qui plantait l'application).
 */
import './setupDom.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { supabase } from '../src/lib/supabaseClient.ts';
import { installerFauxSupabase } from './fauxSupabase.ts';
import { ToastProvider } from '../src/components/ui/Toast.tsx';
import { CompanyTab } from '../src/components/settings/CompanyTab.tsx';
// TenderWizard n'est pas testé ici : il importe `file-saver`, bibliothèque UMD
// que Vite sait lire mais pas le chargeur ESM de Node. Ses sous-composants le
// sont dans composants.test.ts.
import Collaborators from '../src/components/Collaborators.tsx';
import { CalendarPage } from '../src/components/CalendarPage.tsx';
import { Dashboard } from '../src/components/Dashboard.tsx';
import { Tenders } from '../src/components/Tenders.tsx';
import { Notifications } from '../src/components/Notifications.tsx';
import { PricingPage } from '../src/components/PricingPage.tsx';
import { BillingTab } from '../src/components/settings/BillingTab.tsx';
import { SecurityTab } from '../src/components/settings/SecurityTab.tsx';
import { ProfileTab } from '../src/components/settings/ProfileTab.tsx';
import { CollaboratorSubmission } from '../src/components/CollaboratorSubmission.tsx';
import { OnboardingWizard } from '../src/components/OnboardingWizard.tsx';
import { Financial } from '../src/components/Financial.tsx';
import { AuthProvider } from '../src/context/AuthContext.tsx';

type ProprietesCapteur = { erreurs: Error[]; children: React.ReactNode };
class Capteur extends React.Component<ProprietesCapteur, { plante: boolean }> {
    declare props: Readonly<ProprietesCapteur>;
    state = { plante: false };
    static getDerivedStateFromError() { return { plante: true }; }
    componentDidCatch(e: Error) { this.props.erreurs.push(e); }
    render() { return this.state.plante ? React.createElement('div', null, 'PLANTAGE') : this.props.children; }
}

/** Affiche `element` dans le routeur, les toasts et le capteur d'erreurs. */
const afficher = async (element: React.ReactElement) => {
    const erreurs: Error[] = [];
    const vue = render(
        React.createElement(MemoryRouter, null,
            React.createElement(ToastProvider, null,
                React.createElement(Capteur, { erreurs, children: element }))));
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    return { vue, erreurs };
};

const attendre = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

const profil: any = {
    id: 'u1', email: 'moi@exemple.fr', prenom: 'Alex', nom: 'Louis',
    entreprise_id: 'e1', role_id: 'r-admin', notifications: [], notification_preferences: {},
};
const entreprise = {
    id: 'e1', nom: 'AXERO', siret: '12345678900017', siret_verified: true, adresse: '12 RUE DES LILAS',
    ville: 'DIGNE', code_postal: '04000', forme_juridique: '5710', code_naf: '62.01Z', visible_reseau: true,
    created_by: 'u1',
};

test('Mon entreprise : « Modifier » ouvre l’édition sans planter', async () => {
    cleanup();
    const restaurer = installerFauxSupabase({
        tables: {
            entreprises: [entreprise],
            utilisateurs: [{ ...profil }],
            roles: [{ id: 'r-admin', name: 'admin' }, { id: 'r-user', name: 'user' }],
        },
        rpc: { est_admin_entreprise: true, places_restantes_entreprise: 5 },
    });
    try {
        const { erreurs } = await afficher(React.createElement(CompanyTab, { userProfile: profil, onUpdate: () => {} }));
        assert.deepEqual(erreurs.map(e => e.message), [], 'affichage initial');
        fireEvent.click(await screen.findByText('Modifier'));
        await attendre();
        assert.deepEqual(erreurs.map(e => e.message), [], 'passage en édition');
        assert.equal(screen.queryByText('PLANTAGE'), null);
    } finally { restaurer(); }
});

test('Mon entreprise : changer d’onglet referme l’édition (plus de « Enregistrer » hors contexte)', async () => {
    cleanup();
    const restaurer = installerFauxSupabase({
        tables: { entreprises: [entreprise], utilisateurs: [{ ...profil }], roles: [{ id: 'r-admin', name: 'admin' }] },
        rpc: { est_admin_entreprise: true, places_restantes_entreprise: 5 },
    });
    try {
        const { erreurs } = await afficher(React.createElement(CompanyTab, { userProfile: profil, onUpdate: () => {} }));
        fireEvent.click(await screen.findByText('Modifier'));
        await attendre();
        assert.ok(screen.getByText('Enregistrer'), 'édition ouverte');
        fireEvent.click(screen.getByText(/Documents de candidature/));
        await attendre();
        // « Enregistrer » sauvegardait la FICHE depuis l'onglet Documents.
        assert.equal(screen.queryByText('Enregistrer'), null);
        assert.deepEqual(erreurs.map(e => e.message), []);
    } finally { restaurer(); }
});

test('Coffre-fort : un document ajouté se consulte, se télécharge et se renomme', async () => {
    cleanup();
    const restaurer = installerFauxSupabase({
        tables: {
            entreprises: [entreprise], utilisateurs: [{ ...profil }], roles: [{ id: 'r-admin', name: 'admin' }],
            documents_candidature: [{ id: 'd1', entreprise_id: 'e1', label: 'Scan 0923', url: 'documents/e1/1-scan.pdf',
                statut: 'valide', categorie: 'references', created_at: '2026-09-01T00:00:00Z' }],
        },
        rpc: { est_admin_entreprise: true, places_restantes_entreprise: 5 },
    });
    try {
        const { erreurs } = await afficher(React.createElement(CompanyTab, { userProfile: profil, onUpdate: () => {} }));
        fireEvent.click(await screen.findByText(/Documents de candidature/));
        await attendre();
        assert.ok(screen.getByLabelText('Voir « Scan 0923 »'));
        assert.ok(screen.getByLabelText('Télécharger « Scan 0923 »'));
        fireEvent.click(screen.getByLabelText('Renommer « Scan 0923 »'));
        const champ = screen.getByLabelText('Nouveau nom du document');
        fireEvent.change(champ, { target: { value: 'Référence chantier Digne' } });
        fireEvent.keyDown(champ, { key: 'Enter' });
        await attendre();
        assert.ok((await screen.findAllByText('Référence chantier Digne')).length > 0);
        // Suppression : une confirmation, plus d'effacement immédiat.
        fireEvent.click(screen.getByTitle('Supprimer'));
        await attendre();
        assert.ok(screen.getByText('Supprimer ce document ?'));
        assert.deepEqual(erreurs.map(e => e.message), []);
    } finally { restaurer(); }
});

test('Réseau : les invitations envoyées par e-mail sont suivies (relancer, annuler)', async () => {
    cleanup();
    const restaurer = installerFauxSupabase({
        tables: { entreprises: [entreprise], utilisateurs: [{ ...profil }] },
        rpc: { mes_invitations_reseau: [
            { id: 'i1', email: 'futur@partenaire.fr', created_at: '2026-09-20T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', consumed_at: null },
            { id: 'i2', email: 'inscrit@partenaire.fr', created_at: '2026-09-10T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', consumed_at: '2026-09-12T00:00:00Z' },
        ] },
    });
    try {
        const { erreurs } = await afficher(React.createElement(Collaborators, { onNavigate: () => {} }));
        assert.ok(await screen.findByText(/Invitations envoyées par e-mail \(2\)/));
        assert.ok(screen.getByText('Relancer'));
        assert.ok(screen.getByText('Inscrit'));
        fireEvent.click(screen.getByLabelText("Annuler l'invitation de futur@partenaire.fr"));
        await attendre();
        assert.ok(screen.getByText('Annuler cette invitation ?'));
        assert.deepEqual(erreurs.map(e => e.message), []);
    } finally { restaurer(); }
});

// ---------------------------------------------------------------------------
// Toutes les pages touchées pendant la revue : affichage et gestes principaux
// ---------------------------------------------------------------------------
const rien = () => {};
const dans = (j: number) => { const d = new Date(); d.setDate(d.getDate() + j); return d.toISOString(); };
const dossiers = [
    { id: 't1', titre: 'Transport scolaire', statut: 'En cours', createur_id: 'u1', entreprise_id: 'e1',
      date_limite: dans(3), created_at: dans(-20), montant_estime: 100000, groupements: [], invitations: [],
      jalons: [{ label: 'Visite de site', date: dans(1).slice(0, 10), statut: 'a_faire' }] },
    { id: 't2', titre: 'Maintenance informatique', statut: 'Gagné', createur_id: 'u1', entreprise_id: 'e1',
      date_limite: dans(-10), created_at: dans(-60), date_decision: dans(-5), montant_estime: 50000,
      groupements: [], invitations: [], jalons: [] },
];
const donneesCommunes = {
    tables: {
        entreprises: [entreprise],
        utilisateurs: [{ ...profil }],
        roles: [{ id: 'r-admin', name: 'admin' }, { id: 'r-user', name: 'user' }],
        reponses_ao: dossiers,
        ref_domains: [{ id: 'info', label: 'Informatique', natures: ['services'] }],
        ref_specialties: [{ id: 'dev', label: 'Développement', domain_id: 'info' }],
    },
    rpc: { est_admin_entreprise: true, places_restantes_entreprise: 5, dossiers_portes_entreprise: 1, stockage_consomme_entreprise: 0 },
};

const scenarios: Array<[string, () => React.ReactElement, (() => Promise<void>)?]> = [
    ['Mon entreprise : onglets Équipe et Documents', () => React.createElement(CompanyTab, { userProfile: profil, onUpdate: rien }), async () => {
        fireEvent.click(await screen.findByText(/Équipe/)); await attendre();
        // Administrateur : les boutons de gestion des rôles sont proposés.
        assert.ok(await screen.findByText(/Quitter le rôle|Nommer administrateur|Retirer l'administration/));
        fireEvent.click(await screen.findByText(/Documents/)); await attendre();
    }],

    ['Réseau : onglets et filtres', () => React.createElement(Collaborators, { onNavigate: rien }), async () => {
        fireEvent.click(await screen.findByText(/Réseau FILAO/));
        await attendre();
    }],
    ['Calendrier : vues Semaine, Trimestre, Aujourd’hui', () => React.createElement(CalendarPage, {
        onAddTender: rien, userProfile: profil, cachedTenders: dossiers as any,
    }), async () => {
        for (const vue of ['Semaine', 'Trimestre', 'Mois']) { fireEvent.click(await screen.findByText(vue)); await attendre(); }
        fireEvent.click(await screen.findByText("Aujourd'hui")); await attendre();
    }],
    ['Tableau de bord', () => React.createElement(Dashboard, { onNavigate: rien, userProfile: profil, cachedTenders: dossiers as any })],
    ['Mes appels d’offres', () => React.createElement(Tenders, { onAddTender: rien, userProfile: profil, cachedTenders: dossiers as any })],
    ['Notifications', () => React.createElement(Notifications, { onNavigate: rien })],
    ['Offres', () => React.createElement(PricingPage, { userProfile: profil })],
    ['Paramètres › Facturation', () => React.createElement(BillingTab, { userProfile: profil, onUpdate: rien })],
    ['Paramètres › Sécurité', () => React.createElement(SecurityTab, { userProfile: profil, onUpdate: rien })],
    ['Paramètres › Profil', () => React.createElement(AuthProvider, null, React.createElement(ProfileTab, { userProfile: profil, onUpdate: rien }))],
    ['Espace invité (formulaire d’accès)', () => React.createElement(CollaboratorSubmission)],
    ['Onboarding', () => React.createElement(OnboardingWizard, { userProfile: { ...profil, entreprise_id: null }, onComplete: rien })],
    ['Finances', () => React.createElement(Financial, { userProfile: profil, cachedTenders: dossiers as any } as any)],
];

for (const [nom, creer, gestes] of scenarios) {
    test(`Page ${nom} : s’affiche et répond sans planter`, async () => {
        cleanup();
        const restaurer = installerFauxSupabase(donneesCommunes);
        try {
            const { erreurs } = await afficher(creer());
            if (gestes) await gestes();
            assert.deepEqual(erreurs.map(e => e.message), []);
            assert.equal(screen.queryByText('PLANTAGE'), null);
        } finally { restaurer(); }
    });
}

after(async () => {
    cleanup();
    await supabase.auth.stopAutoRefresh();
    await supabase.removeAllChannels();
    (supabase.realtime as any)?.disconnect?.();
});
