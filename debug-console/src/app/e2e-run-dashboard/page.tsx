'use client';

import { type CSSProperties, useEffect, useState } from 'react';

import { VerticalBarChart } from '@/components/analytics/AnalyticsRecharts';
import ProtectedRoute from '@/components/ProtectedRoute';
import RisqE2ePanel, { type E2eWindow, E2E_WINDOW_LABELS } from '@/components/RisqE2ePanel';

interface WindowStats {
  passed: number;
  failed: number;
  running: number;
  completed: number;
  total: number;
  passRatePct: number | null;
}

interface TrendDay {
  ymd: string;
  label: string;
  passed: number;
  failed: number;
  total: number;
  passRatePct: number | null;
}

interface E2eMetrics {
  window: { days: number };
  current: WindowStats;
  previous: WindowStats;
  deltaPoints: number | null;
  duration: { avgSec: number; p50Sec: number; p95Sec: number; sampleCount: number };
  reliability: {
    streakType: 'pass' | 'fail' | 'none';
    streakCount: number;
    lastGreenIso: string | null;
    lastGreenAgeHours: number | null;
    rerunCount: number;
    rerunRatePct: number;
    totalRuns: number;
  };
  trend: TrendDay[];
}

const WINDOW_OPTIONS: E2eWindow[] = ['1d', '7d', '30d'];

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtAge(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const statCard: CSSProperties = {
  flex: '1 1 150px',
  minWidth: 0,
  backgroundColor: 'rgba(255,255,255,0.97)',
  borderRadius: '12px',
  padding: '1rem 1.25rem',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
};

const statLabel: CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 800,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: '#64748b',
  marginBottom: '0.35rem',
};

function StatCard({ label, value, color, sub, subColor }: {
  label: string;
  value: string;
  color: string;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, lineHeight: 1.1, color }}>{value}</div>
      {sub ? (
        <div style={{ marginTop: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: subColor ?? '#64748b' }}>{sub}</div>
      ) : null}
    </div>
  );
}

function WindowSelector({ value, onChange }: { value: E2eWindow; onChange: (next: E2eWindow) => void }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: '0.25rem',
        backgroundColor: 'rgba(255,255,255,0.97)',
        borderRadius: '10px',
        padding: '0.3rem',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      }}
    >
      {WINDOW_OPTIONS.map(function renderOption(opt) {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            onClick={function selectWindow() {
              onChange(opt);
            }}
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.78rem',
              fontWeight: 700,
              border: 'none',
              borderRadius: '7px',
              cursor: 'pointer',
              color: active ? '#ffffff' : '#475569',
              backgroundColor: active ? '#6366f1' : 'transparent',
            }}
          >
            {E2E_WINDOW_LABELS[opt]}
          </button>
        );
      })}
    </div>
  );
}

const chartCard: CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  borderRadius: '12px',
  padding: '1.25rem 1.5rem',
  marginBottom: '1.25rem',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
};

function E2eMetricsView({ timeWindow }: { timeWindow: E2eWindow }) {
  const [metrics, setMetrics] = useState<E2eMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/e2e-runs?action=metrics&window=${timeWindow}`);
        const body = (await res.json().catch(() => ({}))) as Partial<E2eMetrics> & { error?: string };
        if (cancelled) return;
        if (res.ok && body.current && body.reliability && body.duration) {
          setMetrics(body as E2eMetrics);
          setError(null);
        } else {
          setMetrics(null);
          setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        }
      } catch (e) {
        if (!cancelled) {
          setMetrics(null);
          setError(e instanceof Error ? e.message : 'Request failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return function cleanup() {
      cancelled = true;
    };
  }, [timeWindow]);

  if (loading) {
    return (
      <p style={{ margin: '0 0 1.25rem', padding: '0.5rem 0.25rem', fontSize: '0.85rem', color: '#cbd5e1' }}>
        Loading metrics…
      </p>
    );
  }

  if (error || !metrics) {
    return (
      <div
        style={{
          margin: '0 0 1.25rem',
          padding: '0.75rem 0.9rem',
          borderRadius: 10,
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#991b1b',
          fontSize: '0.82rem',
        }}
      >
        {error ?? 'No metrics available'}
      </div>
    );
  }

  const windowLabel = E2E_WINDOW_LABELS[timeWindow];
  const cur = metrics.current;
  const rel = metrics.reliability;
  const dur = metrics.duration;

  const ratio = cur.passRatePct;
  const ratioColor = ratio == null ? '#64748b' : ratio === 100 ? '#16a34a' : cur.failed > 0 ? '#dc2626' : '#0f172a';

  const delta = metrics.deltaPoints;
  const deltaSub =
    delta == null ? undefined : `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${Math.abs(delta)} pts vs prev ${windowLabel}`;
  const deltaColor = delta == null ? '#64748b' : delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b';

  const streakText = rel.streakType === 'none' ? '—' : `${rel.streakType === 'pass' ? '▲' : '▼'} ${rel.streakCount}`;
  const streakColor = rel.streakType === 'pass' ? '#16a34a' : rel.streakType === 'fail' ? '#dc2626' : '#64748b';

  // Exclude days with no completed runs (passRatePct null) so an in-flight-only
  // latest day isn't drawn as a misleading 0% bar.
  const trendData = metrics.trend
    .filter(function hasRate(d) {
      return d.passRatePct != null;
    })
    .map(function toBar(d) {
      return { name: d.label, value: d.passRatePct ?? 0 };
    });

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
        <StatCard label={`Success rate (${windowLabel})`} value={ratio == null ? '—' : `${ratio}%`} color={ratioColor} sub={deltaSub} subColor={deltaColor} />
        <StatCard label="Passed" value={String(cur.passed)} color="#16a34a" />
        <StatCard label="Failed" value={String(cur.failed)} color={cur.failed > 0 ? '#dc2626' : '#0f172a'} />
        <StatCard label="Total runs" value={String(cur.total)} color="#0f172a" />
        <StatCard label="Running" value={String(cur.running)} color={cur.running > 0 ? '#ea580c' : '#64748b'} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
        <StatCard label="Avg duration" value={fmtDuration(dur.avgSec)} color="#0f172a" sub={`p50 ${fmtDuration(dur.p50Sec)}`} />
        <StatCard label="p95 duration" value={fmtDuration(dur.p95Sec)} color="#0f172a" sub={`${dur.sampleCount} runs`} />
        <StatCard label="Current streak" value={streakText} color={streakColor} sub={rel.streakType === 'none' ? undefined : rel.streakType} subColor={streakColor} />
        <StatCard label="Last green" value={fmtAge(rel.lastGreenAgeHours)} color={rel.lastGreenAgeHours == null ? '#64748b' : '#0f172a'} />
        <StatCard label="Re-run rate" value={`${rel.rerunRatePct}%`} color={rel.rerunCount > 0 ? '#b45309' : '#16a34a'} sub={`${rel.rerunCount} of ${rel.totalRuns}`} />
      </div>

      <div style={chartCard}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.75rem' }}>
          Pass rate by day (%)
        </div>
        {trendData.length > 0 ? (
          <VerticalBarChart data={trendData} valueLabel="Pass rate %" barColor="#16a34a" />
        ) : (
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8' }}>No runs in window.</p>
        )}
      </div>
    </>
  );
}

function E2eRunDashboardContent() {
  const [timeWindow, setTimeWindow] = useState<E2eWindow>('7d');

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '1rem 2vw',
    }}>
      <div style={{ width: '100%', maxWidth: '98vw', margin: '0 auto' }}>
        <header style={{
          backgroundColor: 'rgba(255,255,255,0.97)',
          padding: '1.25rem 1.5rem',
          borderRadius: '12px',
          marginBottom: '1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
              E2E Run Dashboard
            </h1>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              Scheduled Playwright E2E runs against prod (main branch) · playwright-e2e.yml
            </p>
          </div>
          <a
            href="/"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#f1f5f9',
              color: '#334155',
              borderRadius: '6px',
              textDecoration: 'none',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            ← Dashboard
          </a>
        </header>
        <div style={{ marginBottom: '1.25rem' }}>
          <WindowSelector value={timeWindow} onChange={setTimeWindow} />
        </div>
        <E2eMetricsView timeWindow={timeWindow} />
        <RisqE2ePanel timeWindow={timeWindow} />
      </div>
    </div>
  );
}

export default function E2eRunDashboardPage() {
  return (
    <ProtectedRoute>
      <E2eRunDashboardContent />
    </ProtectedRoute>
  );
}
