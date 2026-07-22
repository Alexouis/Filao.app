import React, { useState, useEffect } from 'react';
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
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <SettingsLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'profile' && <ProfileTab userProfile={userProfile} onUpdate={onProfileUpdate} />}

      {activeTab === 'billing' && <BillingTab userProfile={userProfile} onUpdate={onProfileUpdate} onNavigate={onNavigate} />}
      {activeTab === 'security' && <SecurityTab userProfile={userProfile} onUpdate={onProfileUpdate} />}
    </SettingsLayout>
  );
};