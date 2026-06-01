'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { SentimentPieChart } from '@/components/analytics/AnalyticsRecharts';

import { getDateRangeError, isDateRangeValid } from '@/lib/analytics/date-range';
import { logger } from '@/lib/logger';

type AnalyticsDatePreset = '1d' | '7d' | '14d' | '30d' | 'custom';

const DATE_PRESETS: ReadonlyArray<{ id: AnalyticsDatePreset; label: string }> = [
  { id: '1d', label: '24h' },
  { id: '7d', label: '7 days' },
  { id: '14d', label: '14 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom' },
];

const SCORE_VALUES: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6, 7];

interface Facets {
  topics: string[];
  experiments: string[];
  categories: string[];
}

interface ExperimentVariantStats {
  variant: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  avgRating: number | null;
}

interface Summary {
  error?: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  categoryCounts?: Record<string, number>;
  merged_truncated?: boolean;
  partition_errors?: number;
  rangeDays?: 1 | 7 | 14 | 30;
  absoluteRange?: { start: string; end: string };
  facets?: Facets;
  timeline?: Array<{ ts: number; rating: number }>;
  experimentCohorts?: Record<string, ExperimentVariantStats[]>;
}

interface RecentRow {
  time: string;
  channel: string;
  sentiment: string;
  summary: string;
  rating: number;
  appId?: string;
  feedbackId?: string;
  category?: string;
}

const CATEGORY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  feedback: { bg: '#dbeafe', fg: '#1d4ed8', label: 'Feedback' },
  issue: { bg: '#fee2e2', fg: '#991b1b', label: 'Issue' },
  bug: { bg: '#ffedd5', fg: '#9a3412', label: 'Bug' },
  support: { bg: '#fef3c7', fg: '#92400e', label: 'Support' },
};

function categoryChipStyle(category: string | undefined): { bg: string; fg: string; label: string } {
  if (!category) return { bg: '#f3f4f6', fg: '#6b7280', label: '—' };
  const key = category.toLowerCase();
  return CATEGORY_STYLES[key] ?? { bg: '#f3f4f6', fg: '#374151', label: category };
}

const shell: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.98)',
  borderRadius: '14px',
  boxShadow: '0 4px 24px rgba(15,23,42,0.08)',
  border: '1px solid rgba(15,118,110,0.2)',
  borderLeft: '4px solid #0d9488',
  overflow: 'hidden',
};

function formatTimelineTick(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function formatTimelineLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

// `recent` defaults to 12 rows for the table view. When the panel filters,
// we want every matching row so the user can page through them all — the
// recent route caps the response at 500.
const RECENT_REQUEST_LIMIT = 500;

function feedbackQuery(
  datePreset: AnalyticsDatePreset,
  customStart: string,
  customEnd: string,
  scores: ReadonlySet<number>,
  topics: ReadonlySet<string>,
  experiments: ReadonlySet<string>,
  categories: ReadonlySet<string>,
  options?: { withRecentLimit?: boolean },
): string | null {
  const params = new URLSearchParams();
  if (datePreset === 'custom') {
    if (!customStart || !customEnd || !isDateRangeValid(customStart, customEnd)) return null;
    params.set('start', customStart);
    params.set('end', customEnd);
  } else {
    const days: Record<Exclude<AnalyticsDatePreset, 'custom'>, string> = {
      '1d': '1',
      '7d': '7',
      '14d': '14',
      '30d': '30',
    };
    params.set('days', days[datePreset]);
  }
  if (scores.size > 0) {
    params.set('scores', Array.from(scores).sort((a, b) => a - b).join(','));
  }
  if (topics.size > 0) {
    params.set('topics', Array.from(topics).sort().join(','));
  }
  if (experiments.size > 0) {
    params.set('experiments', Array.from(experiments).sort().join(','));
  }
  if (categories.size > 0) {
    params.set('categories', Array.from(categories).sort().join(','));
  }
  if (options?.withRecentLimit) {
    params.set('limit', String(RECENT_REQUEST_LIMIT));
  }
  return params.toString();
}

function parseSetParam(raw: string | null): Set<string> {
  if (!raw) return new Set<string>();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function parseScoresParam(raw: string | null): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  for (const s of raw.split(',')) {
    const n = Number.parseInt(s.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.add(n);
  }
  return out;
}

function parseRangeParam(raw: string | null): AnalyticsDatePreset {
  if (raw === '1d' || raw === '7d' || raw === '14d' || raw === '30d' || raw === 'custom') return raw;
  return '7d';
}

// All filter controls share the same darker border so the (occasionally
// sticky) browser focus ring doesn't make some buttons look heavier than
// the rest — see https://stackoverflow.com/a/1648854 for the underlying
// focus-after-click behavior we're routing around.
const filterButton: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  backgroundColor: '#fff',
  color: '#374151',
  border: '1px solid #94a3b8',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '0.75rem',
  fontWeight: 500,
  outline: 'none',
};

const filterButtonActive: React.CSSProperties = {
  ...filterButton,
  backgroundColor: '#1d4ed8',
  color: 'white',
  borderColor: '#1d4ed8',
};

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: ReadonlySet<string>;
  onToggle: (option: string) => void;
  onClear: () => void;
  emptyMessage: string;
  renderOption?: (opt: string) => React.ReactNode;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
  emptyMessage,
  renderOption,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const count = selected.size;
  const buttonLabel = count > 0 ? `${label} (${count})` : label;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={count > 0 ? filterButtonActive : filterButton}
      >
        {buttonLabel} ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            minWidth: '220px',
            maxHeight: '320px',
            overflowY: 'auto',
            backgroundColor: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 8px 20px rgba(15,23,42,0.15)',
            padding: '0.5rem',
          }}
        >
          {options.length === 0 ? (
            <div style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', color: '#94a3b8' }}>{emptyMessage}</div>
          ) : (
            <>
              {options.map((opt) => (
                <label
                  key={opt}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.3rem 0.4rem',
                    fontSize: '0.8rem',
                    color: '#374151',
                    cursor: 'pointer',
                    borderRadius: '4px',
                  }}
                >
                  <input type="checkbox" checked={selected.has(opt)} onChange={() => onToggle(opt)} />
                  <span style={{ wordBreak: 'break-word' }}>{renderOption ? renderOption(opt) : opt}</span>
                </label>
              ))}
              {count > 0 && (
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '0.4rem', paddingTop: '0.4rem' }}>
                  <button
                    type="button"
                    onClick={onClear}
                    style={{
                      width: '100%',
                      padding: '0.3rem',
                      fontSize: '0.75rem',
                      color: '#dc2626',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontWeight: 600,
                    }}
                  >
                    Clear {label}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function FeedbackAnalyticsPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const datePreset = parseRangeParam(searchParams?.get('range') ?? null);
  const customStart = searchParams?.get('start') ?? '';
  const customEnd = searchParams?.get('end') ?? '';
  const scores = useMemo(() => parseScoresParam(searchParams?.get('scores') ?? null), [searchParams]);
  const topicsFilter = useMemo(() => parseSetParam(searchParams?.get('topics') ?? null), [searchParams]);
  const experimentsFilter = useMemo(
    () => parseSetParam(searchParams?.get('experiments') ?? null),
    [searchParams],
  );
  const categoriesFilter = useMemo(
    () => parseSetParam(searchParams?.get('categories') ?? null),
    [searchParams],
  );

  // Local-only mirrors for the custom-range inputs so the user can type a
  // start/end pair and click Apply once — without these the URL would be
  // re-written and the data refetched on every keystroke.
  const [customStartDraft, setCustomStartDraft] = useState(customStart);
  const [customEndDraft, setCustomEndDraft] = useState(customEnd);
  useEffect(() => {
    setCustomStartDraft(customStart);
  }, [customStart]);
  useEffect(() => {
    setCustomEndDraft(customEnd);
  }, [customEnd]);

  const updateUrl = useCallback(
    (overrides: {
      range?: AnalyticsDatePreset;
      start?: string;
      end?: string;
      scores?: ReadonlySet<number>;
      topics?: ReadonlySet<string>;
      experiments?: ReadonlySet<string>;
      categories?: ReadonlySet<string>;
    }) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      next.set('tab', 'feedback');

      const range = overrides.range ?? datePreset;
      if (range === '7d') {
        next.delete('range');
      } else {
        next.set('range', range);
      }

      const startVal = overrides.start ?? customStart;
      const endVal = overrides.end ?? customEnd;
      if (range === 'custom' && startVal && endVal) {
        next.set('start', startVal);
        next.set('end', endVal);
      } else {
        next.delete('start');
        next.delete('end');
      }

      const scoresVal = overrides.scores ?? scores;
      if (scoresVal.size > 0) {
        next.set('scores', Array.from(scoresVal).sort((a, b) => a - b).join(','));
      } else {
        next.delete('scores');
      }

      const topicsVal = overrides.topics ?? topicsFilter;
      if (topicsVal.size > 0) {
        next.set('topics', Array.from(topicsVal).sort().join(','));
      } else {
        next.delete('topics');
      }

      const experimentsVal = overrides.experiments ?? experimentsFilter;
      if (experimentsVal.size > 0) {
        next.set('experiments', Array.from(experimentsVal).sort().join(','));
      } else {
        next.delete('experiments');
      }

      const categoriesVal = overrides.categories ?? categoriesFilter;
      if (categoriesVal.size > 0) {
        next.set('categories', Array.from(categoriesVal).sort().join(','));
      } else {
        next.delete('categories');
      }

      router.replace(`/analytics?${next.toString()}`, { scroll: false });
    },
    [router, searchParams, datePreset, customStart, customEnd, scores, topicsFilter, experimentsFilter, categoriesFilter],
  );

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
      const q = feedbackQuery(datePreset, customStart, customEnd, scores, topicsFilter, experimentsFilter, categoriesFilter);
      const recentQuery = feedbackQuery(
        datePreset,
        customStart,
        customEnd,
        scores,
        topicsFilter,
        experimentsFilter,
        categoriesFilter,
        { withRecentLimit: true },
      );
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
          scoreCount: scores.size,
          topicCount: topicsFilter.size,
          experimentCount: experimentsFilter.size,
        });
      } else {
        logger.debug('feedback.analytics.load.start', { query: q, trigger });
      }
      setLoading(true);
      setError(null);
      try {
        const [sumRes, recRes] = await Promise.all([
          fetch(`/api/feedback/summary?${q}`),
          fetch(`/api/feedback/recent?${recentQuery ?? q}`),
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
    [datePreset, customStart, customEnd, scores, topicsFilter, experimentsFilter, categoriesFilter],
  );

  useEffect(() => {
    void load('auto');
  }, [load]);

  const facets: Facets = summary?.facets ?? { topics: [], experiments: [], categories: [] };
  const customDraftValid =
    customStartDraft !== '' && customEndDraft !== '' && isDateRangeValid(customStartDraft, customEndDraft);
  const customDraftError = getDateRangeError(customStartDraft, customEndDraft);

  const onToggleScore = useCallback(
    (val: number) => {
      const next = new Set(scores);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      updateUrl({ scores: next });
    },
    [scores, updateUrl],
  );

  const onToggleTopic = useCallback(
    (val: string) => {
      const next = new Set(topicsFilter);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      updateUrl({ topics: next });
    },
    [topicsFilter, updateUrl],
  );

  const onToggleExperiment = useCallback(
    (val: string) => {
      const next = new Set(experimentsFilter);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      updateUrl({ experiments: next });
    },
    [experimentsFilter, updateUrl],
  );

  const onToggleCategory = useCallback(
    (val: string) => {
      const next = new Set(categoriesFilter);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      updateUrl({ categories: next });
    },
    [categoriesFilter, updateUrl],
  );

  const hasNonDefaultFilters =
    scores.size > 0 ||
    topicsFilter.size > 0 ||
    experimentsFilter.size > 0 ||
    categoriesFilter.size > 0 ||
    datePreset !== '7d';
  const onClearAll = useCallback(() => {
    updateUrl({
      range: '7d',
      start: '',
      end: '',
      scores: new Set(),
      topics: new Set(),
      experiments: new Set(),
      categories: new Set(),
    });
  }, [updateUrl]);

  const windowLabel = summary?.absoluteRange
    ? `${summary.absoluteRange.start} → ${summary.absoluteRange.end} (UTC)`
    : summary?.rangeDays === 1
      ? 'Last 24 hours (UTC)'
      : summary?.rangeDays
        ? `Last ${summary.rangeDays} days (UTC)`
        : '';

  const totalLabel =
    summary?.absoluteRange != null
      ? 'Ratings (range)'
      : summary?.rangeDays === 1
        ? 'Ratings (24h)'
        : summary?.rangeDays
          ? `Ratings (${summary.rangeDays}d)`
          : 'Ratings';

  return (
    <div style={{ ...shell, position: 'relative' }}>
      {loading && summary ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            backgroundColor: 'rgba(255,255,255,0.55)',
            backdropFilter: 'blur(1px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'wait',
          }}
          aria-busy="true"
          aria-live="polite"
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.85rem',
              backgroundColor: '#fff',
              border: '1px solid #cbd5e1',
              borderRadius: '999px',
              boxShadow: '0 4px 12px rgba(15,23,42,0.12)',
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                border: '2px solid #cbd5e1',
                borderTopColor: '#0d9488',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Updating…</span>
          </div>
        </div>
      ) : null}
      <div
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '0.75rem',
          background: 'linear-gradient(180deg, #f0fdfa 0%, #fff 100%)',
        }}
      >
        <div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>Customer feedback</div>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.78rem', color: '#64748b', maxWidth: '36rem', lineHeight: 1.45 }}>
            S3 Hive partitions by UTC day. Filter by time range, raw 1–7 score, topic, or experiment. Counts and the
            Latest feedback list both reflect the active filter set.
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

      <div
        style={{
          padding: '0.75rem 1.25rem',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.6rem',
        }}
      >
        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
          Range
        </label>
        <select
          value={datePreset}
          onChange={(e) => updateUrl({ range: e.target.value as AnalyticsDatePreset })}
          style={{
            ...filterButton,
            padding: '0.35rem 0.5rem',
          }}
        >
          {DATE_PRESETS.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>

        {datePreset === 'custom' && (
          <>
            <input
              type="date"
              value={customStartDraft}
              onChange={(e) => setCustomStartDraft(e.target.value)}
              max={customEndDraft || undefined}
              style={{ padding: '0.3rem 0.4rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.78rem' }}
              aria-label="Custom range start"
            />
            <span style={{ color: '#64748b', fontSize: '0.72rem' }}>to</span>
            <input
              type="date"
              value={customEndDraft}
              onChange={(e) => setCustomEndDraft(e.target.value)}
              min={customStartDraft || undefined}
              style={{ padding: '0.3rem 0.4rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.78rem' }}
              aria-label="Custom range end"
            />
            <button
              type="button"
              disabled={!customDraftValid}
              onClick={() => updateUrl({ range: 'custom', start: customStartDraft, end: customEndDraft })}
              style={{
                padding: '0.35rem 0.75rem',
                fontSize: '0.78rem',
                backgroundColor: customDraftValid ? '#1d4ed8' : '#94a3b8',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: customDraftValid ? 'pointer' : 'not-allowed',
              }}
            >
              Apply
            </button>
            {customDraftError && (
              <span style={{ color: '#dc2626', fontSize: '0.72rem' }}>{customDraftError}</span>
            )}
          </>
        )}

        <span style={{ width: '1px', height: '20px', backgroundColor: '#e5e7eb', margin: '0 0.25rem' }} aria-hidden />

        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
          Score
        </label>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {SCORE_VALUES.map((val) => {
            const active = scores.has(val);
            return (
              <button
                key={val}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  onToggleScore(val);
                  // Some browsers still drop focus on the button after the
                  // click event despite onMouseDown preventDefault — blur
                  // explicitly so the focus ring doesn't linger after the
                  // user toggles a value off.
                  e.currentTarget.blur();
                }}
                aria-pressed={active}
                style={{
                  width: '28px',
                  ...filterButton,
                  ...(active ? { backgroundColor: '#0d9488', color: '#fff', borderColor: '#0d9488' } : {}),
                  outline: 'none',
                  textAlign: 'center',
                }}
              >
                {val}
              </button>
            );
          })}
          {scores.size > 0 && (
            <button
              type="button"
              onClick={() => updateUrl({ scores: new Set() })}
              style={{
                ...filterButton,
                color: '#dc2626',
                marginLeft: '0.15rem',
              }}
              aria-label="Clear score filter"
            >
              ×
            </button>
          )}
        </div>

        <MultiSelectDropdown
          label="Type"
          options={facets.categories.map((c) => c.toLowerCase())}
          renderOption={(c) => categoryChipStyle(c).label}
          selected={categoriesFilter}
          onToggle={onToggleCategory}
          onClear={() => updateUrl({ categories: new Set() })}
          emptyMessage="No types in this window"
        />

        <MultiSelectDropdown
          label="Topics"
          options={facets.topics}
          selected={topicsFilter}
          onToggle={onToggleTopic}
          onClear={() => updateUrl({ topics: new Set() })}
          emptyMessage="No topics in this window"
        />

        <MultiSelectDropdown
          label="Experiments"
          options={facets.experiments}
          selected={experimentsFilter}
          onToggle={onToggleExperiment}
          onClear={() => updateUrl({ experiments: new Set() })}
          emptyMessage="No experiments in this window"
        />

        {hasNonDefaultFilters && (
          <button
            type="button"
            onClick={onClearAll}
            style={{
              ...filterButton,
              color: '#dc2626',
              fontWeight: 600,
            }}
          >
            Clear all
          </button>
        )}
      </div>

      <div style={{ padding: '1rem 1.25rem 1.25rem' }}>
        {!summary && error ? (
          <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</div>
        ) : !summary && loading ? (
          <div style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center' }}>Loading feedback…</div>
        ) : !summary ? null : (
          <FeedbackBody
            summary={summary}
            recent={recent}
            windowLabel={windowLabel}
            totalLabel={totalLabel}
          />
        )}
      </div>
    </div>
  );
}

interface FeedbackBodyProps {
  summary: Summary;
  recent: { error?: string; items: RecentRow[]; merged_truncated?: boolean; partition_errors?: number } | null;
  windowLabel: string;
  totalLabel: string;
}

function avgRatingColor(value: number | null, mean: number): string {
  if (value == null) return '#64748b';
  if (value >= mean + 0.25) return '#16a34a';
  if (value <= mean - 0.25) return '#dc2626';
  return '#475569';
}

function ExperimentCohortsSection({ cohorts }: { cohorts: Record<string, ExperimentVariantStats[]> | undefined }) {
  if (!cohorts) return null;
  const entries = Object.entries(cohorts).filter(([, variants]) => variants.length > 0);
  if (entries.length === 0) return null;
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>
        Experiment cohorts
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '0.75rem',
        }}
      >
        {entries.map(([name, variants]) => {
          const totalRatings = variants.reduce((s, v) => s + (v.avgRating != null ? v.total : 0), 0);
          const totalRatingSum = variants.reduce(
            (s, v) => s + (v.avgRating != null ? v.avgRating * v.total : 0),
            0,
          );
          const overallAvg = totalRatings > 0 ? totalRatingSum / totalRatings : 0;
          return (
            <div
              key={name}
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                border: '1px solid #e2e8f0',
              }}
            >
              <div
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  color: '#0f172a',
                  fontFamily: 'monospace',
                  marginBottom: '0.4rem',
                  wordBreak: 'break-all',
                }}
              >
                {name}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.6rem' }}>
                    <th style={{ textAlign: 'left', padding: '0.2rem 0.3rem' }}>Variant</th>
                    <th style={{ textAlign: 'right', padding: '0.2rem 0.3rem' }}>Count</th>
                    <th style={{ textAlign: 'right', padding: '0.2rem 0.3rem' }}>Avg</th>
                    <th style={{ textAlign: 'right', padding: '0.2rem 0.3rem', color: '#16a34a' }}>+</th>
                    <th style={{ textAlign: 'right', padding: '0.2rem 0.3rem', color: '#64748b' }}>○</th>
                    <th style={{ textAlign: 'right', padding: '0.2rem 0.3rem', color: '#dc2626' }}>−</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => {
                    const avg = v.avgRating;
                    const avgColor = avgRatingColor(avg, overallAvg);
                    const delta = avg != null && overallAvg > 0 ? avg - overallAvg : null;
                    return (
                      <tr key={v.variant} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td
                          style={{
                            padding: '0.3rem 0.3rem',
                            fontFamily: 'monospace',
                            color: '#1e293b',
                            wordBreak: 'break-all',
                          }}
                        >
                          {v.variant}
                        </td>
                        <td style={{ padding: '0.3rem 0.3rem', textAlign: 'right', color: '#475569' }}>
                          {v.total.toLocaleString()}
                        </td>
                        <td
                          style={{
                            padding: '0.3rem 0.3rem',
                            textAlign: 'right',
                            color: avgColor,
                            fontWeight: 600,
                          }}
                          title={delta != null ? `Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} vs overall` : undefined}
                        >
                          {avg != null ? avg.toFixed(2) : '—'}
                          {delta != null && Math.abs(delta) >= 0.25 && (
                            <span style={{ marginLeft: '0.2rem', fontSize: '0.65rem' }}>
                              {delta > 0 ? '↑' : '↓'}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.3rem 0.3rem', textAlign: 'right', color: '#16a34a' }}>{v.positive}</td>
                        <td style={{ padding: '0.3rem 0.3rem', textAlign: 'right', color: '#64748b' }}>{v.neutral}</td>
                        <td style={{ padding: '0.3rem 0.3rem', textAlign: 'right', color: '#dc2626' }}>{v.negative}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

function FeedbackBody({ summary, recent, windowLabel, totalLabel }: FeedbackBodyProps) {
  const rawTimeline = summary.timeline ?? [];
  // Trailing rolling average so the line bends with the data instead of
  // sitting flat at the overall mean. Window is ~10% of the visible point
  // count, clamped to 3..20 — tight enough to react, wide enough to not
  // just trace each scatter dot.
  const timelinePoints = useMemo(() => {
    const n = rawTimeline.length;
    if (n === 0) return [];
    const window = Math.min(20, Math.max(3, Math.ceil(n / 10)));
    const out: Array<{ ts: number; rating: number; movingAvg: number }> = [];
    let runningSum = 0;
    for (let i = 0; i < n; i += 1) {
      runningSum += rawTimeline[i].rating;
      if (i >= window) runningSum -= rawTimeline[i - window].rating;
      const denom = Math.min(i + 1, window);
      out.push({
        ts: rawTimeline[i].ts,
        rating: rawTimeline[i].rating,
        movingAvg: runningSum / denom,
      });
    }
    return out;
  }, [rawTimeline]);
  const items = recent?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const [page, setPage] = useState(1);
  // Reset to first page whenever the row set changes shape (filter or
  // refresh). Without this the user could land on page 5 of an empty list.
  useEffect(() => {
    setPage(1);
  }, [items.length]);
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = items.slice(pageStart, pageStart + PAGE_SIZE);
  return (
    <>
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
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '0.65rem',
              }}
            >
              {[
                { label: 'Feedback', value: summary.categoryCounts?.feedback ?? 0, color: '#1d4ed8' },
                { label: 'Issue', value: summary.categoryCounts?.issue ?? 0, color: '#991b1b' },
                { label: 'Support', value: summary.categoryCounts?.support ?? 0, color: '#92400e' },
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

        <ExperimentCohortsSection cohorts={summary.experimentCohorts} />

        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', marginBottom: '0.5rem' }}>Latest feedback</div>
        {recent?.error ? (
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{recent.error}</div>
        ) : !recent?.items?.length ? (
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>No rows in this window</div>
        ) : (
          <>
            {timelinePoints.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                  Score over time (1–7)
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={timelinePoints} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      scale="time"
                      tickFormatter={formatTimelineTick}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      minTickGap={32}
                      name="Time"
                    />
                    <YAxis
                      type="number"
                      domain={[1, 7]}
                      ticks={[1, 2, 3, 4, 5, 6, 7]}
                      tick={{ fontSize: 11, fill: '#64748b' }}
                      width={28}
                      name="Rating"
                    />
                    <ZAxis range={[40, 40]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={{ fontSize: '12px' }}
                      labelFormatter={(v: number) => formatTimelineLabel(v)}
                      formatter={(value: number, name: string) => {
                        if (name === 'Rating') return [`${value}/7`, 'Rating'];
                        if (name === 'Moving avg') return [Number(value).toFixed(2), 'Moving avg'];
                        return [value, name];
                      }}
                    />
                    <Scatter dataKey="rating" name="Rating" fill="#0d9488" isAnimationActive={false} />
                    <Line
                      type="monotone"
                      dataKey="movingAvg"
                      name="Moving avg"
                      stroke="#dc2626"
                      strokeWidth={2}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9' }}>
                    {['Time (UTC)', 'Type', 'Rating', 'Preview'].map((h) => (
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
                  {pageItems.map((row, i) => {
                    const deeplinkable = !!(row.appId && row.feedbackId);
                    const href = deeplinkable
                      ? `/?appId=${encodeURIComponent(row.appId!)}&tab=feedback&feedbackId=${encodeURIComponent(row.feedbackId!)}`
                      : null;
                    const cellBase: React.CSSProperties = {
                      padding: '0.5rem 0.65rem',
                      lineHeight: 1.35,
                    };
                    const rowBg = i % 2 === 0 ? '#fff' : '#fafafa';
                    return (
                      <tr
                        key={`${row.feedbackId ?? row.time}-${i}`}
                        style={{
                          backgroundColor: rowBg,
                          cursor: href ? 'pointer' : 'default',
                        }}
                        onClick={
                          href
                            ? (e) => {
                                if ((e.target as HTMLElement).closest('a')) return;
                                window.open(href, '_blank', 'noopener,noreferrer');
                              }
                            : undefined
                        }
                        title={href ? 'Open in per-app Dashboard Feedback tab (new tab)' : undefined}
                      >
                        <td style={{ ...cellBase, color: '#64748b', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1d4ed8', textDecoration: 'none' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {row.time}
                            </a>
                          ) : (
                            row.time
                          )}
                        </td>
                        <td style={{ ...cellBase }}>
                          {(() => {
                            const c = categoryChipStyle(row.category);
                            return (
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '0.1rem 0.5rem',
                                  backgroundColor: c.bg,
                                  color: c.fg,
                                  borderRadius: '9999px',
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                {c.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ ...cellBase, color: '#475569' }}>
                          {Number.isFinite(row.rating) && row.rating >= 1 ? `${row.rating}/7` : '—'}
                        </td>
                        <td style={{ ...cellBase, color: '#334155' }}>{row.summary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '0.5rem',
                  fontSize: '0.78rem',
                  color: '#64748b',
                }}
              >
                <span>
                  Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, items.length)} of{' '}
                  {items.length.toLocaleString()}
                </span>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    style={{
                      padding: '0.3rem 0.6rem',
                      fontSize: '0.75rem',
                      backgroundColor: safePage <= 1 ? '#f3f4f6' : '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      color: safePage <= 1 ? '#cbd5e1' : '#374151',
                      cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Prev
                  </button>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    Page {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    style={{
                      padding: '0.3rem 0.6rem',
                      fontSize: '0.75rem',
                      backgroundColor: safePage >= totalPages ? '#f3f4f6' : '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      color: safePage >= totalPages ? '#cbd5e1' : '#374151',
                      cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
    </>
  );
}
