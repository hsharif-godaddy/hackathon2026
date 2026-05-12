'use client';

import React, { useMemo, useState } from 'react';
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

import RisqSectionCard, { risqPillToggleStyle } from '@/components/RisqSectionCard';

const TOOLTIP_STYLE = { fontSize: '12px' };

const ERROR_TYPE_COLORS: Record<string, string> = {
  'bad request': '#ef4444',
  bad_request: '#ef4444',
  'content policy restriction': '#eab308',
  content_policy_restriction: '#eab308',
  'edit hallucination': '#92400e',
  edit_hallucination: '#92400e',
  'file not found': '#a855f7',
  file_not_found: '#a855f7',
  'invalid json': '#3b82f6',
  invalid_json: '#3b82f6',
  'quota exceeded': '#22c55e',
  quota_exceeded: '#22c55e',
  'request timeout': '#94a3b8',
  request_timeout: '#94a3b8',
};

const FALLBACK_COLORS = ['#6366f1', '#f97316', '#14b8a6', '#ec4899', '#84cc16', '#64748b'];

function colorForErrorType(label: string, index: number): string {
  const k = label.toLowerCase();
  if (ERROR_TYPE_COLORS[k]) return ERROR_TYPE_COLORS[k];
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function formatDayLabel(isoDay: string): string {
  const d = new Date(`${isoDay}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDay;
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
}

export interface ToolErrorRow {
  error_type: string;
  count: number;
  pct?: number;
}

export interface ToolErrorDailyRow {
  day: string;
  error_type: string;
  count: number;
}

export interface ToolErrorBreakdownPanelProps {
  toolErrors24h: { rows: ToolErrorRow[]; total?: number };
  toolErrorsDaily: { rows: ToolErrorDailyRow[] };
  /** Omit outer card when nested inside another section card (e.g. Langfuse insights). */
  embedded?: boolean;
}

type RangeMode = '24h' | '7d';

export default function ToolErrorBreakdownPanel({ toolErrors24h, toolErrorsDaily, embedded = false }: ToolErrorBreakdownPanelProps) {
  const [mode, setMode] = useState<RangeMode>('7d');

  const { stackedChartData, stackKeys, stackLabels } = useMemo(function pivotDaily() {
    const rows = toolErrorsDaily.rows ?? [];
    const byDay = new Map<string, Map<string, number>>();
    const typeTotals = new Map<string, number>();

    for (const r of rows) {
      if (!r.day) continue;
      if (!byDay.has(r.day)) byDay.set(r.day, new Map());
      const m = byDay.get(r.day)!;
      const next = (m.get(r.error_type) ?? 0) + r.count;
      m.set(r.error_type, next);
      typeTotals.set(r.error_type, (typeTotals.get(r.error_type) ?? 0) + r.count);
    }

    const sortedDays = [...byDay.keys()].sort();
    const types = [...typeTotals.keys()].sort(function sortByTotal(a, b) {
      return (typeTotals.get(b) ?? 0) - (typeTotals.get(a) ?? 0);
    });

    const chartData = sortedDays.map(function mapDay(day) {
      const row: Record<string, string | number> = {
        dayLabel: formatDayLabel(day),
      };
      const counts = byDay.get(day)!;
      types.forEach(function assignType(t, i) {
        row[`v${i}`] = counts.get(t) ?? 0;
      });
      return row;
    });

    return {
      stackedChartData: chartData,
      stackKeys: types.map(function keyAt(_t, i) {
        return `v${i}`;
      }),
      stackLabels: types,
    };
  }, [toolErrorsDaily.rows]);

  const pieData = useMemo(
    function buildPie() {
      return (toolErrors24h.rows ?? [])
        .filter((r) => r.count > 0)
        .map(function mapSlice(r, i) {
          return {
            name: r.error_type,
            value: r.count,
            fill: colorForErrorType(r.error_type, i),
          };
        });
    },
    [toolErrors24h.rows],
  );

  const toggleRow = (
    <div style={{ display: 'flex', gap: '0.35rem' }}>
      <button type="button" style={risqPillToggleStyle(mode === '24h')} onClick={function select24h() { setMode('24h'); }}>
        24h
      </button>
      <button type="button" style={risqPillToggleStyle(mode === '7d')} onClick={function select7d() { setMode('7d'); }}>
        7 Days
      </button>
    </div>
  );

  const chartBlock =
    mode === '7d' ? (
      stackedChartData.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No daily tool-error-eval scores in this window (or Langfuse did not return day buckets).</div>
      ) : (
        <div style={{ width: '100%', minHeight: 300 }}>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={stackedChartData} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="dayLabel" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#64748b" width={44} />
              <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Count']} contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              {stackKeys.map(function mapBar(key, i) {
                const label = stackLabels[i] ?? key;
                return (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="toolErr"
                    name={label}
                    fill={colorForErrorType(label, i)}
                    maxBarSize={56}
                  />
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )
    ) : pieData.length === 0 ? (
      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No tool-error-eval scores in the last 24 hours.</div>
    ) : (
      <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={88}
              paddingAngle={1}
              stroke="#f1f5f9"
              strokeWidth={1}
            >
              {pieData.map(function mapCell(entry) {
                return <Cell key={entry.name} fill={entry.fill} />;
              })}
            </Pie>
            <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Count']} contentStyle={TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );

  if (embedded) {
    return (
      <RisqSectionCard variant="compact" title="Tool error breakdown — Langfuse" icon="🔧" actions={toggleRow} marginBottom="0">
        {chartBlock}
      </RisqSectionCard>
    );
  }

  return (
    <RisqSectionCard title="Tool Error Breakdown — Langfuse" icon="🔧" actions={toggleRow}>
      {chartBlock}
    </RisqSectionCard>
  );
}
