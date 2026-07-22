import React, { useState, useRef, useEffect } from 'react';
import {
  Home,
  LayoutGrid,
  Calendar,
  Users,
  BarChart3,
  User,
  LogOut,
  Menu,
  X,
  Bell,
  Briefcase,
  FileText,
  PieChart,
  Building2,
  MessageSquare
} from 'lucide-react';
import { NavItem as NavItemType } from '../types';
import { NotificationModal } from './NotificationModal';
import { SidebarProps } from '../config';
import { supabase } from '../lib/supabaseClient';
import { Logo } from './ui/Logo';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

// Helper Component for Navigation Items
const NavItemBtn: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}> = ({
  icon,
  label,
  active,
  expanded,
  onClick
}) => (
    <button
      onClick={onClick}
      className={`
      w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 group relative
      ${active
          ? 'bg-gradient-to-r from-[#00A3E0]/20 to-[#00A3E0]/5 text-white shadow-inner border-l-2 border-[#00A3E0]'
          : 'text-gray-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'}
      ${!expanded ? 'justify-center' : ''}
    `}
      title={!expanded ? label : ''}
    >
      <div className={`transition-colors shrink-0 ${active ? 'text-[#00A3E0]' : 'group-hover:text-white'}`}>
        {icon}
      </div>
      {expanded && (
        <span className={`font-medium text-sm whitespace-nowrap overflow-hidden transition-all animate-fade-in ${active ? 'font-bold' : ''}`}>
          {label}
        </span>
      )}
    </button>
  );

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  isOpen,
  toggleSidebar,
  isCollapsed,
  toggleCollapse,
  onLogout,
  userProfile
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [avatarError, setAvatarError] = useState(false);
  const { user } = useAuth();
  const { totalUnreadCount } = useChat();

  // Best avatar: DB photo_url > Google OAuth avatar_url > Google picture
  const effectiveAvatar = userProfile?.photo_url
    || user?.user_metadata?.avatar_url
    || user?.user_metadata?.picture
    || null;

  // Fetch unread count logic
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('utilisateurs')
          .select('notifications')
          .eq('id', user.id)
          .single();

        if (error) {
          // PGRST116 = no rows found (e.g. account just deleted) — ignore silently
          if (error.code === 'PGRST116') return;
          throw error;
        }

        const notifications = data?.notifications || [];
        const unread = notifications.filter((n: any) => !n.read).length;
        setUnreadCount(unread);
      } catch (error) {
        console.error('Error fetching notification count:', error);
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close notifications on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Navigation Items Config — Métier (core)
  const mainNavItems = [
    { id: 'dashboard', label: 'Tableau de bord', icon: <Briefcase size={22} /> },
    { id: 'tenders', label: 'Mes appels d\'offres', icon: <FileText size={22} /> },
    { id: 'calendar', label: 'Mon calendrier', icon: <Calendar size={22} /> },
    { id: 'collaborators', label: 'Collaborateurs', icon: <Users size={22} /> },
  ];

  // Navigation Items Config — Configuration
  const configNavItems = [
    { id: 'company', label: 'Mon Entreprise', icon: <Building2 size={22} /> },
  ];

  const handleNavClick = (id: string) => {
    onTabChange(id as NavItemType);
    if (window.innerWidth < 768) toggleSidebar();
  };

  // Helper to get initials
  const getInitials = () => {
    if (!userProfile) return 'U';
    return (userProfile.prenom?.[0] || '') + (userProfile.nom?.[0] || '');
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity"
          onClick={toggleSidebar}
        />
      )}

      {/* SIDEBAR ASIDE */}
      <aside
        className={`
          fixed top-0 left-0 z-50 h-full md:h-[calc(100vh-2rem)] 
          bg-gradient-to-b from-[#081426]/95 to-[#1A3350]/90 backdrop-blur-xl 
          border-r md:border border-white/10 md:rounded-3xl 
          transition-all duration-300 ease-in-out flex flex-col text-white 
          ${isOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'} 
          ${!isCollapsed ? 'md:w-64 md:m-4' : 'md:w-20 md:my-4 md:ml-4'}
        `}
      >

        {/* HEADER: Logo & Toggle */}
        <div className={`h-20 flex items-center shrink-0 ${!isCollapsed ? 'px-6 justify-between' : 'justify-center'}`}>
          <div className={`pt-8 pb-6 flex items-center ${isCollapsed ? 'justify-center px-2' : 'justify-center'}`}>
            <Logo collapsed={isCollapsed} />
          </div>

          {/* Close Button (Mobile) */}
          <button onClick={toggleSidebar} className="md:hidden text-white/50 hover:text-white">
            <X size={24} />
          </button>

          {/* Collapse Button (Desktop) */}
          <button
            onClick={toggleCollapse}
            className={`hidden md:block text-white/30 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5 ${isCollapsed ? 'absolute -right-3 top-24 bg-[#1A3350] border border-white/20 shadow-md rounded-full' : ''}`}
          >
            {isCollapsed ? <Menu size={14} /> : <Menu size={20} />}
          </button>
        </div>

        {/* NAVIGATION LIST */}
        <nav className="flex-1 py-6 px-3 overflow-y-auto custom-scrollbar flex flex-col gap-1">

          {/* Groupe métier */}
          {mainNavItems.map((item) => (
            <NavItemBtn
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={currentTab === item.id || (item.id === 'tenders' && currentTab === 'wizard')}
              expanded={!isCollapsed}
              onClick={() => handleNavClick(item.id)}
            />
          ))}

          {/* Séparateur */}
          <div className="py-3 px-3">
            <div className="h-px bg-white/10" />
          </div>

          {/* Groupe configuration */}
          {configNavItems.map((item) => (
            <NavItemBtn
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={currentTab === item.id}
              expanded={!isCollapsed}
              onClick={() => handleNavClick(item.id)}
            />
          ))}
        </nav>


        {/* FOOTER: Notifications, Settings, Profile */}
        <div className="p-4 border-t border-white/5 shrink-0 flex flex-col gap-4" ref={notificationRef}>

          {/* Action Row: Notifications & Chat */}
          <div className={`flex gap-3 ${!isCollapsed ? 'justify-center px-2' : 'flex-col items-center'}`}>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`relative transition-colors group p-2.5 rounded-xl hover:bg-white/10 ${showNotifications ? 'text-white bg-white/10' : 'text-white/50 hover:text-white'}`}
                title="Notifications"
              >
                <Bell size={22} />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#FF8575] border-2 border-[#081426] rounded-full"></span>
                )}
              </button>

              {/* Modal Popover */}
              {showNotifications && (
                <div className={`absolute bottom-12 ${isCollapsed ? 'left-full ml-4' : 'left-0'} z-50`}>
                  <NotificationModal
                    onClose={() => setShowNotifications(false)}
                    onViewAll={() => {
                      setShowNotifications(false);
                      handleNavClick('notifications');
                    }}
                    unreadCount={unreadCount}
                  />
                </div>
              )}
            </div>

            <div className="relative">
                <button
                    onClick={() => handleNavClick('chat')}
                    className={`transition-colors group p-2.5 rounded-xl hover:bg-white/10 ${currentTab === 'chat' ? 'text-white bg-[#00A3E0]/20 border border-[#00A3E0]/30' : 'text-white/50 hover:text-white'}`}
                    title="Messagerie"
                >
                    <MessageSquare size={22} />
                </button>
                {totalUnreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-[#081426] rounded-full animate-pulse shadow-sm shadow-emerald-400/50"></span>
                )}
            </div>
          </div>

          {/* Profile Card — Clickable to Settings */}
          <button
            onClick={() => handleNavClick('profile')}
            className={`w-full flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/5 transition-all hover:bg-white/10 cursor-pointer group ${!isCollapsed ? '' : 'justify-center'}`}
            title="Mon compte"
          >
            {/* Avatar with gear overlay */}
            <div className="relative shrink-0">
              {effectiveAvatar && !avatarError ? (
                <img
                  src={effectiveAvatar}
                  alt="Profile"
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-white/10"
                  onError={() => setAvatarError(true)}
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#00A3E0] to-[#26367F] flex items-center justify-center text-white font-bold text-xs ring-2 ring-white/10">
                  {getInitials()}
                </div>
              )}
              {/* Small gear badge */}
              <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#1A3350] border border-white/20 rounded-full flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/80">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
              </div>
            </div>

            {/* User Info (Expanded only) */}
            {!isCollapsed && (
              <div className="flex-1 min-w-0 overflow-hidden text-left">
                <p className="text-sm font-bold text-white truncate">
                  {userProfile ? `${userProfile.prenom} ${userProfile.nom}` : 'Chargement...'}
                </p>
                <p className="text-[10px] text-white/50 truncate group-hover:text-[#00A3E0] transition-colors">
                  Mon compte →
                </p>
              </div>
            )}

            {/* Logout Button (Expanded only) */}
            {!isCollapsed && (
              <div
                onClick={(e) => { e.stopPropagation(); onLogout(); }}
                className="text-white/30 hover:text-[#FF8575] transition-colors rounded-lg p-1.5 hover:bg-white/5"
                title="Se déconnecter"
                role="button"
              >
                <LogOut size={16} />
              </div>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Menu Trigger (when closed) */}
      {!isOpen && (
        <button
          onClick={toggleSidebar}
          className="md:hidden fixed top-4 left-4 z-40 p-3 bg-[#081426] text-white rounded-xl shadow-lg border border-white/10"
        >
          <Menu size={24} />
        </button>
      )}
    </>
  );
};