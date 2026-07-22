import React from 'react';
import { APP_CONFIG } from '../../config';

interface LogoProps {
  className?: string;
  collapsed?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = '', collapsed = false }) => {
  return (
    <div className={`flex items-center gap-2 ${className} transition-all duration-300`}>
        <img 
            src={collapsed ? APP_CONFIG.logoCollapsedUrl : APP_CONFIG.logoExpandedUrl} 
            alt={APP_CONFIG.appName}
            style={{ 
                height: APP_CONFIG.logoHeight,
                width: collapsed ? 'auto' : APP_CONFIG.logoWidth,
                maxWidth: '100%'
            }}
            className="object-contain transition-all duration-300"
        />
    </div>
  );
};