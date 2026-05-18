'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface ListedSummary {
  investigationId: string;
  appId: string;
  customerId: string;
  status: 'completed' | 'failed' | 'killed';
  startedAt: string;
  completedAt: string;
  durationMs: number | null;
  startedBy: string;
  feedbackExcerpt: string;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  confidence: number | null;
  rootCause: string | null;
  category: string | null;
  reportAvailable: boolean;
  error: string | null;
}

interface ListResponse {
  items: ListedSummary[];
  nextToken: string | null;
}

function todayUtcIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function statusColor(s: ListedSummary['status']): string {
  if (s === 'completed') return '#15803d';
  if (s === 'failed') return '#b91c1c';
  return '#a16207';
}

function sentimentBadge(s: ListedSummary['sentiment']): { bg: string; fg: string; label: string } | null {
  if (!s) return null;
  if (s === 'positive') return { bg: '#dcfce7', fg: '#15803d', label: 'Positive' };
  if (s === 'negative') return { bg: '#fee2e2', fg: '#b91c1c', label: 'Negative' };
  return { bg: '#f3f4f6', fg: '#374151', label: 'Neutral' };
}

export default function InvestigationsByDatePanel() {
  const [date, setDate] = useState<string>(todayUtcIsoDate());
  const [appIdFilter, setAppIdFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sentimentFilter, setSentimentFilter] = useState<string>('');
  const [items, setItems] = useState<ListedSummary[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (token: string | null) => {
    setLoading(true);
    setError(null);
    try {
      // All filters (appId, status, sentiment) applied client-side so Load More
      // always yields N new apps regardless of filter sparsity.
      const params = new URLSearchParams({ date });
      if (token) params.set('nextToken', token);
      const res = await fetch(`/api/investigate/summaries?${params.toString()}`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data: ListResponse = await res.json();
      setItems((prev) => (token ? [...prev, ...data.items] : data.items));
      setNextToken(data.nextToken);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void fetchPage(null); }, [fetchPage]);

  // All filters client-side — instant, works across all loaded pages, no sparse-pagination problem
  const visibleItems = useMemo(() => items.filter((i) => {
    if (appIdFilter && !i.appId.toLowerCase().includes(appIdFilter.toLowerCase())) return false;
    if (statusFilter && i.status !== statusFilter) return false;
    if (sentimentFilter && i.sentiment !== sentimentFilter) return false;
    return true;
  }), [items, appIdFilter, statusFilter, sentimentFilter]);

  const stats = useMemo(() => {
    const byStatus = { completed: 0, failed: 0, killed: 0 };
    for (const i of visibleItems) byStatus[i.status]++;
    return byStatus;
  }, [visibleItems]);

  const shell: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.98)',
    color: '#0f172a',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
    padding: '1.25rem 1.5rem',
    marginTop: '2rem',
  };

  const labelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#475569',
    gap: '0.3rem',
  };

  const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.55rem',
    fontSize: '0.85rem',
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
  };

  return (
    <section style={shell}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.85rem', color: '#0f172a' }}>Investigations</h2>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <label style={labelStyle}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          App ID
          <input type="text" value={appIdFilter} onChange={(e) => setAppIdFilter(e.target.value)} placeholder="filter…" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Status
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="killed">Killed</option>
          </select>
        </label>
        <label style={labelStyle}>
          Sentiment
          <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} style={inputStyle}>
            <option value="">All</option>
            <option value="positive">Positive</option>
            <option value="neutral">Neutral</option>
            <option value="negative">Negative</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#475569' }}>
        {loading ? 'Loading…' : (
          <>
            {`${visibleItems.length} of ${items.length} loaded · ✓ ${stats.completed} · ✗ ${stats.failed} · killed ${stats.killed}`}
            {visibleItems.length < items.length && (appIdFilter || statusFilter || sentimentFilter) && (
              <span style={{ color: '#b45309', marginLeft: '0.5rem' }}>— filter active, click Load more to search all apps</span>
            )}
          </>
        )}
      </div>

      {error && <div style={{ color: '#b91c1c', marginBottom: '0.75rem', fontSize: '0.85rem' }}>Error: {error}</div>}

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', color: '#0f172a' }}>
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>Time (UTC)</th>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>App</th>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>By</th>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>Status</th>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>Sentiment</th>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>Duration</th>
              <th style={{ padding: '0.6rem 0.7rem', textAlign: 'left', fontWeight: 700, color: '#334155', borderBottom: '1px solid #e2e8f0' }}>Feedback</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((row) => {
              const badge = sentimentBadge(row.sentiment);
              return (
                <tr key={row.investigationId} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.55rem 0.7rem', fontVariantNumeric: 'tabular-nums', color: '#334155' }}>
                    {row.completedAt.replace('T', ' ').replace('Z', '').slice(0, 19)}
                  </td>
                  <td style={{ padding: '0.55rem 0.7rem', fontFamily: 'monospace' }}>
                    {/* Intentionally navigates to latest investigation for the app — not the
                        specific row clicked. Dev-team use case is always "show me the latest
                        report for this app", not historical replay. */}
                    <Link
                      href={`/?appId=${encodeURIComponent(row.appId)}&customerId=${encodeURIComponent(row.customerId)}&tab=investigate`}
                      style={{ color: '#1d4ed8', textDecoration: 'none' }}
                    >
                      {row.appId}
                    </Link>
                  </td>
                  <td style={{ padding: '0.55rem 0.7rem', color: '#334155' }}>{row.startedBy}</td>
                  <td style={{ padding: '0.55rem 0.7rem', color: statusColor(row.status), fontWeight: 600 }}>{row.status}</td>
                  <td style={{ padding: '0.55rem 0.7rem' }}>
                    {badge ? (
                      <span style={{ background: badge.bg, color: badge.fg, padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600 }}>
                        {badge.label}{row.confidence != null ? ` ${Math.round(row.confidence * 100)}%` : ''}
                      </span>
                    ) : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ padding: '0.55rem 0.7rem', color: '#334155' }}>{fmtDuration(row.durationMs)}</td>
                  <td style={{ padding: '0.55rem 0.7rem', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }} title={row.feedbackExcerpt}>
                    {row.feedbackExcerpt}
                  </td>
                </tr>
              );
            })}
            {visibleItems.length === 0 && !loading && (
              <tr>
                <td colSpan={7} style={{ padding: '1.25rem', textAlign: 'center', color: '#94a3b8' }}>
                  No investigations on {date}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {nextToken && (
        <button
          type="button"
          onClick={() => void fetchPage(nextToken)}
          disabled={loading}
          style={{ marginTop: '0.75rem', padding: '0.45rem 0.9rem', background: '#1e293b', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
