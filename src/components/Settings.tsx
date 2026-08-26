import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { UserProfile } from '../config';
import { SettingsLayout } from './settings/SettingsLayout';
import { ProfileTab } from './settings/ProfileTab';

import { BillingTab } from './settings/BillingTab';
import { SecurityTab } from './settings/SecurityTab';

interface SettingsProps {
  userProfile: UserProfile | null;
  onProfileUpdate: () => void;
  initialTab?: string;
  onNavigate?: (tab: string) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  userProfile,
  onProfileUpdate,
  initialTab = 'profile',
  onNavigate
}) => {
  /**
   * Sous-onglet piloté par l'URL (`?section=profile|billing|security`).
   *
   * Il vivait dans un `useState` local : la section n'était donc ni partageable
   * par lien, ni conservée au rechargement, et le bouton Précédent quittait les
   * paramètres au lieu de revenir à la section précédente. Même mécanique que
   * le reste de la navigation — `setSearchParams` empile une entrée
   * d'historique.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const SECTIONS = ['profile', 'billing', 'security'] as const;
  const depuisUrl = searchParams.get('section');
  // Une valeur inconnue dans l'URL ne doit pas produire une page vide.
  const activeTab = (depuisUrl && (SECTIONS as readonly string[]).includes(depuisUrl))
    ? depuisUrl
    : initialTab;

  const changerSection = (section: string) => {
    const p = new URLSearchParams(searchParams);
    p.set('section', section);
    setSearchParams(p);
  };

  // Ancrage : sans paramètre dans l'URL, on inscrit la section courante sans
  // empiler d'entrée, pour que « Précédent » puisse y revenir.
  useEffect(() => {
    if (!searchParams.get('section')) {
      const p = new URLSearchParams(searchParams);
      p.set('section', initialTab);
      setSearchParams(p, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  return (
    <SettingsLayout
      activeTab={activeTab}
      onTabChange={changerSection}
    >
      {activeTab === 'profile' && <ProfileTab userProfile={userProfile} onUpdate={onProfileUpdate} />}

      {activeTab === 'billing' && <BillingTab userProfile={userProfile} onUpdate={onProfileUpdate} onNavigate={onNavigate} />}
      {activeTab === 'security' && <SecurityTab userProfile={userProfile} onUpdate={onProfileUpdate} />}
    </SettingsLayout>
  );
};