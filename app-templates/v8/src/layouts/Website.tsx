import React from 'react';
import { cn } from '@/lib/utils';
import Header, { HeaderConfig } from '@/layouts/parts/Header';
import Footer, { FooterConfig } from '@/layouts/parts/Footer';

export interface WebsiteConfig {
  header?: HeaderConfig;
  footer?: FooterConfig;
  layout?: {
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
    padding?: 'none' | 'sm' | 'md' | 'lg';
    background?: 'default' | 'muted' | 'gradient';
    minHeight?: boolean;
  };
}

interface WebsiteProps {
  children: React.ReactNode;
  config?: WebsiteConfig;
  className?: string;
}

export default function Website({ 
  children, 
  config = {}, 
  className 
}: WebsiteProps) {
  const {
    header,
    footer,
    layout = {
      maxWidth: 'full',
      padding: 'md',
      background: 'default',
      minHeight: true
    }
  } = config;

  const getBackgroundClass = () => {
    switch (layout.background) {
      case 'muted': return 'bg-muted';
      case 'gradient': return 'bg-gradient-to-b from-background to-muted/20';
      default: return 'bg-background';
    }
  };

  return (
    <div className={cn(
      layout.minHeight !== false && "min-h-screen",
      getBackgroundClass(),
      "flex flex-col",
      className
    )}>
      {header && <Header config={header} />}

      <main className="flex-1">
        {children}
      </main>

      {footer && <Footer config={footer} />}
    </div>
  );
}
