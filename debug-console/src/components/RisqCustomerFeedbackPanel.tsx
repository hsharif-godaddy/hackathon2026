'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import RisqSectionCard from '@/components/RisqSectionCard';
import type { FeedbackDailyRow, FeedbackRecentRow } from '@/lib/feedback-s3';

type TimeRangeKey = '1d' | '7d' | 'all';

interface SummaryPayload {
  error?: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  daily?: FeedbackDailyRow[];
  merged_truncated?: boolean;
  partition_errors?: number;
  rangeDays?: number;
  absoluteRange?: { start: string; end: string };
  allTime?: boolean;
}

function feedbackDisplayBody(row: FeedbackRecentRow): string {
  return (
    row.summary?.trim() ||
    row.fullMessage?.trim() ||
    row.message?.trim() ||
    row.comment?.trim() ||
    ''
  );
}

type SentimentFilter = 'all' | 'positive' | 'neutral' | 'negative';

type PlanTierFilterKey = 'free' | 'starter' | 'professional' | 'ultimate';

function rowHasUserMessage(row: FeedbackRecentRow): boolean {
  return Boolean(row.comment?.trim() || row.message?.trim() || row.fullMessage?.trim());
}

function rowMatchesPlanTierFilter(row: FeedbackRecentRow, selected: readonly PlanTierFilterKey[]): boolean {
  if (!selected.length) return true;
  const p = (row.plan ?? '').toUpperCase();
  return selected.some(function matchKey(key) {
    if (key === 'free') return p.includes('FREE');
    if (key === 'starter') return p.includes('START');
    if (key === 'professional') return p.includes('PROFESSIONAL');
    return p.includes('ULTIMATE');
  });
}

const feedbackStack: CSSProperties = {
  marginTop: '1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.2rem',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const purple = '#5b21b6';
const purpleAccent = '#7c3aed';
const indigoTitle = '#3730a3';
const borderHairline = '#eef0f2';

const feedbackSectionShell: CSSProperties = {
  backgroundColor: '#f4f6f8',
  borderRadius: 20,
  border: `1px solid ${borderHairline}`,
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  padding: '1.65rem 1.8rem 1.85rem',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const timeRangeSelectStyle: CSSProperties = {
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

function daysQuery(range: TimeRangeKey): string {
  if (range === '1d') return 'days=1';
  if (range === 'all') return 'all=1';
  return 'days=7';
}

function starsRow(rating: number) {
  const n = Math.max(0, Math.min(7, Math.round(Number(rating) || 0)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.12rem' }}>
      {Array.from({ length: 7 }, function starCell(_, i) {
        const filled = i < n;
        return (
          <span
            key={i}
            style={{
              color: filled ? '#ea580c' : '#e5e7eb',
              fontSize: '0.8rem',
              lineHeight: 1,
            }}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}

function sentimentBadgeStyle(sentiment: string): { bg: string; fg: string; label: string } {
  if (sentiment === 'positive') return { bg: '#dcfce7', fg: '#15803d', label: 'Positive' };
  if (sentiment === 'negative') return { bg: '#fee2e2', fg: '#b91c1c', label: 'Negative' };
  return { bg: '#fef9c3', fg: '#b45309', label: 'Neutral' };
}

function planBadge(plan?: string): { bg: string; fg: string; text: string; border?: string } {
  const p = (plan ?? '').toUpperCase();
  if (p.includes('FREE')) return { bg: '#ede9fe', fg: '#6d28d9', text: p || 'FREE' };
  if (p.includes('START')) return { bg: '#ffedd5', fg: '#c2410c', text: p || 'STARTER' };
  if (p.includes('PROFESSIONAL')) return { bg: '#e0f2fe', fg: '#0369a1', text: p || 'PROFESSIONAL', border: '#bae6fd' };
  if (p.includes('ULTIMATE')) return { bg: '#faf5ff', fg: '#ea580c', text: p || 'ULTIMATE', border: '#ede9fe' };
  if (p) return { bg: '#f1f5f9', fg: '#475569', text: p };
  return { bg: '#f1f5f9', fg: '#64748b', text: '—' };
}

function filterButtonStyle(
  active: boolean,
  variant:
    | 'purple'
    | 'green'
    | 'yellow'
    | 'red'
    | 'white'
    | 'comments'
    | 'planFree'
    | 'planStarter'
    | 'planPro'
    | 'planUltimate',
): CSSProperties {
  const base: CSSProperties = {
    padding: '0.5rem 0.95rem',
    borderRadius: 10,
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    border: '1px solid transparent',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
  };
  if (variant === 'purple') {
    if (active) {
      return {
        ...base,
        backgroundColor: purpleAccent,
        color: '#fff',
        borderColor: '#6d28d9',
        boxShadow: '0 2px 8px rgba(124, 58, 237, 0.35)',
      };
    }
    return { ...base, backgroundColor: '#f5f3ff', color: purpleAccent, borderColor: '#ddd6fe' };
  }
  if (variant === 'green') {
    return {
      ...base,
      backgroundColor: active ? '#bbf7d0' : '#ecfdf5',
      color: '#15803d',
      borderColor: active ? '#4ade80' : '#d1fae5',
    };
  }
  if (variant === 'yellow') {
    return {
      ...base,
      backgroundColor: active ? '#fde68a' : '#fffbeb',
      color: '#c2410c',
      borderColor: active ? '#fbbf24' : '#fef3c7',
    };
  }
  if (variant === 'red') {
    return {
      ...base,
      backgroundColor: active ? '#fecaca' : '#fef2f2',
      color: '#b91c1c',
      borderColor: active ? '#f87171' : '#fee2e2',
    };
  }
  if (variant === 'comments') {
    return {
      ...base,
      backgroundColor: active ? '#c7d2fe' : '#eef2ff',
      color: active ? '#312e81' : '#4338ca',
      borderColor: active ? '#818cf8' : '#c7d2fe',
    };
  }
  if (variant === 'planFree') {
    return {
      ...base,
      backgroundColor: active ? '#ddd6fe' : '#f5f3ff',
      color: '#5b21b6',
      borderColor: active ? '#a78bfa' : '#e9d5ff',
    };
  }
  if (variant === 'planStarter') {
    return {
      ...base,
      backgroundColor: active ? '#fed7aa' : '#fff7ed',
      color: '#c2410c',
      borderColor: active ? '#fb923c' : '#ffedd5',
    };
  }
  if (variant === 'planPro') {
    return {
      ...base,
      backgroundColor: active ? '#bae6fd' : '#f0f9ff',
      color: '#0369a1',
      borderColor: active ? '#38bdf8' : '#e0f2fe',
    };
  }
  if (variant === 'planUltimate') {
    return {
      ...base,
      backgroundColor: active ? '#fce7f3' : '#fdf4ff',
      color: '#c026d3',
      borderColor: active ? '#f0abfc' : '#fae8ff',
    };
  }
  return {
    ...base,
    backgroundColor: '#ffffff',
    color: '#0f172a',
    borderColor: borderHairline,
    boxShadow: active ? '0 0 0 2px rgba(124, 58, 237, 0.12)' : undefined,
  };
}

function FeedbackCard({ row }: { row: FeedbackRecentRow }) {
  const sent = sentimentBadgeStyle(row.sentiment);
  const plan = planBadge(row.plan);
  const body = feedbackDisplayBody(row);
  const hasRemainCredits =
    row.totalCredits !== undefined &&
    row.totalCredits > 0 &&
    row.availableCredits !== undefined &&
    Number.isFinite(row.availableCredits);
  const hasLegacyCredits =
    row.creditsLimit !== undefined &&
    row.creditsLimit > 0 &&
    row.creditsUsed !== undefined &&
    Number.isFinite(row.creditsUsed);
  const remainPct = hasRemainCredits
    ? Math.min(100, Math.round((row.availableCredits! / row.totalCredits!) * 100))
    : 0;
  const legacyPct = hasLegacyCredits
    ? Math.min(100, Math.round((row.creditsUsed! / row.creditsLimit!) * 100))
    : 0;
  const emoji = row.sentiment === 'positive' ? '😊' : row.sentiment === 'negative' ? '☹️' : '😐';
  const statusLine = (row.subscriptionStatus ?? row.status ?? 'active').toLowerCase();
  const footerId = row.customerId ?? row.instanceId ?? '—';

  return (
    <div
      style={{
        border: '1px solid #e8e8ef',
        borderRadius: 16,
        padding: '1.1rem 1.25rem 1.15rem',
        backgroundColor: '#ffffff',
        boxShadow: '0 2px 14px rgba(15, 23, 42, 0.06)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
          alignItems: 'center',
          columnGap: '0.65rem',
          rowGap: '0.35rem',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            flexWrap: 'wrap',
            justifySelf: 'start',
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: '1rem', lineHeight: 1 }}>{emoji}</span>
          <span
            style={{
              fontSize: '0.58rem',
              fontWeight: 800,
              letterSpacing: '0.07em',
              padding: '0.18rem 0.45rem',
              borderRadius: 6,
              backgroundColor: sent.bg,
              color: sent.fg,
              lineHeight: 1.2,
            }}
          >
            {sent.label}
          </span>
          <span
            style={{
              fontSize: '0.58rem',
              fontWeight: 800,
              letterSpacing: '0.06em',
              padding: '0.18rem 0.45rem',
              borderRadius: 6,
              backgroundColor: plan.bg,
              color: plan.fg,
              lineHeight: 1.2,
              border: plan.border ? `1px solid ${plan.border}` : undefined,
            }}
          >
            {plan.text}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.45rem',
            flexWrap: 'nowrap',
            justifySelf: 'center',
          }}
        >
          {starsRow(row.rating)}
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {row.rating}/7
          </span>
        </div>
        <div style={{ textAlign: 'right', justifySelf: 'end', lineHeight: 1.25, minWidth: 0 }}>
          {row.dateUtc && row.clockUtc ? (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{row.dateUtc}</div>
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: '#475569',
                  marginTop: '0.1rem',
                  fontVariantNumeric: 'tabular-nums',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}
              >
                {row.clockUtc} UTC
              </div>
            </>
          ) : (
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>{row.shortTime ?? row.time}</div>
          )}
          <div
            style={{
              fontSize: '0.68rem',
              color: '#94a3b8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              marginTop: '0.12rem',
              wordBreak: 'break-all',
            }}
          >
            {row.appId ?? row.userKey ?? '—'}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: '0.65rem',
          borderRadius: 12,
          backgroundColor: '#f4f4f8',
          border: '1px solid #ececf2',
          borderLeft: '4px solid #7c3aed',
          padding: '0.65rem 0.85rem 0.75rem 0.95rem',
        }}
      >
        <div
          style={{
            fontSize: '0.55rem',
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: '#64748b',
            textTransform: 'uppercase',
            marginBottom: '0.35rem',
          }}
        >
          Message
        </div>
        <div
          style={{
            fontSize: '0.82rem',
            color: body ? '#334155' : '#9ca3af',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
          }}
        >
          {body || '(No message text)'}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: '0.65rem',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.6rem',
              fontWeight: 700,
              color: '#16a34a',
              letterSpacing: '0.06em',
              lineHeight: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Status: {statusLine}
          </div>
          <div
            style={{
              fontSize: '0.6rem',
              color: '#94a3b8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              marginTop: '0.18rem',
              wordBreak: 'break-all',
              lineHeight: 1.35,
            }}
          >
            {footerId}
          </div>
        </div>
        {hasRemainCredits ? (
          <div style={{ minWidth: 140, flex: '0 1 168px' }}>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#64748b', marginBottom: '0.14rem', lineHeight: 1.2 }}>
              Credits: {row.availableCredits}/{row.totalCredits}
            </div>
            <div style={{ height: 6, borderRadius: 4, backgroundColor: '#fee2e2', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${remainPct}%`,
                  height: '100%',
                  backgroundColor: remainPct > 0 ? '#22c55e' : '#ef4444',
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        ) : hasLegacyCredits ? (
          <div style={{ minWidth: 140, flex: '0 1 168px' }}>
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: '#64748b', marginBottom: '0.14rem', lineHeight: 1.2 }}>
              Credits: {row.creditsUsed}/{row.creditsLimit}
            </div>
            <div style={{ height: 6, borderRadius: 4, backgroundColor: '#fee2e2', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${legacyPct}%`,
                  height: '100%',
                  backgroundColor: legacyPct > 0 ? '#22c55e' : '#ef4444',
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function RisqCustomerFeedbackPanel() {
  const [range, setRange] = useState<TimeRangeKey>('1d');
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [dailyChart7d, setDailyChart7d] = useState<FeedbackDailyRow[]>([]);
  const [recent, setRecent] = useState<{ items: FeedbackRecentRow[]; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<SentimentFilter>('all');
  const [onlyWithComments, setOnlyWithComments] = useState(false);
  const [planTierFilterKeys, setPlanTierFilterKeys] = useState<PlanTierFilterKey[]>([]);
  const responsesRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async function loadFeedback() {
      const q = daysQuery(range);
      setLoading(true);
      setLoadErr(null);
      try {
        const [sumRes, recRes, chart7Res] = await Promise.all([
          fetch(`/api/feedback/summary?${q}`),
          fetch(`/api/feedback/recent?${q}&limit=500`),
          fetch('/api/feedback/summary?days=7'),
        ]);
        const sumData = (await sumRes.json().catch(() => ({}))) as SummaryPayload;
        const recData = (await recRes.json().catch(() => ({}))) as { error?: string; items?: FeedbackRecentRow[] };
        const chart7Data = (await chart7Res.json().catch(() => ({}))) as SummaryPayload;
        if (!sumRes.ok) {
          throw new Error(typeof sumData.error === 'string' ? sumData.error : `Summary HTTP ${sumRes.status}`);
        }
        if (!recRes.ok) {
          throw new Error(typeof recData.error === 'string' ? recData.error : `Recent HTTP ${recRes.status}`);
        }
        setSummary(sumData);
        setDailyChart7d(chart7Res.ok && Array.isArray(chart7Data.daily) ? chart7Data.daily : []);
        setRecent({ items: Array.isArray(recData.items) ? recData.items : [], error: recData.error });
      } catch (e) {
        setSummary(null);
        setRecent(null);
        setDailyChart7d([]);
        setLoadErr(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [range],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(
    function computeFiltered() {
      let items = recent?.items ?? [];
      if (filter === 'positive') items = items.filter((r) => r.sentiment === 'positive');
      else if (filter === 'neutral') items = items.filter((r) => r.sentiment === 'neutral');
      else if (filter === 'negative') items = items.filter((r) => r.sentiment === 'negative');
      if (onlyWithComments) items = items.filter(rowHasUserMessage);
      if (planTierFilterKeys.length) {
        items = items.filter((r) => rowMatchesPlanTierFilter(r, planTierFilterKeys));
      }
      return items;
    },
    [recent, filter, onlyWithComments, planTierFilterKeys],
  );

  if (loadErr && !summary) {
    return (
      <div style={feedbackStack}>
        <div style={{ ...feedbackSectionShell, color: '#991b1b', fontSize: '0.88rem' }}>{loadErr}</div>
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div style={feedbackStack}>
        <div style={{ ...feedbackSectionShell, padding: '2.25rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
          Loading customer feedback…
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const pos = summary.positive;
  const neu = summary.neutral;
  const neg = summary.negative;
  const tot = summary.total;

  return (
    <div style={feedbackStack}>
      <section style={feedbackSectionShell}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'flex-start', minWidth: 0 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `linear-gradient(155deg, ${purpleAccent} 0%, ${purple} 100%)`,
                boxShadow: '0 6px 18px rgba(91, 33, 182, 0.28)',
              }}
              aria-hidden
            >
              <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>💬</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.28rem',
                    fontWeight: 800,
                    color: indigoTitle,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.15,
                  }}
                >
                  Customer Feedback
                </h2>
                <span
                  style={{
                    fontSize: '0.58rem',
                    fontWeight: 800,
                    letterSpacing: '0.09em',
                    color: '#1d4ed8',
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    padding: '0.22rem 0.55rem',
                    borderRadius: 999,
                    flexShrink: 0,
                  }}
                >
                  • LIVE FROM S3
                </span>
              </div>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#64748b', fontWeight: 500, lineHeight: 1.45 }}>
                Real-time customer insights • Rating scale 1–7
              </p>
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.22rem', flexShrink: 0 }}>
            <span style={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.1em', color: '#94a3b8' }}>TIME RANGE</span>
            <select
              value={range}
              aria-label="Feedback time range"
              style={timeRangeSelectStyle}
              onChange={function onRangeChange(e) {
                const v = e.target.value;
                setRange(v === '1d' ? '1d' : v === 'all' ? 'all' : '7d');
              }}
            >
              <option value="1d">24 Hours</option>
              <option value="7d">7 Days</option>
              <option value="all">All time</option>
            </select>
          </label>
        </div>

        {(summary.merged_truncated ?? false) ? (
          <div style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: '0.65rem', lineHeight: 1.4 }}>
            Merged S3 payload exceeded the server merge cap; charts and list reflect loaded rows only.
          </div>
        ) : null}
        {(summary.partition_errors ?? 0) > 0 ? (
          <div style={{ fontSize: '0.72rem', color: '#b45309', marginBottom: '0.65rem' }}>
            Partition read errors: {summary.partition_errors}. Counts may be incomplete.
          </div>
        ) : null}

        {summary.error ? (
          <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{summary.error}</div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
                gap: '1rem',
                marginBottom: '1.35rem',
              }}
            >
              {[
                { id: 'positive' as const, label: 'Positive', v: pos, bg: '#ecfdf5', bd: '#86efac', fg: '#15803d', arc: '#4ade80' },
                { id: 'neutral' as const, label: 'Neutral', v: neu, bg: '#fffbeb', bd: '#fcd34d', fg: '#d97706', arc: '#fbbf24' },
                { id: 'negative' as const, label: 'Negative', v: neg, bg: '#fef2f2', bd: '#fca5a5', fg: '#dc2626', arc: '#f87171' },
                { id: 'total' as const, label: 'Total feedback', v: tot, bg: '#eff6ff', bd: '#93c5fd', fg: '#2563eb', arc: '#60a5fa' },
              ].map(function metricCard(m) {
                return (
                  <div
                    key={m.id}
                    style={{
                      position: 'relative',
                      overflow: 'hidden',
                      borderRadius: 16,
                      padding: '1.15rem 1.1rem 1.2rem',
                      backgroundColor: m.bg,
                      border: `1px solid ${m.bd}`,
                      minHeight: 126,
                      textAlign: 'center',
                    }}
                  >
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        right: -36,
                        top: -36,
                        width: 96,
                        height: 96,
                        borderRadius: '50%',
                        backgroundColor: m.arc,
                        opacity: 0.26,
                      }}
                    />
                    <div style={{ position: 'relative', zIndex: 1 }}>
                      <div style={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em', color: m.fg }}>{m.label}</div>
                      <div style={{ fontSize: '1.85rem', fontWeight: 900, color: m.fg, marginTop: '0.35rem', lineHeight: 1.05 }}>
                        {m.v.toLocaleString('en-US')}
                      </div>
                      {m.id === 'total' ? (
                        <button
                          type="button"
                          onClick={function scrollToResponses() {
                            responsesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          style={{
                            marginTop: '0.45rem',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: '#2563eb',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            textDecoration: 'underline',
                            textUnderlineOffset: '2px',
                          }}
                        >
                          All responses
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
                marginBottom: '0.35rem',
              }}
            >
              <RisqSectionCard
                variant="compact"
                bodyBackground="#ffffff"
                title="Total feedback by day (last 7 days, UTC)"
                marginBottom="0"
              >
                {dailyChart7d.length ? (
                  <ResponsiveContainer width="100%" height={268}>
                    <BarChart data={dailyChart7d} margin={{ top: 14, right: 14, left: 4, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={42} />
                      <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Count']} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                      <Bar dataKey="total" fill="#a5b4fc" radius={[8, 8, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '2rem 0', textAlign: 'center' }}>No chart data</div>
                )}
              </RisqSectionCard>
              <RisqSectionCard
                variant="compact"
                bodyBackground="#ffffff"
                title="Sentiment by day (last 7 days, UTC)"
                marginBottom="0"
              >
                {dailyChart7d.length ? (
                  <ResponsiveContainer width="100%" height={268}>
                    <BarChart data={dailyChart7d} margin={{ top: 14, right: 14, left: 4, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={42} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                      <Bar dataKey="positive" stackId="s" fill="#22c55e" name="Positive" maxBarSize={44} />
                      <Bar dataKey="neutral" stackId="s" fill="#fb923c" name="Neutral" maxBarSize={44} />
                      <Bar dataKey="negative" stackId="s" fill="#ef4444" name="Negative" radius={[8, 8, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '2rem 0', textAlign: 'center' }}>No chart data</div>
                )}
              </RisqSectionCard>
            </div>
          </>
        )}

        {!summary.error ? (
          <div
            id="feedback-responses"
            ref={responsesRef}
            style={{
              marginTop: '1.5rem',
              paddingTop: '1.5rem',
              borderTop: `1px solid ${borderHairline}`,
            }}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                borderRadius: 14,
                border: `1px solid ${borderHairline}`,
                padding: '1.15rem 1.25rem',
                marginBottom: '1.15rem',
                boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <span style={{ fontSize: '1.05rem', opacity: 0.85 }} aria-hidden>
                    🔍
                  </span>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a' }}>Filter by sentiment, comments, and plan tier</div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.12rem' }}>
                      Showing {filteredRows.length} of {tot.toLocaleString('en-US')} feedbacks
                      {recent && recent.items.length < tot ? ' (loaded subset)' : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      style={filterButtonStyle(filter === 'all', 'purple')}
                      onClick={function pickAll() {
                        setFilter('all');
                      }}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(filter === 'positive', 'green')}
                      onClick={function pickPositive() {
                        setFilter('positive');
                      }}
                    >
                      Positive
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(filter === 'neutral', 'yellow')}
                      onClick={function pickNeutral() {
                        setFilter('neutral');
                      }}
                    >
                      Neutral
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(filter === 'negative', 'red')}
                      onClick={function pickNegative() {
                        setFilter('negative');
                      }}
                    >
                      Negative
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(onlyWithComments, 'comments')}
                      onClick={function toggleCommentsOnly() {
                        setOnlyWithComments(function flip(v) {
                          return !v;
                        });
                      }}
                    >
                      With comments
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <span
                      style={{
                        fontSize: '0.58rem',
                        fontWeight: 800,
                        letterSpacing: '0.08em',
                        color: '#94a3b8',
                        marginRight: '0.15rem',
                        alignSelf: 'center',
                      }}
                    >
                      PLAN TIER
                    </span>
                    <button
                      type="button"
                      style={filterButtonStyle(planTierFilterKeys.includes('free'), 'planFree')}
                      onClick={function toggleFreeTier() {
                        setPlanTierFilterKeys(function toggleFree(prev) {
                          return prev.includes('free') ? prev.filter((k) => k !== 'free') : [...prev, 'free'];
                        });
                      }}
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(planTierFilterKeys.includes('starter'), 'planStarter')}
                      onClick={function toggleStarterTier() {
                        setPlanTierFilterKeys(function toggleStarter(prev) {
                          return prev.includes('starter') ? prev.filter((k) => k !== 'starter') : [...prev, 'starter'];
                        });
                      }}
                    >
                      Starter
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(planTierFilterKeys.includes('professional'), 'planPro')}
                      onClick={function toggleProTier() {
                        setPlanTierFilterKeys(function togglePro(prev) {
                          return prev.includes('professional')
                            ? prev.filter((k) => k !== 'professional')
                            : [...prev, 'professional'];
                        });
                      }}
                    >
                      Professional
                    </button>
                    <button
                      type="button"
                      style={filterButtonStyle(planTierFilterKeys.includes('ultimate'), 'planUltimate')}
                      onClick={function toggleUltimateTier() {
                        setPlanTierFilterKeys(function toggleUltimate(prev) {
                          return prev.includes('ultimate') ? prev.filter((k) => k !== 'ultimate') : [...prev, 'ultimate'];
                        });
                      }}
                    >
                      Ultimate
                    </button>
                    {planTierFilterKeys.length ? (
                      <button
                        type="button"
                        onClick={function clearPlanTiers() {
                          setPlanTierFilterKeys([]);
                        }}
                        style={{
                          padding: '0.45rem 0.65rem',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          color: '#64748b',
                          backgroundColor: '#f8fafc',
                          border: `1px solid ${borderHairline}`,
                          borderRadius: 8,
                          cursor: 'pointer',
                        }}
                      >
                        Clear tiers
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {loading ? (
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Updating…</div>
            ) : recent?.error ? (
              <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{recent.error}</div>
            ) : filteredRows.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>No rows match this filter.</div>
            ) : (
              <div
                style={{
                  maxHeight: 'min(44rem, 62vh)',
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  paddingRight: '0.2rem',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '0.85rem',
                    alignItems: 'start',
                  }}
                >
                  {filteredRows.map(function mapRow(row, idx) {
                    return <FeedbackCard key={`${row.time}-${row.userKey ?? ''}-${idx}`} row={row} />;
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
