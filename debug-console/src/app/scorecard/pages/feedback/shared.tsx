'use client';

import React, { useRef, useState } from 'react';

import type { IntervalDataPoint, IntervalSeries } from '../../components';
import type { TrendView } from '../../types';
import { aggregateByView } from '../../trendAggregation';

export function fmtWeek(iso: string): string {
  const d: Date = new Date(iso);
  const months: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function Tip({ text, children, style }: { text: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const [show, setShow]       = useState(false);
  const [alignLeft, setAlign] = useState(false);
  const wrapRef               = useRef<HTMLSpanElement>(null);

  const handleEnter = (): void => {
    if (wrapRef.current) {
      const left: number = wrapRef.current.getBoundingClientRect().left;
      setAlign(left < 420);
    }
    setShow(true);
  };

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)',
          ...(alignLeft
            ? { left: '0', transform: 'none' }
            : { left: '50%', transform: 'translateX(-50%)' }),
          background: 'var(--sp-s2)', color: 'var(--sp-tx1)', borderRadius: '6px',
          padding: '0.35rem 0.6rem', fontSize: '0.65rem', lineHeight: 1.45,
          whiteSpace: 'normal', width: 'max-content', maxWidth: '240px',
          zIndex: 50, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

export function Donut({ rate, label, size = 72 }: { rate: number | null; label: string; size?: number }) {
  const pct: number   = rate ?? 0;
  const color: string = pct >= 65 ? '#10b981' : pct >= 50 ? '#f59e0b' : pct > 0 ? '#ef4444' : 'var(--sp-s3)';
  const inner: number = size * 0.72;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${color} ${pct}%, var(--sp-s3) ${pct}%)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: inner, height: inner, borderRadius: '50%', background: 'var(--sp-s1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: size > 60 ? '0.76rem' : '0.58rem', fontWeight: 800, color, fontFamily: 'monospace' }}>
            {rate !== null ? `${rate}%` : '—'}
          </span>
        </div>
      </div>
      <span style={{ fontSize: '0.58rem', color: 'var(--sp-tx2)', fontWeight: 500 }}>{label}</span>
    </div>
  );
}

export const CAT_COLORS: readonly string[] = [
  '#8b5cf6', '#0891b2', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#6366f1', '#14b8a6',
  '#f97316', '#84cc16',
];

export const STAR_COLORS: Record<string, string> = {
  '7': '#10b981', '6': '#22c55e', '5': '#84cc16',
  '4': '#eab308', '3': '#f97316', '2': '#ef4444', '1': '#dc2626',
};

export function starColor(score: number): string {
  return score >= 6 ? '#10b981' : score >= 4 ? '#f59e0b' : '#ef4444';
}

export function buildStarTrendPoints(
  daily: Record<string, Record<string, number>>,
  trendView: TrendView,
): { points: IntervalDataPoint[]; series: IntervalSeries[] } {
  const STARS: string[] = ['1', '2', '3', '4', '5', '6', '7'];
  const sortedDates: string[] = Object.keys(daily).sort();
  const rawPoints: IntervalDataPoint[] = sortedDates.map((date): IntervalDataPoint => {
    const bucket: Record<string, number> = daily[date] ?? {};
    const pt: IntervalDataPoint = { label: date.slice(5), _date: date };
    for (const s of STARS) pt[`s${s}`] = bucket[s] ?? 0;
    return pt;
  });
  const seriesKeys: string[] = STARS.map((s) => `s${s}`);
  const points: IntervalDataPoint[]  = aggregateByView(rawPoints, seriesKeys, trendView);
  const series: IntervalSeries[]     = STARS.map((s): IntervalSeries => ({
    key:   `s${s}`,
    label: `★${s}`,
    color: STAR_COLORS[s]!,
  }));
  return { points, series };
}
