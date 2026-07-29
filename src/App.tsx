import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { OnboardingWizard } from './components/OnboardingWizard';

import { TenderWizard } from './components/TenderWizard';
import { Financial } from './components/Financial';
import Collaborators from './components/Collaborators';
import { Settings } from './components/Settings';
import { CompanyTab } from './components/settings/CompanyTab';
import { Notifications } from './components/Notifications';
import { Tenders } from './components/Tenders';
import { CalendarPage } from './components/CalendarPage';
import { Auth } from './components/Auth';
import { CollaboratorSubmission } from './components/CollaboratorSubmission';
import { ToastProvider } from './components/ui/Toast';
import { InvitationLanding } from './components/InvitationLanding';
import { ResetPassword } from './components/ResetPassword';
import { supabase } from './lib/supabaseClient';
import { NotFound } from './components/NotFound';
import { NavItem } from './types';
import { UserProfile, Tender, CollaboratorData, STATUSES } from './config';
import { useNotificationListener } from './hooks/useNotificationListener';
import { Dashboard } from './components/Dashboard';
import { PricingPage } from './components/PricingPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ChatProvider } from './context/ChatContext';
import { ChatCenter } from './components/chat/ChatCenter';
// Success Modal Component
const SuccessModal = ({ onClose }: { onClose: () => void }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
    <div className="relative bg-filao-success rounded-filao-card p-filao-card md:p-filao-card-lg max-w-lg w-full text-center shadow-filao-modal animate-fade-in-up">
      <button onClick={onClose} className="absolute top-8 right-8 text-white hover:opacity-80 transition-opacity">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
      <div className="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-lg">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-filao-success" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <h2 className="text-4xl font-bold text-white mb-4">Succès</h2>
      <p className="text-white text-lg mb-8 font-medium">Votre appel d'offres a été créé avec succès.</p>
      <button
        onClick={onClose}
        className="w-full bg-filao-primary hover:opacity-90 text-white font-bold py-4 px-6 rounded-filao-btn transition-all shadow-lg"
      >
        Voir mes appels d'offres
      </button>
    </div>
  </div>
);

const AppContent = () => {
  // Auth state — single source of truth via AuthContext (no duplicate fetching)
  const { session, userProfile, loading, signOut: authSignOut, refreshProfile } = useAuth();

  // Router specific URL state (from sandbox_alex)
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabRaw = searchParams.get('tab') as NavItem | 'wizard' | null;
  const currentTab = currentTabRaw || 'dashboard';
  const editingTenderId = searchParams.get('id');

  const navigateTo = (tab: NavItem | 'wizard', id: string | null = null) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('tab', tab);
      if (id) {
        p.set('id', id);
      } else {
        p.delete('id');
      }
      return p;
    });
  };

  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Tender caching state
  const [cachedTenders, setCachedTenders] = useState<Tender[]>([]);
  const [cacheTimestamp, setCacheTimestamp] = useState<number>(0);
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

  // Collaborators caching state
  const [cachedCollaborators, setCachedCollaborators] = useState<CollaboratorData[]>([]);
  const [collabCacheTimestamp, setCollabCacheTimestamp] = useState<number>(0);

  const [tendersResetKey, setTendersResetKey] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Clear tender/collaborator cache on logout
  useEffect(() => {
    if (!session) {
      setCachedTenders([]);
      setCacheTimestamp(0);
      setCachedCollaborators([]);
      setCollabCacheTimestamp(0);
    }
  }, [session]);

  // --- ACTIVATE LISTENER ---
  useNotificationListener(userProfile);

  /**
   * Rattachement au dossier après création de compte ou connexion.
   *
   * `InvitationLanding` dépose le jeton et l'identifiant du dossier en
   * `sessionStorage` avant d'envoyer l'invité vers `/register` ou `/login` —
   * mais rien ne les relisait. L'utilisateur arrivait donc sur un tableau de
   * bord vide et devait retrouver l'appel d'offres par lui-même, ce que le
   * critère de recette interdit explicitement.
   *
   * L'acceptation est enregistrée au passage : un invité qui va jusqu'à créer
   * un compte a manifestement accepté de participer, lui redemander serait une
   * étape de trop.
   */
  useEffect(() => {
    if (!session || !userProfile) return;

    const jeton = sessionStorage.getItem('invitationToken');
    const dossier = sessionStorage.getItem('invitationTenderId');
    if (!dossier) return;

    // Retirés avant tout traitement : en cas d'échec, mieux vaut ne pas
    // rejouer la redirection à chaque rendu.
    sessionStorage.removeItem('invitationToken');
    sessionStorage.removeItem('invitationTenderId');

    const rattacher = async () => {
      if (jeton) {
        const { error } = await supabase.rpc('respond_to_invitation', {
          p_token: jeton,
          p_status: 'accepted',
        });
        // Une invitation déjà traitée ou expirée n'empêche pas d'ouvrir le
        // dossier : l'utilisateur y a peut-être accès par son entreprise.
        if (error) console.warn('Rattachement à l\'invitation :', error);
      }
      navigateTo('wizard', dossier);
    };

    rattacher();
  }, [session, userProfile]);

  const handleOnboardingComplete = (goToWizard?: boolean) => {
    refreshProfile();
    if (goToWizard) {
      navigateTo('wizard', null);
    }
  };

  const handleProfileUpdate = () => {
    refreshProfile();
  };

  const handleLogout = async () => {
    await authSignOut();
    navigateTo('dashboard', null);
    // Cache is cleared by the session-watching useEffect above
  };

  const handleTendersLoad = (tenders: Tender[]) => {
    setCachedTenders(tenders);
    setCacheTimestamp(Date.now());
  };

  const handleCollaboratorsLoad = (collaborators: CollaboratorData[]) => {
    setCachedCollaborators(collaborators);
    setCollabCacheTimestamp(Date.now());
  };

  const handleEditDraft = (id: string) => {
    navigateTo('wizard', id);
  };

  const handleStartNewTender = () => {
    navigateTo('wizard', null);
  };

  const handleTabChange = (tab: NavItem) => {
    // If user clicks 'tenders' and is ALREADY on 'tenders'
    if (tab === 'tenders' && currentTab === 'tenders') {
      // Increment key to force React to destroy and recreate the Tenders component
      // This resets viewMode to 'list', clears selectedTenderId, etc.
      setTendersResetKey(prev => prev + 1);
    }

    // Standard navigation logic
    navigateTo(tab, null);
  };

  const invalidateCache = () => {
    setCachedTenders([]);
    setCacheTimestamp(0);
    setCachedCollaborators([]);
    setCollabCacheTimestamp(0);
  };

  const isCacheValid = () => {
    if (cachedTenders.length === 0) return false;
    const now = Date.now();
    return (now - cacheTimestamp) < CACHE_DURATION;
  };

  const isCollabCacheValid = () => {
    if (cachedCollaborators?.length === 0) return false;
    const now = Date.now();
    return (now - collabCacheTimestamp) < CACHE_DURATION;
  };

  const getCachedTenders = () => {
    return isCacheValid() ? cachedTenders : undefined;
  };

  const getCachedCollaborators = () => {
    return isCollabCacheValid() ? cachedCollaborators : undefined;
  };

  const handleFinishWizard = () => {
    // If we were editing/finalizing an existing tender, just go back to the list
    if (editingTenderId) {
      navigateTo('tenders', null);
    } else {
      setShowSuccessModal(true);
    }
    // Invalidate cache to show the new status
    invalidateCache();
  };

  const closeSuccessModal = () => {
    setShowSuccessModal(false);
    navigateTo('tenders', null);
  };

  const renderContent = () => {
    switch (currentTab) {
      case 'dashboard':
        return (
          <Dashboard
            onNavigate={(tab) => navigateTo(tab as NavItem | 'wizard', null)}
            cachedTenders={getCachedTenders()}
            onTendersLoad={handleTendersLoad}
            cachedCollaborators={getCachedCollaborators()}
            onCollaboratorsLoad={handleCollaboratorsLoad}
            userProfile={userProfile}
            onEditDraft={handleEditDraft}
          />
        );
      case 'wizard':
        return (
          <TenderWizard
            // This forces React to destroy and recreate the component when ID changes, 
            // ensuring props are fresh and no stale state exists.
            key={editingTenderId || 'new-wizard'}
            onCancel={() => navigateTo('tenders', null)}
            onFinish={handleFinishWizard}
            initialTenderId={editingTenderId}
            onTenderUpdate={invalidateCache}
            onNavigate={(tab) => navigateTo(tab as NavItem, null)}
            isSidebarCollapsed={isSidebarCollapsed}
            setIsSidebarCollapsed={setIsSidebarCollapsed}
          />
        );
      case 'finance':
        return (
          <Financial
            onNavigate={(tab) => navigateTo(tab as NavItem | 'wizard', null)}
            cachedTenders={getCachedTenders()}
            onTendersLoad={handleTendersLoad}
            userProfile={userProfile}
          />
        );
      case 'tenders':
        return (
          <Tenders
            key={`tenders-view-${tendersResetKey}`}

            onAddTender={handleStartNewTender}
            cachedTenders={getCachedTenders()}
            onTendersLoad={handleTendersLoad}
            onTenderUpdate={invalidateCache}
            cachedCollaborators={getCachedCollaborators()}
            onCollaboratorsLoad={handleCollaboratorsLoad}
            onEditDraft={handleEditDraft}
            userProfile={userProfile}
            onNavigate={(tab) => navigateTo(tab as NavItem, null)}
          />
        );
      case 'calendar':
        return (
          <CalendarPage
            onAddTender={() => navigateTo('wizard', null)}
            cachedTenders={getCachedTenders()}
            onTendersLoad={handleTendersLoad}
            onNavigateToTender={(tenderId, status) => {
              // Always open in Wizard (Tender Card)
              navigateTo('wizard', tenderId);
            }}
            onNavigate={(tab) => navigateTo(tab as NavItem, null)}
            userProfile={userProfile}
          />
        );
      case 'collaborators':
        return (
          <Collaborators
            cachedCollaborators={getCachedCollaborators()}
            onCollaboratorsLoad={handleCollaboratorsLoad}
            onNavigate={(tenderId) => {
              // Always open in Wizard (Tender Card)
              navigateTo('wizard', tenderId);
            }}
          />
        );
      case 'company':
        return (
          <div className="h-full overflow-y-auto custom-scrollbar p-4 md:p-6">
            <CompanyTab userProfile={userProfile} onUpdate={handleProfileUpdate} />
          </div>
        );
      case 'profile':
        return <Settings initialTab="profile" onProfileUpdate={handleProfileUpdate} userProfile={userProfile} onNavigate={(tab) => navigateTo(tab as NavItem | 'wizard', null)} />;
      case 'settings':
        return <Settings
          initialTab="profile"
          onProfileUpdate={handleProfileUpdate}
          userProfile={userProfile}
          onNavigate={(tab) => navigateTo(tab as NavItem | 'wizard', null)}
        />;
      case 'pricing':
        return (
          <PricingPage
            userProfile={userProfile}
            onNavigate={(tab) => navigateTo(tab as NavItem | 'wizard', null)}
          />
        );
      case 'notifications':
        return (
          <Notifications
            onNavigate={(tab, tenderId) => {
              if (tab === 'tenders' && tenderId) {
                // Determine if we should open the wizard (Tender Card)
                // If it's a tender navigation, we hijack it to the wizard
                navigateTo('wizard', tenderId);
              } else {
                navigateTo(tab as NavItem, null);
              }
            }}
          />
        );
      case 'chat':
        return (
          <ChatCenter 
             onNavigate={(tab, tenderId) => navigateTo(tab as NavItem, tenderId || null)}
          />
        );
      default:
        return (
          <Dashboard
            onNavigate={(tab) => navigateTo(tab as NavItem | 'wizard', null)}
            cachedTenders={getCachedTenders()}
            onTendersLoad={handleTendersLoad}
            cachedCollaborators={getCachedCollaborators()}
            onCollaboratorsLoad={handleCollaboratorsLoad}
            userProfile={userProfile}
            onEditDraft={handleEditDraft}
          />
        );
    }
  };

  const location = useLocation();

  // INTERCEPT: If accessing the external portal, show that component only
  if (location.pathname === '/collaborator-access') {
    return <CollaboratorSubmission />;
  }

  if (location.pathname === '/register') {
    return <Auth viewMode={"register"} />;
  }

  // Définition d'un nouveau mot de passe. Route publique : l'utilisateur arrive
  // ici depuis le lien reçu par e-mail, avec une session de récupération que
  // Supabase établit à partir du fragment d'URL.
  if (location.pathname === '/reset-password') {
    return <ResetPassword />;
  }

  // Public invitation landing page (no auth required).
  // `/invitation` sans jeton est une route valide : la page l'efface de l'URL
  // après lecture pour qu'il ne reste ni dans l'historique ni dans les outils de
  // mesure. Un rechargement arrive donc ici sans jeton, et l'écran invite alors
  // à rouvrir le lien reçu — plutôt qu'une page 404 incompréhensible.
  if (location.pathname === '/invitation' || location.pathname.startsWith('/invitation/')) {
    return <InvitationLanding />;
  }

  // `/login` n'était pas déclaré : il affichait l'écran de connexion par effet
  // de bord, en retombant sur le flux normal faute de session. Explicite ici,
  // il fonctionne aussi pour un utilisateur déjà connecté.
  if (location.pathname === '/login') {
    return session ? <Navigate to="/" replace /> : <Auth />;
  }

  /**
   * Tri des chemins inconnus.
   *
   * La réécriture SPA renvoie `index.html` pour tout chemin, y compris une
   * faute de frappe : le serveur ne sait pas distinguer une route applicative
   * d'une adresse erronée. Sans ce contrôle, `/nimportequoi` affichait
   * l'application comme si l'URL était valide.
   *
   * La navigation interne passe par des paramètres de requête (`/?tab=…`), donc
   * la racine est le seul chemin de l'application authentifiée.
   */
  const CHEMINS_CONNUS = ['/', '/login', '/register', '/reset-password', '/collaborator-access'];
  if (!CHEMINS_CONNUS.includes(location.pathname)) {
    return <NotFound />;
  }

  // Normal App Flow (Auth check, Layout, etc.)
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-filao-surface">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-filao-primary"></div>
    </div>;
  }

  if (!session) {
    return <Auth />;
  }

  // Onboarding wizard for first-time users
  if (userProfile && !userProfile.onboarding_completed) {
    return (
      <OnboardingWizard
        userProfile={userProfile}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  return (
    <Layout
      currentTab={currentTab === 'wizard' ? 'tenders' : currentTab}
      onTabChange={handleTabChange}
      onLogout={handleLogout}
      userProfile={userProfile}
      isCollapsed={isSidebarCollapsed}
      setIsCollapsed={setIsSidebarCollapsed}
    >
      {renderContent()}
      {showSuccessModal && <SuccessModal onClose={closeSuccessModal} />}
    </Layout>
  );
}

const App: React.FC = () => {
  return (
    <ToastProvider>
      <Router>
        <AuthProvider>
          <ChatProvider>
            <AppContent />
          </ChatProvider>
        </AuthProvider>
      </Router>
    </ToastProvider>
  );
};

export default App;