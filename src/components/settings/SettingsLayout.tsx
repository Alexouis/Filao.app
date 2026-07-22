import React from 'react';
import { User, CreditCard, Shield } from 'lucide-react';

interface SettingsLayoutProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    children: React.ReactNode;
}

export const SettingsLayout: React.FC<SettingsLayoutProps> = ({
    activeTab,
    onTabChange,
    children,
}) => {
    const tabs = [
        { id: 'profile', label: 'Mon Profil', icon: User },

        { id: 'billing', label: 'Abonnement', icon: CreditCard },
        { id: 'security', label: 'Sécurité', icon: Shield },
    ];

    return (
        <div className="h-full flex overflow-hidden animate-fade-in p-4">
            {/* Sidebar */}
            <div className="w-56 flex-shrink-0 bg-white/60 backdrop-blur-xl border-r border-gray-200/60 flex flex-col rounded-l-2xl">
                <div className="p-5 pb-3">
                    <h2 className="text-lg font-bold text-gray-900">Paramètres</h2>
                    <p className="text-gray-500 text-xs mt-0.5">Compte & préférences</p>
                </div>

                <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;

                        return (
                            <button
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all duration-200 text-sm ${isActive
                                    ? 'bg-filao-primary text-white shadow-md shadow-filao-primary/20 font-semibold'
                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium'
                                    }`}
                            >
                                <Icon size={18} />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden relative">
                <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-4 md:p-5">
                    {children}
                </div>
            </div>
        </div>
    );
};
