'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { HorizontalBarChart, SentimentPieChart } from '@/components/analytics/AnalyticsRecharts';

import { getDateRangeError, isDateRangeValid } from '@/lib/analytics/date-range';
import { logger } from '@/lib/logger';

type AnalyticsDatePreset = '1d' | '7d' | '14d' | '30d' | 'custom';

interface Summary {
  error?: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  merged_truncated?: boolean;
  partition_errors?: number;
  rangeDays?: 1 | 7 | 14 | 30;
  absoluteRange?: { start: string; end: string };
}

interface RecentRow {
  time: string;
  channel: string;
  sentiment: string;
  summary: string;
  rating: number;
}

const shell: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.98)',
  borderRadius: '14px',
  boxShadow: '0 4px 24px rgba(15,23,42,0.08)',
  border: '1px solid rgba(15,118,110,0.2)',
  borderLeft: '4px solid #0d9488',
  overflow: 'hidden',
};

function sentimentColor(s: string): string {
  if (s === 'positive') return '#16a34a';
  if (s === 'negative') return '#dc2626';
  return '#64748b';
}

function feedbackQuery(datePreset: AnalyticsDatePreset, customStart: string, customEnd: string): string | null {
  if (datePreset === 'custom') {
    if (!customStart || !customEnd || !isDateRangeValid(customStart, customEnd)) {
      return null;
    }
    return new URLSearchParams({ start: customStart, end: customEnd }).toString();
  }
  const days: Record<Exclude<AnalyticsDatePreset, 'custom'>, string> = {
    '1d': '1',
    '7d': '7',
    '14d': '14',
    '30d': '30',
  };
  return new URLSearchParams({ days: days[datePreset] }).toString();
}

export interface FeedbackAnalyticsPanelProps {
  datePreset: AnalyticsDatePreset;
  customStart: string;
  customEnd: string;
}

export default function FeedbackAnalyticsPanel({ datePreset, customStart, customEnd }: FeedbackAnalyticsPanelProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<{
    error?: string;
    items: RecentRow[];
    merged_truncated?: boolean;
    partition_errors?: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async function loadFeedback(trigger: 'auto' | 'refresh') {
      const q = feedbackQuery(datePreset, customStart, customEnd);
      if (!q) {
        setLoading(false);
        logger.warn('feedback.analytics.load.skip', {
          trigger,
          datePreset,
          reason: 'invalid_or_missing_range',
        });
        setError(getDateRangeError(customStart, customEnd) || 'Select start and end dates in the header (max 31 days)');
        setSummary(null);
        setRecent(null);
        return;
      }
      if (trigger === 'refresh') {
        logger.info('feedback.analytics.refresh.click', {
          query: q,
          datePreset,
          customStart: datePreset === 'custom' ? customStart : undefined,
          customEnd: datePreset === 'custom' ? customEnd : undefined,
        });
      } else {
        logger.debug('feedback.analytics.load.start', { query: q, trigger });
      }
      setLoading(true);
      setError(null);
      try {
        const [sumRes, recRes] = await Promise.all([
          fetch(`/api/feedback/summary?${q}`),
          fetch(`/api/feedback/recent?${q}`),
        ]);
        const sumData = await sumRes.json().catch(() => ({}));
        const recData = await recRes.json().catch(() => ({}));
        if (!sumRes.ok) {
          throw new Error(sumData.error || `Summary HTTP ${sumRes.status}`);
        }
        if (!recRes.ok) {
          throw new Error(recData.error || `Recent HTTP ${recRes.status}`);
        }
        setSummary(sumData as Summary);
        setRecent(
          recData as {
            error?: string;
            items: RecentRow[];
            merged_truncated?: boolean;
            partition_errors?: number;
          },
        );
        const s = sumData as Summary;
        const r = recData as { items?: RecentRow[] };
        logger.info('feedback.analytics.load.complete', {
          query: q,
          trigger,
          total: s.total,
          positive: s.positive,
          neutral: s.neutral,
          negative: s.negative,
          recentRowCount: Array.isArray(r.items) ? r.items.length : 0,
          summaryError: s.error ?? null,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to load';
        logger.warn('feedback.analytics.load.error', { query: q, trigger, message });
        setSummary(null);
        setRecent(null);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [datePreset, customStart, customEnd],
  );

  useEffect(() => {
    void load('auto');
  }, [load]);

  if (error && !summary) {
    return (
      <div style={{ ...shell, padding: '1rem 1.25rem', color: '#b91c1c', fontSize: '0.85rem' }}>
        {error}
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div style={{ ...shell, padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
        Loading feedback…
      </div>
    );
  }

  if (!summary) return null;

  const windowLabel = summary.absoluteRange
    ? `${summary.absoluteRange.start} → ${summary.absoluteRange.end} (UTC)`
    : summary.rangeDays === 1
      ? 'Last 24 hours (UTC)'
      : `Last ${summary.rangeDays} days (UTC)`;

  const totalLabel =
    summary.absoluteRange != null
      ? 'Ratings (range)'
      : summary.rangeDays === 1
        ? 'Ratings (24h)'
        : `Ratings (${summary.rangeDays}d)`;

  return (
    <div style={shell}>
      <div
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          background: 'linear-gradient(180deg, #f0fdfa 0%, #fff 100%)',
        }}
      >
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>Customer feedback</div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', maxWidth: '36rem', lineHeight: 1.45 }}>
            S3 Hive partitions by UTC day. Range matches the <strong style={{ color: '#334155' }}>page header</strong> (24h / 7 / 14 /
            30 days / Custom). Summary counts ratings in that window (1–7 scale: ≥6 positive, ≥4 neutral, else negative).
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={function onRefreshClick() {
              void load('refresh');
            }}
            style={{
              padding: '0.4rem 0.75rem',
              fontSize: '0.78rem',
              backgroundColor: '#134e4a',
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

      <div style={{ padding: '1rem 1.25rem 1.25rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.65rem' }}>
          {windowLabel}
        </div>

        {(summary.merged_truncated ?? false) || (recent?.merged_truncated ?? false) ? (
          <div style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: '0.65rem', lineHeight: 1.4 }}>
            Merged S3 payload exceeded the server merge cap; counts and sentiment reflect loaded rows only, not the full window.
          </div>
        ) : null}

        {(summary.partition_errors ?? 0) > 0 || (recent?.partition_errors ?? 0) > 0 ? (
          <div style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: '0.65rem', lineHeight: 1.4 }}>
            One or more S3 day partitions failed to list or read (partition_errors:{' '}
            {Math.max(summary.partition_errors ?? 0, recent?.partition_errors ?? 0)}). Counts may be incomplete; check server
            logs.
          </div>
        ) : null}

        {summary.error ? (
          <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{summary.error}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1rem',
              marginBottom: '1.25rem',
              alignItems: 'stretch',
            }}
          >
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '12px',
                padding: '0.75rem 1rem',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', marginBottom: '0.35rem' }}>Sentiment split</div>
              <SentimentPieChart
                positive={summary.positive}
                neutral={summary.neutral}
                negative={summary.negative}
                height={200}
              />
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '0.65rem',
              }}
            >
              {[
                { label: totalLabel, value: summary.total, color: '#0f766e' },
                { label: 'Positive', value: summary.positive, color: '#16a34a' },
                { label: 'Neutral', value: summary.neutral, color: '#64748b' },
                { label: 'Negative', value: summary.negative, color: '#dc2626' },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '10px',
                    padding: '0.65rem 0.85rem',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{label}</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color, marginTop: '0.15rem' }}>{value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>Latest feedback</div>
        {recent?.error ? (
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{recent.error}</div>
        ) : !recent?.items?.length ? (
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>No rows in this window</div>
        ) : (
          <>
            <div style={{ marginBottom: '0.75rem' }}>
              <HorizontalBarChart
                title="Latest rows — rating (1–7)"
                data={recent.items.map((row, i) => ({
                  name: `${i + 1}. ${row.sentiment}`,
                  value: row.rating,
                }))}
                barColor="#0d9488"
                height={Math.min(280, 48 + recent.items.length * 40)}
                nameMaxLen={22}
                valueLabel="Rating"
              />
            </div>
            <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9' }}>
                    {['Time (UTC)', 'Sentiment', 'Rating', 'Preview'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '0.45rem 0.65rem',
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          color: '#64748b',
                          textTransform: 'uppercase',
                          borderBottom: '1px solid #e2e8f0',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.items.map((row, i) => (
                    <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '0.5rem 0.65rem', color: '#64748b', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {row.time}
                      </td>
                      <td style={{ padding: '0.5rem 0.65rem', fontWeight: 700, color: sentimentColor(row.sentiment) }}>{row.sentiment}</td>
                      <td style={{ padding: '0.5rem 0.65rem', color: '#475569' }}>{row.rating}/7</td>
                      <td style={{ padding: '0.5rem 0.65rem', color: '#334155', lineHeight: 1.35 }}>{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
