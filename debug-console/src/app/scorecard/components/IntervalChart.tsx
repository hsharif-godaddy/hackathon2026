'use client';

import React, { useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface IntervalDataPoint {
  label: string;
  [key: string]: string | number;
}

export interface IntervalSeries {
  key: string;
  label: string;
  color: string;
  format?: (v: number) => string;
}

type ChartType = 'bar' | 'line';

interface Props {
  data: IntervalDataPoint[];
  series: IntervalSeries[];
  size?: 'small' | 'large' | 'full';
  defaultType?: ChartType;
  defaultActive?: string[];
}

const HEIGHT: Record<string, number> = { small: 140, large: 180, full: 220 };

export function IntervalChart({ data, series, size = 'small', defaultType = 'bar', defaultActive }: Props) {
  const [chartType, setChartType] = useState<ChartType>(defaultType);
  const [active, setActive] = useState<Set<string>>(
    new Set(defaultActive ?? series.map((s) => s.key)),
  );

  const toggle = (key: string): void => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const h: number = HEIGHT[size] ?? 160;
  const visible: IntervalSeries[] = series.filter((s) => active.has(s.key));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
      {/* Controls row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {series.map((s) => {
            const on: boolean = active.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                style={{
                  padding: '0.18rem 0.5rem', borderRadius: '5px', fontSize: '0.6rem',
                  fontWeight: on ? 700 : 500, cursor: 'pointer', transition: 'all 0.12s',
                  color: on ? 'white' : s.color,
                  background: on ? s.color : `${s.color}18`,
                  border: `1px solid ${on ? s.color : `${s.color}44`}`,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {(['bar', 'line'] as const).map((t) => {
            const on: boolean = chartType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setChartType(t)}
                style={{
                  padding: '0.18rem 0.45rem', borderRadius: '5px', fontSize: '0.6rem',
                  fontWeight: on ? 700 : 400, cursor: 'pointer', transition: 'all 0.12s',
                  color: on ? 'white' : '#64748b',
                  background: on ? '#334155' : '#f1f5f9',
                  border: `1px solid ${on ? 'var(--sp-accent)' : 'var(--sp-border)'}`,
                }}
              >
                {t === 'bar' ? '▬ Bar' : '〜 Line'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={h}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={48}
            tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v)}
          />
          <Tooltip
            contentStyle={{ fontSize: '0.68rem', borderRadius: '6px', border: '1px solid var(--sp-border)', padding: '0.35rem 0.6rem', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            itemStyle={{ padding: '1px 0' }}
            labelStyle={{ fontWeight: 600, color: 'var(--sp-tx1)', marginBottom: '2px' }}
            formatter={(value: unknown, name: unknown) => {
              const s: IntervalSeries | undefined = series.find((sr) => sr.key === name);
              const num: number = Number(value);
              return [s?.format ? s.format(num) : num.toLocaleString(), s?.label ?? String(name)];
            }}
          />
          {visible.map((s) =>
            chartType === 'bar' ? (
              <Bar key={s.key} dataKey={s.key} fill={s.color} fillOpacity={0.82} radius={[3, 3, 0, 0]} maxBarSize={20} />
            ) : (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 4 }} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
