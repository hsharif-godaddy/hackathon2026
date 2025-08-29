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
    header = {},
    footer = {},
    layout = {
      maxWidth: 'full',
      padding: 'md',
      background: 'default',
      minHeight: true
    }
  } = config;

  const getMaxWidthClass = () => {
    switch (layout.maxWidth) {
      case 'sm': return 'max-w-screen-sm';
      case 'md': return 'max-w-screen-md';
      case 'lg': return 'max-w-screen-lg';
      case 'xl': return 'max-w-screen-xl';
      case '2xl': return 'max-w-screen-2xl';
      default: return '';
    }
  };

  const getPaddingClass = () => {
    switch (layout.padding) {
      case 'none': return '';
      case 'sm': return 'px-2 sm:px-4';
      case 'lg': return 'px-6 sm:px-8 lg:px-12';
      default: return 'px-4 sm:px-6 lg:px-8';
    }
  };

  const getBackgroundClass = () => {
    switch (layout.background) {
      case 'muted': return 'bg-muted';
      case 'gradient': return 'bg-gradient-to-b from-background to-muted/20';
      default: return 'bg-background';
    }
  };

  const mainPaddingTop = header.sticky !== false ? 'pt-16' : '';

  return (
    <div className={cn(
      layout.minHeight !== false && "min-h-screen",
      getBackgroundClass(),
      "flex flex-col",
      className
    )}>
      <Header config={header} />

      <main className={cn(
        "flex-1",
        mainPaddingTop,
        getPaddingClass(),
        getMaxWidthClass(),
        layout.maxWidth !== 'full' && "mx-auto w-full"
      )}>
        {children}
      </main>

      <Footer config={footer} />
    </div>
  );
}
