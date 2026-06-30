'use client';

import { BarChart3, ChevronLeft, ChevronRight, Database, MessageSquare, Route, TrendingUp } from 'lucide-react';
import React from 'react';

import sp from '@/components/supportplane/sp.module.css';

import type { TabId } from './types';
import { TAB_LABELS } from './types';

const TAB_ICONS: Record<TabId, React.ReactNode> = {
  overview:        <BarChart3 size={16} strokeWidth={2} />,
  feedback:        <MessageSquare size={16} strokeWidth={2} />,
  revenue:         <TrendingUp size={16} strokeWidth={2} />,
  appprovisioning: <Database size={16} strokeWidth={2} />,
  journey:         <Route size={16} strokeWidth={2} />,
};

interface ScorecardSidebarProps {
  active: TabId;
  collapsed: boolean;
  onSelect: (tab: TabId) => void;
  onToggle: () => void;
}

export default function ScorecardSidebar({ active, collapsed, onSelect, onToggle }: ScorecardSidebarProps) {
  return (
    <aside className={`${sp.sidebar} ${collapsed ? sp.sidebarCollapsed : sp.sidebarExpanded}`}>
      {/* Brand row */}
      <div className={collapsed ? sp.brandCollapsed : sp.brand}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: 'var(--sp-accent)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="2" width="20" height="22" rx="3" stroke="#fff" strokeWidth="2"/>
            <line x1="7" y1="8"  x2="19" y2="8"  stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="7" y1="12" x2="19" y2="12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="7" y1="16" x2="14" y2="16" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
            <polyline points="15,18.5 17,21 21,17" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {!collapsed && (
          <div className={sp.brandMeta}>
            <div className={sp.brandName}>
              <span className={sp.brandAccent}>Scorecard</span>
            </div>
            <div className={sp.brandSub}>AAB · Analytics</div>
          </div>
        )}
        <button type="button" className={sp.collapseBtn} onClick={onToggle} aria-label="Toggle sidebar">
          {collapsed ? <ChevronRight size={14} strokeWidth={2.5} /> : <ChevronLeft size={14} strokeWidth={2.5} />}
        </button>
      </div>

      {/* Nav */}
      <nav className={sp.nav}>
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>Analytics</div>}
          {(['overview', 'feedback', 'revenue', 'appprovisioning'] as const).map((tab: TabId) => {
            const isActive: boolean = active === tab;
            return collapsed ? (
              <button
                key={tab}
                type="button"
                data-tooltip={TAB_LABELS[tab]}
                onClick={() => onSelect(tab)}
                className={`${sp.navItemCollapsed}${isActive ? ` ${sp.navItemActive}` : ''}`}
                aria-label={TAB_LABELS[tab]}
              >
                {TAB_ICONS[tab]}
              </button>
            ) : (
              <button
                key={tab}
                type="button"
                onClick={() => onSelect(tab)}
                className={`${sp.navItem}${isActive ? ` ${sp.navItemActive}` : ''}`}
              >
                {TAB_ICONS[tab]}
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>Journey</div>}
          {(['journey'] as const).map((tab: TabId) => {
            const isActive: boolean = active === tab;
            return collapsed ? (
              <button
                key={tab}
                type="button"
                data-tooltip={TAB_LABELS[tab]}
                onClick={() => onSelect(tab)}
                className={`${sp.navItemCollapsed}${isActive ? ` ${sp.navItemActive}` : ''}`}
                aria-label={TAB_LABELS[tab]}
              >
                {TAB_ICONS[tab]}
              </button>
            ) : (
              <button
                key={tab}
                type="button"
                onClick={() => onSelect(tab)}
                className={`${sp.navItem}${isActive ? ` ${sp.navItemActive}` : ''}`}
              >
                {TAB_ICONS[tab]}
                {TAB_LABELS[tab]}
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
