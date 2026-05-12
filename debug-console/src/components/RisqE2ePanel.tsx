'use client';

import { type CSSProperties, useEffect, useState } from 'react';

interface E2eRunRow {
  success: boolean;
  status: string;
  conclusion: string;
  environment: string;
  gitBranch: string;
  durationSeconds?: number;
  timestamp: string;
  runUrl: string;
  runNumber: string;
}

function ghWorkflowActive(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'queued' || s === 'in_progress' || s === 'waiting' || s === 'requested' || s === 'pending';
}

function formatDurationSeconds(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

function formatCreated(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function envPillStyle(envRaw: string): { bg: string; fg: string } {
  const e = envRaw.toUpperCase();
  if (e.includes('PROD') && !e.includes('PRE')) return { bg: '#dcfce7', fg: '#15803d' };
  if (e.includes('TEST') || e.includes('DEV') || e.includes('PRE')) return { bg: '#dbeafe', fg: '#1d4ed8' };
  return { bg: '#f1f5f9', fg: '#475569' };
}

function statusDisplay(run: E2eRunRow): { text: string; color: string; prefix: string } {
  const st = (run.status || '').toLowerCase();
  if (ghWorkflowActive(run.status)) {
    return { text: 'RUNNING', color: '#ea580c', prefix: '⏳ ' };
  }
  if (st === 'completed') {
    if (run.success) return { text: 'PASS', color: '#15803d', prefix: '✅ ' };
    return { text: (run.conclusion || 'FAIL').toUpperCase(), color: '#b91c1c', prefix: '✗ ' };
  }
  return { text: (run.status || '—').toUpperCase(), color: '#64748b', prefix: '' };
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '0.85rem 1rem',
  fontSize: '0.65rem',
  fontWeight: 800,
  letterSpacing: '0.08em',
  color: '#64748b',
  textTransform: 'uppercase',
  borderBottom: '1px solid #e2e8f0',
  backgroundColor: '#f0f6ff',
};

const td: CSSProperties = {
  padding: '0.95rem 1rem',
  fontSize: '0.84rem',
  color: '#334155',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'middle',
};

export interface RisqE2ePanelProps {
  /** When set, shows a Close control in the header (e.g. RISQ expandable panel). */
  onDismiss?: () => void;
}

export default function RisqE2ePanel({ onDismiss }: RisqE2ePanelProps) {
  const [runs, setRuns] = useState<E2eRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const listRes = await fetch('/api/e2e-runs?action=list');
        const listBody = (await listRes.json().catch(() => ({}))) as { error?: string; runs?: E2eRunRow[] };
        if (cancelled) return;
        if (listRes.ok && Array.isArray(listBody.runs)) {
          setRuns(listBody.runs);
          setError(null);
        } else {
          setRuns([]);
          setError(typeof listBody.error === 'string' ? listBody.error : `HTTP ${listRes.status}`);
        }
      } catch (e) {
        if (!cancelled) {
          setRuns([]);
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
  }, []);

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: 14,
        border: '1px solid #e5e7eb',
        boxShadow: '0 2px 10px rgba(15,23,42,0.06)',
        overflow: 'hidden',
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          padding: '1rem 1.15rem',
          borderBottom: '1px solid #eef2f7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: '1.15rem', lineHeight: 1 }} aria-hidden>
            ✅
          </span>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
            E2E Test Results - Last 10 Prod Runs
          </h3>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>playwright-e2e.yml · GitHub</span>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#475569',
              backgroundColor: '#f0f6ff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Close
          </button>
        ) : null}
      </div>

      <div style={{ padding: '0.5rem 0 0' }}>
        {loading ? (
          <p style={{ margin: 0, padding: '1.5rem 1.15rem', fontSize: '0.88rem', color: '#64748b' }}>Loading…</p>
        ) : null}
        {!loading && error ? (
          <div
            style={{
              margin: '0.75rem 1rem 1rem',
              padding: '0.75rem 0.9rem',
              borderRadius: 10,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: '0.82rem',
            }}
          >
            {error}
          </div>
        ) : null}
        {!loading && !error && runs.length === 0 ? (
          <p style={{ margin: 0, padding: '1.5rem 1.15rem', fontSize: '0.85rem', color: '#94a3b8' }}>No workflow runs returned.</p>
        ) : null}
        {!loading && !error && runs.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Run #</th>
                  <th style={th}>Environment</th>
                  <th style={th}>Status</th>
                  <th style={th}>Branch</th>
                  <th style={th}>Duration</th>
                  <th style={th}>Created</th>
                  <th style={{ ...th, textAlign: 'right' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(function mapRun(run, i) {
                  const env = envPillStyle(run.environment);
                  const sd = statusDisplay(run);
                  return (
                    <tr key={`${run.runNumber}-${run.timestamp}-${i}`} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f0f6ff' }}>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#0f172a' }}>#{run.runNumber}</td>
                      <td style={td}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.55rem',
                            borderRadius: 6,
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            backgroundColor: env.bg,
                            color: env.fg,
                          }}
                        >
                          {run.environment || '—'}
                        </span>
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: sd.color }}>
                        {sd.prefix}
                        {sd.text}
                      </td>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: '#475569' }}>
                        {run.gitBranch || '—'}
                      </td>
                      <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: '#475569' }}>
                        {formatDurationSeconds(run.durationSeconds)}
                      </td>
                      <td style={{ ...td, color: '#64748b', fontSize: '0.8rem' }}>{formatCreated(run.timestamp)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {run.runUrl ? (
                          <a
                            href={run.runUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#2563eb', fontWeight: 700, fontSize: '0.82rem', textDecoration: 'none' }}
                          >
                            → View Run
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
        ) : null}
      </div>
    </div>
  );
}
