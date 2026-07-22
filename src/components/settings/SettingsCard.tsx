import React from 'react';

interface SettingsCardProps {
    title: string;
    icon: any;
    children: React.ReactNode;
    className?: string;
    description?: string;
    variant?: 'default' | 'danger';
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
    title,
    icon: Icon,
    children,
    className = '',
    description,
    variant = 'default',
}) => {
    const isDanger = variant === 'danger';

    return (
        <div className={`bg-white rounded-xl p-3 shadow-sm border ${isDanger ? 'border-red-200/60' : 'border-gray-100'} ${className}`}>
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${isDanger ? 'bg-red-50 text-red-500' : 'bg-filao-primary/10 text-filao-primary'}`}>
                        <Icon size={18} />
                    </div>
                    <div>
                        <h3 className={`text-sm font-semibold ${isDanger ? 'text-red-700' : 'text-gray-900'}`}>{title}</h3>
                        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
                    </div>
                </div>
            </div>
            {children}
        </div>
    );
};
