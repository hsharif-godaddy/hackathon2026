'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, Zap, TrendingUp, Star, AlertCircle, MessageSquare, ThumbsUp } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';
import type { PanelId } from '@/components/supportplane/types';

interface Summary {
    totalFeedback: number; avgRating: number | null;
    positiveCount: number; negativeCount: number; neutralCount: number;
    issueCount: number; uniqueApps: number;
    dateRange: { from: string | null; to: string | null };
}
interface TrendPoint { date: string; count: number; avgRating: number | null; }
interface RatingBucket { rating: number; count: number; pct: number; }
interface CompResult { current: number; prior: number; delta: number; currentAvgRating: number | null; }

const RATING_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#22c55e', '#14b8a6', '#6366f1'];

export default function FeedbackDashboard({ onNav }: { onNav?: (id: PanelId) => void }) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [trends, setTrends] = useState<TrendPoint[]>([]);
    const [ratings, setRatings] = useState<RatingBucket[]>([]);
    const [wow, setWow] = useState<CompResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);

    async function load() {
        setLoading(true);
        const [sumRes, trendRes, ratRes, compRes] = await Promise.all([
            fetch('/api/supportplane/feedback/summary?days=30'),
            fetch('/api/supportplane/feedback/trends?granularity=day&days=14'),
            fetch('/api/supportplane/feedback/ratings'),
            fetch('/api/supportplane/feedback/comparison'),
        ]);
        if (sumRes.ok) { const d = await sumRes.json(); setSummary(d.summary); }
        if (trendRes.ok) { const d = await trendRes.json(); setTrends(d.trends ?? []); }
        if (ratRes.ok) { const d = await ratRes.json(); setRatings(d.ratings ?? []); }
        if (compRes.ok) { const d = await compRes.json(); setWow(d.wow); }
        setLoading(false);
    }

    async function sync() {
        setSyncing(true);
        await fetch('/api/supportplane/feedback/sync', { method: 'POST' });
        setSyncing(false);
        load();
    }

    useEffect(() => { load(); }, []);

    const total = summary?.totalFeedback ?? 0;
    const posP = total > 0 ? Math.round(((summary?.positiveCount ?? 0) / total) * 100) : 0;
    const negP = total > 0 ? Math.round(((summary?.negativeCount ?? 0) / total) * 100) : 0;
    const maxTrend = Math.max(...trends.map(t => t.count), 1);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>
                        <ThumbsUp size={16} style={{ display: 'inline', marginRight: 6, color: 'var(--green)' }} />
                        Feedback Intelligence — Dashboard
                    </div>
                    <div className={sp.panelSub}>
                        {total.toLocaleString()} records · Avg rating {summary?.avgRating?.toFixed(1) ?? '—'}/7 · {summary?.uniqueApps ?? 0} apps reporting
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                        <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                    </button>
                    <button className={sp.btnPrimary} onClick={sync} disabled={syncing}>
                        <Zap size={13} className={syncing ? sp.spin : ''} />
                        {syncing ? 'Syncing…' : 'Sync S3'}
                    </button>
                </div>
            </div>

            {loading ? <div className={sp.emptyState}>Loading…</div> : total === 0 ? (
                <div className={sp.emptyState}>
                    <AlertCircle size={28} style={{ color: 'var(--t3)', marginBottom: 8 }} />
                    <div>No feedback data yet.</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>Click <strong>Sync S3</strong> to ingest from S3/Athena.</div>
                </div>
            ) : (
                <>
                    {/* KPI row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
                        {[
                            { v: total.toLocaleString(), l: 'Total Feedback', color: 'var(--blue)', icon: <MessageSquare size={16} /> },
                            { v: `${posP}%`, l: 'Positive', color: 'var(--green)', icon: <ThumbsUp size={16} /> },
                            { v: `${negP}%`, l: 'Negative', color: 'var(--red)', icon: <AlertCircle size={16} /> },
                            { v: summary?.avgRating?.toFixed(1) ?? '—', l: 'Avg Rating /7', color: 'var(--amber)', icon: <Star size={16} /> },
                            { v: wow ? (wow.delta >= 0 ? `+${wow.delta}` : `${wow.delta}`) : '—', l: 'WoW Change', color: wow && wow.delta >= 0 ? 'var(--green)' : 'var(--red)', icon: <TrendingUp size={16} /> },
                        ].map(k => (
                            <div key={k.l} className={sp.kpiCard}>
                                <div style={{ color: k.color, marginBottom: 4 }}>{k.icon}</div>
                                <div className={sp.kpiValue} style={{ color: k.color }}>{k.v}</div>
                                <div className={sp.kpiLabel}>{k.l}</div>
                            </div>
                        ))}
                    </div>

                    {/* Score over time + sentiment donut */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 14 }}>
                        <div className={sp.card}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--amber)' }} />
                                Rating score over time — last 14 days
                            </div>
                            <div style={{ paddingTop: 10 }}>
                                {/* Scatter-like dot plot for avg rating per day */}
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, position: 'relative' }}>
                                    {/* Grid lines at 1,3,5,7 */}
                                    {[1,3,5,7].map(g => (
                                        <div key={g} style={{
                                            position: 'absolute', left: 0, right: 0,
                                            bottom: `${((g - 1) / 6) * 100}%`,
                                            borderTop: '1px dashed var(--surface3)',
                                        }} />
                                    ))}
                                    {trends.map((t, i) => {
                                        const r = t.avgRating;
                                        const barH = (t.count / maxTrend) * 100;
                                        return (
                                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', position: 'relative' }}>
                                                <div style={{ width: '70%', height: `${Math.max(4, barH)}%`, background: 'var(--blue)30', borderRadius: '2px 2px 0 0' }} />
                                                {r != null && (
                                                    <div title={`${t.date}: ${r.toFixed(1)} avg, ${t.count} records`} style={{
                                                        position: 'absolute',
                                                        bottom: `${((r - 1) / 6) * 100}%`,
                                                        width: 7, height: 7,
                                                        borderRadius: '50%',
                                                        background: r >= 5 ? '#22c55e' : r <= 2 ? '#ef4444' : '#f59e0b',
                                                        transform: 'translateY(50%)',
                                                        zIndex: 2,
                                                    }} />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                                    <span>{trends[0]?.date}</span>
                                    <span style={{ color: 'var(--t3)' }}>● = avg rating · bars = volume</span>
                                    <span>{trends.at(-1)?.date}</span>
                                </div>
                            </div>
                        </div>

                        <div className={sp.card}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--green)' }} />
                                Sentiment split
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8 }}>
                                {(() => {
                                    const groups = [
                                        { pct: posP, color: '#22c55e', label: `Positive ${posP}%` },
                                        { pct: 100 - posP - negP, color: '#6b7280', label: `Neutral ${100 - posP - negP}%` },
                                        { pct: negP, color: '#ef4444', label: `Negative ${negP}%` },
                                    ];
                                    const circ = 2 * Math.PI * 15.9;
                                    let offset = 0;
                                    return (
                                        <svg viewBox="0 0 36 36" style={{ width: 110, height: 110, transform: 'rotate(-90deg)', marginBottom: 12 }}>
                                            <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface3)" strokeWidth="3.2" />
                                            {groups.map((g, i) => {
                                                const dash = (g.pct / 100) * circ;
                                                const el = (
                                                    <circle key={i} cx="18" cy="18" r="15.9" fill="none"
                                                        stroke={g.color} strokeWidth="3.2"
                                                        strokeDasharray={`${dash} ${circ - dash}`}
                                                        strokeDashoffset={-offset} />
                                                );
                                                offset += dash;
                                                return el;
                                            })}
                                        </svg>
                                    );
                                })()}
                                {[
                                    { label: 'Positive (5–7)', pct: posP, color: '#22c55e' },
                                    { label: 'Neutral (3–4)', pct: 100 - posP - negP, color: '#6b7280' },
                                    { label: 'Negative (1–2)', pct: negP, color: '#ef4444' },
                                ].map(g => (
                                    <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, width: '100%' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                                        <span style={{ fontSize: 10, color: 'var(--t2)', flex: 1 }}>{g.label}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t1)', fontWeight: 600 }}>{g.pct}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Rating bars */}
                    <div className={sp.card} style={{ marginBottom: 14 }}>
                        <div className={sp.cardLabel}>
                            <span className={sp.cardDot} style={{ background: 'var(--amber)' }} />
                            Rating distribution (1–7)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10 }}>
                            {ratings.map(r => (
                                <div key={r.rating} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: RATING_COLORS[r.rating - 1], width: 28, textAlign: 'right', fontWeight: 700 }}>★ {r.rating}</span>
                                    <div style={{ flex: 1, background: 'var(--surface3)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                                        <div style={{ width: `${r.pct}%`, height: 14, background: RATING_COLORS[r.rating - 1], borderRadius: 4, transition: 'width .4s ease' }} />
                                    </div>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t2)', width: 52, textAlign: 'right' }}>{r.count.toLocaleString()} ({r.pct.toFixed(0)}%)</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Nav cards */}
                    <div className={sp.card}>
                        <div className={sp.cardLabel}>
                            <span className={sp.cardDot} style={{ background: 'var(--blue)' }} />
                            Explore feedback
                        </div>
                        <div style={{ display: 'flex', gap: 8, paddingTop: 10, flexWrap: 'wrap' }}>
                            {([
                                { id: 'feedback-overview', label: '📊 Overview',  sub: 'Full summary' },
                                { id: 'feedback-trends',   label: '📈 Trends',    sub: 'WoW / MoM' },
                                { id: 'feedback-ratings',  label: '⭐ Ratings',    sub: 'Distribution' },
                                { id: 'feedback-ratings',  label: '🔬 Analytics', sub: 'Deep Dive' },
                                { id: 'feedback-browse',   label: '🔍 Browse',    sub: 'Browse data' },
                                { id: 'feedback-chat',     label: '💬 AI Chat',   sub: 'NLP queries' },
                            ] satisfies { id: PanelId; label: string; sub: string }[]).map(a => (
                                <button key={a.label} onClick={() => onNav?.(a.id)}
                                    style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>{a.label}</div>
                                    <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{a.sub}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
