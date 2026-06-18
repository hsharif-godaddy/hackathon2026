'use client';

import { FileText, Filter, MessageSquare, Tag, Ticket, TrendingUp } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import sp from '@/components/supportplane/sp.module.css';
import { SERVICE_HEALTH_SKELETON } from '@/components/supportplane/types';
import type { PanelId } from '@/components/supportplane/types';

interface ServiceHealth { name: string; ok: boolean | null; detail: string; }

export default function DashboardPanel({ onNav }: { onNav: (id: PanelId) => void }) {
    const [health, setHealth] = useState<ServiceHealth[]>(
        SERVICE_HEALTH_SKELETON.map(s => ({ ...s, detail: 'Checking…' })),
    );
    useEffect(() => {
        fetch('/api/supportplane/services/health')
            .then(r => r.ok ? r.json() as Promise<ServiceHealth[]> : null)
            .then(d => { if (d) setHealth(d); })
            .catch(() => { /* leave skeleton */ });
    }, []);
    const STATS = [
        { num: '1,247', label: 'L1 Contacts (30d)', delta: '+12%', up: true },
        { num: '184',   label: 'Escalated to L2',   delta: '14.8%', up: false },
        { num: '31',    label: 'Reached CIEC (L3)', delta: '2.5%',  up: false },
        { num: '4.2m',  label: 'Avg Handle Time',   delta: '-8%',   up: true  },
    ];
    const QUICK: { id: PanelId; label: string; desc: string; color: string; bg: string; icon: React.ReactNode }[] = [
        { id: 'chat',        label: 'AI Chat',        desc: 'Ask the support assistant',      color: '#3b82f6', bg: '#3b82f61a', icon: <MessageSquare size={18} /> },
        { id: 'transcripts', label: 'L1 Transcripts', desc: 'Browse ingested call records',   color: '#0891b2', bg: '#0891b21a', icon: <FileText size={18} /> },
        { id: 'trends',      label: 'Trend Analysis', desc: 'Daily / WoW / MoM charts',      color: '#10b981', bg: '#10b9811a', icon: <TrendingUp size={18} /> },
        { id: 'funnel',      label: 'Support Funnel', desc: 'L1 → L2 → L3 escalation flow',  color: '#7c3aed', bg: '#7c3aed1a', icon: <Filter size={18} /> },
        { id: 'tagcloud',    label: 'Intent Tags',    desc: 'Top contact reason clusters',   color: '#f59e0b', bg: '#f59e0b1a', icon: <Tag size={18} /> },
        { id: 'ciec',        label: 'CIEC Analysis',  desc: 'Open tickets & SLA status',      color: '#ef4444', bg: '#ef44441a', icon: <Ticket size={18} /> },
    ];
    return (
        <div className={sp.panel}>
            <div className={sp.demoBanner}>
                <span className={sp.demoBadge}>Demo Data</span>
                Connect SharePoint, Jira, and ServiceNow credentials to replace with live metrics.
            </div>
            <div className={sp.sectionHeading}>30-Day Overview</div>
            <div className={sp.statsGrid}>
                {STATS.map((s) => (
                    <div key={s.label} className={sp.statCard}>
                        <div className={sp.statNum}>{s.num}</div>
                        <div className={sp.statLabel}>{s.label}</div>
                        <div className={`${sp.statDelta} ${s.up ? sp.deltaUp : sp.deltaNt}`}>{s.delta} {s.up ? '▲' : '●'}</div>
                    </div>
                ))}
            </div>
            <div className={sp.sectionHeading}>Navigate</div>
            <div className={sp.quickGrid}>
                {QUICK.map((q) => (
                    <button key={q.id} className={sp.quickCard} onClick={() => onNav(q.id)}>
                        <div className={sp.quickIcon} style={{ background: q.bg, color: q.color }}>{q.icon}</div>
                        <div><div className={sp.quickCardTitle}>{q.label}</div><div className={sp.quickCardDesc}>{q.desc}</div></div>
                    </button>
                ))}
            </div>
            <div className={sp.sectionHeading}>Service Health</div>
            <div className={sp.healthGrid}>
                {health.map((s) => {
                    const cls    = s.ok === null ? sp.healthWarn : s.ok ? sp.healthOk : sp.healthErr;
                    const dotCls = s.ok === null ? sp.dotWarn : s.ok ? sp.dotOk : sp.dotErr;
                    return (
                        <span key={s.name} className={`${sp.healthPill} ${cls}`} title={s.detail}>
                            <span className={`${sp.dot} ${dotCls}`} />
                            <span>{s.name}</span>
                            <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>— {s.detail}</span>
                        </span>
                    );
                })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginTop: 8 }}>
                Status is also visible in the top header on every page.
            </div>
        </div>
    );
}
