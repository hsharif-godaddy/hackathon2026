'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

interface RatingBucket { rating: number; count: number; pct: number; }
interface CategoryRow { category: string; count: number; avgRating: number | null; }

const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#3b82f6', '#22d3ee', '#22c55e', '#6366f1'];
const LABELS: Record<number, string> = {
    1: 'Very Dissatisfied', 2: 'Dissatisfied', 3: 'Somewhat Dissatisfied',
    4: 'Neutral', 5: 'Satisfied', 6: 'Very Satisfied', 7: 'Extremely Satisfied',
};

export default function FeedbackRatingsPanel() {
    const [ratings, setRatings] = useState<RatingBucket[]>([]);
    const [categories, setCategories] = useState<CategoryRow[]>([]);
    const [appId, setAppId] = useState('');
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        const params = new URLSearchParams();
        if (appId) params.set('app_id', appId);
        const res = await fetch(`/api/supportplane/feedback/ratings?${params}`);
        if (res.ok) {
            const d = await res.json();
            setRatings(d.ratings ?? []);
            setCategories(d.categories ?? []);
        }
        setLoading(false);
    }

    useEffect(() => { load(); }, [appId]);

    const total = ratings.reduce((s, r) => s + r.count, 0);
    const avg = total > 0
        ? (ratings.reduce((s, r) => s + r.rating * r.count, 0) / total).toFixed(2)
        : null;

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Rating Analysis</div>
                    <div className={sp.panelSub}>1–7 scale distribution · avg {avg ?? '—'}/7 · {total.toLocaleString()} rated</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input className={sp.searchInput} style={{ minWidth: 160 }}
                        placeholder="Filter by App ID…"
                        value={appId} onChange={e => setAppId(e.target.value)} />
                    <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                        <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                {/* Rating bars */}
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--amber)' }} />
                        Rating Distribution
                    </div>
                    <div style={{ paddingTop: 10 }}>
                        {loading ? (
                            <div style={{ color: 'var(--t3)', fontSize: 12 }}>Loading…</div>
                        ) : ratings.length === 0 ? (
                            <div style={{ color: 'var(--t3)', fontSize: 12 }}>No rating data</div>
                        ) : (
                            ratings.map(r => (
                                <div key={r.rating} style={{ marginBottom: 10 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                                        <span style={{ color: COLORS[r.rating - 1], fontWeight: 600 }}>
                                            ★ {r.rating} — {LABELS[r.rating]}
                                        </span>
                                        <span style={{ fontFamily: 'var(--mono)', color: 'var(--t2)' }}>
                                            {r.count.toLocaleString()} · {r.pct.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div style={{ background: 'var(--surface3)', borderRadius: 4, height: 12, overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${r.pct}%`, height: 12,
                                            background: COLORS[r.rating - 1],
                                            borderRadius: 4,
                                            transition: 'width .4s ease',
                                        }} />
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    {avg && (
                        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--amber)' }}>{avg}</div>
                            <div style={{ fontSize: 11, color: 'var(--t3)' }}>Average rating out of 7</div>
                        </div>
                    )}
                </div>

                {/* Donut chart */}
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--blue)' }} />
                        Sentiment Breakdown
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 12 }}>
                        {total > 0 && (() => {
                            const groups = [
                                { label: 'Negative (1–2)', count: ratings.filter(r => r.rating <= 2).reduce((s, r) => s + r.count, 0), color: '#ef4444' },
                                { label: 'Neutral (3–4)',  count: ratings.filter(r => r.rating >= 3 && r.rating <= 4).reduce((s, r) => s + r.count, 0), color: '#6b7280' },
                                { label: 'Positive (5–7)', count: ratings.filter(r => r.rating >= 5).reduce((s, r) => s + r.count, 0), color: '#22c55e' },
                            ];
                            const circ = 2 * Math.PI * 15.9;
                            let offset = 0;
                            return (
                                <>
                                    <svg viewBox="0 0 36 36" style={{ width: 160, height: 160, transform: 'rotate(-90deg)', marginBottom: 16 }}>
                                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface3)" strokeWidth="3.2" />
                                        {groups.map((g, i) => {
                                            const pct = g.count / total;
                                            const dash = pct * circ;
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
                                    {groups.map(g => (
                                        <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, width: '100%', maxWidth: 200 }}>
                                            <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, flexShrink: 0 }} />
                                            <span style={{ flex: 1, fontSize: 11, color: 'var(--t1)' }}>{g.label}</span>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t2)' }}>
                                                {g.count.toLocaleString()} ({((g.count / total) * 100).toFixed(0)}%)
                                            </span>
                                        </div>
                                    ))}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </div>

            {/* Category breakdown */}
            {categories.length > 0 && (
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--purple)' }} />
                        Rating by Category
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>Category</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>Count</th>
                                <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--t3)', fontWeight: 500 }}>Avg Rating</th>
                                <th style={{ padding: '4px 8px' }} />
                            </tr>
                        </thead>
                        <tbody>
                            {categories.map(c => (
                                <tr key={c.category} style={{ borderBottom: '1px solid var(--surface3)' }}>
                                    <td style={{ padding: '6px 8px', color: 'var(--t1)', fontWeight: 500 }}>{c.category || 'Unknown'}</td>
                                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', textAlign: 'right', color: 'var(--t2)' }}>{c.count.toLocaleString()}</td>
                                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', textAlign: 'right', color: c.avgRating != null && c.avgRating >= 5 ? 'var(--green)' : c.avgRating != null && c.avgRating <= 2 ? 'var(--red)' : 'var(--amber)' }}>
                                        {c.avgRating?.toFixed(1) ?? '—'}
                                    </td>
                                    <td style={{ padding: '6px 8px' }}>
                                        <div style={{ background: 'var(--surface3)', borderRadius: 3, height: 6, width: 80 }}>
                                            <div style={{ width: `${((c.avgRating ?? 0) / 7) * 100}%`, height: 6, background: 'var(--amber)', borderRadius: 3 }} />
                                        </div>
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
