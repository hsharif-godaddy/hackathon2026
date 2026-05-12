'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { CurrPrevBarChart, EngagementDauWau7dChart, EngagementFunnelRows } from '@/components/analytics/AnalyticsRecharts';

import type { C1Engagement7dRow, C1Period } from '@/lib/c1-analytics-server';

const C1_WINDOW_OPTIONS: ReadonlyArray<{ period: C1Period; label: string }> = [
  { period: 'day', label: 'Last Day' },
  { period: 'week', label: 'Last 7 Days' },
  { period: '15days', label: 'Last 15 Days' },
  { period: 'month', label: 'Last 30 Days' },
];

const borderHairline = '#eef0f2';

const shell: CSSProperties = {
  borderRadius: 20,
  border: `1px solid ${borderHairline}`,
  padding: '1.65rem 1.75rem 1.85rem',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  backgroundColor: '#f4f6f8',
  backgroundImage:
    'radial-gradient(ellipse 70% 55% at 0% 0%, rgba(99, 102, 241, 0.07), transparent 52%), radial-gradient(ellipse 55% 45% at 100% 100%, rgba(59, 130, 246, 0.06), transparent 48%)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

const periodSelectStyle: CSSProperties = {
  appearance: 'none' as const,
  WebkitAppearance: 'none' as const,
  padding: '0.5rem 2.15rem 0.5rem 0.85rem',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#334155',
  backgroundColor: '#ffffff',
  border: `1px solid ${borderHairline}`,
  borderRadius: 10,
  cursor: 'pointer',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.65rem center',
  backgroundSize: 12,
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
};

const whiteCard: CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: 14,
  border: `1px solid ${borderHairline}`,
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
};

const kpiCard: CSSProperties = {
  ...whiteCard,
  padding: '1.25rem 1rem 1.2rem',
  textAlign: 'center',
  minHeight: 132,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

interface FunnelStep {
  label: string;
  eid: string;
  count: number;
  pct_of_top: number;
  pct_of_prev: number;
}

interface Bundle {
  period: C1Period;
  dau: { today_dau: number };
  wau: { curr_wau: number; prev_wau: number; pct_change: number };
  funnel: { from_date: string; to_date: string; period: C1Period; steps: FunnelStep[] };
  sessions: { curr_sessions: number; prev_sessions: number; pct_change: number; period: string };
  avgSession: { curr_avg_min: number; prev_avg_min: number; pct_change: number; period: string };
  tasksPerSession: {
    curr_clicks_per_session: number;
    prev_clicks_per_session: number;
    absolute_change: number;
    pct_change: number;
    period: string;
  };
  engagement7d: C1Engagement7dRow[];
}

function pctLabel(n: number): string {
  if (n === 0 || Number.isNaN(n)) return '0%';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function formatAvgSessionMin(min: number): string {
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function deltaColor(n: number): string {
  if (n > 0) return '#16a34a';
  if (n < 0) return '#dc2626';
  return '#64748b';
}

function periodLabel(p: C1Period): string {
  const opt = C1_WINDOW_OPTIONS.find((o) => o.period === p);
  if (opt) return opt.label;
  if (p === '14days') return 'Last 14 Days';
  return p;
}

interface C1AnalyticsPanelProps {
  /** When set (e.g. Analytics `/analytics` tab), period is driven by the parent DateRangeSelector. */
  period?: C1Period;
}

export default function C1AnalyticsPanel({ period: periodFromParent }: C1AnalyticsPanelProps) {
  const [internalPeriod, setInternalPeriod] = useState<C1Period>('week');
  const controlled = periodFromParent !== undefined;
  const period = controlled ? periodFromParent : internalPeriod;
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async function loadBundle() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: 'bundle', period });
      const res = await fetch(`/api/c1-analytics?${params}`);
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
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !bundle) {
    return (
      <div style={{ ...shell, color: '#b91c1c', fontSize: '0.88rem', borderLeft: '4px solid #ef4444' }}>
        {error}
      </div>
    );
  }

  if (!bundle && loading) {
    return (
      <div style={{ ...shell, padding: '2.25rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
        Loading engagement analytics…
      </div>
    );
  }

  if (!bundle) return null;

  const { dau, wau, funnel, sessions, avgSession, tasksPerSession, engagement7d } = bundle;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      <section style={shell}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start', minWidth: 0 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(145deg, #22c55e 0%, #15803d 100%)',
                boxShadow: '0 6px 16px rgba(22, 163, 74, 0.28)',
              }}
              aria-hidden
            >
              <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>📈</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.28rem',
                  fontWeight: 800,
                  color: '#14532d',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                }}
              >
                Engagement Analytics
              </h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.45rem', marginTop: '0.45rem' }}>
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: '#15803d',
                    backgroundColor: '#ecfdf5',
                    border: '1px solid #bbf7d0',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 999,
                    flexShrink: 0,
                  }}
                >
                  ● MULTI-SOURCE
                </span>
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500, lineHeight: 1.4 }}>
                  C1 analytics • QuickSight • FullStory • Console data
                </span>
              </div>
            </div>
          </div>
          {controlled ? null : (
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem', flexShrink: 0 }}>
              <span style={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.1em', color: '#94a3b8' }}>TIME PERIOD</span>
              <select
                value={period}
                aria-label="C1 analytics time period"
                style={periodSelectStyle}
                onChange={function onPeriodChange(e) {
                  const v = e.target.value;
                  if (v === 'day' || v === 'week' || v === '15days' || v === 'month') setInternalPeriod(v);
                }}
              >
                {C1_WINDOW_OPTIONS.map(function optRow(o) {
                  return (
                    <option key={o.period} value={o.period}>
                      {o.label}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
        </div>

        <div
          style={{
            marginBottom: '1.35rem',
            padding: '0.75rem 1rem',
            borderRadius: 10,
            background: 'linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(241, 245, 249, 0.95) 38%, rgba(191, 219, 254, 0.12) 100%)',
            border: `1px solid ${borderHairline}`,
            fontSize: '0.68rem',
            color: '#64748b',
            lineHeight: 1.45,
          }}
        >
          <span style={{ fontWeight: 700, color: '#475569' }}>Metrics include </span>
          DAU (today), WAU (7d vs prior 7d), sessions, avg session, tasks per session, and AppBuilder funnel (distinct visitors per step, UTC).
          <span style={{ fontWeight: 700, color: '#475569' }}> Data sources: </span>
          ClickHouse.
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1rem',
            marginBottom: '1.35rem',
          }}
        >
          <div style={kpiCard}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>{dau.today_dau.toLocaleString('en-US')}</div>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', marginTop: '0.4rem' }}>DAU (TODAY)</div>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b', marginTop: '0.45rem' }}>Live · UTC day</div>
          </div>
          <div style={kpiCard}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>{formatCompact(wau.curr_wau)}</div>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', marginTop: '0.4rem' }}>WAU</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: deltaColor(wau.pct_change), marginTop: '0.45rem' }}>
              {pctLabel(wau.pct_change)} vs prev
            </div>
          </div>
          <div style={kpiCard}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
              {sessions.curr_sessions.toLocaleString('en-US')}
            </div>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', marginTop: '0.4rem' }}>SESSIONS</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: deltaColor(sessions.pct_change), marginTop: '0.45rem' }}>
              {pctLabel(sessions.pct_change)} vs prev {sessions.period}
            </div>
          </div>
          <div style={kpiCard}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>{formatAvgSessionMin(avgSession.curr_avg_min)}</div>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', marginTop: '0.4rem' }}>AVG SESSION</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: deltaColor(avgSession.pct_change), marginTop: '0.45rem' }}>
              {pctLabel(avgSession.pct_change)} vs prev {avgSession.period}
            </div>
          </div>
          <div style={kpiCard}>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
              {tasksPerSession.curr_clicks_per_session}
            </div>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', marginTop: '0.4rem' }}>TASKS / SESSION</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: deltaColor(tasksPerSession.absolute_change), marginTop: '0.45rem' }}>
              {tasksPerSession.absolute_change >= 0 ? '+' : ''}
              {tasksPerSession.absolute_change} vs prev {tasksPerSession.period} ({pctLabel(tasksPerSession.pct_change)})
            </div>
          </div>
        </div>

        <div style={{ ...whiteCard, padding: '1.25rem 1.35rem 1.4rem', marginBottom: '1.15rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.35rem' }}>
            <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.015em' }}>DAU · WAU — last 7 UTC days</div>
            <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b' }}>Bars: daily active users · Line: rolling 7-day unique visitors</div>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '1rem', lineHeight: 1.45 }}>Page-view events · ClickHouse</div>
          <EngagementDauWau7dChart data={engagement7d} height={308} />
        </div>

        <div style={{ ...whiteCard, padding: '1.25rem 1.25rem 1.35rem', marginBottom: '1.15rem' }}>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', marginBottom: '0.85rem', letterSpacing: '0.02em' }}>
            Session trends vs prior window
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            <div style={{ background: '#fafbfc', borderRadius: 12, border: `1px solid ${borderHairline}`, padding: '1rem 0.85rem' }}>
              <CurrPrevBarChart
                title="Sessions"
                currLabel="Current"
                prevLabel="Previous"
                curr={sessions.curr_sessions}
                prev={sessions.prev_sessions}
                currColor="#3b82f6"
                prevColor="#cbd5e1"
                height={152}
              />
            </div>
            <div style={{ background: '#fafbfc', borderRadius: 12, border: `1px solid ${borderHairline}`, padding: '1rem 0.85rem' }}>
              <CurrPrevBarChart
                title="Avg session (min)"
                currLabel="Current"
                prevLabel="Previous"
                curr={avgSession.curr_avg_min}
                prev={avgSession.prev_avg_min}
                currColor="#2563eb"
                prevColor="#cbd5e1"
                height={152}
              />
            </div>
            <div style={{ background: '#fafbfc', borderRadius: 12, border: `1px solid ${borderHairline}`, padding: '1rem 0.85rem' }}>
              <CurrPrevBarChart
                title="Clicks / session"
                currLabel="Current"
                prevLabel="Previous"
                curr={tasksPerSession.curr_clicks_per_session}
                prev={tasksPerSession.prev_clicks_per_session}
                currColor="#60a5fa"
                prevColor="#cbd5e1"
                height={152}
              />
            </div>
          </div>
        </div>

        <div style={{ ...whiteCard, padding: '1.25rem 1.35rem 1.4rem' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.85rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
              <span style={{ fontSize: '1.05rem', lineHeight: 1 }} aria-hidden>
                🔄
              </span>
              <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
                AppBuilder Funnel — ClickHouse ({funnel.from_date} → {funnel.to_date})
              </div>
            </div>
            <button
              type="button"
              onClick={function refreshC1Bundle() {
                void load();
              }}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: `1px solid ${borderHairline}`,
                background: '#ffffff',
                cursor: 'pointer',
                fontSize: '1rem',
                lineHeight: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
                flexShrink: 0,
              }}
              title="Refresh data"
              aria-label="Refresh engagement data"
            >
              ↻
            </button>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.9rem', lineHeight: 1.45 }}>
            {periodLabel(funnel.period)} · distinct visitors per eid · funnel calendar span matches selected period
          </div>
          <EngagementFunnelRows steps={funnel.steps} />
          <div style={{ marginTop: '1rem', borderRadius: 12, border: `1px solid ${borderHairline}`, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', padding: '1rem 1.05rem', background: '#fafbfc' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    {['Step', 'EID', 'Users', '% of top', '% of prev'].map(function headCell(h) {
                      return (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '0.65rem 0.8rem',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: '#64748b',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            borderBottom: `1px solid ${borderHairline}`,
                            background: '#f1f5f9',
                          }}
                        >
                          {h}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {funnel.steps.map(function bodyRow(s, idx) {
                    return (
                      <tr key={s.eid} style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                        <td style={{ padding: '0.65rem 0.8rem', color: '#0f172a', borderBottom: `1px solid ${borderHairline}` }}>{s.label}</td>
                        <td
                          style={{
                            padding: '0.65rem 0.8rem',
                            color: '#64748b',
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: '0.72rem',
                            borderBottom: `1px solid ${borderHairline}`,
                            wordBreak: 'break-all',
                          }}
                        >
                          {s.eid}
                        </td>
                        <td style={{ padding: '0.65rem 0.8rem', borderBottom: `1px solid ${borderHairline}` }}>{s.count.toLocaleString('en-US')}</td>
                        <td style={{ padding: '0.65rem 0.8rem', borderBottom: `1px solid ${borderHairline}` }}>{s.pct_of_top}%</td>
                        <td style={{ padding: '0.65rem 0.8rem', borderBottom: `1px solid ${borderHairline}` }}>{s.pct_of_prev}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>Updating…</div>
        ) : null}
      </section>
    </div>
  );
}
