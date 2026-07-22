import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useSearchParams } from 'react-router-dom';
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

  // Public invitation landing page (no auth required)
  if (location.pathname.startsWith('/invitation/')) {
    return <InvitationLanding />;
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