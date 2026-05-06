'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { HorizontalBarChart, VerticalBarChart } from '@/components/analytics/AnalyticsRecharts';

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

interface Bundle {
  meta: BundleMeta;
  overview: OverviewPayload;
  sentiment: Record<string, unknown>;
  actionIntents: CategoricalBlock;
  verticals: CategoricalBlock;
  performance: PerformancePayload;
  toolErrors: CategoricalBlock;
  recentErrors: { traces: TraceRow[]; trace_fetch_errors?: number };
  model: { model: string | null; trace_id: string | null };
}

const panelShell: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.98)',
  borderRadius: '14px',
  boxShadow: '0 4px 24px rgba(15,23,42,0.08)',
  border: '1px solid rgba(124,58,237,0.18)',
  borderLeft: '4px solid #7c3aed',
  overflow: 'hidden',
};

const card: React.CSSProperties = {
  backgroundColor: '#fafafa',
  padding: '0.75rem 1rem',
  borderRadius: '12px',
  boxShadow: 'none',
  border: '1px solid #e9d5ff',
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.35rem 0.5rem',
  fontSize: '0.65rem',
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  borderBottom: '1px solid #e2e8f0',
};

const td: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  fontSize: '0.78rem',
  color: '#334155',
  borderBottom: '1px solid #f1f5f9',
};

function InsightSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: '1.25rem' }}>
      <div style={{ marginBottom: '0.65rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#312e81', letterSpacing: '0.01em' }}>{title}</h3>
        {subtitle ? (
          <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.72rem', color: '#64748b', lineHeight: 1.45 }}>{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MiniTable({
  title,
  columns,
  rows,
  horizontalBar,
  verticalBar,
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
}) {
  if (!rows.length) {
    return (
      <div style={card}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>{title}</div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No data</div>
      </div>
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
    <div style={card}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>{title}</div>
      {vBarData && vBarData.length > 0 ? (
        <div style={{ marginBottom: '0.65rem' }}>
          <VerticalBarChart
            data={vBarData}
            barColor={verticalBar?.barColor ?? '#6366f1'}
            height={verticalBar?.chartHeight ?? 200}
            valueLabel={columns.find((c) => c.key === verticalBar?.valueKey)?.label ?? 'Value'}
          />
        </div>
      ) : null}
      {hBarData && hBarData.length > 0 ? (
        <div style={{ marginBottom: '0.65rem' }}>
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
      <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #ede9fe', maxHeight: verticalBar || horizontalBar ? '200px' : undefined, overflowY: verticalBar || horizontalBar ? 'auto' : undefined }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#faf5ff' }}>
              {columns.map((c) => (
                <th key={c.key} style={th}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((r, i) => (
              <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                {columns.map((c) => (
                  <td key={c.key} style={td}>
                    {String(r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
      <div style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
        Loading Langfuse insights…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card, borderLeft: '4px solid #ef4444', color: '#b91c1c', fontSize: '0.8rem' }}>
        {error}
      </div>
    );
  }

  if (!bundle) return null;

  const { overview, sentiment, actionIntents, verticals, performance, toolErrors, recentErrors, model, meta } =
    bundle;
  const emotion = sentiment['emotion-type'] as { rows?: { value: string; count: number; pct: number }[] } | undefined;
  const polarity = sentiment['sentiment-polarity'] as
    | { rows?: { value: string; count: number; pct: number }[] }
    | undefined;

  const scoreEntries = Object.entries(overview.score_by_name || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div style={panelShell}>
      <div
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #ede9fe',
          background: 'linear-gradient(180deg, #faf5ff 0%, #fff 100%)',
        }}
      >
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>Langfuse insights</div>
        <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45, maxWidth: '48rem' }}>
          Traces, costs, scores, and latency for the date range selected in the page header. Charts summarize distributions; tables
          retain exact values. Use Langfuse UI for deep dives.
        </p>
      </div>

      <div style={{ padding: '1rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {meta.panelErrors && Object.keys(meta.panelErrors).length > 0 ? (
          <div
            style={{
              marginBottom: '0.5rem',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
          Window: <strong style={{ color: '#334155' }}>{overview.from_date}</strong> → <strong style={{ color: '#334155' }}>{overview.to_date}</strong>
          {loading ? ' · refreshing…' : ''}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {meta.uiBaseUrl && (
            <a
              href={meta.uiBaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '0.75rem',
                color: '#6d28d9',
                fontWeight: 600,
              }}
            >
              Open Langfuse UI ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => load()}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.75rem',
              backgroundColor: '#5b21b6',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <InsightSection title="Overview" subtitle="High-level volume, cost, and latest model from Langfuse.">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem',
        }}
        >
        {[
          { label: 'Traces', value: overview.total_traces.toLocaleString(), color: '#7c3aed' },
          { label: 'Total cost', value: `$${overview.total_cost.toFixed(4)}`, color: '#dc2626' },
          { label: 'Scores (events)', value: overview.total_scores.toLocaleString(), color: '#0d9488' },
          {
            label: 'Latest model',
            value: model.model || '—',
            color: '#2563eb',
            sub: model.trace_id ? `trace: ${model.trace_id.slice(0, 8)}…` : undefined,
          },
        ].map(({ label, value, color, sub }) => (
          <div key={label} style={card}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color, marginTop: '0.2rem', wordBreak: 'break-word' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.15rem', fontFamily: 'ui-monospace, monospace' }}>{sub}</div>}
          </div>
        ))}
      </div>
      </InsightSection>

      {overview.model_costs.length > 0 && (
        <InsightSection title="Cost & tokens" subtitle="Spend and token volume by model.">
        <MiniTable
          title="Cost by model"
          columns={[
            { key: 'model', label: 'Model' },
            { key: 'cost', label: 'Cost' },
            { key: 'input_tokens', label: 'In tok' },
            { key: 'output_tokens', label: 'Out tok' },
            { key: 'count_obs', label: 'Obs' },
          ]}
          rows={overview.model_costs.map((m) => ({
            model: m.model || '__untracked__',
            cost: m.cost.toFixed(6),
            cost_num: m.cost,
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            count_obs: m.count_obs,
          }))}
          verticalBar={{ labelKey: 'model', valueKey: 'cost_num', barColor: '#7c3aed', chartHeight: 220 }}
        />
        </InsightSection>
      )}

      <InsightSection title="Sentiment" subtitle="Emotion-type and polarity distributions from scored traces.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
        <MiniTable
          title="Emotion type"
          columns={[
            { key: 'value', label: 'Value' },
            { key: 'count', label: 'Count' },
            { key: 'pct', label: '%' },
          ]}
          rows={(emotion?.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
          horizontalBar={{ labelKey: 'value', valueKey: 'count', barColor: '#8b5cf6', chartHeight: 160 }}
        />
        <MiniTable
          title="Sentiment polarity"
          columns={[
            { key: 'value', label: 'Value' },
            { key: 'count', label: 'Count' },
            { key: 'pct', label: '%' },
          ]}
          rows={(polarity?.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
          horizontalBar={{ labelKey: 'value', valueKey: 'count', barColor: '#6366f1', chartHeight: 160 }}
        />
      </div>
      </InsightSection>

      <InsightSection title="Routing & intents" subtitle="What users are trying to do and which verticals show up in traces.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <MiniTable
          title="Action intents"
          columns={[
            { key: 'intent', label: 'Intent' },
            { key: 'count', label: 'Count' },
            { key: 'pct', label: '%' },
          ]}
          rows={(actionIntents.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
          horizontalBar={{ labelKey: 'intent', valueKey: 'count', barColor: '#0d9488', chartHeight: 200 }}
        />
        <MiniTable
          title="Verticals"
          columns={[
            { key: 'vertical', label: 'Vertical' },
            { key: 'count', label: 'Count' },
            { key: 'pct', label: '%' },
          ]}
          rows={(verticals.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
          horizontalBar={{ labelKey: 'vertical', valueKey: 'count', barColor: '#d97706', chartHeight: 200 }}
        />
      </div>
      </InsightSection>

      <InsightSection title="Score names" subtitle="Which named scores appear most often in this window (top 40).">
      <div style={card}>
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
                    backgroundColor: '#f5f3ff',
                    border: '1px solid #ddd6fe',
                    color: '#4c1d95',
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
                barColor="#6d28d9"
                height={240}
                nameMaxLen={28}
                valueLabel="Score events"
              />
            </div>
          </>
        )}
      </div>
      </InsightSection>

      <InsightSection title="Tool errors" subtitle="Evaluated tool failures and a short list of recent error traces.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        <MiniTable
          title="Tool error eval"
          columns={[
            { key: 'error_type', label: 'Type' },
            { key: 'count', label: 'Count' },
            { key: 'pct', label: '%' },
          ]}
          rows={(toolErrors.rows ?? []).map((r) => ({ ...r, pct: `${r.pct}%` }))}
          horizontalBar={{ labelKey: 'error_type', valueKey: 'count', barColor: '#dc2626', chartHeight: 180 }}
        />
        <div style={card}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>
            Recent tool errors (header date range, top 5 traces)
          </div>
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
            <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: '#334155' }}>
              {recentErrors.traces.map((t, i) => (
                <li key={i} style={{ marginBottom: '0.35rem' }}>
                  <span style={{ color: '#b45309', fontWeight: 600 }}>{t.error_type}</span>
                  {t.name && <span style={{ color: '#64748b' }}> · {t.name}</span>}
                  {t.app_id && (
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#64748b' }}> · app {t.app_id}</span>
                  )}
                  {t.url && (
                    <>
                      {' '}
                      <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed' }}>
                        trace ↗
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      </InsightSection>

      <InsightSection title="Latency" subtitle="End-to-end trace latency plus per-observation breakdown (top 25).">
      <div style={card}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>
          Traces total / observations by name
        </div>
        <div style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.75rem' }}>
          Traces: n={performance.total.count} · p50 {performance.total.p50_ms ?? '—'} ms · p95 {performance.total.p95_ms ?? '—'} ms · p99{' '}
          {performance.total.p99_ms ?? '—'} ms
        </div>
        {performance.observations.length === 0 ? (
          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No observation latency rows</div>
        ) : (
          <>
            <div style={{ marginBottom: '0.75rem' }}>
              <HorizontalBarChart
                title="Observation p50 latency (ms)"
                data={performance.observations
                  .filter((o) => o.p50_ms != null && o.p50_ms > 0)
                  .slice(0, 18)
                  .map((o) => ({ name: o.name, value: o.p50_ms ?? 0 }))}
                barColor="#7c3aed"
                height={260}
                nameMaxLen={32}
                valueLabel="ms"
              />
            </div>
            <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #ede9fe' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#faf5ff' }}>
                  {['Name', 'Count', 'p50', 'p90', 'p95', 'p99'].map((h) => (
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
      </InsightSection>
      </div>
    </div>
  );
}
