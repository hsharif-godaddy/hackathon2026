'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

interface TrendPoint { date: string; count: number; avgRating: number | null; }
interface CompResult { current: number; prior: number; delta: number; deltaRating: number | null; currentAvgRating: number | null; priorAvgRating: number | null; }

type Granularity = 'day' | 'week' | 'month';

function Delta({ val }: { val: number }) {
    if (val > 0) return <span style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: 12 }}><TrendingUp size={11} style={{ display: 'inline', marginRight: 2 }} />+{val.toLocaleString()}</span>;
    if (val < 0) return <span style={{ color: 'var(--red)', fontFamily: 'var(--mono)', fontSize: 12 }}><TrendingDown size={11} style={{ display: 'inline', marginRight: 2 }} />{val.toLocaleString()}</span>;
    return <span style={{ color: 'var(--t3)', fontFamily: 'var(--mono)', fontSize: 12 }}><Minus size={11} style={{ display: 'inline', marginRight: 2 }} />0</span>;
}

function SparkBar({ points, color = 'var(--blue)' }: { points: TrendPoint[]; color?: string }) {
    if (!points.length) return null;
    const max = Math.max(...points.map(p => p.count), 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
            {points.map((p, i) => (
                <div key={i} title={`${p.date}: ${p.count}`}
                    style={{
                        flex: 1, minWidth: 2,
                        height: `${Math.max(4, (p.count / max) * 100)}%`,
                        background: color, borderRadius: '2px 2px 0 0', opacity: .75,
                    }} />
            ))}
        </div>
    );
}

export default function FeedbackTrendsPanel() {
    const [granularity, setGranularity] = useState<Granularity>('day');
    const [days, setDays] = useState(30);
    const [trends, setTrends] = useState<TrendPoint[]>([]);
    const [wow, setWow] = useState<CompResult | null>(null);
    const [mom, setMom] = useState<CompResult | null>(null);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        const [tRes, cRes] = await Promise.all([
            fetch(`/api/supportplane/feedback/trends?granularity=${granularity}&days=${days}`),
            fetch('/api/supportplane/feedback/comparison'),
        ]);
        if (tRes.ok) { const d = await tRes.json(); setTrends(d.trends ?? []); }
        if (cRes.ok) { const d = await cRes.json(); setWow(d.wow); setMom(d.mom); }
        setLoading(false);
    }

    useEffect(() => { load(); }, [granularity, days]);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Feedback Trends — WoW / MoM</div>
                    <div className={sp.panelSub}>Week-over-week and month-over-month comparisons</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={days} onChange={e => setDays(+e.target.value)} className={sp.select} style={{ minWidth: 100 }}>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={60}>Last 60 days</option>
                        <option value={90}>Last 90 days</option>
                    </select>
                    <select value={granularity} onChange={e => setGranularity(e.target.value as Granularity)} className={sp.select}>
                        <option value="day">Daily</option>
                        <option value="week">Weekly</option>
                        <option value="month">Monthly</option>
                    </select>
                    <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                        <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* WoW / MoM cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[
                    { label: 'Week over Week', comp: wow, color: 'var(--blue)' },
                    { label: 'Month over Month', comp: mom, color: 'var(--purple)' },
                ].map(({ label, comp, color }) => (
                    <div key={label} className={sp.card}>
                        <div className={sp.cardLabel}>
                            <span className={sp.cardDot} style={{ background: color }} />
                            {label}
                        </div>
                        {comp ? (
                            <div style={{ paddingTop: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                    <div>
                                        <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--mono)', color }}>
                                            {comp.current.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>Current period</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--mono)', color: 'var(--t3)' }}>
                                            {(comp.prior ?? 0).toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>Prior period</div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div>
                                        <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>Volume Δ</div>
                                        <Delta val={comp.delta} />
                                    </div>
                                    {comp.deltaRating != null && (
                                        <div>
                                            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>Rating Δ</div>
                                            <Delta val={comp.deltaRating} />
                                        </div>
                                    )}
                                    {comp.currentAvgRating != null && (
                                        <div>
                                            <div style={{ fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>Avg Rating</div>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)' }}>{comp.currentAvgRating.toFixed(1)}/7</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>No comparison data available</div>
                        )}
                    </div>
                ))}
            </div>

            {/* Trend chart */}
            <div className={sp.card}>
                <div className={sp.cardLabel}>
                    <span className={sp.cardDot} style={{ background: 'var(--blue)' }} />
                    {granularity === 'day' ? 'Daily' : granularity === 'week' ? 'Weekly' : 'Monthly'} feedback volume
                    <span style={{ marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)' }}>
                        ({trends.length} periods · {trends.reduce((s, t) => s + t.count, 0).toLocaleString()} total)
                    </span>
                </div>
                {loading ? (
                    <div className={sp.emptyState} style={{ height: 100 }}>Loading…</div>
                ) : trends.length === 0 ? (
                    <div className={sp.emptyState} style={{ height: 100 }}>No data for this period</div>
                ) : (
                    <>
                        <div style={{ paddingTop: 12 }}>
                            <SparkBar points={trends} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>
                            <span>{trends[0]?.date}</span>
                            <span>{trends.at(-1)?.date}</span>
                        </div>
                    </>
                )}
            </div>

            {/* Rating-over-time table */}
            {trends.length > 0 && (
                <div className={sp.card} style={{ marginTop: 12 }}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--amber)' }} />
                        Avg rating by period
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>Period</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>Count</th>
                                    <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>Avg Rating</th>
                                    <th style={{ padding: '4px 8px' }} />
                                </tr>
                            </thead>
                            <tbody>
                                {trends.slice().reverse().slice(0, 12).map((t, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid var(--surface3)' }}>
                                        <td style={{ padding: '5px 8px', fontFamily: 'var(--mono)', color: 'var(--t2)' }}>{t.date}</td>
                                        <td style={{ padding: '5px 8px', fontFamily: 'var(--mono)', textAlign: 'right', color: 'var(--t1)' }}>{t.count.toLocaleString()}</td>
                                        <td style={{ padding: '5px 8px', fontFamily: 'var(--mono)', textAlign: 'right', color: t.avgRating != null && t.avgRating >= 5 ? 'var(--green)' : t.avgRating != null && t.avgRating <= 2 ? 'var(--red)' : 'var(--amber)' }}>
                                            {t.avgRating?.toFixed(1) ?? '—'}
                                        </td>
                                        <td style={{ padding: '5px 8px' }}>
                                            <div style={{ background: 'var(--surface3)', borderRadius: 3, height: 5, width: 80 }}>
                                                <div style={{ width: `${((t.avgRating ?? 0) / 7) * 100}%`, height: 5, background: 'var(--amber)', borderRadius: 3 }} />
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
