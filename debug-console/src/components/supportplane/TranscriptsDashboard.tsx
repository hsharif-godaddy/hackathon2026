'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, FileText, TrendingUp, Calendar, Upload, BarChart2 } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';
import type { PanelId } from '@/components/supportplane/types';
import TagClusterVisualization from './TagClusterVisualization';

interface Stats {
    total: number;
    thisWeek: number;
    lastWeek: number;
    weekDelta: number;
    weekDeltaPct: number;
    thisMonth: number;
    lastMonth: number;
    monthDelta: number;
    monthDeltaPct: number;
    avgDuration: number | null;
    topCategories: { label: string; count: number }[];
    dateRange: { from: string | null; to: string | null };
    byDay: { date: string; count: number }[];
}

function fmt(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TranscriptsDashboard({ onNav }: { onNav?: (id: PanelId) => void }) {
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        try {
            const res = await fetch('/api/supportplane/transcripts/stats');
            if (res.ok) setStats(await res.json());
        } catch { /* silently degrade */ }
        setLoading(false);
    }

    useEffect(() => { load(); }, []);

    const byDay = stats?.byDay ?? [];
    const maxDay = Math.max(...byDay.map(d => d.count), 1);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>L1 Transcripts — Dashboard</div>
                    <div className={sp.panelSub}>
                        {stats ? `${stats.total.toLocaleString()} total transcripts · ${fmt(stats.dateRange.from)} → ${fmt(stats.dateRange.to)}` : 'Loading…'}
                    </div>
                </div>
                <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                    <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                </button>
            </div>

            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 16 }}>
                {[
                    { v: stats?.total.toLocaleString() ?? '—', l: 'Total Transcripts', s: 'all time', color: 'var(--blue)', icon: <FileText size={18} />, delta: null },
                    { v: stats?.thisWeek.toLocaleString() ?? '—', l: 'This Week', s: `WoW: ${stats?.weekDeltaPct ? (stats.weekDeltaPct > 0 ? '+' : '') + stats.weekDeltaPct + '%' : '—'}`, color: 'var(--green)', icon: <TrendingUp size={18} />, delta: stats?.weekDelta },
                    { v: stats?.thisMonth.toLocaleString() ?? '—', l: 'This Month', s: `MoM: ${stats?.monthDeltaPct ? (stats.monthDeltaPct > 0 ? '+' : '') + stats.monthDeltaPct + '%' : '—'}`, color: 'var(--purple)', icon: <Calendar size={18} />, delta: stats?.monthDelta },
                    { v: stats?.avgDuration ? `${Math.round(stats.avgDuration / 60)}m` : '—', l: 'Avg Duration', s: 'per transcript', color: 'var(--amber)', icon: <BarChart2 size={18} />, delta: null },
                ].map(k => (
                    <div key={k.l} className={sp.kpiCard}>
                        <div style={{ color: k.color, marginBottom: 4 }}>{k.icon}</div>
                        <div className={sp.kpiValue} style={{ color: k.color }}>
                            {k.v}
                            {k.delta !== null && k.delta !== undefined && k.delta !== 0 && (
                                <span style={{ fontSize: 14, marginLeft: 6, color: k.delta > 0 ? 'var(--green)' : 'var(--red)' }}>
                                    {k.delta > 0 ? '↑' : '↓'}{Math.abs(k.delta)}
                                </span>
                            )}
                        </div>
                        <div className={sp.kpiLabel}>{k.l}</div>
                        <div className={sp.kpiSub}>{k.s}</div>
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                {/* Daily volume */}
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--blue)' }} />
                        Daily volume — last 30 days
                    </div>
                    {byDay.length === 0 ? (
                        <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>No data yet. Upload transcripts to get started.</div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, paddingTop: 10 }}>
                                {byDay.map((d, i) => (
                                    <div key={i} title={`${d.date}: ${d.count}`} style={{
                                        flex: 1, minWidth: 2,
                                        height: `${Math.max(4, (d.count / maxDay) * 100)}%`,
                                        background: 'var(--blue)', borderRadius: '2px 2px 0 0', opacity: .75,
                                    }} />
                                ))}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                                <span>{byDay[0]?.date}</span><span>{byDay.at(-1)?.date}</span>
                            </div>
                        </>
                    )}
                </div>

                {/* Top categories */}
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--purple)' }} />
                        Top intent categories
                    </div>
                    {(stats?.topCategories ?? []).length === 0 ? (
                        <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>No category data available</div>
                    ) : (
                        <div style={{ paddingTop: 8 }}>
                            {(stats?.topCategories ?? []).slice(0, 6).map((c, i) => {
                                const max = Math.max(...(stats?.topCategories ?? []).map(x => x.count), 1);
                                return (
                                    <div key={c.label} style={{ marginBottom: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                                            <span style={{ color: 'var(--t1)' }}>{c.label}</span>
                                            <span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{c.count.toLocaleString()}</span>
                                        </div>
                                        <div style={{ background: 'var(--surface3)', borderRadius: 3, height: 6 }}>
                                            <div style={{ width: `${(c.count / max) * 100}%`, height: 6, background: ['var(--blue)', 'var(--purple)', 'var(--green)', 'var(--amber)', 'var(--red)', 'var(--teal)'][i % 6], borderRadius: 3 }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* 3D Tag Cluster Visualization */}
            <div style={{ marginBottom: 14 }}>
                <TagClusterVisualization
                    onTagClick={(tag) => {
                        // Navigate to browse panel with tag filter
                        if (onNav) {
                            onNav('transcripts' as PanelId);
                            // Tag will be applied via URL params or state management
                        }
                    }}
                />
            </div>

            {/* Quick actions */}
            <div className={sp.card}>
                <div className={sp.cardLabel}>
                    <span className={sp.cardDot} style={{ background: 'var(--green)' }} />
                    Quick actions
                </div>
                <div style={{ display: 'flex', gap: 8, paddingTop: 10, flexWrap: 'wrap' }}>
                    {[
                        { id: 'transcripts' as PanelId,     label: '📋 Browse Transcripts',   sub: 'Search & filter' },
                        { id: 'upload' as PanelId,          label: '⬆️ Upload / Sync',         sub: 'Add new transcripts' },
                        { id: 'analysis' as PanelId,        label: '🔬 Deep Dive Analysis',    sub: 'Trends & patterns' },
                        { id: 'transcript-chat' as PanelId, label: '💬 AI Chat',               sub: 'Ask questions' },
                    ].map(a => (
                        <button key={a.id} onClick={() => onNav?.(a.id)}
                            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', minWidth: 160 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t1)', marginBottom: 2 }}>{a.label}</div>
                            <div style={{ fontSize: 11, color: 'var(--t3)' }}>{a.sub}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
