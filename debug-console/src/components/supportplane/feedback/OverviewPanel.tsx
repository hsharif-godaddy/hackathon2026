'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, CloudDownload, Zap } from 'lucide-react';

import sp from '@/components/supportplane/sp.module.css';
import { WaveDots } from '@/components/supportplane/WaveDots';
import type { PanelId } from '@/components/supportplane/types';

// ── Types ────────────────────────────────────────────────────────────────────

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

interface Coverage {
    earliest: string | null;
    latest: string | null;
    totalRows: number;
    bothRows: number;
    s3OnlyRows: number;
    athenaRows: number;
    rawS3Total: number;
    rawAthenaTotal: number;
}

interface Ingestion { lastSync: string | null; totalRows: number; }

interface TrendPoint {
    date: string;
    count: number;
    avgRating: number | null;
    issueCount: number;
    supportCount: number;
    feedbackCount: number;
}

interface RatingBucket { rating: number; count: number; pct: number; }

// ── Constants ────────────────────────────────────────────────────────────────

// VIBGYOR: 1=red → 7=violet
const RATING_COLORS: readonly string[] = ['#EF4444', '#F97316', '#FACC15', '#22C55E', '#14B8A6', '#3B82F6', '#8B5CF6'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string { return n.toLocaleString(); }

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }); }
    catch { return iso; }
}

function shadeHex(hex: string, amt: number): string {
    const c = hex.replace('#', '').padEnd(6, '0');
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    const f = (v: number): number => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

// ── KPI band ─────────────────────────────────────────────────────────────────

function KpiBand({
    total, withFeedback, silent, avgRating, feedbackRate,
}: {
    total: number; withFeedback: number; silent: number;
    avgRating: number | null; feedbackRate: number;
}) {
    const wfPct: number = total > 0 ? (withFeedback / total) * 100 : 0;

    return (
        <div className={sp.card} style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', borderBottom: '1px solid var(--sp-border)', paddingBottom: 16, marginBottom: 14 }}>
                {/* Total records */}
                <div style={{ paddingRight: 20 }}>
                    <div style={{ fontSize: 42, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--sp-tx1)', lineHeight: 1, letterSpacing: '-0.02em' }}>{fmt(total)}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx2)', marginTop: 6 }}>Total records</div>
                    <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>enriched · S3 ∪ Athena</div>
                </div>
                {/* Avg rating — no WoW delta here; deltas live in WoW / MoM tabs */}
                <div style={{ borderLeft: '1px solid var(--sp-border)', paddingLeft: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                        <span style={{ fontSize: 42, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--sp-tx1)', lineHeight: 1, letterSpacing: '-0.02em' }}>
                            {avgRating != null ? avgRating.toFixed(1) : '—'}
                        </span>
                        <span style={{ fontSize: 16, color: 'var(--sp-txm)', fontFamily: 'var(--mono)' }}>/7</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx2)', marginTop: 10 }}>Avg rating</div>
                    <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>1–7 scale · all time</div>
                </div>
                {/* With feedback */}
                <div style={{ borderLeft: '1px solid var(--sp-border)', paddingLeft: 20 }}>
                    <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'var(--mono)', color: '#34d399', lineHeight: 1 }}>{fmt(withFeedback)}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx2)', marginTop: 8 }}>With feedback</div>
                    <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>has category or rating</div>
                </div>
                {/* Silent */}
                <div style={{ borderLeft: '1px solid var(--sp-border)', paddingLeft: 20 }}>
                    <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'var(--mono)', color: '#f4516c', lineHeight: 1 }}>{fmt(silent)}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx2)', marginTop: 8 }}>Silent records</div>
                    <div style={{ fontSize: 11, color: 'rgba(244,81,108,0.7)' }}>no feedback submitted</div>
                </div>
                {/* Feedback rate */}
                <div style={{ borderLeft: '1px solid var(--sp-border)', paddingLeft: 20 }}>
                    <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--sp-tx1)', lineHeight: 1 }}>{feedbackRate.toFixed(1)}%</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx2)', marginTop: 8 }}>Feedback rate</div>
                    <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>records carrying user input</div>
                </div>
            </div>
            {/* Split bar */}
            <div style={{ display: 'flex', height: 30, borderRadius: 8, overflow: 'hidden', gap: 2 }}>
                <div style={{
                    flex: wfPct, background: 'linear-gradient(90deg, #0e9f6e, #34d399)',
                    display: 'flex', alignItems: 'center', paddingLeft: 12, minWidth: 0,
                }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        With feedback · {wfPct.toFixed(1)}%
                    </span>
                </div>
                <div style={{
                    flex: 100 - wfPct,
                    background: 'repeating-linear-gradient(135deg, rgba(244,81,108,.18), rgba(244,81,108,.18) 9px, rgba(244,81,108,.08) 9px, rgba(244,81,108,.08) 18px)',
                    border: '1px solid rgba(244,81,108,.3)', borderRadius: '0 8px 8px 0',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 12, minWidth: 0,
                }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#ffd7df', whiteSpace: 'nowrap' }}>
                        Silent · {(100 - wfPct).toFixed(1)}%
                    </span>
                </div>
            </div>
        </div>
    );
}

// ── Intelligence cards ────────────────────────────────────────────────────────

type InsightLevel = 'high' | 'warn' | 'info';

interface Insight {
    level: InsightLevel;
    tag: string;
    headline: string;
    why: string;
    action: string;
}

function buildInsights(summary: Summary, totalRows: number, withFeedback: number, ratings: RatingBucket[]): Insight[] {
    const silent: number = totalRows - withFeedback;
    const silentPct: number = totalRows > 0 ? Math.round((silent / totalRows) * 100) : 0;
    const avgR: number = summary.avgRating ?? 0;
    const sosPct: number = totalRows > 0 ? Math.round((summary.supportCount / totalRows) * 100) : 0;
    const r7: RatingBucket | undefined = ratings.find(r => r.rating === 7);
    const r1r2: number = (ratings.find(r => r.rating === 1)?.pct ?? 0) + (ratings.find(r => r.rating === 2)?.pct ?? 0);
    const bimodal: boolean = (r7?.pct ?? 0) > 40 && r1r2 > 10;

    const insights: Insight[] = [];

    if (silentPct > 30) {
        insights.push({
            level: 'high', tag: '● Activation gap',
            headline: 'A silent majority.',
            why: `${fmt(silent)} of ${fmt(totalRows)} records (${silentPct}%) carry usage data with no rating or category — signal not being captured.`,
            action: 'Instrument feedback prompts in GoCaaS & SharePoint flows',
        });
    }

    if (bimodal) {
        insights.push({
            level: 'warn', tag: '▲ Distribution',
            headline: 'Bimodal, not average.',
            why: `${r7?.pct ?? 0}% rated 7★ while ${r1r2}% sit at 1–2★. The ${avgR.toFixed(1)} mean masks two distinct populations.`,
            action: 'Segment detractors before trusting the average',
        });
    }

    if (summary.negativeCount > summary.neutralCount) {
        insights.push({
            level: 'warn', tag: '▲ Sentiment',
            headline: 'Negatives outweigh neutrals.',
            why: `${fmt(summary.negativeCount)} negative vs ${fmt(summary.neutralCount)} neutral — the middle ground is eroding toward the bottom.`,
            action: 'Route 1–2★ ratings to Deep Dive clustering',
        });
    }

    const sosFine: boolean = sosPct < 4;
    insights.push({
        level: sosFine ? 'info' : 'warn', tag: sosFine ? '● Escalations' : '▲ Escalations',
        headline: sosFine ? 'SOS holding steady.' : 'SOS rate elevated.',
        why: `${fmt(summary.supportCount)} SOS & ${fmt(summary.issueCount)} bugs recorded this range — ${sosPct}% of total records.`,
        action: sosFine ? 'Hold; alert if SOS exceeds 4% week-over-week' : 'Investigate SOS surge — check recent topic clusters',
    });

    while (insights.length < 4) {
        insights.push({
            level: 'info', tag: '● Apps',
            headline: `${fmt(summary.uniqueApps)} apps reported feedback.`,
            why: `Feedback spans ${fmt(summary.uniqueApps)} unique applications in this date range.`,
            action: 'Check Rating Analysis for per-app leaderboard',
        });
    }

    return insights.slice(0, 4);
}

function InsightCards({ insights, onNav }: { insights: Insight[]; onNav?: (id: PanelId) => void }) {
    const borderColor: Record<InsightLevel, string> = { high: '#f4516c', warn: '#f5b014', info: '#2dd4bf' };
    const tagColor: Record<InsightLevel, string> = { high: '#ff8aa0', warn: '#f6c452', info: '#7fe6d8' };
    const bgGrad: Record<InsightLevel, string> = {
        high: 'linear-gradient(180deg, rgba(244,81,108,0.07), var(--sp-s1))',
        warn: 'linear-gradient(180deg, rgba(245,176,20,0.05), var(--sp-s1))',
        info: 'linear-gradient(180deg, rgba(45,212,191,0.05), var(--sp-s1))',
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
            {insights.map((ins, i) => (
                <div key={i} style={{
                    background: bgGrad[ins.level],
                    border: '1px solid var(--sp-border)',
                    borderLeft: `3px solid ${borderColor[ins.level]}`,
                    borderRadius: 11, padding: '13px 14px',
                    display: 'flex', flexDirection: 'column', gap: 7,
                }}>
                    <div style={{ fontSize: 9.5, letterSpacing: '0.12em', fontWeight: 800, textTransform: 'uppercase', color: tagColor[ins.level] }}>{ins.tag}</div>
                    <div style={{ fontSize: 14.5, fontWeight: 650, lineHeight: 1.25, letterSpacing: '-0.01em', color: 'var(--sp-tx1)' }}>{ins.headline}</div>
                    <div style={{ fontSize: 12, color: 'var(--sp-tx2)', lineHeight: 1.45 }}>{ins.why}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--sp-txm)', marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed var(--sp-border)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <span>→</span>
                        <button onClick={() => onNav?.('feedback-ratings')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--sp-accent)', fontWeight: 600, textAlign: 'left', fontSize: 'inherit' }}>
                            {ins.action}
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── 3-D SVG helpers (shared by StairDonut3D and CategoryDonut3D) ─────────────

const ISO = 0.40;   // y-squish — lower = more tilted / dramatic perspective
const SAMPLES = 3;  // degrees per arc point

function pt3D(deg: number, r: number, elev: number, cx: number, cy: number): [number, number] {
    const a: number = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a) * ISO - elev];
}

function arcPts(a0: number, a1: number, r: number, elev: number, cx: number, cy: number): [number, number][] {
    const out: [number, number][] = [];
    const step: number = a0 <= a1 ? SAMPLES : -SAMPLES;
    for (let a: number = a0; step > 0 ? a <= a1 : a >= a1; a += step) {
        out.push(pt3D(a, r, elev, cx, cy));
    }
    out.push(pt3D(a1, r, elev, cx, cy));
    return out;
}

function toPath(pts: [number, number][]): string {
    return 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L') + ' Z';
}

// ── 3-D Stair donut (VIBGYOR 1★→7★) ─────────────────────────────────────────

function StairDonut3D({ ratings, totalRated }: { ratings: RatingBucket[]; totalRated: number }) {
    const CX = 260; const CY = 210;
    const INNER_R = 90; const OUTER_R = 175;
    const BASE_ELEV = 12; const STEP_H = 11;
    // Start at 135° so lower ratings face the back-left and high-elevation
    // segments (7★ violet) wrap into the front-right of the perspective view
    const START_DEG = 135;

    type Seg = { rating: number; color: string; a0: number; a1: number; mid: number; elev: number };
    const segs: Seg[] = [];
    let acc: number = START_DEG;
    for (const r of ratings) {
        const sweep: number = (r.count / Math.max(totalRated, 1)) * 360;
        const elev: number = BASE_ELEV + (r.rating - 1) * STEP_H;
        segs.push({ rating: r.rating, color: RATING_COLORS[r.rating - 1] ?? '#6b7280', a0: acc, a1: acc + sweep, mid: acc + sweep / 2, elev });
        acc += sweep;
    }

    // Painter's order: back first (sin < 0 = top of ellipse = farthest from viewer)
    const order: Seg[] = [...segs].sort((a, b) => Math.sin((a.mid * Math.PI) / 180) - Math.sin((b.mid * Math.PI) / 180));

    const faces: { d: string; fill: string }[] = order.flatMap(s => {
        const { color, a0, a1, elev } = s;
        const outerTop: [number, number][] = arcPts(a0, a1, OUTER_R, elev, CX, CY);
        const outerBot: [number, number][] = arcPts(a1, a0, OUTER_R, 0, CX, CY);
        const innerTop: [number, number][] = arcPts(a0, a1, INNER_R, elev, CX, CY);
        const innerBot: [number, number][] = arcPts(a1, a0, INNER_R, 0, CX, CY);
        const capA: [number, number][] = [pt3D(a0, INNER_R, elev, CX, CY), pt3D(a0, OUTER_R, elev, CX, CY), pt3D(a0, OUTER_R, 0, CX, CY), pt3D(a0, INNER_R, 0, CX, CY)];
        const capB: [number, number][] = [pt3D(a1, INNER_R, elev, CX, CY), pt3D(a1, OUTER_R, elev, CX, CY), pt3D(a1, OUTER_R, 0, CX, CY), pt3D(a1, INNER_R, 0, CX, CY)];
        return [
            { d: toPath([...outerTop, ...outerBot]),                fill: shadeHex(color, -0.42) },
            { d: toPath(capA),                                       fill: shadeHex(color, -0.26) },
            { d: toPath(capB),                                       fill: shadeHex(color, -0.32) },
            { d: toPath([...innerTop, ...innerBot]),                fill: shadeHex(color, -0.55) },
            { d: toPath([...outerTop, ...[...innerTop].reverse()]), fill: color },
        ];
    });

    return (
        <svg viewBox="0 0 520 390" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <ellipse cx={CX} cy={CY + 24} rx={OUTER_R * 0.95} ry={OUTER_R * ISO * 0.85}
                fill="rgba(0,0,0,0.5)" style={{ filter: 'blur(10px)' }} />
            {faces.map((f, i) => <path key={i} d={f.d} fill={f.fill} />)}
        </svg>
    );
}

// ── 3-D Category donut (flat, uniform height — like reference screenshots) ───

interface CatSlice { label: string; sub: string; count: number; color: string; }

function CategoryDonut3D({ slices, total }: { slices: CatSlice[]; total: number }) {
    const CX = 270; const CY = 200;
    const INNER_R = 85; const OUTER_R = 170;
    const ELEV = 38;   // uniform height — makes it look like a solid 3D cylinder ring
    const START_DEG = -90;

    type DSeg = { label: string; count: number; color: string; a0: number; a1: number; mid: number };
    const segs: DSeg[] = [];
    let acc: number = START_DEG;
    for (const s of slices) {
        if (s.count <= 0) continue;
        const sweep: number = (s.count / Math.max(total, 1)) * 360;
        segs.push({ label: s.label, count: s.count, color: s.color, a0: acc, a1: acc + sweep, mid: acc + sweep / 2 });
        acc += sweep;
    }

    const order: DSeg[] = [...segs].sort((a, b) => Math.sin((a.mid * Math.PI) / 180) - Math.sin((b.mid * Math.PI) / 180));

    const faces: { d: string; fill: string }[] = order.flatMap(s => {
        const { color, a0, a1 } = s;
        const outerTop: [number, number][] = arcPts(a0, a1, OUTER_R, ELEV, CX, CY);
        const outerBot: [number, number][] = arcPts(a1, a0, OUTER_R, 0, CX, CY);
        const innerTop: [number, number][] = arcPts(a0, a1, INNER_R, ELEV, CX, CY);
        const innerBot: [number, number][] = arcPts(a1, a0, INNER_R, 0, CX, CY);
        const capA: [number, number][] = [pt3D(a0, INNER_R, ELEV, CX, CY), pt3D(a0, OUTER_R, ELEV, CX, CY), pt3D(a0, OUTER_R, 0, CX, CY), pt3D(a0, INNER_R, 0, CX, CY)];
        const capB: [number, number][] = [pt3D(a1, INNER_R, ELEV, CX, CY), pt3D(a1, OUTER_R, ELEV, CX, CY), pt3D(a1, OUTER_R, 0, CX, CY), pt3D(a1, INNER_R, 0, CX, CY)];
        return [
            { d: toPath([...outerTop, ...outerBot]),                fill: shadeHex(color, -0.38) },
            { d: toPath(capA),                                       fill: shadeHex(color, -0.22) },
            { d: toPath(capB),                                       fill: shadeHex(color, -0.28) },
            { d: toPath([...innerTop, ...innerBot]),                fill: shadeHex(color, -0.52) },
            { d: toPath([...outerTop, ...[...innerTop].reverse()]), fill: color },
        ];
    });

    return (
        // Tightly cropped viewBox: donut lives at CX=270,CY=200. After cropping dead space:
        // x: 80–460 (380px), y: 58–310 (252px). Labels moved outside SVG to a legend row.
        <svg viewBox="80 58 380 252" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <ellipse cx={CX} cy={CY + 22} rx={OUTER_R * 0.9} ry={OUTER_R * ISO * 0.85}
                fill="rgba(0,0,0,0.45)" style={{ filter: 'blur(10px)' }} />
            {faces.map((f, i) => <path key={i} d={f.d} fill={f.fill} />)}
        </svg>
    );
}

// ── Sentiment heartbeat (avg rating over time) — full width ───────────────────

function PulseChart({ trends }: { trends: TrendPoint[] }) {
    const [hovIdx, setHovIdx] = useState<number | null>(null);

    const W: number = 1040;
    const H: number = 310;
    const PL: number = 36;
    const PR: number = 14;
    const PT: number = 8;
    const PB: number = 26;
    const chartH: number = H - PT - PB;
    const laneH: number = chartH / 7;

    if (trends.length < 2) {
        return <div style={{ fontSize: 12, color: 'var(--sp-txm)', padding: '20px 0' }}>Not enough daily data.</div>;
    }

    const sx = (i: number): number => PL + (i / Math.max(trends.length - 1, 1)) * (W - PL - PR);
    // Rating 7 at top, rating 1 at bottom — maps 1–7 into the chart height
    const sy = (v: number): number => PT + ((7 - v) / 7) * chartH;

    // Thin heartbeat spine connecting days that have data
    const linePts: string = trends
        .map((t, i) => (t.avgRating != null && t.avgRating > 0) ? `${sx(i).toFixed(1)},${sy(t.avgRating).toFixed(1)}` : null)
        .filter((p): p is string => p !== null)
        .join(' L');
    const lineD: string = linePts ? 'M' + linePts : '';

    // Overall average rating for the horizontal reference line
    const ratedTrends: TrendPoint[] = trends.filter(t => t.avgRating != null && t.avgRating > 0);
    const overallAvg: number = ratedTrends.length > 0
        ? ratedTrends.reduce((s, t) => s + (t.avgRating ?? 0), 0) / ratedTrends.length
        : 0;
    const avgY: number = overallAvg > 0 ? sy(overallAvg) : -1;

    const hovT: TrendPoint | undefined = hovIdx !== null ? trends[hovIdx] : undefined;

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
            {/* ── Swimlane bands: rating 7 at top → 1 at bottom ── */}
            {[7, 6, 5, 4, 3, 2, 1].map((r: number, idx: number) => {
                const color: string = RATING_COLORS[r - 1] ?? '#6b7280';
                const yTop: number = PT + idx * laneH;
                return (
                    <g key={r}>
                        <rect x={PL} y={yTop} width={W - PL - PR} height={laneH}
                            fill={color} fillOpacity={idx % 2 === 0 ? 0.055 : 0.025} />
                        <line x1={PL} y1={yTop} x2={W - PR} y2={yTop}
                            stroke={color} strokeOpacity={0.2} strokeWidth={0.6} />
                        <text x={PL - 5} y={yTop + laneH / 2 + 3.5}
                            fill={color} fontSize={9.5} fontFamily="monospace"
                            textAnchor="end" fontWeight="700">
                            {r}★
                        </text>
                    </g>
                );
            })}
            {/* Bottom edge of lane 1 */}
            <line x1={PL} y1={PT + 7 * laneH} x2={W - PR} y2={PT + 7 * laneH}
                stroke={RATING_COLORS[0]} strokeOpacity={0.2} strokeWidth={0.6} />

            {/* ── Heartbeat spine (dotted, bright) ── */}
            {lineD && (
                <path d={lineD} fill="none" stroke="rgba(255,255,255,0.45)"
                    strokeWidth={1.2} strokeDasharray="4 5"
                    strokeLinejoin="round" strokeLinecap="round" />
            )}

            {/* ── Average rating horizontal reference line ── */}
            {avgY > 0 && (
                <g>
                    <line x1={PL} y1={avgY} x2={W - PR} y2={avgY}
                        stroke="rgba(255,255,255,0.28)" strokeWidth={1}
                        strokeDasharray="6 4" />
                    <rect x={W - PR - 38} y={avgY - 9} width={38} height={14} rx={3}
                        fill="rgba(255,255,255,0.08)" />
                    <text x={W - PR - 4} y={avgY + 3.5} fill="rgba(255,255,255,0.55)"
                        fontSize={9} fontFamily="monospace" textAnchor="end" fontWeight="600">
                        {`avg ${overallAvg.toFixed(1)}★`}
                    </text>
                </g>
            )}

            {/* ── Per-day dots (small, bright) ── */}
            {trends.map((t: TrendPoint, i: number) => {
                if (t.avgRating == null || t.avgRating <= 0) return null;
                const x: number = sx(i);
                const y: number = sy(t.avgRating);
                const dotR: number = Math.min(7, Math.max(1, Math.round(t.avgRating)));
                const color: string = RATING_COLORS[dotR - 1] ?? '#6b7280';
                const isHov: boolean = hovIdx === i;
                return (
                    <g key={i}>
                        {/* Wide transparent hit area per column */}
                        <rect x={x - 7} y={PT} width={14} height={chartH}
                            fill="transparent" style={{ cursor: 'crosshair' }}
                            onMouseEnter={() => setHovIdx(i)}
                            onMouseLeave={() => setHovIdx(null)} />
                        {/* Outer glow pulse on hover */}
                        {isHov && <circle cx={x} cy={y} r={8} fill={color} fillOpacity={0.2} />}
                        {/* Dot — small normally, slightly bigger on hover */}
                        <circle cx={x} cy={y}
                            r={isHov ? 4 : 2}
                            fill={color}
                            stroke={isHov ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)'}
                            strokeWidth={isHov ? 1.5 : 0.6}
                            style={{ filter: `drop-shadow(0 0 ${isHov ? 5 : 2.5}px ${color})` }} />
                    </g>
                );
            })}

            {/* ── Hover tooltip ── */}
            {hovT != null && hovT.avgRating != null && hovIdx !== null && (() => {
                const x: number = sx(hovIdx);
                const y: number = sy(hovT.avgRating);
                const dotR: number = Math.min(7, Math.max(1, Math.round(hovT.avgRating)));
                const color: string = RATING_COLORS[dotR - 1] ?? '#6b7280';
                const TW: number = 168;
                const TH: number = 96;
                const tx: number = x + 16 + TW > W - PR ? x - TW - 12 : x + 16;
                const ty: number = Math.max(PT, Math.min(y - 24, H - PB - TH));
                return (
                    <g style={{ pointerEvents: 'none' }}>
                        {/* Vertical guide */}
                        <line x1={x} y1={PT} x2={x} y2={H - PB}
                            stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeDasharray="3 3" />
                        {/* Card */}
                        <rect x={tx} y={ty} width={TW} height={TH} rx={7}
                            fill="rgba(14,18,28,0.97)" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                        {/* Date */}
                        <text x={tx + 10} y={ty + 16} fill="#64748b" fontSize={9.5} fontFamily="monospace">
                            {hovT.date.slice(0, 10)}
                        </text>
                        {/* Avg rating */}
                        <circle cx={tx + 12} cy={ty + 30} r={4.5} fill={color} />
                        <text x={tx + 22} y={ty + 34} fill={color}
                            fontSize={14} fontFamily="monospace" fontWeight="bold">
                            {hovT.avgRating.toFixed(2)}★ avg
                        </text>
                        {/* Counts row 1 */}
                        <text x={tx + 10} y={ty + 52}
                            fill={hovT.feedbackCount > 0 ? '#94a3b8' : '#475569'}
                            fontSize={9.5} fontFamily="monospace">
                            {hovT.feedbackCount > 0 ? `💬 ${hovT.feedbackCount} feedback` : '💬 — pre-enrichment'}
                        </text>
                        {/* Counts row 2 */}
                        <text x={tx + 10} y={ty + 68} fill="#64748b" fontSize={9} fontFamily="monospace">
                            {`🐛 ${hovT.issueCount} issues · 🆘 ${hovT.supportCount} support`}
                        </text>
                        {/* Counts row 3 */}
                        <text x={tx + 10} y={ty + 83} fill="#475569" fontSize={9} fontFamily="monospace">
                            {`📋 ${hovT.count} total records`}
                        </text>
                    </g>
                );
            })()}

            {/* ── X-axis date labels ── */}
            {(['first', 'mid', 'last'] as const).map((pos: 'first' | 'mid' | 'last') => {
                const idx: number = pos === 'first' ? 0 : pos === 'mid' ? Math.floor(trends.length / 2) : trends.length - 1;
                const anchor: 'start' | 'middle' | 'end' = pos === 'first' ? 'start' : pos === 'mid' ? 'middle' : 'end';
                return (
                    <text key={pos} x={sx(idx)} y={H - 8} fill="#46566b"
                        fontSize={9} fontFamily="monospace" textAnchor={anchor}>
                        {trends[idx]?.date.slice(0, 10) ?? ''}
                    </text>
                );
            })}
        </svg>
    );
}

// ── Weekly stacked composite chart ────────────────────────────────────────────

type WeekMode = 'composite' | 'split' | 'ratings';

// The weekly trends API returns dates as 'YYYY-WNN' (e.g. '2025-W18').
// Given that string, extract the week number directly.
function isoWeek(dateStr: string): number {
    const m: RegExpMatchArray | null = dateStr.match(/^(\d{4})-W(\d{1,2})$/);
    if (m) return parseInt(m[2], 10);
    // Fallback: compute from a YYYY-MM-DD / ISO datetime string
    const clean: string = dateStr.slice(0, 10);
    const d: Date = new Date(clean + 'T00:00:00Z');
    if (isNaN(d.getTime())) return 0;
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const y: Date = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - y.getTime()) / 86400000) + 1) / 7);
}

// Convert 'YYYY-WNN' or 'YYYY-MM-DD' to "Apr 28 – May 4" week tenure.
function weekTenure(dateStr: string): string {
    const fmtD = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    const m: RegExpMatchArray | null = dateStr.match(/^(\d{4})-W(\d{1,2})$/);
    if (m) {
        const year: number = parseInt(m[1], 10);
        const week: number = parseInt(m[2], 10);
        // ISO week 1 is the week containing Jan 4. Find its Monday.
        const jan4: Date = new Date(Date.UTC(year, 0, 4));
        const dow: number = jan4.getUTCDay() || 7; // 1=Mon … 7=Sun
        const monday1: Date = new Date(jan4);
        monday1.setUTCDate(jan4.getUTCDate() - dow + 1);
        const start: Date = new Date(monday1);
        start.setUTCDate(monday1.getUTCDate() + (week - 1) * 7);
        const end: Date = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        return `${fmtD(start)} – ${fmtD(end)}`;
    }

    // Fallback: plain date string
    const clean: string = dateStr.slice(0, 10);
    const start: Date = new Date(clean + 'T00:00:00Z');
    if (isNaN(start.getTime())) return dateStr;
    const end: Date = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${fmtD(start)} – ${fmtD(end)}`;
}

function WeeklyChart({ trends: allTrends, silentRatio, ratings }: {
    trends: TrendPoint[]; silentRatio: number; ratings: RatingBucket[];
}) {
    const [mode, setMode] = useState<WeekMode>('ratings');
    const [hoveredBar, setHoveredBar] = useState<number | null>(null);

    // Filter to weeks from the first one that has actual feedback data (April 1+)
    const firstActiveIdx: number = allTrends.findIndex(t =>
        t.feedbackCount > 0 || t.issueCount > 0 || t.supportCount > 0
    );
    const trends: TrendPoint[] = firstActiveIdx >= 0 ? allTrends.slice(firstActiveIdx) : allTrends;

    if (!trends.length) return null;

    const W = 1060; const H = 400; const PL = 44; const PR = 16; const PT = 12; const PB = 36;
    const plotH: number = H - PT - PB;
    const plotW: number = W - PL - PR;
    const gap: number = plotW / trends.length;
    const bw: number = Math.min(48, gap * 0.65);

    const maxTotal: number = Math.max(...trends.map(t => {
        return t.count + Math.round(t.count * silentRatio);
    }), 1) * 1.1;

    const yScale = (v: number): number => plotH * (v / maxTotal);
    const sx = (i: number): number => PL + gap * i + (gap - bw) / 2;

    // Per-rating colors for the 'ratings' mode (VIBGYOR)
    const totalRated: number = ratings.reduce((s, r) => s + r.count, 0);
    const ratingFracs: number[] = ratings.map(r => totalRated > 0 ? r.count / totalRated : 0);

    const gridSteps = 4;
    const gridLines: number[] = Array.from({ length: gridSteps + 1 }, (_, i) => Math.round((maxTotal / gridSteps) * i));

    // Tooltip data
    const ht: TrendPoint | undefined = hoveredBar !== null ? trends[hoveredBar] : undefined;

    const modeSubtitle: string = mode === 'composite'
        ? 'Composite 4 stacks by category · muted cap = silent records (est.)'
        : mode === 'split'
            ? 'Green = with-feedback records · muted = silent (est.)'
            : 'Product feedback split by star rating (1★–7★ · estimated from overall distribution)';

    return (
        <div>
            {/* Header row: subtitle + toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--sp-txm)' }}>
                    Each bar = one week · from {trends[0]?.date ?? ''} · {trends.length} weeks shown.&ensp;{modeSubtitle}
                </div>
                <div style={{ display: 'flex', border: '1px solid var(--sp-border)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                    {([
                        ['ratings',   '★ Rating split'],
                        ['composite', 'Composite · 4 stacks'],
                        ['split',     'Feedback vs Silent'],
                    ] as [WeekMode, string][]).map(([m, label], mi) => (
                        <button key={m} onClick={() => setMode(m)} style={{
                            background: mode === m ? 'rgba(45,212,191,0.15)' : 'transparent',
                            color: mode === m ? '#cffaf2' : 'var(--sp-txm)',
                            border: 'none',
                            borderRight: mi < 2 ? '1px solid var(--sp-border)' : 'none',
                            fontFamily: 'inherit', fontSize: 11, padding: '5px 12px', cursor: 'pointer',
                        }}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* SVG chart */}
            <svg
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: '100%', height: 'auto', display: 'block' }}
                onMouseLeave={() => setHoveredBar(null)}
            >
                {/* Grid */}
                {gridLines.map(val => {
                    const y: number = PT + plotH - yScale(val);
                    return (
                        <g key={val}>
                            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="rgba(255,255,255,0.055)" />
                            <text x={PL - 8} y={y + 3} fill="#46566b" fontSize={10} fontFamily="monospace" textAnchor="end">{val.toLocaleString()}</text>
                        </g>
                    );
                })}

                {/* Bars */}
                {trends.map((t, i) => {
                    const x: number = sx(i);
                    const estSilent: number = Math.round(t.count * silentRatio);
                    const uncategorized: number = Math.max(0, t.count - t.feedbackCount - t.issueCount - t.supportCount);
                    const weekNum: number = isoWeek(t.date);

                    // Build stacks based on mode
                    const stacks: { v: number; color: string; silent?: boolean }[] = mode === 'composite' ? [
                        { v: t.feedbackCount, color: '#3b82f6' },
                        { v: t.issueCount,    color: '#ec4899' },
                        { v: t.supportCount,  color: '#f59e0b' },
                        { v: uncategorized,   color: '#6b7280' },
                        { v: estSilent,       color: 'rgba(148,163,184,0.22)', silent: true },
                    ] : mode === 'split' ? [
                        { v: t.count,    color: '#34d399' },
                        { v: estSilent,  color: 'rgba(148,163,184,0.22)', silent: true },
                    ] : [
                        // ratings mode: approximate per-star counts from feedbackCount × global distribution
                        ...ratingFracs.map((frac, ri) => ({
                            v: Math.round(t.feedbackCount * frac),
                            color: RATING_COLORS[ri] ?? '#6b7280',
                        })),
                        { v: t.issueCount + t.supportCount + uncategorized, color: '#6b7280' },
                        { v: estSilent, color: 'rgba(148,163,184,0.22)', silent: true },
                    ];

                    const isHovered: boolean = hoveredBar === i;
                    let yTop: number = PT + plotH;

                    return (
                        <g key={i}>
                            {/* Hover hit-area (transparent rect over the whole column) */}
                            <rect
                                x={x - 2} y={PT} width={bw + 4} height={plotH}
                                fill="transparent"
                                onMouseEnter={() => setHoveredBar(i)}
                            />
                            {/* Stacked bar segments */}
                            {stacks.map((s, si) => {
                                if (s.v <= 0) return null;
                                const h: number = yScale(s.v);
                                yTop -= h;
                                return (
                                    <rect key={si}
                                        x={x} y={yTop} width={bw} height={Math.max(0.5, h - 0.5)}
                                        fill={s.color} rx={1.5}
                                        opacity={isHovered ? 1 : 0.85}
                                        stroke={s.silent ? 'rgba(148,163,184,0.35)' : isHovered ? 'rgba(255,255,255,0.3)' : 'none'}
                                        strokeWidth={isHovered && !s.silent ? 0.8 : s.silent ? 0.8 : 0}
                                        strokeDasharray={s.silent ? '3 2' : '0'}
                                    />
                                );
                            })}
                            {/* X-axis label */}
                            <text x={x + bw / 2} y={H - 14} fill={isHovered ? '#94a3b8' : '#647488'} fontSize={10} textAnchor="middle" fontFamily="monospace">
                                W{weekNum}
                            </text>
                        </g>
                    );
                })}

                {/* Tooltip overlay */}
                {hoveredBar !== null && ht !== undefined && (() => {
                    const tx: number = sx(hoveredBar);
                    const estSilent: number = Math.round(ht.count * silentRatio);
                    const uncategorized: number = Math.max(0, ht.count - ht.feedbackCount - ht.issueCount - ht.supportCount);
                    const weekNum: number = isoWeek(ht.date);
                    const tenure: string = weekTenure(ht.date);

                    const rows: { label: string; value: number; color: string }[] = [
                        { label: '💬 Feedback', value: ht.feedbackCount, color: '#7fb4ff' },
                        { label: '🐛 Issues',   value: ht.issueCount,    color: '#ff8a8a' },
                        { label: '🆘 SOS',       value: ht.supportCount,  color: '#f59e0b' },
                        { label: '○ Uncat.',    value: uncategorized,    color: '#8b9ab0' },
                        { label: '◌ Silent',    value: estSilent,        color: '#64748b' },
                    ];

                    const TW = 200; const TH = 130;
                    // Position tooltip so it doesn't overflow right edge
                    const ttX: number = Math.min(tx - TW / 2 + bw / 2, W - PR - TW - 4);
                    const ttY: number = 16;

                    return (
                        <g style={{ pointerEvents: 'none' }}>
                            <rect x={ttX} y={ttY} width={TW} height={TH} rx={7} fill="#1a2233" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                            {/* Week # + date range */}
                            <text x={ttX + 10} y={ttY + 17} fill="#94a3b8" fontSize={10} fontWeight={700} fontFamily="monospace">W{weekNum}</text>
                            <text x={ttX + 36} y={ttY + 17} fill="#64748b" fontSize={9} fontFamily="monospace">{tenure}</text>
                            {/* Total */}
                            <text x={ttX + 10} y={ttY + 32} fill="#e2e8f0" fontSize={11} fontWeight={700} fontFamily="monospace">
                                Total {ht.count.toLocaleString()}
                            </text>
                            {/* Avg rating */}
                            {ht.avgRating != null && (
                                <text x={ttX + TW - 10} y={ttY + 32} fill="#f59e0b" fontSize={10} fontFamily="monospace" textAnchor="end">
                                    ★ {ht.avgRating.toFixed(1)}
                                </text>
                            )}
                            {/* Row breakdown */}
                            {rows.map((r, ri) => (
                                <g key={ri}>
                                    <circle cx={ttX + 16} cy={ttY + 46 + ri * 16} r={3.5} fill={r.color} />
                                    <text x={ttX + 26} y={ttY + 50 + ri * 16} fill="#94a3b8" fontSize={9.5} fontFamily="monospace">{r.label}</text>
                                    <text x={ttX + TW - 10} y={ttY + 50 + ri * 16} fill={r.color} fontSize={9.5} fontFamily="monospace" textAnchor="end" fontWeight={600}>{r.value.toLocaleString()}</text>
                                </g>
                            ))}
                        </g>
                    );
                })()}
            </svg>

            {/* Legend */}
            {(() => {
                const legendItems: { color: string; label: string }[] = mode === 'composite' ? [
                    { color: '#3b82f6', label: '💬 Product Feedback' },
                    { color: '#ec4899', label: '🐛 Issues / Bugs' },
                    { color: '#f59e0b', label: '🆘 SOS Support' },
                    { color: '#6b7280', label: '○ Uncategorized' },
                    { color: 'rgba(148,163,184,0.4)', label: '◌ Silent (est.)' },
                ] : mode === 'split' ? [
                    { color: '#34d399', label: '✓ With Feedback' },
                    { color: 'rgba(148,163,184,0.4)', label: '◌ Silent (est.)' },
                ] : [
                    ...RATING_COLORS.map((c, i) => ({ color: c, label: `${i + 1}★` })),
                    { color: '#6b7280', label: '○ Other' },
                    { color: 'rgba(148,163,184,0.4)', label: '◌ Silent (est.)' },
                ];
                return (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: 'var(--sp-tx2)' }}>
                        {legendItems.map(s => (
                            <span key={s.label} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                                <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block', flexShrink: 0 }} />
                                {s.label}
                            </span>
                        ))}
                        {mode === 'ratings' && (
                            <span style={{ color: 'var(--sp-txm)', fontSize: 10.5, marginLeft: 4 }}>
                                (★ counts estimated from global rating distribution × weekly feedback volume)
                            </span>
                        )}
                    </div>
                );
            })()}
        </div>
    );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FeedbackOverviewPanel({ onNav, onSync }: { onNav?: (id: PanelId) => void; onSync?: () => void }) {
    const [summary, setSummary]       = useState<Summary | null>(null);
    const [coverage, setCoverage]     = useState<Coverage | null>(null);
    const [ingestion, setIngestion]   = useState<Ingestion | null>(null);
    const [ratings, setRatings]       = useState<RatingBucket[]>([]);
    const [weekTrends, setWeekTrends] = useState<TrendPoint[]>([]);
    const [dayTrends, setDayTrends]   = useState<TrendPoint[]>([]);
    const [initialLoad, setInitialLoad] = useState<boolean>(true);
    const [refreshing, setRefreshing]   = useState<boolean>(false);
    const [error, setError]             = useState<string | null>(null);

    async function load(): Promise<void> {
        if (summary === null && coverage === null) setInitialLoad(true);
        setRefreshing(true);
        setError(null);
        const ctrl: AbortController = new AbortController();
        const tid: ReturnType<typeof setTimeout> = setTimeout(() => ctrl.abort(), 130_000);
        try {
            const [sumRes, ratRes, weekRes, dayRes] = await Promise.all([
                fetch('/api/supportplane/feedback/summary', { signal: ctrl.signal }),
                fetch('/api/supportplane/feedback/ratings', { signal: ctrl.signal }),
                fetch('/api/supportplane/feedback/trends?granularity=week&days=365', { signal: ctrl.signal }),
                fetch('/api/supportplane/feedback/trends?granularity=day&days=90', { signal: ctrl.signal }),
            ]);
            if (sumRes.ok) {
                const d = await sumRes.json() as { summary: Summary; ingestion: Ingestion; coverage: Coverage };
                setSummary(d.summary);
                setIngestion(d.ingestion);
                setCoverage(d.coverage ?? null);
            }
            if (ratRes.ok)  { const d = await ratRes.json()  as { ratings: RatingBucket[] };  setRatings(d.ratings ?? []); }
            if (weekRes.ok) { const d = await weekRes.json() as { trends: TrendPoint[] };      setWeekTrends(d.trends ?? []); }
            if (dayRes.ok)  { const d = await dayRes.json()  as { trends: TrendPoint[] };      setDayTrends(d.trends ?? []); }
        } catch (err: unknown) {
            const isAbort: boolean = err instanceof Error && err.name === 'AbortError';
            setError(isAbort ? 'Timed out — DynamoDB scan can be slow on cold start. Try refreshing.' : 'Failed to load feedback data');
        } finally {
            clearTimeout(tid);
            setInitialLoad(false);
            setRefreshing(false);
        }
    }

    useEffect(() => { void load(); }, []);

    const totalEnriched: number = coverage?.totalRows ?? 0;
    const tf: number = summary?.totalFeedback ?? 0;
    const withCategory: number = (summary?.feedbackCount ?? 0) + (summary?.issueCount ?? 0) + (summary?.supportCount ?? 0);
    const silent: number = Math.max(0, totalEnriched - withCategory);
    const feedbackRate: number = totalEnriched > 0 ? (withCategory / totalEnriched) * 100 : 0;
    const silentRatio: number = totalEnriched > 0 ? silent / totalEnriched : 0.5;
    const rated: number = (summary?.positiveCount ?? 0) + (summary?.negativeCount ?? 0) + (summary?.neutralCount ?? 0);
    const pct = (n: number): number => rated > 0 ? Math.round((n / rated) * 100) : 0;
    const posPct: number = pct(summary?.positiveCount ?? 0);
    const negPct: number = pct(summary?.negativeCount ?? 0);
    const neuPct: number = 100 - posPct - negPct;

    const insights: Insight[] = summary ? buildInsights(summary, totalEnriched, withCategory, ratings) : [];

    const catSlices: CatSlice[] = [
        { label: '💬 Feedback', sub: 'product feedback', count: summary?.feedbackCount ?? 0, color: '#3b82f6' },
        { label: '🆘 SOS',      sub: 'escalations',      count: summary?.supportCount  ?? 0, color: '#f59e0b' },
        { label: '🐛 Issues',   sub: 'bugs & defects',   count: summary?.issueCount    ?? 0, color: '#ec4899' },
        { label: '∅ Silent',    sub: 'no input',          count: silent,                      color: '#5b6b80' },
    ];

    return (
        <div className={sp.panelRoot}>
            {/* ── Header ── */}
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Feedback Intelligence — Overview</div>
                    <div className={sp.panelSub}>
                        {coverage ? (
                            <span style={{ color: 'var(--sp-accent)', fontWeight: 600 }}>
                                {fmtDate(coverage.earliest)} → {fmtDate(coverage.latest)}
                            </span>
                        ) : '—'}
                        {' '}· Last sync: {ingestion?.lastSync ? fmtDate(ingestion.lastSync) : 'never'}
                        {' '}· <span style={{ fontFamily: 'var(--mono)' }}>S3 ∪ Athena</span>, no duplicates
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className={sp.btnSecondary} onClick={() => void load()} disabled={refreshing}>
                        <RefreshCw size={13} className={refreshing ? sp.spin : ''} />
                        {refreshing ? 'Refreshing…' : 'Refresh'}
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

            {initialLoad ? (
                <div className={sp.emptyState} style={{ flexDirection: 'column', gap: 12 }}>
                    <WaveDots size={10} gap={7} />
                    <span style={{ fontSize: 12, color: 'var(--sp-txm)' }}>Loading feedback data…</span>
                </div>
            ) : tf === 0 ? (
                <div className={sp.emptyState}>
                    <CloudDownload size={32} style={{ marginBottom: 8, color: 'var(--sp-txm)' }} />
                    <div style={{ fontWeight: 600 }}>No feedback data loaded</div>
                    <div style={{ fontSize: 12, color: 'var(--sp-txm)', marginTop: 6, maxWidth: 420, lineHeight: 1.6 }}>
                        Go to <strong>Browse Data</strong> to sync from S3 / Athena.
                    </div>
                    <button className={sp.btnPrimary} style={{ marginTop: 14 }} onClick={() => onNav?.('feedback-browse')}>
                        <CloudDownload size={13} /> Open Data Source &amp; Sync
                    </button>
                </div>
            ) : (
                <div style={{ opacity: refreshing ? 0.55 : 1, transition: 'opacity 0.2s ease', pointerEvents: refreshing ? 'none' : 'auto' }}>

                    {/* ── 1: KPI band ── */}
                    <KpiBand total={totalEnriched} withFeedback={withCategory} silent={silent}
                        avgRating={summary?.avgRating ?? null} feedbackRate={feedbackRate} />

                    {/* ── 2: Intelligence cards ── */}
                    <InsightCards insights={insights} onNav={onNav} />

                    {/* ── 3: Sentiment & rating distribution (ABOVE analytics) ── */}
                    <div className={sp.card} style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: '#f59e0b' }} />
                                Sentiment &amp; rating distribution — 1★ to 7★
                            </div>
                            <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--sp-txm)' }}>
                                avg {summary?.avgRating?.toFixed(1) ?? '—'}/7 · {fmt(rated)} of {fmt(tf)} rated
                            </span>
                        </div>
                        {/* 2/3 stair donut | 1/3 rating legend */}
                        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, alignItems: 'flex-start' }}>
                            {/* Stair donut — takes 2/3 */}
                            <div>
                                <StairDonut3D ratings={ratings} totalRated={rated} />
                                <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--sp-txm)', marginTop: 2 }}>
                                    arc width = volume · step height = rating · VIBGYOR 1★ red → 7★ violet
                                </div>
                            </div>
                            {/* Rating legend bars — takes 2/5 */}
                            <div>
                                {/* 1★ at top → 7★ at bottom; bars right-aligned so positive fills right, red leaves space on right */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 13, marginBottom: 22 }}>
                                    {ratings.map(r => {
                                        const color: string = RATING_COLORS[r.rating - 1] ?? '#6b7280';
                                        const maxCount: number = Math.max(...ratings.map(x => x.count), 1);
                                        const barPct: number = (r.count / maxCount) * 100;
                                        return (
                                            <div key={r.rating} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 52px 32px', gap: 8, alignItems: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sp-tx2)' }}>
                                                    <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block', flexShrink: 0 }} />
                                                    {r.rating}★
                                                </div>
                                                {/* right-aligned bar: empty space on left, fill on right */}
                                                <div style={{ height: 7, borderRadius: 5, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', display: 'flex', justifyContent: 'flex-end' }}>
                                                    <div style={{ width: `${barPct}%`, height: '100%', borderRadius: 5, background: color }} />
                                                </div>
                                                <div style={{ fontFamily: 'var(--mono)', color: 'var(--sp-tx1)', textAlign: 'right', fontSize: 12 }}>{fmt(r.count)}</div>
                                                <div style={{ fontFamily: 'var(--mono)', color: 'var(--sp-txm)', textAlign: 'right', fontSize: 11 }}>{r.pct}%</div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Sentiment strip — negative left → positive right */}
                                <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--sp-border)', marginBottom: 14, display: 'flex' }}>
                                    <div style={{ flex: negPct, background: '#f4516c' }} />
                                    <div style={{ flex: neuPct, background: '#fb923c' }} />
                                    <div style={{ flex: posPct, background: '#34d399' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 11.5, color: 'var(--sp-tx2)', marginBottom: 28 }}>
                                    {[
                                        { color: '#f4516c', label: 'Negative 1–2★', v: summary?.negativeCount ?? 0, p: negPct },
                                        { color: '#fb923c', label: 'Neutral  3–4★', v: summary?.neutralCount  ?? 0, p: neuPct },
                                        { color: '#34d399', label: 'Positive 5–7★', v: summary?.positiveCount ?? 0, p: posPct },
                                    ].map(s => (
                                        <div key={s.label} style={{ display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
                                                <span style={{ color: s.color }}>{s.label}</span>
                                            </div>
                                            <span style={{ fontFamily: 'var(--mono)', color: s.color, fontSize: 12, fontWeight: 600 }}>{fmt(s.v)} · {s.p}%</span>
                                        </div>
                                    ))}
                                </div>

                                {/* NPS breakdown — Promoters 6–7★ · Passives 4–5★ · Detractors 1–3★ */}
                                {(() => {
                                    const npsPromoterPct: number = ratings.filter((r: RatingBucket) => r.rating >= 6).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
                                    const npsPassivePct: number  = ratings.filter((r: RatingBucket) => r.rating >= 4 && r.rating <= 5).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
                                    const npsDetractorPct: number = ratings.filter((r: RatingBucket) => r.rating <= 3).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
                                    const npsScore: number = Math.round(npsPromoterPct - npsDetractorPct);
                                    const npsColor: string = npsScore >= 40 ? '#34D399' : npsScore >= 0 ? '#F5B014' : '#F4516C';
                                    return (
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: 40, fontWeight: 700, lineHeight: 1, color: npsColor }}>
                                                    {npsScore >= 0 ? '+' : ''}{npsScore}
                                                </div>
                                                <div style={{ fontSize: 10.5, color: 'var(--sp-txm)', lineHeight: 1.3 }}>
                                                    NPS score<br />promoters − detractors
                                                </div>
                                            </div>
                                            {/* Stacked bar */}
                                            <div style={{ display: 'flex', height: 32, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--sp-border)', marginBottom: 8 }}>
                                                <div style={{ flex: Math.max(npsPromoterPct, 0.5), background: 'linear-gradient(135deg,#34D399,#1E9E73)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', minWidth: 0 }}>
                                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#05241a' }}>{npsPromoterPct.toFixed(1)}%</span>
                                                    <span style={{ fontSize: 8.5, color: 'rgba(0,0,0,0.5)' }}>Promoters</span>
                                                </div>
                                                <div style={{ flex: Math.max(npsPassivePct, 0.5), background: '#252f45', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', minWidth: 0 }}>
                                                    <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94a3b8' }}>{npsPassivePct.toFixed(1)}%</span>
                                                    <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.35)' }}>Passives</span>
                                                </div>
                                                <div style={{ flex: Math.max(npsDetractorPct, 0.5), background: 'linear-gradient(135deg,#F4516C,#c43350)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', minWidth: 0 }}>
                                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#fff' }}>{npsDetractorPct.toFixed(1)}%</span>
                                                    <span style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.55)' }}>Detractors</span>
                                                </div>
                                            </div>
                                            {/* Legend */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--sp-txm)', marginBottom: 10 }}>
                                                <span>6–7★ <span style={{ color: '#34D399' }}>Promoters</span></span>
                                                <span>4–5★ <span style={{ color: '#94a3b8' }}>Passives</span></span>
                                                <span>1–3★ <span style={{ color: '#F4516C' }}>Detractors</span></span>
                                            </div>
                                            {/* 3 mini cards */}
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
                                                {[
                                                    { lbl: 'Promoters', pct: npsPromoterPct, col: '#34D399', bg: 'rgba(52,211,153,0.09)' },
                                                    { lbl: 'Passives',  pct: npsPassivePct,  col: '#94a3b8', bg: 'rgba(148,163,184,0.07)' },
                                                    { lbl: 'Detractors',pct: npsDetractorPct,col: '#F4516C', bg: 'rgba(244,81,108,0.09)' },
                                                ].map((x: { lbl: string; pct: number; col: string; bg: string }) => (
                                                    <div key={x.lbl} style={{ background: x.bg, border: '1px solid var(--sp-border)', borderRadius: 9, padding: '8px 10px', textAlign: 'center' }}>
                                                        <div style={{ fontFamily: 'var(--mono)', fontSize: 17, fontWeight: 700, color: x.col }}>{x.pct.toFixed(1)}%</div>
                                                        <div style={{ fontSize: 9.5, color: 'var(--sp-txm)', marginTop: 2 }}>{x.lbl}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>

                    {/* ── 4: Sentiment heartbeat — full width ── */}
                    <div className={sp.card} style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: '#f4516c' }} />
                                Sentiment heartbeat — avg rating over last 90 days
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--sp-txm)' }}>daily granularity · 1★ – 7★ scale</span>
                        </div>
                        <PulseChart trends={dayTrends} />
                    </div>

                    {/* ── 5+6: Feedback breakdown (donut + analytics) — side by side 60/40 ── */}
                    <div className={sp.card} style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} style={{ background: '#8b5cf6' }} />
                                Feedback breakdown — by category &amp; type
                            </div>
                            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--sp-txm)' }}>
                                {fmt(withCategory)} categorized · {fmt(silent)} silent · {fmt(totalEnriched)} total
                            </span>
                        </div>

                        {/* 60 / 40 split */}
                        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 28, alignItems: 'flex-start' }}>

                            {/* ── Left 60%: 3D donut + legend chips below ── */}
                            <div>
                                <CategoryDonut3D slices={catSlices} total={totalEnriched} />

                                {/* Legend chips directly below the donut */}
                                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                                    {catSlices.map(c => {
                                        const pct: number = totalEnriched > 0 ? (c.count / totalEnriched) * 100 : 0;
                                        return (
                                            <div key={c.label} style={{
                                                display: 'flex', alignItems: 'center', gap: 7,
                                                padding: '6px 12px', borderRadius: 20,
                                                background: 'rgba(255,255,255,0.04)',
                                                border: `1px solid ${c.color}44`,
                                            }}>
                                                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color, display: 'inline-block', flexShrink: 0 }} />
                                                <span style={{ fontSize: 11.5, fontWeight: 600, color: c.color }}>{c.label}</span>
                                                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--sp-tx1)', fontWeight: 700 }}>{fmt(c.count)}</span>
                                                <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--sp-txm)' }}>{pct.toFixed(0)}%</span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Footnote */}
                                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--sp-txm)', display: 'flex', gap: 5, alignItems: 'flex-start' }}>
                                    <span style={{ color: '#f4516c', flexShrink: 0 }}>◆</span>
                                    <span>
                                        <strong style={{ color: '#f4516c' }}>Silent</strong> records ({(100 - feedbackRate).toFixed(1)}%) carry usage but no rating or category.
                                        The {feedbackRate.toFixed(1)}% feedback rate comes from the three real categories.
                                    </span>
                                </div>
                            </div>

                            {/* ── Right 40%: 6 analytics tiles in 2×3 grid ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                                {[
                                    { icon: '💬', label: 'Feedback', v: summary?.feedbackCount ?? 0, color: '#7fb4ff', sub: 'text or rating' },
                                    { icon: '▲',  label: 'Positive', v: summary?.positiveCount ?? 0, color: '#34d399', sub: `${posPct}% · 5–7★` },
                                    { icon: '🐛', label: 'Issues',   v: summary?.issueCount    ?? 0, color: '#ff8a8a', sub: 'bug-tagged' },
                                    { icon: '■',  label: 'Neutral',  v: summary?.neutralCount  ?? 0, color: '#fb923c', sub: `${neuPct}% · 3–4★` },
                                    { icon: '🆘', label: 'Support',  v: summary?.supportCount  ?? 0, color: '#f59e0b', sub: 'escalations' },
                                    { icon: '▼',  label: 'Negative', v: summary?.negativeCount ?? 0, color: '#f4516c', sub: `${negPct}% · 1–2★` },
                                ].map(c => (
                                    <div key={c.label} style={{ background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 12, padding: '16px 18px' }}>
                                        <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sp-txm)', fontWeight: 700 }}>
                                            {c.icon} {c.label}
                                        </div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700, color: c.color, marginTop: 8, lineHeight: 1 }}>{fmt(c.v)}</div>
                                        <div style={{ fontSize: 11, color: 'var(--sp-txm)', marginTop: 5 }}>{c.sub}</div>
                                    </div>
                                ))}
                            </div>

                        </div>
                    </div>

                    {/* ── 7: Weekly composite chart ── */}
                    <div className={sp.card}>
                        <div className={sp.cardLabel} style={{ marginBottom: 4 }}>
                            <span className={sp.cardDot} style={{ background: '#3b82f6' }} />
                            Weekly record composition — feedback vs silent
                        </div>
                        <WeeklyChart trends={weekTrends} silentRatio={silentRatio} ratings={ratings} />
                    </div>

                </div>
            )}
        </div>
    );
}
