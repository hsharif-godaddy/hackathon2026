'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, BarChart2, RefreshCw, TrendingUp, Zap } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

interface RatingBucket { rating: number; count: number; pct: number; }
interface TopicEntry   { topic: string; count: number; }
interface AppEntry {
    appId: string; count: number; avgRating: number | null;
    issueCount: number; issueRate: number | null;
    negativeCount: number; passiveCount: number; positiveCount: number;
}
interface Signal { icon: React.ReactNode; color: string; bg: string; tag: string; headline: string; detail: string; }

const RC: readonly string[] = ['#EF4444','#F97316','#FACC15','#22C55E','#14B8A6','#3B82F6','#8B5CF6'];
const RATING_LABELS: Record<number, string> = {
    1:'Very Dissatisfied',2:'Dissatisfied',3:'Somewhat Dissatisfied',
    4:'Neutral',5:'Satisfied',6:'Very Satisfied',7:'Extremely Satisfied',
};
const TOPIC_COLORS: readonly string[] = ['#6366f1','#3b82f6','#22c55e','#f59e0b','#ef4444','#14b8a6','#f97316','#8b5cf6','#ec4899','#06b6d4'];
const UNKNOWN_IDS: ReadonlySet<string> = new Set(['__unknown__','unknown','','null','undefined']);

function fmt(n: number): string { return n.toLocaleString(); }
function pct(n: number, d: number): number { return d > 0 ? Math.round((n / d) * 100) : 0; }
function ratingColor(r: number | null): string {
    if (r == null) return 'var(--sp-txm)';
    return r >= 6 ? '#34D399' : r >= 4.5 ? '#F59E0B' : '#F4516C';
}
function npsColor(score: number): string { return score >= 40 ? '#34D399' : score >= 0 ? '#F5B014' : '#F4516C'; }
function isKnown(id: string): boolean { return !UNKNOWN_IDS.has(id.trim().toLowerCase()); }

function NpsBar({ pos, pas, neg }: { pos: number; pas: number; neg: number }) {
    const total: number = pos + pas + neg;
    if (total === 0) return <div style={{ height: 6, background: 'var(--sp-s2)', borderRadius: 3 }} />;
    return (
        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(pos / total) * 100}%`, background: '#34D399', minWidth: pos > 0 ? 2 : 0 }} />
            <div style={{ width: `${(pas / total) * 100}%`, background: '#475569', minWidth: pas > 0 ? 2 : 0 }} />
            <div style={{ width: `${(neg / total) * 100}%`, background: '#F4516C', minWidth: neg > 0 ? 2 : 0 }} />
        </div>
    );
}

// ── 1: Summary strip ──────────────────────────────────────────────────────────

function SummaryStrip({ ratings }: { ratings: RatingBucket[] }) {
    const total: number = ratings.reduce((s: number, r: RatingBucket) => s + r.count, 0);
    if (total === 0) return null;
    const avg: number   = ratings.reduce((s: number, r: RatingBucket) => s + r.rating * r.count, 0) / total;
    const prom: number  = ratings.filter((r: RatingBucket) => r.rating >= 6).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const pas: number   = ratings.filter((r: RatingBucket) => r.rating >= 4 && r.rating <= 5).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const det: number   = ratings.filter((r: RatingBucket) => r.rating <= 3).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const nps: number   = Math.round(prom - det);

    return (
        <div className={sp.card} style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 10 }}>
                {([
                    { lbl: 'NPS Score',   val: `${nps >= 0 ? '+' : ''}${nps}`, sub: 'promoters − detractors', col: npsColor(nps) },
                    { lbl: 'Avg Rating',  val: `${avg.toFixed(2)}★`,            sub: 'out of 7',              col: '#F59E0B' },
                    { lbl: 'Total Rated', val: fmt(total),                       sub: 'feedback items',        col: 'var(--sp-tx1)' },
                    { lbl: 'Promoters',   val: `${prom.toFixed(1)}%`,            sub: '6–7★',                 col: '#34D399' },
                    { lbl: 'Passives',    val: `${pas.toFixed(1)}%`,             sub: '4–5★',                 col: '#94a3b8' },
                    { lbl: 'Detractors',  val: `${det.toFixed(1)}%`,             sub: '1–3★',                 col: '#F4516C' },
                ] as { lbl: string; val: string; sub: string; col: string }[]).map((s: { lbl: string; val: string; sub: string; col: string }) => (
                    <div key={s.lbl} style={{ textAlign: 'center', padding: '10px 0' }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sp-txm)', fontWeight: 700, marginBottom: 3 }}>{s.lbl}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: s.col, lineHeight: 1 }}>{s.val}</div>
                        <div style={{ fontSize: 9, color: 'var(--sp-txm)', marginTop: 3 }}>{s.sub}</div>
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--sp-border)' }}>
                {ratings.map((r: RatingBucket) => (
                    <div key={r.rating} title={`${r.rating}★ · ${r.pct.toFixed(1)}%`}
                        style={{ flex: r.count, background: RC[r.rating - 1] ?? '#6b7280', minWidth: r.count > 0 ? 2 : 0 }} />
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                {ratings.map((r: RatingBucket) => (
                    <span key={r.rating} style={{ fontSize: 9, color: RC[r.rating - 1], fontFamily: 'var(--mono)' }}>{r.rating}★&nbsp;{r.pct.toFixed(0)}%</span>
                ))}
            </div>
        </div>
    );
}

// ── 2 & 3: Rating bars + NPS below + Topics on right ─────────────────────────

function RatingAndTopics({ ratings, topics, appId, onAppIdChange, topN, onTopNChange, loading }: {
    ratings: RatingBucket[]; topics: TopicEntry[];
    appId: string; onAppIdChange: (v: string) => void;
    topN: number; onTopNChange: (n: number) => void; loading: boolean;
}) {
    const prom: number = ratings.filter((r: RatingBucket) => r.rating >= 6).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const pas: number  = ratings.filter((r: RatingBucket) => r.rating >= 4 && r.rating <= 5).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const det: number  = ratings.filter((r: RatingBucket) => r.rating <= 3).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const nps: number  = Math.round(prom - det);
    const maxTopic: number = Math.max(...topics.map((t: TopicEntry) => t.count), 1);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            {/* Left: rating bars + NPS below */}
            <div className={sp.card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div className={sp.cardLabel}><span className={sp.cardDot} style={{ background: '#F59E0B' }} />Rating Distribution</div>
                    <input className={sp.searchInput} style={{ width: 160 }} placeholder="Filter by App ID…"
                        value={appId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onAppIdChange(e.target.value)} />
                </div>
                {loading ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>Loading…</div>
                    : ratings.length === 0 ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No data</div>
                    : ratings.map((r: RatingBucket) => {
                        const col: string = RC[r.rating - 1] ?? '#6b7280';
                        return (
                            <div key={r.rating} style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                                    <span style={{ color: col, fontWeight: 600 }}>{r.rating}★ — {RATING_LABELS[r.rating]}</span>
                                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--sp-tx2)' }}>{fmt(r.count)} · {r.pct.toFixed(1)}%</span>
                                </div>
                                <div style={{ background: 'var(--sp-s2)', borderRadius: 4, height: 9, overflow: 'hidden', border: '1px solid var(--sp-border)' }}>
                                    <div style={{ width: `${r.pct}%`, height: '100%', background: col, borderRadius: 4, boxShadow: `0 0 5px ${col}66`, transition: 'width .4s' }} />
                                </div>
                            </div>
                        );
                    })}
                {/* NPS below rating bars */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--sp-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 40, fontWeight: 700, lineHeight: 1, color: npsColor(nps) }}>{nps >= 0 ? '+' : ''}{nps}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-txm)', lineHeight: 1.4 }}>NPS score<br />Promoters − Detractors</div>
                    </div>
                    <div style={{ display: 'flex', height: 30, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--sp-border)', marginBottom: 6 }}>
                        <div style={{ flex: Math.max(prom, 0.5), background: 'linear-gradient(135deg,#34D399,#1E9E73)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#052e16' }}>{prom.toFixed(1)}%</span>
                            <span style={{ fontSize: 8, color: 'rgba(0,0,0,0.5)' }}>Promoters</span>
                        </div>
                        <div style={{ flex: Math.max(pas, 0.5), background: '#1e2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{pas.toFixed(1)}%</span>
                            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)' }}>Passives</span>
                        </div>
                        <div style={{ flex: Math.max(det, 0.5), background: 'linear-gradient(135deg,#F4516C,#c43350)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{det.toFixed(1)}%</span>
                            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.55)' }}>Detractors</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--sp-txm)' }}>
                        <span>6–7★ <span style={{ color: '#34D399' }}>Promoters</span></span>
                        <span>4–5★ <span style={{ color: '#94a3b8' }}>Passives</span></span>
                        <span>1–3★ <span style={{ color: '#F4516C' }}>Detractors</span></span>
                    </div>
                </div>
            </div>

            {/* Right: Top Topics */}
            <div className={sp.card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className={sp.cardLabel}><span className={sp.cardDot} style={{ background: '#3B82F6' }} />Top Topics</div>
                    <select value={topN} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onTopNChange(+e.target.value)} className={sp.select}>
                        <option value={10}>Top 10</option><option value={20}>Top 20</option><option value={50}>Top 50</option>
                    </select>
                </div>
                {loading ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>Loading…</div>
                    : topics.length === 0 ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No topic data</div>
                    : (
                        <>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingBottom: 12, borderBottom: '1px solid var(--sp-border)', marginBottom: 10 }}>
                                {topics.map((t: TopicEntry, i: number) => {
                                    const scale: number = 0.6 + (t.count / maxTopic) * 0.9;
                                    const col: string = TOPIC_COLORS[i % TOPIC_COLORS.length] ?? '#6366f1';
                                    return (
                                        <span key={t.topic} title={`${t.topic}: ${t.count}`} style={{
                                            fontSize: Math.round(10 * scale) + 2, fontWeight: scale > 1.1 ? 700 : 500,
                                            color: col, background: `${col}18`, borderRadius: 5, padding: '2px 7px', cursor: 'default', lineHeight: 1.6,
                                        }}>{t.topic}</span>
                                    );
                                })}
                            </div>
                            {topics.slice(0, topN > 10 ? 20 : 10).map((t: TopicEntry, i: number) => {
                                const col: string = TOPIC_COLORS[i % TOPIC_COLORS.length] ?? '#6366f1';
                                return (
                                    <div key={t.topic} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--sp-txm)', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                                        <span style={{ fontSize: 11.5, color: 'var(--sp-tx1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.topic}</span>
                                        <div style={{ width: 70, background: 'var(--sp-s2)', borderRadius: 3, height: 5, flexShrink: 0 }}>
                                            <div style={{ width: `${(t.count / maxTopic) * 100}%`, height: 5, background: col, borderRadius: 3 }} />
                                        </div>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--sp-tx2)', width: 28, textAlign: 'right', flexShrink: 0 }}>{t.count}</span>
                                    </div>
                                );
                            })}
                        </>
                    )}
            </div>
        </div>
    );
}

// ── 4: Problem Children + Promoters ──────────────────────────────────────────

function ProblemChildrenAndPromoters({ apps, loading }: { apps: AppEntry[]; loading: boolean }) {
    const [topN, setTopN] = useState<number>(10);
    const known: AppEntry[] = apps.filter((a: AppEntry) => isKnown(a.appId));
    const problems: AppEntry[] = [...known].filter((a: AppEntry) => a.negativeCount > 0).sort((a: AppEntry, b: AppEntry) => b.negativeCount - a.negativeCount).slice(0, topN);
    const promoters: AppEntry[] = [...known].filter((a: AppEntry) => a.positiveCount > 0).sort((a: AppEntry, b: AppEntry) => b.positiveCount - a.positiveCount).slice(0, topN);
    const maxNeg: number = Math.max(...problems.map((a: AppEntry) => a.negativeCount), 1);
    const maxPos: number = Math.max(...promoters.map((a: AppEntry) => a.positiveCount), 1);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className={sp.card} style={{ borderLeft: '3px solid #F4516C' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div className={sp.cardLabel}>
                        <AlertTriangle size={13} style={{ color: '#F4516C', flexShrink: 0 }} />
                        <span style={{ marginLeft: 5 }}>Top Problem Children — Most Detractors</span>
                    </div>
                    <select value={topN} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTopN(+e.target.value)} className={sp.select}>
                        {([5,10,15,20] as number[]).map((n: number) => <option key={n} value={n}>Top {n}</option>)}
                    </select>
                </div>
                {loading ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>Loading…</div>
                    : problems.length === 0 ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No data</div>
                    : problems.map((a: AppEntry, i: number) => {
                        const negRate: number = pct(a.negativeCount, a.count);
                        const sev: string = negRate >= 40 ? '#F4516C' : negRate >= 20 ? '#F97316' : '#FACC15';
                        return (
                            <div key={a.appId} style={{ marginBottom: 8, background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 9, padding: '9px 11px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                                    <div style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0, background: `${sev}22`, border: `1px solid ${sev}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: sev }}>#{i + 1}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sp-tx1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.appId}</div>
                                        <div style={{ fontSize: 9.5, color: 'var(--sp-txm)' }}>{fmt(a.count)} total · avg {a.avgRating?.toFixed(1) ?? '—'}★</div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: '#F4516C', lineHeight: 1 }}>{fmt(a.negativeCount)}</div>
                                        <div style={{ fontSize: 9, color: '#F4516C', opacity: 0.75 }}>1–3★ · {negRate}%</div>
                                    </div>
                                </div>
                                <div style={{ height: 5, background: 'var(--sp-s1)', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
                                    <div style={{ width: `${(a.negativeCount / maxNeg) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#F4516C,#c43350)', borderRadius: 3 }} />
                                </div>
                                <NpsBar pos={a.positiveCount} pas={a.passiveCount} neg={a.negativeCount} />
                            </div>
                        );
                    })}
            </div>
            <div className={sp.card} style={{ borderLeft: '3px solid #34D399' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div className={sp.cardLabel}>
                        <TrendingUp size={13} style={{ color: '#34D399', flexShrink: 0 }} />
                        <span style={{ marginLeft: 5 }}>Top Promoters — Delighted Customers</span>
                    </div>
                    <span style={{ fontSize: 9.5, color: 'var(--sp-txm)' }}>Top {topN}</span>
                </div>
                {loading ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>Loading…</div>
                    : promoters.length === 0 ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No data</div>
                    : promoters.map((a: AppEntry, i: number) => {
                        const posRate: number = pct(a.positiveCount, a.count);
                        const medal: string = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                        return (
                            <div key={a.appId} style={{ marginBottom: 8, background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 9, padding: '9px 11px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                                    <div style={{ width: 24, height: 24, borderRadius: 5, flexShrink: 0, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: i < 3 ? 13 : 10, fontFamily: 'var(--mono)', fontWeight: 700, color: '#34D399' }}>{medal}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--sp-tx1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.appId}</div>
                                        <div style={{ fontSize: 9.5, color: 'var(--sp-txm)' }}>{fmt(a.count)} total · avg {a.avgRating?.toFixed(1) ?? '—'}★</div>
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: '#34D399', lineHeight: 1 }}>{fmt(a.positiveCount)}</div>
                                        <div style={{ fontSize: 9, color: '#34D399', opacity: 0.8 }}>6–7★ · {posRate}%</div>
                                    </div>
                                </div>
                                <div style={{ height: 5, background: 'var(--sp-s1)', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
                                    <div style={{ width: `${(a.positiveCount / maxPos) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#34D399,#1E9E73)', borderRadius: 3 }} />
                                </div>
                                <NpsBar pos={a.positiveCount} pas={a.passiveCount} neg={a.negativeCount} />
                            </div>
                        );
                    })}
            </div>
        </div>
    );
}

// ── 5: App Leaderboard ────────────────────────────────────────────────────────

function AppLeaderboard({ apps, loading }: { apps: AppEntry[]; loading: boolean }) {
    const [topN, setTopN] = useState<number>(20);
    const ranked: AppEntry[] = apps.filter((a: AppEntry) => isKnown(a.appId) && a.avgRating != null).sort((a: AppEntry, b: AppEntry) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, topN);

    return (
        <div className={sp.card} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className={sp.cardLabel}><span className={sp.cardDot} style={{ background: '#3B82F6' }} />App Leaderboard — ranked by avg rating</div>
                <select value={topN} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTopN(+e.target.value)} className={sp.select}>
                    {([10,20,30,50] as number[]).map((n: number) => <option key={n} value={n}>Top {n}</option>)}
                </select>
            </div>
            {loading ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>Loading…</div>
                : ranked.length === 0 ? <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No data</div>
                : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
                        {ranked.map((a: AppEntry, i: number) => {
                            const col: string = ratingColor(a.avgRating);
                            const npsScore: number = pct(a.positiveCount, a.positiveCount + a.negativeCount) - pct(a.negativeCount, a.positiveCount + a.negativeCount);
                            return (
                                <div key={a.appId} style={{ background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderLeft: `3px solid ${col}`, borderRadius: 9, padding: '9px 11px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700, color: '#fff', background: col, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>#{i + 1}</span>
                                        <span style={{ fontSize: 11, color: 'var(--sp-tx1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{a.appId}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700, color: col, flexShrink: 0 }}>{a.avgRating?.toFixed(1)}★</span>
                                    </div>
                                    <NpsBar pos={a.positiveCount} pas={a.passiveCount} neg={a.negativeCount} />
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--sp-txm)', marginTop: 4 }}>
                                        <span>{fmt(a.count)} · {fmt(a.issueCount)} issues</span>
                                        <span style={{ color: npsColor(npsScore) }}>NPS {npsScore >= 0 ? '+' : ''}{npsScore}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
        </div>
    );
}

// ── 6: Pattern Signals ────────────────────────────────────────────────────────

function PatternSignals({ apps, ratings, loading }: { apps: AppEntry[]; ratings: RatingBucket[]; loading: boolean }) {
    if (loading) return null;
    const known: AppEntry[] = apps.filter((a: AppEntry) => isKnown(a.appId) && a.count >= 5);
    const signals: Signal[] = [];

    const bimodal: AppEntry | undefined = [...known].filter((a: AppEntry) => a.positiveCount > 0 && a.negativeCount > 0).sort((a: AppEntry, b: AppEntry) => {
        const sA: number = (a.positiveCount / a.count) * (a.negativeCount / a.count);
        const sB: number = (b.positiveCount / b.count) * (b.negativeCount / b.count);
        return sB - sA;
    })[0];
    if (bimodal) signals.push({ icon: <BarChart2 size={13} />, color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', tag: 'Bimodal', headline: `${bimodal.appId} divides opinion`, detail: `${pct(bimodal.positiveCount, bimodal.count)}% promoters and ${pct(bimodal.negativeCount, bimodal.count)}% detractors — the average hides two distinct user groups.` });

    const highIssue: AppEntry | undefined = [...known].filter((a: AppEntry) => (a.issueRate ?? 0) >= 15).sort((a: AppEntry, b: AppEntry) => (b.issueRate ?? 0) - (a.issueRate ?? 0))[0];
    if (highIssue) signals.push({ icon: <AlertTriangle size={13} />, color: '#F4516C', bg: 'rgba(244,81,108,0.08)', tag: 'Bug Cluster', headline: `${highIssue.appId} has elevated bug reports`, detail: `${highIssue.issueRate?.toFixed(1) ?? 0}% issue rate — ${fmt(highIssue.issueCount)} bugs in ${fmt(highIssue.count)} responses. Investigate recent deploys.` });

    const totalRated: number = ratings.reduce((s: number, r: RatingBucket) => s + r.count, 0);
    const top7: number = totalRated > 0 ? ((ratings.find((r: RatingBucket) => r.rating === 7)?.count ?? 0) / totalRated) * 100 : 0;
    const bot2: number = totalRated > 0 ? (ratings.filter((r: RatingBucket) => r.rating <= 2).reduce((s: number, r: RatingBucket) => s + r.count, 0) / totalRated) * 100 : 0;
    if (top7 > 50) signals.push({ icon: <TrendingUp size={13} />, color: '#34D399', bg: 'rgba(52,211,153,0.08)', tag: 'Ceiling Effect', headline: `${top7.toFixed(1)}% of all ratings are 7★`, detail: 'Strong ceiling effect — the 7★ mode dominates. The scale may not capture enough nuance at the top end.' });
    else if (bot2 > 20) signals.push({ icon: <AlertTriangle size={13} />, color: '#F4516C', bg: 'rgba(244,81,108,0.08)', tag: 'Floor Risk', headline: `${bot2.toFixed(1)}% of ratings are 1–2★`, detail: 'Significant detractor mass. Check the Problem Children section above and triage the top apps immediately.' });

    const best: AppEntry | undefined  = [...known].sort((a: AppEntry, b: AppEntry) => (b.positiveCount / Math.max(b.count, 1)) - (a.positiveCount / Math.max(a.count, 1)))[0];
    const worst: AppEntry | undefined = [...known].filter((a: AppEntry) => a.count >= 10).sort((a: AppEntry, b: AppEntry) => (a.positiveCount / Math.max(a.count, 1)) - (b.positiveCount / Math.max(b.count, 1)))[0];
    if (best && worst && best.appId !== worst.appId) {
        const gap: number = pct(best.positiveCount, best.count) - pct(worst.positiveCount, worst.count);
        if (gap > 40) signals.push({ icon: <Zap size={13} />, color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)', tag: 'Promoter Gap', headline: `${gap}pt spread in promoter rate across apps`, detail: `${best.appId} at ${pct(best.positiveCount, best.count)}% vs ${worst.appId} at ${pct(worst.positiveCount, worst.count)}%. Study the top performer for replicable UX patterns.` });
    }

    if (signals.length === 0) return null;
    return (
        <div className={sp.card} style={{ marginBottom: 0 }}>
            <div className={sp.cardLabel} style={{ marginBottom: 12 }}>
                <Zap size={13} style={{ color: '#8B5CF6', flexShrink: 0 }} /><span style={{ marginLeft: 5 }}>Deep Pattern Signals</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {signals.map((s: Signal, i: number) => (
                    <div key={i} style={{ background: s.bg, border: '1px solid var(--sp-border)', borderLeft: `3px solid ${s.color}`, borderRadius: 10, padding: '12px 13px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                            <span style={{ color: s.color }}>{s.icon}</span>
                            <span style={{ fontSize: 9, letterSpacing: '0.1em', fontWeight: 800, textTransform: 'uppercase', color: s.color }}>{s.tag}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--sp-tx1)', lineHeight: 1.25, marginBottom: 5 }}>{s.headline}</div>
                        <div style={{ fontSize: 11, color: 'var(--sp-tx2)', lineHeight: 1.5 }}>{s.detail}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FeedbackRatingsPanel() {
    const [ratings, setRatings] = useState<RatingBucket[]>([]);
    const [topics, setTopics]   = useState<TopicEntry[]>([]);
    const [apps, setApps]       = useState<AppEntry[]>([]);
    const [appId, setAppId]     = useState<string>('');
    const [topN, setTopN]       = useState<number>(20);
    const [loading, setLoading] = useState<boolean>(true);

    async function load(id: string, n: number): Promise<void> {
        setLoading(true);
        const params: URLSearchParams = new URLSearchParams();
        if (id) params.set('app_id', id);
        const [ratRes, topRes]: [Response, Response] = await Promise.all([
            fetch(`/api/supportplane/feedback/ratings?${params}`),
            fetch(`/api/supportplane/feedback/topics?top=${n}`),
        ]);
        if (ratRes.ok) {
            const d = await ratRes.json() as { ratings: RatingBucket[] };
            setRatings(d.ratings ?? []);
        }
        if (topRes.ok) {
            const d = await topRes.json() as { topics: TopicEntry[]; apps: AppEntry[] };
            setTopics(d.topics ?? []);
            setApps(d.apps ?? []);
        }
        setLoading(false);
    }

    useEffect(() => { void load(appId, topN); }, [appId, topN]);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Feedback Deep Dive</div>
                    <div className={sp.panelSub}>NPS · rating distribution · topics · problem children · promoters · leaderboard · pattern signals</div>
                </div>
                <button className={sp.btnSecondary} onClick={() => void load(appId, topN)} disabled={loading}>
                    <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                </button>
            </div>
            <SummaryStrip ratings={ratings} />
            <RatingAndTopics ratings={ratings} topics={topics} appId={appId} onAppIdChange={setAppId} topN={topN} onTopNChange={setTopN} loading={loading} />
            <ProblemChildrenAndPromoters apps={apps} loading={loading} />
            <AppLeaderboard apps={apps} loading={loading} />
            <PatternSignals apps={apps} ratings={ratings} loading={loading} />
        </div>
    );
}
