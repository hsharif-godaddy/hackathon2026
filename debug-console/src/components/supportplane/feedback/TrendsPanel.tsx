'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import sp from '@/components/supportplane/sp.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrendPoint {
    date: string;
    count: number;
    avgRating: number | null;
    feedbackCount: number;
    issueCount: number;
    supportCount: number;
}

// Actual shape returned by /api/supportplane/feedback/comparison
interface PeriodStats {
    label: string;
    count: number;
    avgRating: number | null;
    issueCount: number;
    issueRate: number | null;
}

interface CompResult {
    current: PeriodStats;
    previous: PeriodStats;
    delta: { count: number; countPct: number | null; rating: number | null; issueRate: number | null };
}

interface RatingBucket { rating: number; count: number; pct: number; }

type TrendsTab = 'wow' | 'mom';

// ── Constants ──────────────────────────────────────────────────────────────────

const RC: string[] = ['#EF4444','#F97316','#FACC15','#22C55E','#14B8A6','#3B82F6','#8B5CF6'];
const DOW_LABELS: string[] = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTH_LABELS: string[] = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ratingColor(r: number): string {
    return RC[Math.max(0, Math.min(6, Math.round(r) - 1))];
}

// ── Forecast ───────────────────────────────────────────────────────────────────

interface FcResult { fc: number[]; lo: number[]; hi: number[]; slope: number; sd: number; }

function linearForecast(series: number[], h: number): FcResult {
    const n: number = series.length;
    if (n < 2) {
        const base: number = series[0] ?? 0;
        return { fc: Array(h).fill(base) as number[], lo: Array(h).fill(base) as number[], hi: Array(h).fill(base) as number[], slope: 0, sd: 0 };
    }
    const mx: number = (n - 1) / 2;
    const my: number = series.reduce((a: number, b: number) => a + b, 0) / n;
    let num: number = 0;
    let den: number = 0;
    series.forEach((y: number, i: number) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
    const slope: number = den ? num / den : 0;
    const intercept: number = my - slope * mx;
    const resid: number[] = series.map((y: number, i: number) => y - (intercept + slope * i));
    const sd: number = Math.sqrt(resid.reduce((p: number, c: number) => p + c * c, 0) / Math.max(1, n - 2));
    const fc: number[] = [];
    const lo: number[] = [];
    const hi: number[] = [];
    for (let k: number = 1; k <= h; k++) {
        const yh: number = intercept + slope * (n - 1 + k);
        const w: number = 0.9 * sd * (1 + 0.15 * k);
        fc.push(yh);
        lo.push(yh - w);
        hi.push(yh + w);
    }
    return { fc, lo, hi, slope, sd };
}

// Anchored forecast: slope from fitSeries, starting point = last of histSeries
function anchoredForecast(histSeries: number[], fitN: number, h: number): FcResult {
    const fitSeries: number[] = histSeries.slice(-Math.max(2, fitN));
    const { slope, sd } = linearForecast(fitSeries, h);
    const lastObs: number = histSeries[histSeries.length - 1] ?? 0;
    const fc: number[] = Array.from({ length: h }, (_: unknown, k: number) => lastObs + slope * (k + 1));
    const lo: number[] = fc.map((v: number, k: number) => v - 0.9 * sd * (1 + 0.15 * (k + 1)));
    const hi: number[] = fc.map((v: number, k: number) => v + 0.9 * sd * (1 + 0.15 * (k + 1)));
    return { fc, lo, hi, slope, sd };
}

// ── NPS ────────────────────────────────────────────────────────────────────────

interface NPSData { score: number; promoterPct: number; passivePct: number; detractorPct: number; totalRated: number; }

function computeNPS(ratings: RatingBucket[]): NPSData {
    const totalRated: number = ratings.reduce((s: number, r: RatingBucket) => s + r.count, 0);
    if (!totalRated) return { score: 0, promoterPct: 0, passivePct: 0, detractorPct: 0, totalRated: 0 };
    const promoterPct: number = ratings.filter((r: RatingBucket) => r.rating >= 6).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const passivePct: number = ratings.filter((r: RatingBucket) => r.rating >= 4 && r.rating <= 5).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    const detractorPct: number = ratings.filter((r: RatingBucket) => r.rating <= 3).reduce((s: number, r: RatingBucket) => s + r.pct, 0);
    return { score: Math.round(promoterPct - detractorPct), promoterPct, passivePct, detractorPct, totalRated };
}

// ── Cadence ────────────────────────────────────────────────────────────────────

interface CadencePoint { label: string; avgRating: number; count: number; isSoft: boolean; }

function computeCadence(dayTrends: TrendPoint[], mode: TrendsTab): CadencePoint[] {
    if (!dayTrends.length) return [];
    if (mode === 'wow') {
        const buckets: { sum: number; cnt: number }[] = Array.from({ length: 7 }, () => ({ sum: 0, cnt: 0 }));
        dayTrends.forEach((t: TrendPoint) => {
            const d: Date = new Date(t.date.slice(0, 10) + 'T12:00:00Z');
            const dow: number = (d.getUTCDay() + 6) % 7;
            if (t.avgRating != null && t.avgRating > 0) { buckets[dow].sum += t.avgRating; buckets[dow].cnt++; }
        });
        const avgs: number[] = buckets.map((b: { sum: number; cnt: number }) => b.cnt > 0 ? b.sum / b.cnt : 0);
        const filled: number[] = avgs.filter((v: number) => v > 0);
        const overall: number = filled.length ? filled.reduce((a: number, b: number) => a + b, 0) / filled.length : 0;
        return DOW_LABELS.map((label: string, i: number): CadencePoint => ({ label, avgRating: avgs[i], count: buckets[i].cnt, isSoft: avgs[i] > 0 && avgs[i] < overall - 0.15 }));
    }
    const buckets: { sum: number; cnt: number }[] = Array.from({ length: 5 }, () => ({ sum: 0, cnt: 0 }));
    dayTrends.forEach((t: TrendPoint) => {
        const d: Date = new Date(t.date.slice(0, 10) + 'T12:00:00Z');
        const wom: number = Math.min(4, Math.floor((d.getUTCDate() - 1) / 7));
        if (t.avgRating != null && t.avgRating > 0) { buckets[wom].sum += t.avgRating; buckets[wom].cnt++; }
    });
    const avgs: number[] = buckets.map((b: { sum: number; cnt: number }) => b.cnt > 0 ? b.sum / b.cnt : 0);
    const filled: number[] = avgs.filter((v: number) => v > 0);
    const overall: number = filled.length ? filled.reduce((a: number, b: number) => a + b, 0) / filled.length : 0;
    return ['W1','W2','W3','W4','W5'].map((label: string, i: number): CadencePoint => ({ label, avgRating: avgs[i], count: buckets[i].cnt, isSoft: avgs[i] > 0 && avgs[i] < overall - 0.15 }));
}

// ── Signals ────────────────────────────────────────────────────────────────────

interface Signal { type: 'fore' | 'anom' | 'risk'; icon: string; tag: string; text: string; }

function generateSignals(trends: TrendPoint[], comp: CompResult | null, mode: TrendsTab, cadence: CadencePoint[], nps: NPSData): Signal[] {
    const signals: Signal[] = [];
    if (!trends.length || !comp) return signals;

    const recent: TrendPoint[] = trends.slice(-4).filter((t: TrendPoint) => t.avgRating != null && t.avgRating > 0);
    if (recent.length >= 3) {
        const vals: number[] = recent.map((t: TrendPoint) => t.avgRating ?? 0);
        const { slope } = linearForecast(vals, 1);
        const period: string = mode === 'wow' ? 'weekly' : 'monthly';
        if (slope < -0.04) {
            signals.push({ type: 'risk', icon: '▲', tag: 'Declining trend',
                text: `Avg rating has fallen <b>${Math.abs(slope * 4).toFixed(2)} pts</b> over the last 4 ${period} periods. Continued pressure unless root causes are addressed.` });
        } else if (slope > 0.04) {
            const proj: number = (comp.current.avgRating ?? 0) + slope * 2;
            signals.push({ type: 'fore', icon: '◷', tag: 'Improving trend',
                text: `Avg rating climbing <b>+${(slope * 4).toFixed(2)} pts</b> over 4 ${period} periods. If the slope holds, expect <b>${Math.min(7, proj).toFixed(2)}</b> within 2 periods.` });
        }
    }

    if (comp.previous.count > 0) {
        const volPct: number = ((comp.current.count - comp.previous.count) / comp.previous.count) * 100;
        const rd: number = comp.delta.rating ?? 0;
        if (volPct > 10 && rd <= 0) {
            signals.push({ type: 'risk', icon: '▲', tag: 'Volume without quality',
                text: `Volume up <b>+${volPct.toFixed(1)}%</b> ${mode === 'wow' ? 'WoW' : 'MoM'} while avg rating is flat or declining. New arrivals may be landing with mixed impressions.` });
        } else if (volPct > 10 && rd > 0) {
            signals.push({ type: 'fore', icon: '◷', tag: 'Growth with quality',
                text: `Volume up <b>+${volPct.toFixed(1)}%</b> and avg rating improved <b>+${rd.toFixed(2)}</b> — both trends reinforcing each other.` });
        } else if (volPct < -10) {
            signals.push({ type: 'risk', icon: '▲', tag: 'Volume contraction',
                text: `Submission volume down <b>${volPct.toFixed(1)}%</b> ${mode === 'wow' ? 'week-over-week' : 'month-over-month'}. Lower velocity reduces signal quality.` });
        }
    }

    const softDay: CadencePoint | undefined = cadence.find((c: CadencePoint) => c.isSoft && c.count >= 3);
    if (softDay) {
        signals.push({ type: 'anom', icon: '◆', tag: 'Cadence anomaly',
            text: `<b>${softDay.label}</b> consistently rates <b>${softDay.avgRating.toFixed(2)}★</b> — below the ${mode === 'wow' ? 'week' : 'month'} average. Check for release timing or staffing patterns.` });
    }

    if (nps.totalRated > 0 && nps.score < 40) {
        signals.push({ type: 'risk', icon: '▲', tag: 'NPS below threshold',
            text: `NPS of <b>${nps.score >= 0 ? '+' : ''}${nps.score}</b> is below the 40-point benchmark. Detractors at <b>${nps.detractorPct.toFixed(1)}%</b> are the primary drag.` });
    } else if (nps.totalRated > 0 && nps.score >= 60) {
        signals.push({ type: 'fore', icon: '◷', tag: 'NPS strength',
            text: `NPS of <b>+${nps.score}</b> is well above benchmark. Promoters at <b>${nps.promoterPct.toFixed(1)}%</b> represent a growth activation lever.` });
    }

    return signals.slice(0, 4);
}

// ── Actions ────────────────────────────────────────────────────────────────────

interface Action { b: string; s: string; imp: 'HIGH' | 'MED' | 'LOW'; eff: 'HIGH' | 'MED' | 'LOW'; own: string; }

function generateActions(signals: Signal[], trends: TrendPoint[], mode: TrendsTab): Action[] {
    const actions: Action[] = [];

    if (signals.some((s: Signal) => s.tag === 'Declining trend' || s.tag === 'Volume without quality')) {
        actions.push({ b: 'Triage the root cause of rating pressure',
            s: `Pull the 1–3★ comments for the current ${mode === 'wow' ? 'week' : 'month'}, cluster by theme, and route the top 3 patterns to engineering.`,
            imp: 'HIGH', eff: 'LOW', own: 'Product / Engineering' });
    }

    const softSig: Signal | undefined = signals.find((s: Signal) => s.tag === 'Cadence anomaly');
    if (softSig) {
        actions.push({ b: `Stabilize the soft ${mode === 'wow' ? 'day' : 'week'}`,
            s: softSig.text.replace(/<[^>]+>/g, ''),
            imp: 'MED', eff: 'MED', own: 'Release / On-call' });
    }

    const lastTrend: TrendPoint | undefined = trends[trends.length - 1];
    const issueRate: number = lastTrend && lastTrend.count > 0 ? (lastTrend.issueCount / lastTrend.count) * 100 : 0;
    if (issueRate > 20) {
        actions.push({ b: 'Reduce the issue/bug complaint rate',
            s: `Issue rate elevated at ${issueRate.toFixed(1)}% of total records. Identify the highest-volume recurring bug pattern and schedule for the next sprint.`,
            imp: 'HIGH', eff: 'MED', own: 'Engineering' });
    }

    if (signals.some((s: Signal) => s.tag === 'NPS below threshold')) {
        actions.push({ b: 'Build a detractor follow-up flow',
            s: 'Route 1–3★ submissions to a lightweight follow-up prompt within 24h. Even 10% conversion to neutral lifts NPS measurably.',
            imp: 'HIGH', eff: 'MED', own: 'Product / CX' });
    }

    if (actions.length < 3) {
        actions.push({ b: `Instrument the ${mode === 'wow' ? 'weekly' : 'monthly'} feedback digest`,
            s: 'Automate a digest to key stakeholders: top 3 movers (volume, avg rating, NPS). Creates accountability before issues compound.',
            imp: 'LOW', eff: 'HIGH', own: 'Analytics' });
    }

    if (actions.length < 4 && signals.some((s: Signal) => s.tag === 'Growth with quality')) {
        actions.push({ b: 'Activate promoters before momentum fades',
            s: 'Both volume and rating are rising. Launch a referral or community feature now — promoters are most active within 48h of a positive experience.',
            imp: 'MED', eff: 'HIGH', own: 'Growth' });
    }

    return actions.slice(0, 4);
}

// ── Editorial headline ─────────────────────────────────────────────────────────

function editorialRead(trends: TrendPoint[], comp: CompResult | null, mode: TrendsTab): { h: string; p: string } {
    if (!comp || !trends.length) return { h: 'Awaiting trend data.', p: '' };
    const recent: TrendPoint[] = trends.slice(-4).filter((t: TrendPoint) => t.avgRating != null && t.avgRating > 0);
    const slope: number = recent.length >= 2 ? linearForecast(recent.map((t: TrendPoint) => t.avgRating ?? 0), 1).slope : 0;
    const volPct: number = comp.previous.count > 0 ? ((comp.current.count - comp.previous.count) / comp.previous.count) * 100 : 0;
    const curRating: number = comp.current.avgRating ?? 0;
    const isWow: boolean = mode === 'wow';
    if (slope > 0.05 && volPct > 5) return {
        h: `Rising on all fronts. <em>Keep the momentum.</em>`,
        p: `Both volume and quality are trending up ${isWow ? 'this week' : 'this month'}. Avg rating slope +${(slope * 4).toFixed(2)} over 4 periods suggests sustained improvement — not a one-period spike.`,
    };
    if (slope < -0.05) return {
        h: `Rating pressure is building. <em>Investigate now.</em>`,
        p: `Avg rating declining for ${recent.length} consecutive ${isWow ? 'weeks' : 'months'}. Volume is ${volPct >= 0 ? `up +${volPct.toFixed(1)}%` : `down ${volPct.toFixed(1)}%`}, which ${volPct >= 0 ? 'masks the signal — watch the tails' : 'compounds the concern'}.`,
    };
    if (volPct > 10) return {
        h: `Volume surging. <em>Quality holding steady.</em>`,
        p: `${isWow ? 'Weekly' : 'Monthly'} volume up ${volPct.toFixed(1)}% while mean is stable at ${curRating.toFixed(2)}. Demand is strong — convert new arrivals into advocates.`,
    };
    return {
        h: `Steady at the surface. <em>Watch the tails.</em>`,
        p: `Average holding near ${curRating.toFixed(2)} with a ${volPct >= 0 ? `+${volPct.toFixed(1)}%` : `${volPct.toFixed(1)}%`} volume change. Stability isn't stagnation — but the distribution deserves a close read.`,
    };
}

// ── Period label formatter ─────────────────────────────────────────────────────

function fmtPeriodLabel(date: string): string {
    const wm: RegExpMatchArray | null = date.match(/^(\d{4})-W(\d{1,2})$/);
    if (wm) return `W${wm[2]}`;
    const dm: RegExpMatchArray | null = date.match(/^(\d{4})-(\d{2})/);
    if (dm) return MONTH_LABELS[parseInt(dm[2], 10) - 1] ?? date.slice(0, 7);
    return date.slice(0, 7);
}

// ── SparkSVG ───────────────────────────────────────────────────────────────────

function SparkSVG({ vals, good }: { vals: number[]; good: boolean }) {
    if (vals.length < 2) return <div style={{ height: 34 }} />;
    const W: number = 120; const H: number = 34; const p: number = 2;
    const mn: number = Math.min(...vals); const mx: number = Math.max(...vals);
    const rng: number = mx - mn || 1;
    const sx = (i: number): number => p + (i / (vals.length - 1)) * (W - 2 * p);
    const sy = (v: number): number => p + (1 - (v - mn) / rng) * (H - 2 * p);
    const d: string = 'M' + vals.map((v: number, i: number) => `${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' L ');
    const col: string = good ? '#34D399' : '#F4516C';
    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
            <path d={`${d} L${sx(vals.length - 1).toFixed(1)} ${H - p} L${sx(0).toFixed(1)} ${H - p}Z`}
                fill={good ? 'rgba(52,211,153,0.12)' : 'rgba(244,81,108,0.12)'} />
            <path d={d} fill="none" stroke={col} strokeWidth={1.6} strokeLinejoin="round" />
            <circle cx={sx(vals.length - 1)} cy={sy(vals[vals.length - 1])} r={2.5} fill={col} />
        </svg>
    );
}

// ── VitalCard ──────────────────────────────────────────────────────────────────

interface VitalCardProps {
    label: string; value: string; unit?: string;
    delta: string; deltaDir: 'good' | 'bad' | 'flat'; arrow: string;
    spark: number[]; sparkGood: boolean;
    fcVal: string; fcRange: string;
    sublabel?: string;
}

function VitalCard({ label, value, unit, delta, deltaDir, arrow, spark, sparkGood, fcVal, fcRange, sublabel }: VitalCardProps) {
    const deltaColor: string = deltaDir === 'good' ? '#34D399' : deltaDir === 'bad' ? '#F4516C' : '#9FB0C3';
    return (
        <div style={{ background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sp-txm)', fontWeight: 700 }}>{label}</div>
            {sublabel && <div style={{ fontSize: 10, color: 'var(--sp-tx3)', marginTop: 2, fontFamily: 'var(--mono)' }}>{sublabel}</div>}
            <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 600, lineHeight: 1, marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                {value}
                {unit && <span style={{ fontSize: 13, color: 'var(--sp-txm)', fontWeight: 400 }}>{unit}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, fontFamily: 'var(--mono)', color: deltaColor }}>
                {arrow} {delta}
            </div>
            <SparkSVG vals={spark} good={sparkGood} />
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sp-txm)', borderTop: '1px dashed var(--sp-border)', paddingTop: 8, lineHeight: 1.4 }}>
                → <span style={{ color: '#2DD4BF', fontFamily: 'var(--mono)' }}>{fcVal}</span> · {fcRange}
            </div>
        </div>
    );
}

// ── ForecastChart ──────────────────────────────────────────────────────────────

function ForecastChart({ histSeries, fitN, labels, fcHorizon }: {
    histSeries: number[]; fitN: number; labels: string[]; fcHorizon: number;
}) {
    const W: number = 1120; const H: number = 280;
    const PL: number = 46; const PR: number = 92; const PT: number = 16; const PB: number = 34;

    if (histSeries.length < 2) return <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sp-txm)', fontSize: 12 }}>Not enough data for forecast.</div>;

    const { fc, lo, hi } = anchoredForecast(histSeries, fitN, fcHorizon);
    const hiBounded: number[] = hi.map((v: number) => Math.min(7.2, v));
    const loBounded: number[] = lo.map((v: number) => Math.max(0.8, v));

    const all: number[] = [...histSeries, ...fc, ...loBounded, ...hiBounded];
    let mn: number = Math.max(Math.min(...histSeries) - 0.3, 1);
    let mx: number = Math.min(Math.max(...all) + 0.2, 7.5);
    const rng: number = mx - mn || 1;

    const N: number = histSeries.length + fcHorizon;
    const sx = (i: number): number => PL + (i / (N - 1)) * (W - PL - PR);
    const sy = (v: number): number => PT + (1 - (v - mn) / rng) * (H - PT - PB);

    const anchor: [number, number] = [sx(histSeries.length - 1), sy(histSeries[histSeries.length - 1])];
    const bandTop: [number, number][] = hiBounded.map((v: number, k: number): [number, number] => [sx(histSeries.length + k), sy(v)]);
    const bandBot: [number, number][] = loBounded.map((v: number, k: number): [number, number] => [sx(histSeries.length + k), sy(v)]).reverse();
    const bandPts: [number, number][] = [anchor, ...bandTop, ...bandBot, anchor];

    const histD: string = 'M' + histSeries.map((v: number, i: number) => `${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' L ');
    const fcPts: [number, number][] = [anchor, ...fc.map((v: number, k: number): [number, number] => [sx(histSeries.length + k), sy(v)])];
    const fcD: string = 'M' + fcPts.map((pt: [number, number]) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' L ');

    const gridVals: number[] = [mn + rng * 0.25, mn + rng * 0.5, mn + rng * 0.75, mx - 0.1];
    const lastFc: number = fc[fc.length - 1] ?? histSeries[histSeries.length - 1];
    const ex: number = sx(N - 1);
    const ey: number = sy(lastFc);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
                <linearGradient id="fcHistGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5AA9FF" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#5AA9FF" stopOpacity={0.01} />
                </linearGradient>
            </defs>
            {gridVals.map((v: number) => (
                <g key={v}>
                    <line x1={PL} y1={sy(v)} x2={W - PR} y2={sy(v)} stroke="rgba(255,255,255,0.05)" />
                    <text x={PL - 8} y={sy(v) + 3.5} fill="#46566b" fontSize={10} fontFamily="monospace" textAnchor="end">{v.toFixed(1)}</text>
                </g>
            ))}
            <path d={`M${bandPts.map((pt: [number, number]) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' L ')}Z`} fill="rgba(45,212,191,0.10)" />
            <line x1={anchor[0]} y1={PT} x2={anchor[0]} y2={H - PB} stroke="rgba(255,255,255,0.18)" strokeDasharray="4 4" />
            <text x={anchor[0] + 5} y={PT + 11} fill="#647488" fontSize={9.5} fontFamily="monospace">now</text>
            <path d={`${histD} L${sx(histSeries.length - 1).toFixed(1)} ${H - PB} L${sx(0).toFixed(1)} ${H - PB}Z`} fill="url(#fcHistGrad)" />
            <path d={histD} fill="none" stroke="#5AA9FF" strokeWidth={2.4} strokeLinejoin="round" />
            <path d={fcD} fill="none" stroke="#2DD4BF" strokeWidth={2.2} strokeDasharray="6 5" strokeLinejoin="round" />
            {histSeries.map((v: number, i: number) => <circle key={i} cx={sx(i)} cy={sy(v)} r={2.4} fill="#5AA9FF" />)}
            {fc.map((v: number, k: number) => <circle key={k} cx={sx(histSeries.length + k)} cy={sy(v)} r={2.4} fill="#2DD4BF" />)}
            <circle cx={ex} cy={ey} r={5} fill="#2DD4BF" stroke="#0E1320" strokeWidth={2} />
            <text x={ex + 9} y={ey - 4} fill="#7fe6d8" fontSize={13} fontFamily="monospace" fontWeight="bold">{lastFc.toFixed(2)}</text>
            <text x={ex + 9} y={ey + 10} fill="#647488" fontSize={9.5} fontFamily="monospace">proj</text>
            {labels.map((t: string, i: number) => t ? (
                <text key={i} x={sx(i)} y={H - 12} fill="#647488" fontSize={9.5} textAnchor="middle" fontFamily="monospace">{t}</text>
            ) : null)}
            {fc.map((_: number, k: number) => (
                <text key={k} x={sx(histSeries.length + k)} y={H - 12} fill="#3a4658" fontSize={9.5} textAnchor="middle" fontFamily="monospace">+{k + 1}</text>
            ))}
        </svg>
    );
}

// ── DistributionCard ───────────────────────────────────────────────────────────
// Each row: VIBGYOR bar for current pct, delta indicator vs prior avg rating

function DistributionCard({ ratings, deltaRating }: { ratings: RatingBucket[]; deltaRating: number | null }) {
    if (!ratings.length) return <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No rating data.</div>;
    const mx: number = Math.max(...ratings.map((r: RatingBucket) => r.pct), 1);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[...ratings].sort((a: RatingBucket, b: RatingBucket) => b.rating - a.rating).map((r: RatingBucket) => {
                const col: string = RC[r.rating - 1];
                const barW: number = (r.pct / mx) * 100;
                const isPromoter: boolean = r.rating >= 6;
                const isDetractor: boolean = r.rating <= 3;
                const textCol: string = isPromoter ? '#34D399' : isDetractor ? '#F4516C' : '#9FB0C3';
                return (
                    <div key={r.rating} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 84px', gap: 10, alignItems: 'center', fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--sp-tx2)' }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: col, display: 'inline-block', flexShrink: 0 }} />
                            {r.rating}★
                        </div>
                        <div style={{ position: 'relative', height: 20 }}>
                            <div style={{ position: 'absolute', left: 0, top: 4, height: 12, borderRadius: 4, background: `${col}20`, width: '100%' }} />
                            <div style={{ position: 'absolute', left: 0, top: 2, height: 16, borderRadius: 4, background: col, width: `${barW.toFixed(1)}%`, opacity: 0.88, transition: 'width 0.4s ease' }} />
                        </div>
                        <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                            <span style={{ color: textCol, fontWeight: 600 }}>{r.pct.toFixed(1)}%</span>
                            {' '}<span style={{ color: '#46566b' }}>{r.count.toLocaleString()}</span>
                        </div>
                    </div>
                );
            })}
            {deltaRating !== null && (
                <div style={{ marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--sp-border)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--sp-txm)' }}>
                    <span>Avg rating shift vs prior period:</span>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: deltaRating >= 0 ? '#34D399' : '#F4516C' }}>
                        {deltaRating >= 0 ? '+' : ''}{deltaRating.toFixed(2)}
                    </span>
                </div>
            )}
        </div>
    );
}

// ── NPSDisplay ─────────────────────────────────────────────────────────────────

function NPSDisplay({ nps }: { nps: NPSData }) {
    const npsColor: string = nps.score >= 40 ? '#34D399' : nps.score >= 0 ? '#F5B014' : '#F4516C';
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 52, fontWeight: 700, lineHeight: 1, color: npsColor }}>
                    {nps.score >= 0 ? '+' : ''}{nps.score}
                </div>
                <div style={{ fontSize: 12, color: 'var(--sp-txm)' }}>
                    NPS<br />promoters − detractors
                </div>
            </div>
            <div style={{ display: 'flex', height: 36, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sp-border)', margin: '12px 0 6px' }}>
                <div style={{ flex: Math.max(nps.promoterPct, 0.5), background: 'linear-gradient(135deg,#34D399,#1E9E73)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#05241a' }}>{nps.promoterPct.toFixed(1)}%</span>
                    <span style={{ fontSize: 9, color: 'rgba(0,0,0,0.55)' }}>Promoters</span>
                </div>
                <div style={{ flex: Math.max(nps.passivePct, 0.5), background: '#2a3650', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>{nps.passivePct.toFixed(1)}%</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)' }}>Passive</span>
                </div>
                <div style={{ flex: Math.max(nps.detractorPct, 0.5), background: 'linear-gradient(135deg,#F4516C,#c43350)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{nps.detractorPct.toFixed(1)}%</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>Detractors</span>
                </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--sp-txm)', marginTop: 6 }}>
                <span>6–7★ <span style={{ color: '#34D399' }}>Promoters</span></span>
                <span>4–5★ <span style={{ color: '#94a3b8' }}>Passives</span></span>
                <span>1–3★ <span style={{ color: '#F4516C' }}>Detractors</span></span>
            </div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {[
                    { lbl: 'Promoters', pct: nps.promoterPct, col: '#34D399', bg: 'rgba(52,211,153,0.1)' },
                    { lbl: 'Passives',  pct: nps.passivePct,  col: '#94a3b8', bg: 'rgba(148,163,184,0.08)' },
                    { lbl: 'Detractors',pct: nps.detractorPct, col: '#F4516C', bg: 'rgba(244,81,108,0.1)' },
                ].map((x: { lbl: string; pct: number; col: string; bg: string }) => (
                    <div key={x.lbl} style={{ background: x.bg, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: x.col }}>{x.pct.toFixed(1)}%</div>
                        <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginTop: 2 }}>{x.lbl}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── ChannelShift ───────────────────────────────────────────────────────────────

function ChannelShift({ trends, mode }: { trends: TrendPoint[]; mode: TrendsTab }) {
    if (trends.length < 2) return <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>Not enough periods.</div>;
    const last: TrendPoint = trends[trends.length - 1];
    const prior: TrendPoint = trends[trends.length - 2];
    const tot = (t: TrendPoint): number => Math.max(t.count, 1);
    const channels: { nm: string; dot: string; cur: number; prev: number }[] = [
        { nm: 'Product Feedback', dot: '#3B82F6', cur: (last.feedbackCount / tot(last)) * 100, prev: (prior.feedbackCount / tot(prior)) * 100 },
        { nm: 'Issues / Bugs',    dot: '#EC4899', cur: (last.issueCount / tot(last)) * 100,    prev: (prior.issueCount / tot(prior)) * 100 },
        { nm: 'SOS Support',      dot: '#F59E0B', cur: (last.supportCount / tot(last)) * 100,  prev: (prior.supportCount / tot(prior)) * 100 },
    ];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sp-tx3)', fontWeight: 700, marginBottom: 2 }}>
                vs prior {mode === 'wow' ? 'week' : 'month'}
            </div>
            {channels.map((c: { nm: string; dot: string; cur: number; prev: number }) => {
                const diff: number = c.cur - c.prev;
                const diffColor: string = Math.abs(diff) < 0.5 ? '#9FB0C3' : diff > 0 ? '#34D399' : '#F4516C';
                return (
                    <div key={c.nm} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '9px 10px', borderRadius: 9, border: '1px solid var(--sp-border)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, display: 'inline-block', flexShrink: 0 }} />
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--sp-tx1)' }}>{c.nm}</div>
                                <div style={{ fontSize: 11, color: 'var(--sp-tx3)', marginTop: 1 }}>{c.cur.toFixed(1)}% of total</div>
                            </div>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: diffColor, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── CadenceChart ── VIBGYOR bars + reference line ──────────────────────────────

function CadenceChart({ data, weeklyAvgSpark, mode }: {
    data: CadencePoint[];
    weeklyAvgSpark: number[];
    mode: TrendsTab;
}) {
    const withData: CadencePoint[] = data.filter((d: CadencePoint) => d.avgRating > 0);
    if (!withData.length) return <div style={{ color: 'var(--sp-txm)', fontSize: 12, padding: '16px 0' }}>Insufficient day-level data for cadence analysis.</div>;

    const allRatings: number[] = withData.map((d: CadencePoint) => d.avgRating);
    const overall: number = allRatings.reduce((a: number, b: number) => a + b, 0) / allRatings.length;
    const lo: number = 4.0; const hi: number = 7.0; const rng: number = hi - lo;

    const softDays: string[] = data.filter((d: CadencePoint) => d.isSoft).map((d: CadencePoint) => d.label);

    // Mini sparkline for weekly avg trend (overlay)
    const sparkH: number = 60;
    const sparkMin: number = weeklyAvgSpark.length > 0 ? Math.min(...weeklyAvgSpark) : 4;
    const sparkMax: number = weeklyAvgSpark.length > 0 ? Math.max(...weeklyAvgSpark) : 7;
    const sparkRng: number = sparkMax - sparkMin || 0.5;

    return (
        <div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 120, marginTop: 6, position: 'relative' }}>
                {/* Overall average reference line */}
                <div style={{
                    position: 'absolute', left: 0, right: 0,
                    bottom: `${Math.max(0, Math.min(100, ((overall - lo) / rng) * 100))}%`,
                    borderTop: '1px dashed rgba(255,255,255,0.22)',
                    pointerEvents: 'none',
                }} />
                {data.map((d: CadencePoint, i: number) => {
                    if (!d.avgRating) return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                            <div style={{ fontSize: 11, color: 'var(--sp-tx3)', marginTop: 6 }}>{d.label}</div>
                        </div>
                    );
                    const hpct: number = Math.max(6, ((d.avgRating - lo) / rng) * 100);
                    const col: string = ratingColor(d.avgRating);
                    return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: d.isSoft ? '#ff8aa0' : col, fontWeight: 600 }}>{d.avgRating.toFixed(2)}</div>
                            <div style={{ width: '55%', maxWidth: 32, height: `${hpct}%`, borderRadius: '5px 5px 0 0', background: col, opacity: d.isSoft ? 0.6 : 0.85 }} />
                            <div style={{ fontSize: 11, color: d.isSoft ? '#ff8aa0' : 'var(--sp-tx3)', fontWeight: d.isSoft ? 700 : 400 }}>{d.label}</div>
                        </div>
                    );
                })}
            </div>

            {/* Weekly avg sparkline */}
            {weeklyAvgSpark.length >= 3 && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 8, border: '1px solid var(--sp-border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--sp-txm)', marginBottom: 5 }}>Avg rating {mode === 'wow' ? 'week' : 'month'} by {mode === 'wow' ? 'week' : 'month'} trend</div>
                    <svg viewBox={`0 0 300 ${sparkH}`} style={{ width: '100%', height: sparkH, display: 'block' }} preserveAspectRatio="none">
                        {weeklyAvgSpark.map((v: number, i: number) => {
                            const x: number = (i / (weeklyAvgSpark.length - 1)) * 300;
                            const y: number = sparkH - ((v - sparkMin) / sparkRng) * (sparkH - 6) - 3;
                            const col: string = ratingColor(v);
                            return (
                                <g key={i}>
                                    {i > 0 && (
                                        <line
                                            x1={(( i - 1) / (weeklyAvgSpark.length - 1)) * 300}
                                            y1={sparkH - ((weeklyAvgSpark[i - 1] - sparkMin) / sparkRng) * (sparkH - 6) - 3}
                                            x2={x} y2={y}
                                            stroke="rgba(255,255,255,0.2)" strokeWidth={1.5}
                                        />
                                    )}
                                    <circle cx={x} cy={y} r={3.5} fill={col} />
                                </g>
                            );
                        })}
                    </svg>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, fontFamily: 'var(--mono)', color: '#46566b', marginTop: 3 }}>
                        <span>{sparkMin.toFixed(2)}★</span>
                        <span style={{ color: 'var(--sp-txm)' }}>last {weeklyAvgSpark.length} {mode === 'wow' ? 'weeks' : 'months'}</span>
                        <span>{sparkMax.toFixed(2)}★</span>
                    </div>
                </div>
            )}

            <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--sp-txm)' }}>
                {softDays.length > 0
                    ? <span>Soft {mode === 'wow' ? 'day' : 'week'} — <b style={{ color: '#ff8aa0' }}>{softDays.join(', ')}</b> consistently below avg · overall avg <b style={{ color: 'var(--sp-tx2)' }}>{overall.toFixed(2)}★</b></span>
                    : <span>No significant cadence pattern · overall avg <b style={{ color: 'var(--sp-tx2)' }}>{overall.toFixed(2)}★</b></span>
                }
            </div>
        </div>
    );
}

// ── SignalList ─────────────────────────────────────────────────────────────────

function SignalList({ signals }: { signals: Signal[] }) {
    if (!signals.length) return <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No significant signals detected for this period.</div>;
    const borderColors: Record<Signal['type'], string> = { fore: '#2DD4BF', anom: '#F5B014', risk: '#F4516C' };
    const bgColors: Record<Signal['type'], string> = { fore: 'rgba(45,212,191,0.05)', anom: 'rgba(245,176,20,0.05)', risk: 'rgba(244,81,108,0.05)' };
    const labels: Record<Signal['type'], string> = { fore: 'FORECAST', anom: 'ANOMALY', risk: 'RISK' };
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {signals.map((s: Signal, i: number) => (
                <div key={i} style={{
                    display: 'flex', gap: 11, alignItems: 'flex-start',
                    padding: '12px 13px', background: bgColors[s.type],
                    border: '1px solid var(--sp-border)',
                    borderLeft: `3px solid ${borderColors[s.type]}`,
                    borderRadius: 10,
                }}>
                    <div style={{ fontSize: 16, marginTop: 1, flexShrink: 0, color: borderColors[s.type] }}>{s.icon}</div>
                    <div>
                        <div style={{ fontSize: 9, letterSpacing: '0.1em', fontWeight: 800, textTransform: 'uppercase', color: borderColors[s.type], marginBottom: 3 }}>
                            {labels[s.type]} · {s.tag}
                        </div>
                        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--sp-tx2)' }}
                            dangerouslySetInnerHTML={{ __html: s.text }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── ActionList ─────────────────────────────────────────────────────────────────

function ActionList({ actions }: { actions: Action[] }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {actions.map((a: Action, i: number) => (
                <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '28px 1fr auto',
                    gap: 11, alignItems: 'start',
                    padding: '12px 13px',
                    border: '1px solid var(--sp-border)',
                    borderRadius: 11,
                    background: 'var(--sp-s2)',
                }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 17, color: '#2DD4BF', fontWeight: 600 }}>0{i + 1}</div>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: 'var(--sp-tx1)' }}>{a.b}</div>
                        <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--sp-txm)', lineHeight: 1.45 }}>{a.s}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(244,81,108,0.16)', color: '#ff8aa0' }}>↑ {a.imp}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(45,212,191,0.14)', color: '#7fe6d8' }}>⊙ {a.eff}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: 'rgba(90,169,255,0.14)', color: '#9fc6ff' }}>{a.own}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Period breakdown table ─────────────────────────────────────────────────────

function PeriodTable({ trends, isWow }: { trends: TrendPoint[]; isWow: boolean }) {
    const rows: TrendPoint[] = [...trends].reverse().slice(0, 12);
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid var(--sp-border)' }}>
                        {['Period','Total','💬 Feedback','🐛 Issues','🆘 SOS','Avg ★'].map((h: string) => (
                            <th key={h} style={{ padding: '6px 10px', color: 'var(--sp-txm)', fontWeight: 600, textAlign: h === 'Period' ? 'left' : 'right', fontSize: 11 }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((t: TrendPoint, i: number) => {
                        const rc: string = t.avgRating == null ? 'var(--sp-txm)' : ratingColor(t.avgRating);
                        return (
                            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                                onMouseEnter={(e: React.MouseEvent<HTMLTableRowElement>) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; }}
                                onMouseLeave={(e: React.MouseEvent<HTMLTableRowElement>) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', color: 'var(--sp-tx2)' }}>{t.date}</td>
                                <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', textAlign: 'right', color: 'var(--sp-tx1)', fontWeight: 600 }}>{t.count.toLocaleString()}</td>
                                <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', textAlign: 'right', color: '#7fb4ff' }}>{t.feedbackCount.toLocaleString()}</td>
                                <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', textAlign: 'right', color: '#ff8a8a' }}>{t.issueCount.toLocaleString()}</td>
                                <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', textAlign: 'right', color: '#f59e0b' }}>{t.supportCount.toLocaleString()}</td>
                                <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', textAlign: 'right', color: rc }}>{t.avgRating?.toFixed(2) ?? '—'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--sp-tx3)', fontFamily: 'var(--mono)' }}>
                Showing last {rows.length} {isWow ? 'weeks' : 'months'} · most recent first
            </div>
        </div>
    );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function FeedbackTrendsPanel({ defaultMode }: { defaultMode?: 'wow' | 'mom' }) {
    const [tab, setTab]                 = useState<TrendsTab>(defaultMode ?? 'wow');
    const [weekTrends, setWeekTrends]   = useState<TrendPoint[]>([]);
    const [monthTrends, setMonthTrends] = useState<TrendPoint[]>([]);
    const [dayTrends, setDayTrends]     = useState<TrendPoint[]>([]);
    const [wow, setWow]                 = useState<CompResult | null>(null);
    const [mom, setMom]                 = useState<CompResult | null>(null);
    const [ratings, setRatings]         = useState<RatingBucket[]>([]);
    const [loading, setLoading]         = useState(true);
    const [fcHorizon, setFcHorizon]     = useState(3);

    async function load(): Promise<void> {
        setLoading(true);
        const [weekRes, monthRes, dayRes, cRes, ratRes] = await Promise.all([
            fetch('/api/supportplane/feedback/trends?granularity=week&days=365'),
            fetch('/api/supportplane/feedback/trends?granularity=month&days=730'),
            fetch('/api/supportplane/feedback/trends?granularity=day&days=30'),
            fetch('/api/supportplane/feedback/comparison'),
            fetch('/api/supportplane/feedback/ratings'),
        ]);
        if (weekRes.ok)  { const d: { trends: TrendPoint[] } = await weekRes.json()  as { trends: TrendPoint[] }; setWeekTrends(d.trends ?? []); }
        if (monthRes.ok) { const d: { trends: TrendPoint[] } = await monthRes.json() as { trends: TrendPoint[] }; setMonthTrends(d.trends ?? []); }
        if (dayRes.ok)   { const d: { trends: TrendPoint[] } = await dayRes.json()   as { trends: TrendPoint[] }; setDayTrends(d.trends ?? []); }
        if (cRes.ok)     { const d: { wow: CompResult; mom: CompResult } = await cRes.json() as { wow: CompResult; mom: CompResult }; setWow(d.wow); setMom(d.mom); }
        if (ratRes.ok)   { const d: { ratings: RatingBucket[] } = await ratRes.json() as { ratings: RatingBucket[] }; setRatings(d.ratings ?? []); }
        setLoading(false);
    }

    useEffect(() => { void load(); }, []);

    const isWow: boolean = tab === 'wow';
    const activeTrends: TrendPoint[] = isWow ? weekTrends : monthTrends;
    const activeComp: CompResult | null = isWow ? wow : mom;
    const horizons: [string, number][] = isWow ? [['+3 wk', 3], ['+6 wk', 6]] : [['+2 mo', 2], ['+3 mo', 3]];

    // Derived NPS
    const nps: NPSData = computeNPS(ratings);

    // Cadence from day trends
    const cadence: CadencePoint[] = computeCadence(dayTrends, tab);

    // ── Forecast chart data ──
    // Show last 12 wk / 8 mo of history; fit slope on recent 5 wk / 3 mo
    const fcSource: TrendPoint[] = isWow ? weekTrends.slice(-12) : monthTrends.slice(-8);
    const fcFiltered: TrendPoint[] = fcSource.filter((t: TrendPoint) => t.avgRating != null && t.avgRating > 0);
    const histSeries: number[] = fcFiltered.map((t: TrendPoint) => t.avgRating ?? 0);
    const fitN: number = isWow ? 5 : 3;
    const fcLabels: string[] = fcFiltered.map((t: TrendPoint, i: number, arr: TrendPoint[]): string => {
        if (i === 0 || i === arr.length - 1 || i === Math.floor(arr.length / 2)) return fmtPeriodLabel(t.date);
        return '';
    });

    // Weekly avg sparkline for cadence chart
    const weeklyAvgSpark: number[] = (isWow ? weekTrends.slice(-8) : monthTrends.slice(-6))
        .filter((t: TrendPoint) => t.avgRating != null && t.avgRating > 0)
        .map((t: TrendPoint) => t.avgRating ?? 0);

    // ── Spark data for vital cards ──
    const sparkN: number = isWow ? 8 : 6;
    const sparkTrends: TrendPoint[] = activeTrends.slice(-sparkN);
    const ratingSpark: number[] = sparkTrends.map((t: TrendPoint) => t.avgRating ?? 0).filter((v: number) => v > 0);
    const volSpark: number[] = sparkTrends.map((t: TrendPoint) => t.count);
    const fbSpark: number[] = sparkTrends.map((t: TrendPoint) => t.count > 0 ? (t.feedbackCount / t.count) * 100 : 0);
    const issueSpark: number[] = sparkTrends.map((t: TrendPoint) => t.count > 0 ? (t.issueCount / t.count) * 100 : 0);

    // One-period forecast for vital cards
    const ratingFc: FcResult = ratingSpark.length >= 2 ? anchoredForecast(ratingSpark, Math.min(4, ratingSpark.length), 1) : { fc: [], lo: [], hi: [], slope: 0, sd: 0 };
    const volFc: FcResult = volSpark.length >= 2 ? anchoredForecast(volSpark, Math.min(4, volSpark.length), 1) : { fc: [], lo: [], hi: [], slope: 0, sd: 0 };
    const fbFc: FcResult = fbSpark.length >= 2 ? anchoredForecast(fbSpark, Math.min(4, fbSpark.length), 1) : { fc: [], lo: [], hi: [], slope: 0, sd: 0 };

    // ── Signals + actions ──
    const signals: Signal[] = generateSignals(activeTrends, activeComp, tab, cadence, nps);
    const actions: Action[] = generateActions(signals, activeTrends, tab);
    const read: { h: string; p: string } = editorialRead(activeTrends, activeComp, tab);

    // ── Comp field accessors (correct shape) ──
    const curCount: number = activeComp?.current.count ?? 0;
    const prevCount: number = activeComp?.previous.count ?? 0;
    const curRating: number = activeComp?.current.avgRating ?? 0;
    const deltaRating: number | null = activeComp?.delta.rating ?? null;
    const deltaPct: number | null = activeComp?.delta.countPct ?? null;
    const curLabel: string = activeComp?.current.label ?? '';
    const prevLabel: string = activeComp?.previous.label ?? '';

    const ratingDelta: string = deltaRating != null ? `${deltaRating >= 0 ? '+' : ''}${deltaRating.toFixed(2)}` : '—';
    const ratingDir: 'good' | 'bad' | 'flat' = (deltaRating ?? 0) > 0.01 ? 'good' : (deltaRating ?? 0) < -0.01 ? 'bad' : 'flat';
    const volDeltaStr: string = deltaPct != null ? `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%` : prevCount > 0 ? `${(((curCount - prevCount) / prevCount) * 100).toFixed(1)}%` : '—';
    const volDir: 'good' | 'bad' | 'flat' = curCount > prevCount ? 'good' : curCount < prevCount ? 'bad' : 'flat';

    const lastPt: TrendPoint | undefined = activeTrends[activeTrends.length - 1];
    const prevPt: TrendPoint | undefined = activeTrends[activeTrends.length - 2];
    const fbRateCur: number = lastPt && lastPt.count > 0 ? (lastPt.feedbackCount / lastPt.count) * 100 : 0;
    const fbRatePrev: number = prevPt && prevPt.count > 0 ? (prevPt.feedbackCount / prevPt.count) * 100 : 0;
    const fbRateDelta: number = fbRateCur - fbRatePrev;
    const fbDir: 'good' | 'bad' | 'flat' = fbRateDelta > 0.3 ? 'good' : fbRateDelta < -0.3 ? 'bad' : 'flat';

    return (
        <div className={sp.panelRoot}>
            {/* ── Header ── */}
            <div className={sp.panelHeader}>
                <div>
                    <div className={sp.panelTitle}>Feedback Trends</div>
                    <div className={sp.panelSub}>
                        {isWow ? 'Week-over-week · last 12 weeks · next-period forecast' : 'Month-over-month · last 8 months · next-period forecast'}
                    </div>
                </div>
                <button className={sp.btnSecondary} onClick={() => void load()} disabled={loading}>
                    <RefreshCw size={13} className={loading ? sp.spin : ''} />
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {/* ── Full-width tabs ── */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, background: 'var(--sp-s2)', border: '1px solid var(--sp-border)', borderRadius: 13, padding: 5, width: '100%' }}>
                {(['wow', 'mom'] as TrendsTab[]).map((id: TrendsTab) => {
                    const isOn: boolean = tab === id;
                    return (
                        <button key={id} onClick={() => { setTab(id); setFcHorizon(id === 'wow' ? 3 : 2); }}
                            style={{
                                flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '12px 20px',
                                borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                                border: `1px solid ${isOn ? 'var(--sp-border)' : 'transparent'}`,
                                background: isOn ? 'linear-gradient(135deg,rgba(45,212,191,0.12),rgba(90,169,255,0.08))' : 'transparent',
                                opacity: isOn ? 1 : 0.55,
                            }}>
                            <span style={{ fontSize: 16, letterSpacing: '-0.01em', color: isOn ? '#CFFAF2' : 'var(--sp-txm)', fontWeight: isOn ? 700 : 400 }}>
                                {id === 'wow' ? 'Week over Week' : 'Month over Month'}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--sp-tx3)' }}>
                                {id === 'wow' ? 'last 12 weeks · +3 / +6 week forecast' : 'last 8 months · +2 / +3 month forecast'}
                            </span>
                        </button>
                    );
                })}
            </div>

            {loading ? (
                <div className={sp.emptyState} style={{ height: 200 }}>
                    <RefreshCw size={20} className={sp.spin} style={{ color: 'var(--sp-txm)' }} />
                    <span style={{ fontSize: 13, color: 'var(--sp-txm)', marginTop: 8 }}>Loading trends…</span>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 16 }}>

                    {/* ── Editorial read ── */}
                    <div style={{ maxWidth: 1020 }}>
                        <h2 style={{ fontSize: 28, fontWeight: 600, fontStyle: 'italic', letterSpacing: '-0.01em', margin: '0 0 8px', lineHeight: 1.1, color: 'var(--sp-tx1)', fontFamily: 'Georgia, serif' }}
                            dangerouslySetInnerHTML={{ __html: read.h }} />
                        <p style={{ fontStyle: 'italic', color: 'var(--sp-tx2)', fontSize: 14.5, margin: 0, lineHeight: 1.55, fontFamily: 'Georgia, serif' }}>{read.p}</p>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--sp-tx3)', alignItems: 'center', flexWrap: 'wrap' }}>
                            {[
                                { l: isWow ? 'This week' : 'This month', v: curCount > 0 ? curCount.toLocaleString() : '—', sub: curLabel },
                                { l: isWow ? 'Prior week' : 'Prior month', v: prevCount > 0 ? prevCount.toLocaleString() : '—', sub: prevLabel },
                                { l: 'Avg rating', v: curRating > 0 ? `${curRating.toFixed(2)}/7` : '—', sub: '' },
                                { l: 'Rating Δ', v: deltaRating != null ? `${deltaRating >= 0 ? '+' : ''}${deltaRating.toFixed(2)}` : '—', sub: '' },
                            ].map(({ l, v, sub }: { l: string; v: string; sub: string }, i: number) => (
                                <React.Fragment key={l}>
                                    {i > 0 && <span style={{ color: '#2a3650' }}>→</span>}
                                    <span title={sub} style={{ border: '1px solid var(--sp-border)', borderRadius: 7, padding: '4px 10px', color: 'var(--sp-tx2)' }}>
                                        {l} · <b style={{ color: 'var(--sp-tx1)' }}>{v}</b>
                                    </span>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>

                    {/* ── Vital signs ── */}
                    <div className={sp.card}>
                        <div className={sp.cardLabel} style={{ marginBottom: 14 }}>
                            <span className={sp.cardDot} />
                            Vital signs
                            <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--sp-tx3)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                                {isWow ? '8-period sparkline · next-week forecast' : '6-period sparkline · next-month forecast'}
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                            <VitalCard
                                label="Avg Rating"
                                value={curRating > 0 ? curRating.toFixed(2) : '—'} unit="/7"
                                sublabel={curLabel}
                                delta={ratingDelta} deltaDir={ratingDir}
                                arrow={ratingDir === 'good' ? '▲' : ratingDir === 'bad' ? '▼' : '→'}
                                spark={ratingSpark} sparkGood={ratingDir !== 'bad'}
                                fcVal={ratingFc.fc[0] != null ? Math.min(7, ratingFc.fc[0]).toFixed(2) : '—'}
                                fcRange={ratingFc.lo[0] != null && ratingFc.hi[0] != null
                                    ? `${Math.max(1, ratingFc.lo[0]).toFixed(2)} – ${Math.min(7, ratingFc.hi[0]).toFixed(2)}`
                                    : 'slope projection'}
                            />
                            <VitalCard
                                label={isWow ? 'Weekly Volume' : 'Monthly Volume'}
                                value={curCount > 0 ? curCount.toLocaleString() : '—'}
                                sublabel={curLabel}
                                delta={volDeltaStr} deltaDir={volDir}
                                arrow={volDir === 'good' ? '▲' : volDir === 'bad' ? '▼' : '→'}
                                spark={volSpark} sparkGood
                                fcVal={volFc.fc[0] != null ? Math.max(0, Math.round(volFc.fc[0])).toLocaleString() : '—'}
                                fcRange={volFc.lo[0] != null && volFc.hi[0] != null
                                    ? `${Math.max(0, Math.round(volFc.lo[0])).toLocaleString()} – ${Math.round(volFc.hi[0]).toLocaleString()}`
                                    : 'trend projection'}
                            />
                            <VitalCard
                                label="Feedback Rate"
                                value={`${fbRateCur.toFixed(1)}%`}
                                delta={`${fbRateDelta >= 0 ? '+' : ''}${fbRateDelta.toFixed(1)}pp`}
                                deltaDir={fbDir}
                                arrow={fbDir === 'good' ? '▲' : fbDir === 'bad' ? '▼' : '→'}
                                spark={fbSpark} sparkGood={fbRateDelta >= 0}
                                fcVal={fbFc.fc[0] != null ? `${Math.min(100, Math.max(0, fbFc.fc[0])).toFixed(1)}%` : '—'}
                                fcRange="feedback / total records"
                            />
                            <VitalCard
                                label="NPS Score"
                                value={`${nps.score >= 0 ? '+' : ''}${nps.score}`}
                                delta={nps.score >= 50 ? 'Strong' : nps.score >= 30 ? 'Moderate' : 'At risk'}
                                deltaDir={nps.score >= 40 ? 'good' : nps.score >= 0 ? 'flat' : 'bad'}
                                arrow={nps.score >= 40 ? '▲' : nps.score >= 0 ? '→' : '▼'}
                                spark={ratingSpark.map((v: number) => Math.max(0, (v - 1) / 6 * 100))}
                                sparkGood={nps.score >= 30}
                                fcVal={`${nps.promoterPct.toFixed(0)}% promo`}
                                fcRange={`${nps.detractorPct.toFixed(0)}% detract`}
                            />
                            <VitalCard
                                label="Detractor Rate"
                                value={`${nps.detractorPct.toFixed(1)}%`}
                                delta={`1–3★ · ${nps.detractorPct.toFixed(1)}% of rated`}
                                deltaDir={nps.detractorPct < 15 ? 'good' : nps.detractorPct < 25 ? 'flat' : 'bad'}
                                arrow={nps.detractorPct < 15 ? '▼' : nps.detractorPct < 25 ? '→' : '▲'}
                                spark={issueSpark} sparkGood={false}
                                fcVal={nps.detractorPct < 20 ? 'Healthy' : 'Watch'}
                                fcRange={`${nps.passivePct.toFixed(0)}% passive`}
                            />
                        </div>
                    </div>

                    {/* ── Trajectory + forecast ── */}
                    <div className={sp.card}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                            <div className={sp.cardLabel}>
                                <span className={sp.cardDot} />
                                Trajectory &amp; forecast — avg rating
                                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--sp-tx3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                                    slope from last {fitN} {isWow ? 'weeks' : 'months'} · anchored to current
                                </span>
                            </div>
                            <div style={{ display: 'flex', border: '1px solid var(--sp-border)', borderRadius: 8, overflow: 'hidden' }}>
                                {horizons.map(([lbl, h]: [string, number]) => (
                                    <button key={h} onClick={() => setFcHorizon(h)} style={{
                                        background: fcHorizon === h ? 'rgba(45,212,191,0.16)' : 'transparent',
                                        border: 0, color: fcHorizon === h ? '#CFFAF2' : 'var(--sp-tx3)',
                                        fontFamily: 'inherit', fontSize: 11, padding: '5px 12px', cursor: 'pointer',
                                    }}>{lbl}</button>
                                ))}
                            </div>
                        </div>
                        <ForecastChart histSeries={histSeries} fitN={fitN} labels={fcLabels} fcHorizon={fcHorizon} />
                        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 11.5, color: 'var(--sp-txm)' }}>
                            {[
                                { label: 'Observed', color: '#5AA9FF', dash: false },
                                { label: `Forecast (slope from last ${fitN})`, color: '#2DD4BF', dash: true },
                                { label: 'Confidence band', color: 'rgba(45,212,191,0.12)', isRect: true },
                            ].map((x: { label: string; color: string; dash?: boolean; isRect?: boolean }) => (
                                <span key={x.label} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                                    {x.isRect
                                        ? <span style={{ width: 14, height: 10, background: x.color, borderRadius: 2, display: 'inline-block' }} />
                                        : <span style={{ width: 14, height: 0, borderTopWidth: 2.5, borderTopStyle: x.dash ? 'dashed' : 'solid', borderTopColor: x.color, display: 'inline-block' }} />
                                    }
                                    {x.label}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* ── Distribution + NPS ── */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div className={sp.card}>
                            <div className={sp.cardLabel} style={{ marginBottom: 14 }}>
                                <span className={sp.cardDot} />
                                Rating distribution
                                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--sp-tx3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>all-time · bar = share of rated</span>
                            </div>
                            <DistributionCard ratings={ratings} deltaRating={deltaRating} />

                            {/* Cadence under distribution */}
                            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--sp-border)' }}>
                                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sp-txm)', fontWeight: 700, marginBottom: 10 }}>
                                    Avg rating by {isWow ? 'day of week' : 'week of month'} · VIBGYOR scale
                                </div>
                                <CadenceChart data={cadence} weeklyAvgSpark={weeklyAvgSpark} mode={tab} />
                            </div>
                        </div>

                        <div className={sp.card}>
                            <div className={sp.cardLabel} style={{ marginBottom: 14 }}>
                                <span className={sp.cardDot} style={{ background: '#34D399', boxShadow: '0 0 0 3px rgba(52,211,153,0.18)' }} />
                                Promoters &amp; detractors — NPS
                                <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--sp-tx3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>6–7★ promoters · 4–5★ passive · 1–3★ detractors</span>
                            </div>
                            {nps.totalRated > 0
                                ? <NPSDisplay nps={nps} />
                                : <div style={{ color: 'var(--sp-txm)', fontSize: 12 }}>No rating data to compute NPS.</div>
                            }

                            {/* Channel shift under NPS */}
                            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--sp-border)' }}>
                                <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--sp-txm)', fontWeight: 700, marginBottom: 10 }}>
                                    Channel shift
                                </div>
                                <ChannelShift trends={activeTrends} mode={tab} />
                            </div>
                        </div>
                    </div>

                    {/* ── Signals ── */}
                    <div className={sp.card}>
                        <div className={sp.cardLabel} style={{ marginBottom: 14 }}>
                            <span className={sp.cardDot} />
                            Signals &amp; predictive callouts
                            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--sp-tx3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                                <span style={{ color: '#2DD4BF' }}>■</span> forecast &nbsp;
                                <span style={{ color: '#F5B014' }}>■</span> anomaly &nbsp;
                                <span style={{ color: '#F4516C' }}>■</span> risk
                            </span>
                        </div>
                        <SignalList signals={signals} />
                    </div>

                    {/* ── Actions ── */}
                    <div className={sp.card}>
                        <div className={sp.cardLabel} style={{ marginBottom: 14 }}>
                            <span className={sp.cardDot} style={{ background: '#F4516C', boxShadow: '0 0 0 3px rgba(244,81,108,0.18)' }} />
                            Where to push — ranked by impact × ease
                        </div>
                        <ActionList actions={actions} />
                    </div>

                    {/* ── Period breakdown table ── */}
                    {activeTrends.length > 0 && (
                        <div className={sp.card}>
                            <div className={sp.cardLabel} style={{ marginBottom: 12 }}>
                                <span className={sp.cardDot} style={{ background: '#F59E0B' }} />
                                {isWow ? 'Weekly' : 'Monthly'} breakdown — last {Math.min(activeTrends.length, 12)} periods
                            </div>
                            <PeriodTable trends={activeTrends} isWow={isWow} />
                        </div>
                    )}

                </div>
            )}
        </div>
    );
}
