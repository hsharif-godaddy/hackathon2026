'use client';

import React from 'react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
}: {
  title?: string;
  data: NameValue[];
  barColor?: string;
  height?: number;
  nameMaxLen?: number;
  valueLabel?: string;
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
  const rowH = Math.max(28, Math.min(40, height / Math.max(chartData.length, 1)));
  const chartHeight = Math.min(420, Math.max(height, chartData.length * rowH + 48));

  return (
    <div style={{ width: '100%' }}>
      {title ? (
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.45rem' }}>{title}</div>
      ) : null}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart layout="vertical" data={chartData} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
          <YAxis type="category" dataKey="label" width={118} tick={{ fontSize: 10 }} stroke="#64748b" />
          <Tooltip formatter={(v: number) => [v.toLocaleString(), valueLabel]} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="value" fill={barColor} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VerticalBarChart({
  title,
  data,
  barColor = '#6366f1',
  height = 240,
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
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.45rem' }}>{title}</div>
      ) : null}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 52 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9 }} stroke="#94a3b8" angle={-32} textAnchor="end" interval={0} height={48} />
          <YAxis tick={{ fontSize: 11 }} stroke="#64748b" width={44} />
          <Tooltip formatter={(v: number) => [v.toLocaleString(), valueLabel]} contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="value" fill={barColor} radius={[4, 4, 0, 0]} maxBarSize={48} />
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
  height = 140,
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
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="#64748b" />
          <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" width={36} />
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
