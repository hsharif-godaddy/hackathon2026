'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';
import type { PanelId } from '@/components/supportplane/types';
import type { JiraTicket } from '@/lib/jira-client';

interface BoardStats {
    total: number; open: number; inProgress: number; done: number;
    highPriority: number; byType: Record<string, number>;
}

function fromTickets(tickets: JiraTicket[]): BoardStats {
    return {
        total: tickets.length,
        open: tickets.filter(t => ['Open', 'To Do', 'Backlog', 'New'].includes(t.status)).length,
        inProgress: tickets.filter(t => ['In Progress', 'In Review', 'In Development'].some(s => t.status.includes(s))).length,
        done: tickets.filter(t => ['Done', 'Closed', 'Resolved'].includes(t.status)).length,
        highPriority: tickets.filter(t => ['High', 'Critical', 'Highest', 'Blocker'].includes(t.priority)).length,
        byType: {} as Record<string, number>,
    };
}

function StatCard({ label, value, color, sub }: { label: string; value: number | string; color: string; sub?: string }) {
    return (
        <div className={sp.kpiCard}>
            <div className={sp.kpiValue} style={{ color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
            <div className={sp.kpiLabel}>{label}</div>
            {sub && <div className={sp.kpiSub}>{sub}</div>}
        </div>
    );
}

export default function TicketsDashboard({ onNav }: { onNav?: (id: PanelId) => void }) {
    const [ciec, setCiec] = useState<JiraTicket[]>([]);
    const [aabsp, setAabsp] = useState<JiraTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true); setError(null);
        try {
            const [cRes, aRes] = await Promise.all([
                fetch('/api/supportplane/jira?board=ciec'),
                fetch('/api/supportplane/jira?board=aabsp').catch(() => null),
            ]);
            if (cRes.ok) { const d = await cRes.json(); setCiec(d.tickets ?? []); }
            if (aRes?.ok) { const d = await aRes.json(); setAabsp(d.tickets ?? []); }
        } catch {
            setError('Failed to load Jira data — check Jira credentials in .env.local');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    const ciecStats = fromTickets(ciec);
    const aabspStats = fromTickets(aabsp);
    const combined = {
        total: ciecStats.total + aabspStats.total,
        open: ciecStats.open + aabspStats.open,
        inProgress: ciecStats.inProgress + aabspStats.inProgress,
        highPriority: ciecStats.highPriority + aabspStats.highPriority,
    };

    const recentTickets = [...ciec, ...aabsp]
        .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
        .slice(0, 10);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Support Tickets — Dashboard</div>
                    <div className={sp.panelSub}>CIEC + AABSP combined · {combined.total} tickets · {combined.open} open</div>
                </div>
                <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                    <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                </button>
            </div>

            {error && <div className={sp.alertError}>{error}</div>}

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
                <StatCard label="Total Tickets" value={combined.total} color="var(--blue)" sub="CIEC + AABSP" />
                <StatCard label="Open" value={combined.open} color="var(--amber)" sub="Needs attention" />
                <StatCard label="In Progress" value={combined.inProgress} color="var(--purple)" sub="Being worked on" />
                <StatCard label="High Priority" value={combined.highPriority} color="var(--red)" sub="Blocker / Critical" />
            </div>

            {/* Board comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                {[
                    { label: 'CIEC Board', stats: ciecStats, id: 'ciec' as PanelId, color: 'var(--blue)', href: 'https://godaddy-corp.atlassian.net/issues/?filter=103469' },
                    { label: 'AABSP Board', stats: aabspStats, id: 'aabsp' as PanelId, color: 'var(--purple)', href: 'https://godaddy-corp.atlassian.net/jira/software/projects/AABSP/boards' },
                ].map(b => (
                    <div key={b.label} className={sp.card}>
                        <div className={sp.cardLabel}>
                            <span className={sp.cardDot} style={{ background: b.color }} />
                            {b.label}
                            <a href={b.href} target="_blank" rel="noopener noreferrer"
                                style={{ marginLeft: 'auto', color: 'var(--t3)' }}>
                                <ExternalLink size={11} />
                            </a>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 12 }}>
                            {[
                                { v: b.stats.open, l: 'Open', c: 'var(--amber)', icon: <Clock size={14} /> },
                                { v: b.stats.inProgress, l: 'In Progress', c: 'var(--purple)', icon: <AlertTriangle size={14} /> },
                                { v: b.stats.done, l: 'Done', c: 'var(--green)', icon: <CheckCircle size={14} /> },
                            ].map(s => (
                                <div key={s.l} style={{ textAlign: 'center', padding: '8px 4px', background: 'var(--surface2)', borderRadius: 8 }}>
                                    <div style={{ color: s.c, marginBottom: 2 }}>{s.icon}</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: s.c }}>{s.v}</div>
                                    <div style={{ fontSize: 10, color: 'var(--t3)' }}>{s.l}</div>
                                </div>
                            ))}
                        </div>
                        {b.stats.highPriority > 0 && (
                            <div style={{ marginTop: 10, padding: '6px 10px', background: 'var(--red)15', border: '1px solid var(--red)40', borderRadius: 6, fontSize: 11, color: 'var(--red)' }}>
                                ⚠️ {b.stats.highPriority} high-priority ticket{b.stats.highPriority > 1 ? 's' : ''} need attention
                            </div>
                        )}
                        <button onClick={() => onNav?.(b.id)}
                            className={sp.btnSecondary}
                            style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}>
                            View {b.label} →
                        </button>
                    </div>
                ))}
            </div>

            {/* Recent tickets */}
            {recentTickets.length > 0 && (
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--teal)' }} />
                        10 most recent tickets
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Key', 'Title', 'Status', 'Priority', 'Assignee', 'Created'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {recentTickets.map(t => (
                                <tr key={t.key} style={{ borderBottom: '1px solid var(--surface3)' }}>
                                    <td style={{ padding: '6px 8px' }}>
                                        <a href={t.url} target="_blank" rel="noopener noreferrer"
                                            style={{ color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600 }}>
                                            {t.key}
                                        </a>
                                    </td>
                                    <td style={{ padding: '6px 8px', color: 'var(--t1)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.summary}</td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <span style={{ fontSize: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', color: 'var(--t2)' }}>{t.status}</span>
                                    </td>
                                    <td style={{ padding: '6px 8px', color: ['High','Critical','Highest','Blocker'].includes(t.priority) ? 'var(--red)' : 'var(--t2)', fontSize: 11 }}>{t.priority}</td>
                                    <td style={{ padding: '6px 8px', color: 'var(--t3)' }}>{t.assignee ?? '—'}</td>
                                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: 'var(--t3)', fontSize: 10 }}>
                                        {new Date(t.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
