'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { HorizontalBarChart, VerticalBarChart } from '@/components/analytics/AnalyticsRecharts';
import LangfuseDeepDiveSearchPanel from '@/components/LangfuseDeepDiveSearchPanel';
import RisqSectionCard, {
  risqSectionDataPanel,
  risqSectionInnerWell,
  risqSectionSurface,
} from '@/components/RisqSectionCard';
import ToolErrorBreakdownPanel from '@/components/ToolErrorBreakdownPanel';

interface LangfuseInsightsPanelProps {
  fromTimestamp: string;
  toTimestamp: string;
}

interface BundleMeta {
  uiBaseUrl: string | null;
  panelErrors?: Partial<
    Record<
      | 'overview'
      | 'sentiment'
      | 'actionIntents'
      | 'verticals'
      | 'performance'
      | 'toolErrors'
      | 'toolErrors24h'
      | 'toolErrorsDaily'
      | 'recentErrors'
      | 'model',
      string
    >
  >;
}

interface OverviewPayload {
  from_date: string;
  to_date: string;
  total_traces: number;
  total_cost: number;
  total_scores: number;
  model_costs: Array<{
    model: string | null;
    cost: number;
    input_tokens: number;
    output_tokens: number;
    count_obs: number;
  }>;
  score_by_name: Record<string, number>;
}

interface CategoricalBlock {
  from_date: string;
  to_date: string;
  total?: number;
  rows: Array<Record<string, string | number>>;
}

interface PerfRow {
  name: string;
  count: number;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

interface PerformancePayload {
  from_date: string;
  to_date: string;
  total: PerfRow;
  observations: PerfRow[];
}

interface TraceRow {
  id?: string;
  name?: string;
  timestamp?: string;
  error_type?: string;
  url?: string | null;
  app_id?: string;
}

function formatTraceTimeUtc(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

interface ToolErrorsDailyPayload {
  from_date: string;
  to_date: string;
  rows: Array<{ day: string; error_type: string; count: number }>;
}

interface Bundle {
  meta: BundleMeta;
  overview: OverviewPayload;
  sentiment: Record<string, unknown>;
  actionIntents: CategoricalBlock;
  verticals: CategoricalBlock;
  performance: PerformancePayload;
  toolErrors: CategoricalBlock;
  toolErrors24h: CategoricalBlock;
  toolErrorsDaily: ToolErrorsDailyPayload;
  recentErrors: { traces: TraceRow[]; trace_fetch_errors?: number };
  model: { model: string | null; trace_id: string | null };
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.75rem 1rem',
  fontSize: '0.7rem',
  fontWeight: 700,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  borderBottom: '1px solid #e2e8f0',
};

const td: React.CSSProperties = {
  padding: '0.75rem 1rem',
  fontSize: '0.8125rem',
  color: '#334155',
  borderBottom: '1px solid #eef2f7',
  verticalAlign: 'middle',
};

const TOOL_ERR_TYPE_COLORS: Record<string, string> = {
  'bad request': '#ef4444',
  'bad_request': '#ef4444',
  'content policy restriction': '#eab308',
  'content_policy_restriction': '#eab308',
  'edit hallucination': '#92400e',
  'edit_hallucination': '#92400e',
  'file not found': '#a855f7',
  'file_not_found': '#a855f7',
  'invalid json': '#3b82f6',
  'invalid_json': '#3b82f6',
  'quota exceeded': '#22c55e',
  'quota_exceeded': '#22c55e',
  'request timeout': '#94a3b8',
  'request_timeout': '#94a3b8',
};

const TOOL_ERR_FALLBACK_COLORS = ['#6366f1', '#f97316', '#14b8a6', '#ec4899', '#84cc16', '#64748b'];

function colorForToolErrorTypeLabel(label: string, index: number): string {
  const k = (label || '').toLowerCase().trim();
  if (TOOL_ERR_TYPE_COLORS[k]) return TOOL_ERR_TYPE_COLORS[k];
  return TOOL_ERR_FALLBACK_COLORS[index % TOOL_ERR_FALLBACK_COLORS.length];
}

function MiniTable({
  title,
  columns,
  rows,
  horizontalBar,
  verticalBar,
  scrollMaxHeight,
  alignRight,
}: {
  title: string;
  columns: { key: string; label: string }[];
  rows: Array<Record<string, string | number>>;
  horizontalBar?: {
    labelKey: string;
    valueKey: string;
    barColor?: string;
    chartHeight?: number;
    valueLabel?: string;
  };
  verticalBar?: { labelKey: string; valueKey: string; barColor?: string; chartHeight?: number };
  scrollMaxHeight?: string;
  alignRight?: string[];
}) {
  const right = alignRight ? new Set(alignRight) : null;
  const stickyHead = Boolean(scrollMaxHeight);
  if (!rows.length) {
    return (
      <RisqSectionCard variant="compact" title={title} marginBottom="0">
        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No data</div>
      </RisqSectionCard>
    );
  }

  let hBarData: { name: string; value: number }[] | null = null;
  if (horizontalBar) {
    hBarData = rows
      .slice(0, 20)
      .map((r) => ({
        name: String(r[horizontalBar.labelKey] ?? ''),
        value: Number(r[horizontalBar.valueKey]),
      }))
      .filter((d) => d.name && !Number.isNaN(d.value));
  }

  let vBarData: { name: string; value: number }[] | null = null;
  if (verticalBar) {
    vBarData = rows
      .slice(0, 16)
      .map((r) => ({
        name: String(r[verticalBar.labelKey] ?? ''),
        value: Number(String(r[verticalBar.valueKey]).replace(/,/g, '')),
      }))
      .filter((d) => d.name && !Number.isNaN(d.value));
  }

  return (
    <RisqSectionCard variant="compact" title={title} marginBottom="0">
      {vBarData && vBarData.length > 0 ? (
        <div style={{ marginBottom: '0.85rem' }}>
          <VerticalBarChart
            data={vBarData}
            barColor={verticalBar?.barColor ?? '#6366f1'}
            height={verticalBar?.chartHeight ?? 200}
            valueLabel={columns.find((c) => c.key === verticalBar?.valueKey)?.label ?? 'Value'}
          />
        </div>
      ) : null}
      {hBarData && hBarData.length > 0 ? (
        <div style={{ marginBottom: '0.85rem' }}>
          <HorizontalBarChart
            data={hBarData}
            barColor={horizontalBar?.barColor ?? '#7c3aed'}
            height={horizontalBar?.chartHeight ?? 200}
            valueLabel={
              horizontalBar?.valueLabel ??
              columns.find((c) => c.key === horizontalBar?.valueKey)?.label ??
              'Count'
            }
          />
        </div>
      ) : null}
      <div
        style={{
          overflowX: 'auto',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          backgroundColor: '#ffffff',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          maxHeight: verticalBar || horizontalBar ? '200px' : scrollMaxHeight,
          overflowY: verticalBar || horizontalBar ? 'auto' : scrollMaxHeight ? 'auto' : undefined,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={{
                    ...th,
                    textAlign: right?.has(c.key) ? 'right' : 'left',
                    ...(stickyHead
                      ? {
                          position: 'sticky',
                          top: 0,
                          zIndex: 2,
                          backgroundColor: '#f1f5f9',
                          boxShadow: 'inset 0 -1px 0 #e2e8f0',
                        }
                      : { backgroundColor: '#f0f6ff' }),
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => (
              <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f0f6ff' }}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      ...td,
                      textAlign: right?.has(c.key) ? 'right' : 'left',
                      fontVariantNumeric: right?.has(c.key) ? 'tabular-nums' : undefined,
                    }}
                  >
                    {String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </RisqSectionCard>
  );
}

export default function LangfuseInsightsPanel({ fromTimestamp, toTimestamp }: LangfuseInsightsPanelProps) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async function loadBundle() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        action: 'bundle',
        fromTimestamp,
        toTimestamp,
      });
      const res = await fetch(`/api/langfuse-analytics?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBundle(data as Bundle);
    } catch (e) {
      setBundle(null);
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [fromTimestamp, toTimestamp]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !bundle) {
    return (
      <div style={{ ...risqSectionSurface, padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
        Loading Langfuse insights…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...risqSectionSurface, padding: '1rem 1.25rem', borderLeft: '4px solid #ef4444', color: '#b91c1c', fontSize: '0.8rem' }}>
        {error}
      </div>
    );
  }

  if (!bundle) return null;

  const { overview, sentiment, actionIntents, verticals, performance, toolErrors, toolErrors24h, toolErrorsDaily, recentErrors, model, meta } =
    bundle;
  const emotion = sentiment['emotion-type'] as { rows?: { value: string; count: number; pct: number }[] } | undefined;
  const polarity = sentiment['sentiment-polarity'] as
    | { rows?: { value: string; count: number; pct: number }[] }
    | undefined;

  const scoreEntries = Object.entries(overview.score_by_name || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <RisqSectionCard
        title="Langfuse insights"
        icon="📈"
        subtitle="Traces, costs, scores, and latency for the selected window. Charts summarize distributions; tables retain exact values. Use Langfuse UI for deep dives."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {meta.uiBaseUrl ? (
              <a
                href={meta.uiBaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '0.75rem',
                  color: '#2563eb',
                  fontWeight: 600,
                }}
              >
                Open Langfuse UI ↗
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => load()}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Refresh
            </button>
          </div>
        }
      >
        {meta.panelErrors && Object.keys(meta.panelErrors).length > 0 ? (
          <div
            style={{
              marginBottom: '0.65rem',
              padding: '0.6rem 0.75rem',
              borderRadius: '10px',
              border: '1px solid #fbbf24',
              backgroundColor: '#fffbeb',
              fontSize: '0.74rem',
              color: '#92400e',
              lineHeight: 1.45,
            }}
          >
            Some insight panels failed to load (partial data shown). Panels:{' '}
            {Object.entries(meta.panelErrors)
              .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)
              .join(' · ')}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Window: <strong style={{ color: '#334155' }}>{overview.from_date}</strong> → <strong style={{ color: '#334155' }}>{overview.to_date}</strong>
            {loading ? ' · refreshing…' : ''}
          </span>
        </div>
      </RisqSectionCard>

      <RisqSectionCard
        title="Tool errors & evaluations"
        icon="🔧"
        subtitle="tool-error-eval: last 7 days by day (stacked) vs last 24 hours (pie), plus recent traces."
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.75rem',
            width: '100%',
          }}
        >
          <div style={{ width: '100%', minWidth: 0 }}>
            <ToolErrorBreakdownPanel
              embedded
              toolErrors24h={{
                rows: (toolErrors24h.rows ?? []).map((r) => ({
                  error_type: String(r.error_type ?? ''),
                  count: Number(r.count ?? 0),
                  pct: typeof r.pct === 'number' ? r.pct : undefined,
                })),
              }}
              toolErrorsDaily={toolErrorsDaily}
            />
          </div>
          <div style={{ width: '100%', minWidth: 0 }}>
            <MiniTable
              title="Tool error eval (full window)"
              columns={[
                { key: 'error_type', label: 'Type' },
                { key: 'count', label: 'Count' },
                { key: 'pct', label: '%' },
              ]}
              rows={(toolErrors.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
              scrollMaxHeight="min(420px, 50vh)"
              alignRight={['count', 'pct']}
            />
          </div>
          <div style={{ width: '100%', minWidth: 0 }}>
            <RisqSectionCard
              variant="compact"
              title="Recent tool errors"
              subtitle="Same header date range · top traces"
              marginBottom="0"
            >
              {(recentErrors.trace_fetch_errors ?? 0) > 0 ? (
                <div style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: '0.45rem', lineHeight: 1.35 }}>
                  {recentErrors.trace_fetch_errors} trace detail request(s) failed — list may be incomplete. Check server logs.
                </div>
              ) : null}
              {!recentErrors.traces?.length ? (
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  {(recentErrors.trace_fetch_errors ?? 0) > 0
                    ? 'No trace rows returned after failures above.'
                    : 'None matched'}
                </div>
              ) : (
                <div
                  style={{
                    overflow: 'auto',
                    borderRadius: 12,
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                    maxHeight: 'min(480px, 55vh)',
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th
                          style={{
                            ...th,
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            backgroundColor: '#f1f5f9',
                            boxShadow: 'inset 0 -1px 0 #e2e8f0',
                            minWidth: 120,
                          }}
                        >
                          Error type
                        </th>
                        <th
                          style={{
                            ...th,
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            backgroundColor: '#f1f5f9',
                            boxShadow: 'inset 0 -1px 0 #e2e8f0',
                            minWidth: 140,
                          }}
                        >
                          Name
                        </th>
                        <th
                          style={{
                            ...th,
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            backgroundColor: '#f1f5f9',
                            boxShadow: 'inset 0 -1px 0 #e2e8f0',
                            minWidth: 100,
                          }}
                        >
                          App
                        </th>
                        <th
                          style={{
                            ...th,
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            backgroundColor: '#f1f5f9',
                            boxShadow: 'inset 0 -1px 0 #e2e8f0',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Time (UTC)
                        </th>
                        <th
                          style={{
                            ...th,
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            backgroundColor: '#f1f5f9',
                            boxShadow: 'inset 0 -1px 0 #e2e8f0',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                            minWidth: 72,
                          }}
                        >
                          Trace
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentErrors.traces.map(function mapRecentToolErrorRow(t, i) {
                        const errLabel = String(t.error_type ?? '');
                        const typeColor = colorForToolErrorTypeLabel(errLabel, i);
                        return (
                          <tr key={t.id ?? `${t.timestamp ?? ''}-${t.app_id ?? ''}-${i}`} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f0f6ff' }}>
                            <td
                              style={{
                                ...td,
                                fontWeight: 700,
                                color: typeColor,
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                fontSize: '0.78rem',
                                wordBreak: 'break-word',
                              }}
                            >
                              {t.error_type ?? '—'}
                            </td>
                            <td style={{ ...td, color: '#475569', fontSize: '0.8rem', maxWidth: 220, wordBreak: 'break-word' }}>
                              {t.name ?? '—'}
                            </td>
                            <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', color: '#334155', wordBreak: 'break-all' }}>
                              {t.app_id ?? '—'}
                            </td>
                            <td style={{ ...td, fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                              {formatTraceTimeUtc(t.timestamp)}
                            </td>
                            <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {t.url ? (
                                <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.8rem' }}>
                                  trace ↗
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </RisqSectionCard>
          </div>
        </div>
      </RisqSectionCard>

      <RisqSectionCard title="Sentiment" subtitle="Emotion-type and polarity distributions from scored traces." icon="💭">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.15rem' }}>
          <MiniTable
            title="Emotion type"
            columns={[
              { key: 'value', label: 'Value' },
              { key: 'count', label: 'Count' },
              { key: 'pct', label: '%' },
            ]}
            rows={(emotion?.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
            horizontalBar={{ labelKey: 'value', valueKey: 'count', barColor: '#8b5cf6', chartHeight: 184 }}
          />
          <MiniTable
            title="Sentiment polarity"
            columns={[
              { key: 'value', label: 'Value' },
              { key: 'count', label: 'Count' },
              { key: 'pct', label: '%' },
            ]}
            rows={(polarity?.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
            horizontalBar={{ labelKey: 'value', valueKey: 'count', barColor: '#6366f1', chartHeight: 184 }}
          />
        </div>
      </RisqSectionCard>

      <RisqSectionCard
        title="Trace & session search"
        subtitle="Fetch EB Langfuse trace/session payloads and mgmt app details by ID — structured layout with raw JSON in a disclosure."
        icon="🔎"
      >
        <LangfuseDeepDiveSearchPanel />
      </RisqSectionCard>

      <RisqSectionCard
        title="Routing & intents"
        subtitle="What users are trying to do and which website categories show up in traces."
        icon="🧭"
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.15rem' }}>
          <MiniTable
            title="Action intents"
            columns={[
              { key: 'intent', label: 'Intent' },
              { key: 'count', label: 'Count' },
              { key: 'pct', label: '%' },
            ]}
            rows={(actionIntents.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
            horizontalBar={{ labelKey: 'intent', valueKey: 'count', barColor: '#0d9488', chartHeight: 228 }}
          />
          <MiniTable
            title="Website categories"
            columns={[
              { key: 'vertical', label: 'Website category' },
              { key: 'count', label: 'Count' },
              { key: 'pct', label: '%' },
            ]}
            rows={(verticals.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
            horizontalBar={{ labelKey: 'vertical', valueKey: 'count', barColor: '#d97706', chartHeight: 228 }}
          />
        </div>
      </RisqSectionCard>

      <RisqSectionCard title="Score names" subtitle="Which named scores appear most often in this window (top 40)." icon="🏷️">
        <div style={risqSectionDataPanel}>
          {scoreEntries.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No score aggregates</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {scoreEntries.slice(0, 40).map(([name, count]) => (
                  <span
                    key={name}
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '0.68rem',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '999px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      color: '#334155',
                    }}
                  >
                    <strong>{name}</strong>
                    <span style={{ color: '#64748b', marginLeft: '0.35rem' }}>{count}</span>
                  </span>
                ))}
              </div>
              <div style={{ marginTop: '0.85rem' }}>
                <HorizontalBarChart
                  title="Top score names by volume"
                  data={scoreEntries.slice(0, 14).map(([name, count]) => ({ name, value: Number(count) }))}
                  barColor="#6366f1"
                  height={280}
                  nameMaxLen={28}
                  valueLabel="Score events"
                />
              </div>
            </>
          )}
        </div>
      </RisqSectionCard>

      <RisqSectionCard title="Overview" subtitle="High-level volume, cost, and latest model from Langfuse." icon="📊">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.95rem',
          }}
        >
          {[
            { label: 'Traces', value: overview.total_traces.toLocaleString(), color: '#7c3aed' },
            { label: 'Scores (events)', value: overview.total_scores.toLocaleString(), color: '#0d9488' },
            {
              label: 'Latest model',
              value: model.model || '—',
              color: '#2563eb',
              sub: model.trace_id ? `trace: ${model.trace_id.slice(0, 8)}…` : undefined,
            },
          ].map(({ label, value, color, sub }) => (
            <div key={label} style={risqSectionInnerWell}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color, marginTop: '0.2rem', wordBreak: 'break-word' }}>{value}</div>
              {sub && <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.15rem', fontFamily: 'ui-monospace, monospace' }}>{sub}</div>}
            </div>
          ))}
        </div>
      </RisqSectionCard>

      <RisqSectionCard title="Latency" subtitle="End-to-end trace latency plus per-observation breakdown (top 25). Percentile columns (p50–p99) are in milliseconds." icon="⏱️">
        <div style={risqSectionDataPanel}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', marginBottom: '0.6rem' }}>
            Traces total / observations by name
          </div>
          <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.95rem' }}>
            Traces: n={performance.total.count} · p50 {performance.total.p50_ms ?? '—'} ms · p95 {performance.total.p95_ms ?? '—'} ms · p99{' '}
            {performance.total.p99_ms ?? '—'} ms
          </div>
          {performance.observations.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No observation latency rows</div>
          ) : (
            <>
              <div style={{ marginBottom: '0.95rem' }}>
                <HorizontalBarChart
                  title="Observation p50 latency (ms)"
                  data={performance.observations
                    .filter((o) => o.p50_ms != null && o.p50_ms > 0)
                    .slice(0, 18)
                    .map((o) => ({ name: o.name, value: o.p50_ms ?? 0 }))}
                  barColor="#6366f1"
                  height={320}
                  minRowHeight={50}
                  maxChartHeight={840}
                  yAxisWidth={268}
                  nameMaxLen={46}
                  valueLabel="ms"
                />
              </div>
              <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e8ecf1', backgroundColor: '#ffffff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f0f6ff' }}>
                      {['Name', 'Count', 'p50 (ms)', 'p90 (ms)', 'p95 (ms)', 'p99 (ms)'].map((h) => (
                        <th key={h} style={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {performance.observations.slice(0, 25).map((o, i) => (
                      <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                        <td style={td}>{o.name}</td>
                        <td style={td}>{o.count}</td>
                        <td style={td}>{o.p50_ms ?? '—'}</td>
                        <td style={td}>{o.p90_ms ?? '—'}</td>
                        <td style={td}>{o.p95_ms ?? '—'}</td>
                        <td style={td}>{o.p99_ms ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </RisqSectionCard>
    </div>
  );
}
