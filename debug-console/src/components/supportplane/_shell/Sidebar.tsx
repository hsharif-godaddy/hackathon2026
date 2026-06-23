'use client';

import {
    BarChart2, BarChart3, Calendar, ChevronLeft, ChevronRight, CreditCard,
    ExternalLink, FileText, Filter, Gauge, HeartHandshake, LayoutDashboard,
    Layers, MessageSquare, Star, Sun, Tag, ThumbsUp, Ticket, TrendingUp, Upload,
} from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';
import SPIcon from './SPIcon';
import type { NavGroup, NavItem, PanelId } from '@/components/supportplane/types';

const NAV_GROUPS: NavGroup[] = [
    { label: '🌅 Executive', items: [
        { id: 'today', label: 'TODAY', icon: <Sun size={16} /> },
    ]},
    { label: '📊 Dashboards', items: [
        { id: 'dash-transcripts', label: 'L1 Transcripts',       icon: <Gauge size={16} /> },
        { id: 'dash-feedback',    label: 'Feedback Intelligence', icon: <ThumbsUp size={16} /> },
        { id: 'dash-tickets',     label: 'Support Tickets',       icon: <LayoutDashboard size={16} /> },
    ]},
    { label: '🎙 L1 Transcripts', items: [
        { id: 'transcripts',      label: 'Browse',        icon: <FileText size={16} /> },
        { id: 'upload',           label: 'Upload / Sync', icon: <Upload size={16} /> },
        { id: 'analysis',         label: 'Deep Dive',     icon: <BarChart2 size={16} /> },
        { id: 'transcript-chat',  label: 'AI Chat',       icon: <MessageSquare size={16} /> },
    ]},
    { label: '⭐ Feedback', items: [
        { id: 'feedback-overview', label: 'Overview',          icon: <Gauge size={16} /> },
        { id: 'feedback-trends',   label: 'Trends (WoW/MoM)', icon: <TrendingUp size={16} /> },
        { id: 'feedback-ratings',  label: 'Rating Analysis',   icon: <Star size={16} /> },
        { id: 'feedback-topics',   label: 'Topic Analysis',    icon: <Tag size={16} /> },
        { id: 'feedback-browse',   label: 'Browse Data',       icon: <Filter size={16} /> },
        { id: 'feedback-chat',     label: 'AI Chat',           icon: <MessageSquare size={16} /> },
    ]},
    { label: '🎫 Support Tickets', items: [
        { id: 'ciec',  label: 'CIEC Board',  icon: <Ticket size={16} /> },
        { id: 'aabsp', label: 'AABSP Board', icon: <BarChart3 size={16} /> },
    ]},
    { label: '🔬 Deep Dives', items: [
        { id: 'cannibalization', label: 'Cannibalization', icon: <Layers size={16} /> },
        { id: 'refund',          label: 'Refund Audit',    icon: <CreditCard size={16} /> },
    ]},
];

const QUICK_LINKS = [
    { label: 'On-Call',         href: 'https://godaddy.service-now.com/now/sow/schedules/params/selected-group/925f19f62b6b6a102aa1f2356e91bf18', icon: <Calendar size={14} /> },
    { label: 'CIEC Board',      href: 'https://godaddy-corp.atlassian.net/issues/?filter=103469',                                                   icon: <Ticket size={14} /> },
    { label: 'AABSP Board',     href: 'https://godaddy-corp.atlassian.net/jira/software/projects/AABSP/boards',                                     icon: <BarChart3 size={14} /> },
    { label: 'Care SharePoint', href: 'https://secureserver.sharepoint.com/sites/careservices',                                                      icon: <HeartHandshake size={14} /> },
];

export { NAV_GROUPS, QUICK_LINKS };
export type { NavItem, NavGroup };

export default function Sidebar({ active, collapsed, onSelect, onToggle }: {
    active: PanelId; collapsed: boolean;
    onSelect: (id: PanelId) => void; onToggle: () => void;
}) {
    return (
        <aside className={`${sp.sidebar} ${collapsed ? sp.sidebarCollapsed : sp.sidebarExpanded}`}>
            {/* Brand */}
            <div className={collapsed ? sp.brandCollapsed : sp.brand}>
                <SPIcon size={26} />
                {!collapsed && (
                    <div className={sp.brandMeta}>
                        <div className={sp.brandName}>
                            AAB <span className={sp.brandSep}>|</span>{' '}
                            <span className={sp.brandAccent}>Support Plane</span>
                        </div>
                        <div className={sp.brandSub}>Support Intelligence</div>
                    </div>
                )}
                <button className={sp.collapseBtn} onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                    {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                </button>
            </div>

            {/* Nav */}
            <nav className={sp.nav}>
                {NAV_GROUPS.map((group) => (
                    <div key={group.label} className={sp.navGroup}>
                        {!collapsed && (
                            <div className={sp.navGroupLabel}>{group.label}</div>
                        )}

                        {group.items.map((item) => (
                            collapsed ? (
                                /* Collapsed: icon-only with CSS tooltip */
                                <button
                                    key={item.id}
                                    onClick={() => onSelect(item.id)}
                                    // data-tooltip drives the ::after pseudo-element
                                    data-tooltip={item.label}
                                    className={`${sp.navItemCollapsed} ${active === item.id ? sp.navItemActive : ''}`}
                                >
                                    {item.icon}
                                </button>
                            ) : (
                                /* Expanded: icon + label */
                                <button
                                    key={item.id}
                                    onClick={() => onSelect(item.id)}
                                    className={`${sp.navItem} ${active === item.id ? sp.navItemActive : ''}`}
                                >
                                    <span style={{ flexShrink: 0 }}>{item.icon}</span>
                                    <span>{item.label}</span>
                                </button>
                            )
                        ))}

                        <div className={sp.navDivider} />
                    </div>
                ))}

                {/* Quick links section */}
                {!collapsed && (
                    <div className={sp.navGroupLabel}>Quick Links</div>
                )}
                {QUICK_LINKS.map((lk) => (
                    collapsed ? (
                        <a
                            key={lk.href}
                            href={lk.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-tooltip={lk.label}
                            className={sp.navLinkCollapsed}
                        >
                            {lk.icon}
                        </a>
                    ) : (
                        <a
                            key={lk.href}
                            href={lk.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={sp.navLink}
                        >
                            <span style={{ flexShrink: 0 }}>{lk.icon}</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lk.label}</span>
                            <ExternalLink size={10} className={sp.navLinkExt} />
                        </a>
                    )
                ))}
            </nav>
        </aside>
    );
}
