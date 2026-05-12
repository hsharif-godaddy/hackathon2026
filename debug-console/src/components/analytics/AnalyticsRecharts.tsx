'use client';

import React from 'react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { C1Engagement7dRow } from '@/lib/c1-analytics-server';

const TOOLTIP_STYLE = { fontSize: '12px' };

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export interface NameValue {
  name: string;
  value: number;
}

export function HorizontalBarChart({
  title,
  data,
  barColor = '#7c3aed',
  height = 220,
  nameMaxLen = 36,
  valueLabel = 'Count',
  minRowHeight = 46,
  maxChartHeight = 720,
  yAxisWidth = 210,
  barCategoryGap = '22%',
}: {
  title?: string;
  data: NameValue[];
  barColor?: string;
  height?: number;
  nameMaxLen?: number;
  valueLabel?: string;
  /** Minimum pixels reserved per category row (spacing for Y-axis labels). */
  minRowHeight?: number;
  maxChartHeight?: number;
  yAxisWidth?: number;
  barCategoryGap?: number | string;
}) {
  if (!data.length) {
    return (
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '0.5rem 0' }}>No chart data</div>
    );
  }
  const chartData = data.map((d) => ({
    ...d,
    label: truncate(d.name, nameMaxLen),
  }));
  const n = Math.max(chartData.length, 1);
  const chartHeight = Math.min(maxChartHeight, Math.max(height, n * minRowHeight + 96));

  return (
    <div style={{ width: '100%' }}>
      {title ? (
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.55rem' }}>{title}</div>
      ) : null}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          layout="vertical"
          data={chartData}
          margin={{ top: 14, right: 28, left: 8, bottom: 14 }}
          barCategoryGap={barCategoryGap}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis
            type="category"
            dataKey="label"
            width={yAxisWidth}
            tick={{ fontSize: 11 }}
            stroke="#64748b"
            tickMargin={10}
            interval={0}
          />
          <Tooltip formatter={(v: number) => [v.toLocaleString(), valueLabel]} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="value" fill={barColor} radius={[0, 6, 6, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EngagementFunnelRows({
  steps,
}: {
  steps: ReadonlyArray<{ label: string; count: number; pct_of_top: number }>;
}) {
  if (!steps.length) {
    return <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No funnel data</div>;
  }
  const max = steps.reduce(function maxCount(m, s) {
    return Math.max(m, s.count);
  }, 0);
  return (
    <div>
      {steps.map(function row(s, i) {
        const widthPct = max > 0 ? Math.max(0, Math.min(100, (s.count / max) * 100)) : 0;
        const isLast = i === steps.length - 1;
        return (
          <div
            key={s.label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(88px, 1.1fr) minmax(96px, 2.4fr) auto',
              gap: '0.85rem',
              alignItems: 'center',
              padding: '0.78rem 0',
              borderBottom: isLast ? undefined : '1px solid #eef2f6',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', lineHeight: 1.35 }}>{s.label}</div>
            <div
              style={{
                position: 'relative',
                height: 30,
                backgroundColor: '#f1f5f9',
                borderRadius: 999,
                overflow: 'hidden',
              }}
              aria-hidden
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${widthPct}%`,
                  minWidth: s.count > 0 ? 6 : 0,
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, #2563eb 0%, #3b82f6 42%, #93c5fd 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
                }}
              />
            </div>
            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {s.count.toLocaleString('en-US')} ({s.pct_of_top}%)
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function EngagementDauWau7dChart({
  data,
  height = 300,
}: {
  data: C1Engagement7dRow[];
  height?: number;
}) {
  if (!data.length) {
    return (
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '2rem 0', textAlign: 'center' }}>No chart data</div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 16, right: 18, left: 4, bottom: 8 }}>
          <defs>
            <linearGradient id="c1DauBarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0.88} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} stroke="#cbd5e1" width={44} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
            }}
            formatter={function tooltipFmt(value: number, name: string) {
              return [value.toLocaleString('en-US'), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 10 }} iconType="circle" />
          <Bar dataKey="dau" name="DAU (page views)" fill="url(#c1DauBarFill)" radius={[6, 6, 0, 0]} maxBarSize={36} />
          <Line
            type="monotone"
            dataKey="wau"
            name="WAU (7-day rolling)"
            stroke="#3b82f6"
            strokeWidth={2.75}
            dot={{ fill: '#1d4ed8', stroke: '#fff', strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VerticalBarChart({
  title,
  data,
  barColor = '#6366f1',
  height = 260,
  valueLabel = 'Value',
}: {
  title?: string;
  data: NameValue[];
  barColor?: string;
  height?: number;
  valueLabel?: string;
}) {
  if (!data.length) {
    return (
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '0.5rem 0' }}>No chart data</div>
    );
  }
  const chartData = data.map((d) => ({
    ...d,
    label: truncate(d.name, 20),
  }));

  return (
    <div style={{ width: '100%' }}>
      {title ? (
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.55rem' }}>{title}</div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 14, right: 12, left: 4, bottom: 56 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" angle={-32} textAnchor="end" interval={0} height={52} />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" width={48} />
          <Tooltip formatter={(v: number) => [v.toLocaleString(), valueLabel]} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="value" fill={barColor} radius={[4, 4, 0, 0]} maxBarSize={54} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CurrPrevBarChart({
  title,
  currLabel,
  prevLabel,
  curr,
  prev,
  currColor,
  prevColor,
  height = 156,
}: {
  title: string;
  currLabel: string;
  prevLabel: string;
  curr: number;
  prev: number;
  currColor: string;
  prevColor: string;
  height?: number;
}) {
  const chartData = [
    { period: currLabel, value: curr, fill: currColor },
    { period: prevLabel, value: prev, fill: prevColor },
  ];

  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={40} />
          <Tooltip formatter={(v: number) => [v.toLocaleString(), '']} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
            {chartData.map((entry) => (
              <Cell key={entry.period} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SentimentPieChart({
  positive,
  neutral,
  negative,
  height = 200,
}: {
  positive: number;
  neutral: number;
  negative: number;
  height?: number;
}) {
  const data = [
    { name: 'Positive', value: positive, fill: '#16a34a' },
    { name: 'Neutral', value: neutral, fill: '#94a3b8' },
    { name: 'Negative', value: negative, fill: '#dc2626' },
  ].filter((d) => d.value > 0);

  if (!data.length) {
    return (
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '0.5rem 0' }}>No ratings in window</div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '280px' }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Count']} contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
