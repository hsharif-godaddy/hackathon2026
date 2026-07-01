'use client';

import { BarChart3, ChevronLeft, ChevronRight, CreditCard, Database, ExternalLink, Filter, Gauge, MessageSquare, Route, Search, TrendingUp } from 'lucide-react';
import React from 'react';

import sp from '@/components/supportplane/sp.module.css';

import type { FeedbackSubTab, TabId } from './types';
import { FEEDBACK_SUB_LABELS, TAB_LABELS } from './types';

// ── Icon maps ─────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<TabId, React.ReactNode> = {
  overview:        <BarChart3 size={16} strokeWidth={2} />,
  appprovisioning: <Database size={16} strokeWidth={2} />,
  revenue:         <TrendingUp size={16} strokeWidth={2} />,
  revenuefunnel:   <Filter size={16} strokeWidth={2} />,
  subscriptions:   <CreditCard size={16} strokeWidth={2} />,
  feedback:        <MessageSquare size={16} strokeWidth={2} />,
  journey:         <Route size={16} strokeWidth={2} />,
};

const FEEDBACK_SUB_ICONS: Record<FeedbackSubTab, React.ReactNode> = {
  'overview':   <Gauge size={15} strokeWidth={2} />,
  'deep-dive':  <Search size={15} strokeWidth={2} />,
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface ScorecardSidebarProps {
  active:                 TabId;
  collapsed:              boolean;
  feedbackSubTab:         FeedbackSubTab;
  onSelect:               (tab: TabId) => void;
  onSelectFeedbackSubTab: (sub: FeedbackSubTab) => void;
  onToggle:               () => void;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function ScorecardSidebar({
  active, collapsed, feedbackSubTab,
  onSelect, onSelectFeedbackSubTab, onToggle,
}: ScorecardSidebarProps) {

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    isActive: boolean,
    onClick: () => void,
  ): React.ReactNode => collapsed ? (
    <button
      key={id}
      type="button"
      data-tooltip={label}
      onClick={onClick}
      className={`${sp.navItemCollapsed}${isActive ? ` ${sp.navItemActive}` : ''}`}
      aria-label={label}
    >
      {icon}
    </button>
  ) : (
    <button
      key={id}
      type="button"
      onClick={onClick}
      className={`${sp.navItem}${isActive ? ` ${sp.navItemActive}` : ''}`}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );

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

        {/* Analytics group */}
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>📊 Analytics</div>}
          {(['overview', 'appprovisioning'] as const).map((tab: TabId) =>
            navItem(tab, TAB_LABELS[tab], TAB_ICONS[tab], active === tab, () => onSelect(tab))
          )}
          <div className={sp.navDivider} />
        </div>

        {/* Revenue group */}
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>💰 Revenue</div>}
          {(['revenue', 'revenuefunnel', 'subscriptions'] as const).map((tab: TabId) =>
            navItem(tab, TAB_LABELS[tab], TAB_ICONS[tab], active === tab, () => onSelect(tab))
          )}
          <div className={sp.navDivider} />
        </div>

        {/* Feedback group */}
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>⭐ Feedback</div>}
          {(['overview', 'deep-dive'] as const).map((sub: FeedbackSubTab) =>
            navItem(
              `feedback-${sub}`,
              FEEDBACK_SUB_LABELS[sub],
              FEEDBACK_SUB_ICONS[sub],
              active === 'feedback' && feedbackSubTab === sub,
              () => onSelectFeedbackSubTab(sub),
            )
          )}
          <div className={sp.navDivider} />
        </div>

        {/* Journey group */}
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>🔍 Journey</div>}
          {navItem('journey', TAB_LABELS['journey'], TAB_ICONS['journey'], active === 'journey', () => onSelect('journey'))}
          <div className={sp.navDivider} />
        </div>

        {/* Quick Links group */}
        <div className={sp.navGroup}>
          {!collapsed && <div className={sp.navGroupLabel}>🔗 Quick Links</div>}
          {collapsed ? (
            <a
              href="https://goarena.int.gdcorp.tools/ui/report/batch-eval"
              target="_blank"
              rel="noopener noreferrer"
              data-tooltip="Intent Resolution Dashboard"
              className={sp.navItemCollapsed}
              aria-label="Intent Resolution Dashboard"
            >
              <ExternalLink size={16} strokeWidth={2} />
            </a>
          ) : (
            <a
              href="https://goarena.int.gdcorp.tools/ui/report/batch-eval"
              target="_blank"
              rel="noopener noreferrer"
              className={sp.navItem}
            >
              <span style={{ flexShrink: 0 }}><ExternalLink size={16} strokeWidth={2} /></span>
              <span>Intent resolution dashboard</span>
            </a>
          )}
        </div>

      </nav>
    </aside>
  );
}
