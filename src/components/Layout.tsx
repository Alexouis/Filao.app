import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { LayoutProps } from '../config'

export const Layout: React.FC<LayoutProps> = ({
  children,
  currentTab,
  onTabChange,
  onLogout,
  userProfile,
  isCollapsed,
  setIsCollapsed
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-tr from-[#E0F7FA] via-[#E3F2FD] to-[#FFCCBC] flex">
      <Sidebar
        currentTab={currentTab}
        onTabChange={onTabChange}
        isOpen={sidebarOpen}
        toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        isCollapsed={isCollapsed}
        toggleCollapse={() => setIsCollapsed(!isCollapsed)}
        onLogout={onLogout}
        userProfile={userProfile}
      />

      <main className={`flex-1 h-full overflow-hidden transition-all duration-300 ease-in-out ${isCollapsed ? 'ml-0 md:ml-24' : 'ml-0 md:ml-72'}`}>
        <div className="w-full h-full">
          {children}
        </div>
      </main>
    </div>
  );
};