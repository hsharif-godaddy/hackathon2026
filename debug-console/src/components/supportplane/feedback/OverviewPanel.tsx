'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, CloudDownload, Zap } from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';
import { WaveDots } from '@/components/supportplane/WaveDots';
import type { PanelId } from '@/components/supportplane/types';

interface Summary {
    totalFeedback: number;
    avgRating: number | null;
    issueCount: number;
    supportCount: number;
    feedbackCount: number;
    uniqueApps: number;
    positiveCount: number;
    negativeCount: number;
    neutralCount: number;
    dateRange: { from: string | null; to: string | null };
}

interface Ingestion {
    totalFiles: number;
    successFiles: number;
    errorFiles: number;
    lastSync: string | null;
    totalRows: number;
    dbPath: string;
}

interface Coverage {
    earliest: string | null;
    latest: string | null;
    totalRows: number;
}

interface TrendPoint {
    date: string;
    count: number;
    avgRating: number | null;
}

function formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RatingBar({ rating, count, pct, color }: { rating: number; count: number; pct: number; color: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t2)', width: 32, textAlign: 'right', flexShrink: 0 }}>{rating}/7</span>
            <div style={{ flex: 1, background: 'var(--surface3)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: 10, background: color, borderRadius: 4, transition: 'width .4s ease' }} />
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)', width: 28, textAlign: 'right', flexShrink: 0 }}>{count}</span>
        </div>
    );
}

const RATING_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#22c55e', '#14b8a6', '#6366f1'];

export default function FeedbackOverviewPanel({ onNav, onSync }: { onNav?: (id: PanelId) => void; onSync?: () => void }) {
    const [summary, setSummary] = useState<Summary | null>(null);
    const [ingestion, setIngestion] = useState<Ingestion | null>(null);
    const [coverage, setCoverage] = useState<Coverage | null>(null);
    const [ratings, setRatings] = useState<{ rating: number; count: number; pct: number }[]>([]);
    const [trends, setTrends] = useState<TrendPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setLoading(true); setError(null);
        const controller = new AbortController();
        const timerId = setTimeout(() => controller.abort(), 100_000);
        try {
            const [sumRes, ratRes, trendRes] = await Promise.all([
                fetch('/api/supportplane/feedback/summary?days=30', { signal: controller.signal }),
                fetch('/api/supportplane/feedback/ratings', { signal: controller.signal }),
                fetch('/api/supportplane/feedback/trends?granularity=day&days=30', { signal: controller.signal }),
            ]);
            if (sumRes.ok) {
                const d = await sumRes.json();
                setSummary(d.summary);
                setIngestion(d.ingestion);
                setCoverage(d.coverage ?? null);
            }
            if (ratRes.ok) {
                const d = await ratRes.json();
                setRatings(d.ratings ?? []);
            }
            if (trendRes.ok) {
                const d = await trendRes.json();
                setTrends(d.trends ?? []);
            }
        } catch (err: unknown) {
            const isAbort = err instanceof Error && err.name === 'AbortError';
            setError(isAbort
                ? 'Timed out loading feedback data — DynamoDB scan is slow (VPN or cold start). Try refreshing in a minute.'
                : 'Failed to load feedback data');
        } finally {
            clearTimeout(timerId);
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    const totalFeedback = summary?.totalFeedback ?? 0;
    const sentimentPct = totalFeedback > 0
        ? {
            pos: Math.round(((summary?.positiveCount ?? 0) / totalFeedback) * 100),
            neg: Math.round(((summary?.negativeCount ?? 0) / totalFeedback) * 100),
            neu: Math.round(((summary?.neutralCount ?? 0) / totalFeedback) * 100),
          }
        : { pos: 0, neg: 0, neu: 0 };

    return (
        <div className={sp.panelRoot}>
            {/* Header */}
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Feedback Intelligence — Overview</div>
                    <div className={sp.panelSub}>
                        {summary && summary.totalFeedback > 0 ? (
                            <>
                                <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                                    Data available: {formatDate(coverage?.earliest ?? null)} → {formatDate(coverage?.latest ?? null)}
                                </span>
                                {' '}· {(coverage?.totalRows ?? ingestion?.totalRows)?.toLocaleString()} rows ·
                                Last sync: {ingestion?.lastSync ? formatDate(ingestion.lastSync) : 'never'}
                                {' '}· Showing last 30 days
                            </>
                        ) : (
                            <>S3 + Athena · Last sync: {ingestion?.lastSync ? formatDate(ingestion.lastSync) : 'Never'}</>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                        <RefreshCw size={13} className={loading ? sp.spin : ''} />
                        Refresh
                    </button>
                    {onSync && (
                        <button className={sp.btnPrimary} onClick={onSync}>
                            <Zap size={13} />
                            Sync from S3
                        </button>
                    )}
                </div>
            </div>

            {error && <div className={sp.alertError}>{error}</div>}

            {loading ? (
                <div className={sp.emptyState} style={{ flexDirection: 'column', gap: 12 }}>
                    <WaveDots size={10} gap={7} />
                    <span style={{ fontSize: 12, color: 'var(--sp-txm)' }}>Loading feedback data…</span>
                </div>
            ) : summary?.totalFeedback === 0 ? (
                <div className={sp.emptyState}>
                    <CloudDownload size={32} style={{ marginBottom: 8, color: 'var(--t3)' }} />
                    <div style={{ fontWeight: 600 }}>No feedback data in local database</div>
                    <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6, maxWidth: 420, lineHeight: 1.6 }}>
                        Go to <strong>Browse Data</strong> (the data source page) to sync from S3 / Athena.
                        Data is available from <strong>April 1 2026</strong> onwards.
                        AWS credentials must be set in <code>.env.local</code>.
                    </div>
                    <button className={sp.btnPrimary} style={{ marginTop: 14 }} onClick={() => onNav?.('feedback-browse')}>
                        <CloudDownload size={13} /> Open Data Source &amp; Sync
                    </button>
                </div>
            ) : (
                <>
                    {/* KPI row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8, marginBottom: 16 }}>
                        {[
                            { v: totalFeedback.toLocaleString(), l: 'Total Feedback', s: `Latest: ${formatDate(summary?.dateRange.to ?? null)}`, color: 'var(--blue)' },
                            { v: summary?.avgRating?.toFixed(1) ?? '—', l: 'Avg Rating', s: 'out of 7', color: summary?.avgRating != null && summary.avgRating >= 5 ? 'var(--green)' : 'var(--amber)' },
                            { v: `${sentimentPct.pos}%`, l: 'Positive', s: `${summary?.positiveCount?.toLocaleString()} records (5–7)`, color: 'var(--green)' },
                            { v: `${sentimentPct.neg}%`, l: 'Negative', s: `${summary?.negativeCount?.toLocaleString()} records (1–2)`, color: 'var(--red)' },
                            { v: summary?.issueCount?.toLocaleString() ?? '0', l: 'Issues', s: `${Math.round(((summary?.issueCount ?? 0) / totalFeedback) * 100)}% of total`, color: 'var(--red)' },
                            { v: summary?.uniqueApps?.toLocaleString() ?? '0', l: 'Unique Apps', s: 'reporting feedback', color: 'var(--purple)' },
                        ].map(k => (
                            <div key={k.l} className={sp.kpiCard}>
                                <div className={sp.kpiValue} style={{ color: k.color }}>{k.v}</div>
                                <div className={sp.kpiLabel}>{k.l}</div>
                                <div className={sp.kpiSub}>{k.s}</div>
                            </div>
                        ))}
                    </div>

                    {/* Sentiment split + rating bars */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                        <div className={sp.card}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--green)' }} />
                                Sentiment Split — last 30 days
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0' }}>
                                <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
                                    <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface3)" strokeWidth="3.2" />
                                        {(() => {
                                            const segs = [
                                                { pct: sentimentPct.pos, color: '#22c55e' },
                                                { pct: sentimentPct.neu, color: '#6b7280' },
                                                { pct: sentimentPct.neg, color: '#ef4444' },
                                            ];
                                            const circ = 2 * Math.PI * 15.9;
                                            let offset = 0;
                                            return segs.map((s, i) => {
                                                const dash = (s.pct / 100) * circ;
                                                const el = (
                                                    <circle key={i} cx="18" cy="18" r="15.9" fill="none"
                                                        stroke={s.color} strokeWidth="3.2"
                                                        strokeDasharray={`${dash} ${circ - dash}`}
                                                        strokeDashoffset={-offset} />
                                                );
                                                offset += dash;
                                                return el;
                                            });
                                        })()}
                                    </svg>
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{sentimentPct.pos}%</div>
                                        <div style={{ fontSize: 9, color: 'var(--t3)' }}>positive</div>
                                    </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    {[
                                        { label: 'Positive (5–7)', pct: sentimentPct.pos, color: '#22c55e', count: summary?.positiveCount },
                                        { label: 'Neutral (3–4)',  pct: sentimentPct.neu, color: '#6b7280', count: summary?.neutralCount },
                                        { label: 'Negative (1–2)', pct: sentimentPct.neg, color: '#ef4444', count: summary?.negativeCount },
                                    ].map(s => (
                                        <div key={s.label} style={{ marginBottom: 8 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--t2)', marginBottom: 3 }}>
                                                <span style={{ color: s.color }}>{s.label}</span>
                                                <span style={{ fontFamily: 'var(--mono)' }}>{s.count?.toLocaleString()} · {s.pct}%</span>
                                            </div>
                                            <div style={{ background: 'var(--surface3)', borderRadius: 3, height: 5 }}>
                                                <div style={{ width: `${s.pct}%`, height: 5, background: s.color, borderRadius: 3 }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className={sp.card}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--amber)' }} />
                                Rating Distribution (1–7 scale)
                            </div>
                            <div style={{ paddingTop: 8 }}>
                                {ratings.map(r => (
                                    <RatingBar
                                        key={r.rating}
                                        rating={r.rating}
                                        count={r.count}
                                        pct={r.pct}
                                        color={RATING_COLORS[r.rating - 1] ?? '#6b7280'}
                                    />
                                ))}
                                <div style={{ fontSize: 10, color: 'var(--t3)', fontFamily: 'var(--mono)', marginTop: 8 }}>
                                    Avg {summary?.avgRating?.toFixed(1) ?? '—'}/7 · {totalFeedback.toLocaleString()} rated
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Daily trend sparklines */}
                    {trends.length > 0 && (
                        <div className={sp.card} style={{ marginBottom: 14 }}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--blue)' }} />
                                Daily feedback volume — last 30 days
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60, paddingTop: 8 }}>
                                {(() => {
                                    const max = Math.max(...trends.map(t => t.count), 1);
                                    return trends.map((t, i) => (
                                        <div key={i} title={`${t.date}: ${t.count} records`}
                                            style={{
                                                flex: 1, minWidth: 2,
                                                height: `${Math.max(4, (t.count / max) * 100)}%`,
                                                background: 'var(--blue)',
                                                borderRadius: '2px 2px 0 0',
                                                opacity: 0.7,
                                                cursor: 'default',
                                            }} />
                                    ));
                                })()}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                                <span>{trends[0]?.date}</span>
                                <span>{trends.at(-1)?.date}</span>
                            </div>
                        </div>
                    )}

                    {/* Category breakdown + quick nav */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div className={sp.card}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--purple)' }} />
                                Feedback by category
                            </div>
                            {[
                                { cat: 'feedback', label: 'Product Feedback', color: 'var(--blue)', count: summary?.feedbackCount },
                                { cat: 'issue',    label: 'Issues / Bugs',    color: 'var(--red)',  count: summary?.issueCount },
                                { cat: 'support',  label: 'SOS Support',      color: 'var(--amber)', count: summary?.supportCount },
                            ].map(c => (
                                <div key={c.cat} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <span style={{ width: 9, height: 9, borderRadius: 2, background: c.color, flexShrink: 0, display: 'inline-block' }} />
                                    <span style={{ flex: 1, fontSize: 12, color: 'var(--t1)' }}>{c.label}</span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t2)' }}>{c.count?.toLocaleString() ?? 0}</span>
                                    <div style={{ width: 60, background: 'var(--surface3)', borderRadius: 3, height: 5 }}>
                                        <div style={{ width: `${totalFeedback ? Math.round(((c.count ?? 0) / totalFeedback) * 100) : 0}%`, height: 5, background: c.color, borderRadius: 3 }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className={sp.card}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: 'var(--teal)' }} />
                                Quick navigation
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, paddingTop: 8 }}>
                                {[
                                    { id: 'feedback-trends' as PanelId,  label: '📈 Trends',        sub: 'WoW / MoM' },
                                    { id: 'feedback-ratings' as PanelId, label: '⭐ Ratings',        sub: 'Distribution' },
                                    { id: 'feedback-topics' as PanelId,  label: '🏷 Topics',         sub: 'Frequency' },
                                    { id: 'feedback-browse' as PanelId,  label: '🔍 Browse',         sub: 'Browse data' },
                                    { id: 'feedback-chat' as PanelId,    label: '💬 AI Chat',        sub: 'Ask anything' },
                                    { id: 'dash-feedback' as PanelId,    label: '📊 Dashboard',      sub: 'Overview' },
                                ].map(item => (
                                    <button key={item.id} onClick={() => onNav?.(item.id)}
                                        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left' }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>{item.label}</div>
                                        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>{item.sub}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
