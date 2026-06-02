'use client';

import { type CSSProperties, useEffect, useState } from 'react';

import ProtectedRoute from '@/components/ProtectedRoute';
import RisqE2ePanel, { type E2eWindow, E2E_WINDOW_LABELS } from '@/components/RisqE2ePanel';

interface E2eSummary {
  passed: number;
  failed: number;
  total: number;
  running: number;
}

const WINDOW_OPTIONS: E2eWindow[] = ['1d', '7d', '30d'];

// Denominator is completed runs only (passed + failed); in-flight runs are
// surfaced separately as the "Running" stat, so they shouldn't dilute the rate.
function successRatioPct(passed: number, completed: number): number | null {
  if (completed <= 0) return null;
  return Math.round((passed / completed) * 100);
}

const statCard: CSSProperties = {
  flex: '1 1 160px',
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

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={statCard}>
      <div style={statLabel}>{label}</div>
      <div style={{ fontSize: '1.65rem', fontWeight: 800, lineHeight: 1.1, color }}>{value}</div>
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

function E2eSummaryStrip({ timeWindow }: { timeWindow: E2eWindow }) {
  const [summary, setSummary] = useState<E2eSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/e2e-runs?action=summary&window=${timeWindow}`);
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          passed?: number;
          failed?: number;
          total?: number;
          running?: number;
        };
        if (cancelled) return;
        if (res.ok) {
          setSummary({
            passed: body.passed ?? 0,
            failed: body.failed ?? 0,
            total: body.total ?? 0,
            running: body.running ?? 0,
          });
          setError(null);
        } else {
          setSummary(null);
          setError(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
        }
      } catch (e) {
        if (!cancelled) {
          setSummary(null);
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
        Loading run summary…
      </p>
    );
  }

  if (error || !summary) {
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
        {error ?? 'No summary available'}
      </div>
    );
  }

  const completed = summary.passed + summary.failed;
  const ratio = successRatioPct(summary.passed, completed);
  const ratioColor = ratio == null ? '#64748b' : ratio === 100 ? '#16a34a' : summary.failed > 0 ? '#dc2626' : '#0f172a';
  const windowLabel = E2E_WINDOW_LABELS[timeWindow];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
      <StatCard label={`Success rate (${windowLabel})`} value={ratio == null ? '—' : `${ratio}%`} color={ratioColor} />
      <StatCard label="Passed" value={String(summary.passed)} color="#16a34a" />
      <StatCard label="Failed" value={String(summary.failed)} color={summary.failed > 0 ? '#dc2626' : '#0f172a'} />
      <StatCard label="Total runs" value={String(summary.total)} color="#0f172a" />
      <StatCard label="Running" value={String(summary.running)} color={summary.running > 0 ? '#ea580c' : '#64748b'} />
    </div>
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
        <E2eSummaryStrip timeWindow={timeWindow} />
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
