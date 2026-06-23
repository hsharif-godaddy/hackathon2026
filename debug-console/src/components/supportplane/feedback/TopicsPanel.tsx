'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

interface TopicEntry { topic: string; count: number; }
interface AppEntry { appId: string; count: number; avgRating: number | null; }

const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4'];

export default function FeedbackTopicsPanel() {
    const [topics, setTopics] = useState<TopicEntry[]>([]);
    const [apps, setApps] = useState<AppEntry[]>([]);
    const [topN, setTopN] = useState(20);
    const [loading, setLoading] = useState(true);

    async function load() {
        setLoading(true);
        const res = await fetch(`/api/supportplane/feedback/topics?top=${topN}`);
        if (res.ok) {
            const d = await res.json();
            setTopics(d.topics ?? []);
            setApps(d.apps ?? []);
        }
        setLoading(false);
    }

    useEffect(() => { load(); }, [topN]);

    const maxTopic = Math.max(...topics.map(t => t.count), 1);
    const maxApp = Math.max(...apps.map(a => a.count), 1);

    return (
        <div className={sp.panelRoot}>
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Topic Analysis</div>
                    <div className={sp.panelSub}>Most frequent feedback topics and app leaderboard</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={topN} onChange={e => setTopN(+e.target.value)} className={sp.select}>
                        <option value={10}>Top 10</option>
                        <option value={20}>Top 20</option>
                        <option value={50}>Top 50</option>
                    </select>
                    <button className={sp.btnSecondary} onClick={load} disabled={loading}>
                        <RefreshCw size={13} className={loading ? sp.spin : ''} /> Refresh
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* Topics */}
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--blue)' }} />
                        Top {topN} Topics (tag cloud)
                    </div>
                    {loading ? (
                        <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>Loading…</div>
                    ) : topics.length === 0 ? (
                        <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>No topic data</div>
                    ) : (
                        <>
                            {/* Tag cloud */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 0', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
                                {topics.map((t, i) => {
                                    const scale = 0.6 + (t.count / maxTopic) * 0.9;
                                    return (
                                        <span key={t.topic} title={`${t.topic}: ${t.count}`} style={{
                                            fontSize: Math.round(10 * scale) + 2,
                                            fontWeight: scale > 1.1 ? 700 : 500,
                                            color: COLORS[i % COLORS.length],
                                            background: `${COLORS[i % COLORS.length]}18`,
                                            borderRadius: 5,
                                            padding: '2px 8px',
                                            cursor: 'default',
                                            lineHeight: 1.6,
                                        }}>
                                            {t.topic}
                                        </span>
                                    );
                                })}
                            </div>
                            {/* Bar list */}
                            <div>
                                {topics.slice(0, 10).map((t, i) => (
                                    <div key={t.topic} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)', width: 18, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                                        <span style={{ fontSize: 11, color: 'var(--t1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.topic}</span>
                                        <div style={{ width: 80, background: 'var(--surface3)', borderRadius: 3, height: 6, flexShrink: 0 }}>
                                            <div style={{ width: `${(t.count / maxTopic) * 100}%`, height: 6, background: COLORS[i % COLORS.length], borderRadius: 3 }} />
                                        </div>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t2)', width: 32, textAlign: 'right', flexShrink: 0 }}>{t.count}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* App leaderboard */}
                <div className={sp.card}>
                    <div className={sp.cardLabel}>
                        <span className={sp.cardDot} style={{ background: 'var(--purple)' }} />
                        App Leaderboard (by feedback volume)
                    </div>
                    {loading ? (
                        <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>Loading…</div>
                    ) : apps.length === 0 ? (
                        <div style={{ color: 'var(--t3)', fontSize: 12, paddingTop: 10 }}>No app data</div>
                    ) : (
                        <div style={{ paddingTop: 8 }}>
                            {apps.slice(0, 15).map((a, i) => (
                                <div key={a.appId} style={{ marginBottom: 9 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                                        <span style={{
                                            fontFamily: 'var(--mono)', fontSize: 10, color: '#fff',
                                            background: COLORS[i % COLORS.length],
                                            borderRadius: 4, padding: '1px 5px',
                                            flexShrink: 0, minWidth: 20, textAlign: 'center',
                                        }}>{i + 1}</span>
                                        <span style={{ fontSize: 11, color: 'var(--t1)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.appId}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--amber)', flexShrink: 0 }}>
                                            {a.avgRating?.toFixed(1) ?? '—'}★
                                        </span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t2)', flexShrink: 0, minWidth: 36, textAlign: 'right' }}>
                                            {a.count.toLocaleString()}
                                        </span>
                                    </div>
                                    <div style={{ marginLeft: 28, background: 'var(--surface3)', borderRadius: 3, height: 5 }}>
                                        <div style={{ width: `${(a.count / maxApp) * 100}%`, height: 5, background: COLORS[i % COLORS.length], borderRadius: 3 }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
