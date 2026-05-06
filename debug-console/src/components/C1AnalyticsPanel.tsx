'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { CurrPrevBarChart, HorizontalBarChart } from '@/components/analytics/AnalyticsRecharts';

import type { C1Period } from '@/lib/c1-analytics-server';

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
}

const card: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  padding: '0.75rem 1rem',
  borderRadius: '10px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
};

function pctLabel(n: number): string {
  if (n === 0 || Number.isNaN(n)) return '0%';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

interface C1AnalyticsPanelProps {
  period: C1Period;
}

export default function C1AnalyticsPanel({ period }: C1AnalyticsPanelProps) {
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
    load();
  }, [load]);

  if (error && !bundle) {
    return (
      <div style={{ ...card, borderLeft: '4px solid #ef4444', color: '#b91c1c', fontSize: '0.8rem' }}>
        {error}
      </div>
    );
  }

  if (!bundle && loading) {
    return (
      <div style={{ ...card, textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
        Loading C1 (ClickHouse)…
      </div>
    );
  }

  if (!bundle) return null;

  const { dau, wau, funnel, sessions, avgSession, tasksPerSession } = bundle;

  return (
    <div
      style={{
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderRadius: '14px',
        boxShadow: '0 4px 24px rgba(15,23,42,0.08)',
        border: '1px solid rgba(234,88,12,0.2)',
        borderLeft: '4px solid #ea580c',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #ffedd5',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.85rem',
          background: 'linear-gradient(180deg, #fff7ed 0%, #fff 100%)',
        }}
      >
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>C1 (ClickHouse)</div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', maxWidth: '42rem', lineHeight: 1.45 }}>
            Time range uses the <strong style={{ color: '#334155' }}>same presets</strong> as the page header (24h / 7 / 14 / 30 days
            / Custom). Sessions, Avg session, Clicks/session, and the funnel share that window (UTC). With <strong style={{ color: '#334155' }}>Custom</strong>, the
            span maps to the nearest C1 bucket (day / week / 14 days / month), not arbitrary start–end dates. DAU and WAU stay fixed for quick health checks.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={() => load()}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.78rem',
              backgroundColor: '#9a3412',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Refresh
          </button>
          {loading ? <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Updating…</span> : null}
        </div>
      </div>

      <div style={{ padding: '1rem 1.25rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <div style={card}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>DAU (today)</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ea580c', marginTop: '0.2rem' }}>{dau.today_dau.toLocaleString()}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>WAU (7d vs prior 7d)</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f97316', marginTop: '0.2rem' }}>
            {wau.curr_wau.toLocaleString()}
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', marginLeft: '0.35rem' }}>
              vs {wau.prev_wau.toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: wau.pct_change >= 0 ? '#22c55e' : '#ef4444', marginTop: '0.15rem' }}>
            {pctLabel(wau.pct_change)}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Sessions</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fb923c', marginTop: '0.2rem' }}>
            {sessions.curr_sessions.toLocaleString()}
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', marginLeft: '0.35rem' }}>
              vs {sessions.prev_sessions.toLocaleString()}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: sessions.pct_change >= 0 ? '#22c55e' : '#ef4444', marginTop: '0.15rem' }}>
            {pctLabel(sessions.pct_change)}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Avg session (min)</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fdba74', marginTop: '0.2rem' }}>
            {avgSession.curr_avg_min}
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', marginLeft: '0.35rem' }}>
              vs {avgSession.prev_avg_min}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: avgSession.pct_change >= 0 ? '#22c55e' : '#ef4444', marginTop: '0.15rem' }}>
            {pctLabel(avgSession.pct_change)}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Clicks / session</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fed7aa', marginTop: '0.2rem' }}>
            {tasksPerSession.curr_clicks_per_session}
            <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', marginLeft: '0.35rem' }}>
              vs {tasksPerSession.prev_clicks_per_session}
            </span>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.15rem' }}>
            Δ {tasksPerSession.absolute_change >= 0 ? '+' : ''}
            {tasksPerSession.absolute_change} ({pctLabel(tasksPerSession.pct_change)})
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <div style={card}>
          <CurrPrevBarChart
            title="Sessions"
            currLabel="Current window"
            prevLabel="Previous window"
            curr={sessions.curr_sessions}
            prev={sessions.prev_sessions}
            currColor="#fb923c"
            prevColor="#cbd5e1"
            height={130}
          />
        </div>
        <div style={card}>
          <CurrPrevBarChart
            title="Avg session (min)"
            currLabel="Current"
            prevLabel="Previous"
            curr={avgSession.curr_avg_min}
            prev={avgSession.prev_avg_min}
            currColor="#fdba74"
            prevColor="#cbd5e1"
            height={130}
          />
        </div>
        <div style={card}>
          <CurrPrevBarChart
            title="Clicks / session"
            currLabel="Current"
            prevLabel="Previous"
            curr={tasksPerSession.curr_clicks_per_session}
            prev={tasksPerSession.prev_clicks_per_session}
            currColor="#fed7aa"
            prevColor="#cbd5e1"
            height={130}
          />
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>
          Funnel — {funnel.period} ({funnel.from_date} →{' '}
          {funnel.to_date}, distinct visitors per eid)
        </div>
        <div style={{ marginBottom: '0.75rem' }}>
          <HorizontalBarChart
            title="Users by funnel step"
            data={funnel.steps.map((s) => ({ name: s.label, value: s.count }))}
            barColor="#ea580c"
            height={Math.min(320, 40 + funnel.steps.length * 36)}
            nameMaxLen={40}
            valueLabel="Users"
          />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#fff7ed' }}>
                {['Step', 'EID', 'Users', '% of top', '% of prev'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      borderBottom: '1px solid #fed7aa',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.steps.map((s, idx) => (
                <tr key={s.eid} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '0.35rem 0.5rem', color: '#0f172a', borderBottom: '1px solid #f1f5f9' }}>{s.label}</td>
                  <td
                    style={{
                      padding: '0.35rem 0.5rem',
                      color: '#64748b',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '0.68rem',
                      borderBottom: '1px solid #f1f5f9',
                      wordBreak: 'break-all',
                    }}
                  >
                    {s.eid}
                  </td>
                  <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #f1f5f9' }}>{s.count.toLocaleString()}</td>
                  <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #f1f5f9' }}>{s.pct_of_top}%</td>
                  <td style={{ padding: '0.35rem 0.5rem', borderBottom: '1px solid #f1f5f9' }}>{s.pct_of_prev}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
}
