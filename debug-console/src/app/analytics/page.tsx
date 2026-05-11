'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import C1AnalyticsPanel from '@/components/C1AnalyticsPanel';
import FeedbackAnalyticsPanel from '@/components/FeedbackAnalyticsPanel';
import LangfuseInsightsPanel from '@/components/LangfuseInsightsPanel';
import ProtectedRoute from '@/components/ProtectedRoute';
import { ChartEmptyState, ChartLoadingState } from '@/components/analytics/ChartStates';
import { CloudflareChartsGrid, formatBandwidth } from '@/components/analytics/CloudflareChartsGrid';
import { EChartsMiniChart } from '@/components/analytics/EChartsMiniChart';
import { HelpBadge, type HelpInfo } from '@/components/analytics/HelpBadge';

import type { C1Period } from '@/lib/c1-analytics-server';
import type { CloudflareBucketInterval, CloudflareOverview } from '@/lib/analytics/cloudflare-db';
import { getDateRangeError, isDateRangeValid } from '@/lib/analytics/date-range';

interface ErrorTypeStats {
  total: number;
  daily_stats: Array<{ date: string; errors: number; apps: number }>;
}

interface ErrorStats {
  websocket: ErrorTypeStats;
  budget: ErrorTypeStats;
}

interface HourlyErrorStats {
  date: string;
  errorType: 'websocket' | 'budget';
  hourly_stats: Array<{ hour: number; errors: number; apps: number }>;
}

interface Last24HoursErrorStats {
  errorType: 'websocket' | 'budget';
  start: string;
  end: string;
  hourly_stats: Array<{ hoursAgo: number; timestamp: string; errors: number; apps: number }>;
}

interface SummarizationStats {
  total: number;
  daily_stats: Array<{ date: string; total: number; successful: number; failed: number; apps: number }>;
}

interface HourlySummarizationStats {
  date: string;
  hourly_stats: Array<{ hour: number; total: number; successful: number; failed: number; apps: number }>;
}

interface Last24HoursSummarizationStats {
  start: string;
  end: string;
  hourly_stats: Array<{ hoursAgo: number; timestamp: string; total: number; successful: number; failed: number; apps: number }>;
}

interface PublishStats {
  total: number;
  successes: number;
  failures: number;
  daily_stats: Array<{ date: string; successes: number; failures: number; begins: number; build_failed: number; archive_failed: number }>;
}

interface HourlyPublishStats {
  date: string;
  hourly_stats: Array<{ hour: string; begins: number; successes: number; failures: number }>;
}

interface Last24HoursPublishStats {
  start: string;
  end: string;
  hourly_stats: Array<{ hoursAgo: number; timestamp: string; begins: number; successes: number; failures: number }>;
}

// Helper to build chart data for rolling 24h hourly view
function buildRolling24hChartData<T>(
  hourlyStats: Array<T & { hoursAgo: number }>,
  getValue: (stat: T) => number,
  getTooltip: (hoursAgo: number, stat: T) => string
): Array<{ value: number; label: string; tooltip: string }> {
  return Array.from({ length: 24 }, (_, i) => {
    const hoursAgo = 23 - i;
    const stat = hourlyStats.find(h => h.hoursAgo === hoursAgo);
    const value = stat ? getValue(stat) : 0;
    return {
      value,
      label: hoursAgo === 0 ? 'now' : hoursAgo === 12 ? '-12h' : hoursAgo === 23 ? '-23h' : '',
      tooltip: stat ? getTooltip(hoursAgo, stat) : `${hoursAgo}h ago: 0`
    };
  });
}

// Rolling 1-hour view with 5-minute buckets (12 bars, 0–55 minutesAgo).
function buildRolling1hChartData<T>(
  minuteStats: Array<T & { minutesAgo: number }>,
  getValue: (stat: T) => number,
  getTooltip: (minutesAgo: number, stat: T) => string
): Array<{ value: number; label: string; tooltip: string }> {
  return Array.from({ length: 12 }, (_, i) => {
    const minutesAgo = (11 - i) * 5;
    const stat = minuteStats.find(h => h.minutesAgo === minutesAgo);
    const value = stat ? getValue(stat) : 0;
    return {
      value,
      label: minutesAgo === 0 ? 'now' : minutesAgo === 30 ? '-30m' : minutesAgo === 55 ? '-55m' : '',
      tooltip: stat ? getTooltip(minutesAgo, stat) : `${minutesAgo}m ago: 0`
    };
  });
}

// Helper to build chart data for hourly drilldown (specific day)
function buildHourlyChartData<T>(
  hourlyStats: Array<T & { hour: number }>,
  getValue: (stat: T) => number,
  getTooltip: (hour: number, stat: T) => string
): Array<{ value: number; label: string; tooltip: string }> {
  return Array.from({ length: 24 }, (_, hour) => {
    const stat = hourlyStats.find(h => h.hour === hour);
    const value = stat ? getValue(stat) : 0;
    return {
      value,
      label: hour === 0 ? '0h' : hour === 12 ? '12h' : hour === 23 ? '23h' : '',
      tooltip: stat ? getTooltip(hour, stat) : `${hour}:00 - 0`
    };
  });
}

// Helper to build chart data for daily view
function buildDailyChartData<T>(
  dailyStats: Array<T & { date: string }>,
  getValue: (stat: T) => number,
  getTooltip: (date: string, stat: T) => string,
  formatDate: (date: string) => string
): Array<{ value: number; label: string; tooltip: string }> {
  return dailyStats.map((stat, i) => ({
    value: getValue(stat),
    label: i === 0 || i === dailyStats.length - 1 || i === Math.floor(dailyStats.length / 2) ? formatDate(stat.date) : '',
    tooltip: getTooltip(stat.date, stat)
  }));
}

type DatePreset = '1h' | '1d' | '7d' | '14d' | '30d' | '90d' | '6mo' | '1yr' | 'custom';

// Narrower presets for sections where 1h granularity doesn't apply.
type StandardDatePreset = '1d' | '7d' | '14d' | '30d' | 'custom';

// PDNA is a daily snapshot source — no sub-day granularity possible.
// Presets are deliberately restricted to multi-day windows, up to 1 year
// (the backend pre-aggregates the last 365 days).
type PdnaDatePreset = '7d' | '14d' | '30d' | '90d' | '6mo' | '1yr' | 'custom';

const PRESET_LABELS: Record<DatePreset, string> = {
  '1h': '1h',
  '1d': '24h',
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
  '6mo': '6 months',
  '1yr': '1 year',
  custom: 'Custom',
};

interface DateRangeSelectorProps<P extends DatePreset> {
  presets: readonly P[];
  value: P;
  onValueChange: (v: P) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  onCustomApply: () => void;
}

function DateRangeSelector<P extends DatePreset>({
  presets, value, onValueChange,
  customStart, customEnd, onCustomStartChange, onCustomEndChange, onCustomApply,
}: DateRangeSelectorProps<P>) {
  const customValid = customStart && customEnd && isDateRangeValid(customStart, customEnd);
  const customError = getDateRangeError(customStart, customEnd);
  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      alignItems: 'center',
      flexWrap: 'wrap',
      backgroundColor: 'rgba(255,255,255,0.97)',
      padding: '0.5rem 0.75rem',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
      marginBottom: '0.75rem',
    }}>
      {presets.map(preset => (
        <button
          key={preset}
          onClick={() => onValueChange(preset)}
          style={{
            padding: '0.35rem 0.7rem',
            backgroundColor: value === preset ? '#1d4ed8' : '#f3f4f6',
            color: value === preset ? 'white' : '#374151',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: 500,
          }}
        >
          {PRESET_LABELS[preset]}
        </button>
      ))}
      {value === 'custom' && (
        <>
          <label style={{ fontSize: '0.75rem', color: '#374151', fontWeight: 500 }}>From:</label>
          <input
            type="date"
            value={customStart}
            onChange={(e) => onCustomStartChange(e.target.value)}
            max={customEnd || formatDateInput(new Date())}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.75rem' }}
          />
          <label style={{ fontSize: '0.75rem', color: '#374151', fontWeight: 500 }}>To:</label>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => onCustomEndChange(e.target.value)}
            min={customStart}
            max={formatDateInput(new Date())}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.75rem' }}
          />
          <button
            onClick={onCustomApply}
            disabled={!customValid}
            style={{
              padding: '0.3rem 0.8rem',
              backgroundColor: customValid ? '#1d4ed8' : '#94a3b8',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: customValid ? 'pointer' : 'not-allowed',
              fontSize: '0.75rem',
            }}
          >
            Apply
          </button>
          {customError && <span style={{ color: '#dc2626', fontSize: '0.7rem' }}>{customError}</span>}
        </>
      )}
    </div>
  );
}

function datePresetToC1Period(datePreset: DatePreset, customStart: string, customEnd: string): C1Period {
  if (datePreset === 'custom') {
    if (customStart && customEnd && isDateRangeValid(customStart, customEnd)) {
      const span =
        Math.floor(
          (new Date(`${customEnd}T00:00:00.000Z`).getTime() -
            new Date(`${customStart}T00:00:00.000Z`).getTime()) /
            (24 * 60 * 60 * 1000),
        ) + 1;
      if (span <= 1) return 'day';
      if (span <= 7) return 'week';
      if (span <= 14) return '14days';
      return 'month';
    }
    return 'week';
  }
  if (datePreset === '1d') return 'day';
  if (datePreset === '7d') return 'week';
  if (datePreset === '14d') return '14days';
  if (datePreset === '30d') return 'month';
  return 'week';
}

function getDateRange(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;

  switch (preset) {
    case '1h':
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '1d':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      break;
    case '14d':
      start = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      start = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000);
      break;
    case '6mo':
      start = new Date(now.getTime() - 179 * 24 * 60 * 60 * 1000);
      break;
    case '1yr':
      start = new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(now.getTime() - 60 * 60 * 1000);
  }

  return { start, end };
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Maps a Cloudflare-tab preset/custom range into the {startMs, endMs,
 * bucketInterval} tuple the backend expects. Bucket sizing is picked
 * from the span length so we always return O(50–150) histogram buckets.
 */
function resolveCloudflareWindow(
  preset: DatePreset,
  customStart: string,
  customEnd: string,
): { startMs: number | null; endMs: number | null; bucketInterval: CloudflareBucketInterval } {
  if (preset === 'custom') {
    if (!customStart || !customEnd || !isDateRangeValid(customStart, customEnd)) {
      return { startMs: null, endMs: null, bucketInterval: '1h' };
    }
    const startMs = new Date(`${customStart}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${customEnd}T23:59:59.999Z`).getTime();
    const spanDays = (endMs - startMs) / (24 * 60 * 60 * 1000);
    const bucketInterval: CloudflareBucketInterval =
      spanDays <= 2 ? '15m' : spanDays <= 14 ? '1h' : '1d';
    return { startMs, endMs, bucketInterval };
  }
  const { start, end } = getDateRange(preset);
  const bucketInterval: CloudflareBucketInterval =
    preset === '1h' ? '5m'
    : preset === '1d' ? '15m'
    : preset === '7d' || preset === '14d' ? '1h'
    : '1d';
  return { startMs: start.getTime(), endMs: end.getTime(), bucketInterval };
}

const ANALYTICS_TAB_IDS = ['apps', 'cloudflare', 'langfuse', 'c1', 'feedback'] as const;
type AnalyticsTabId = (typeof ANALYTICS_TAB_IDS)[number];

function parseAnalyticsTab(value: string | null | undefined): AnalyticsTabId {
  if (value === 'airo' || value === 'pdna') return 'apps';
  if (value && (ANALYTICS_TAB_IDS as readonly string[]).includes(value)) {
    return value as AnalyticsTabId;
  }
  return 'apps';
}

const ANALYTICS_TABS: ReadonlyArray<{ id: AnalyticsTabId; label: string }> = [
  { id: 'apps', label: 'Apps' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'langfuse', label: 'Langfuse' },
  { id: 'c1', label: 'C1 (ClickHouse)' },
  { id: 'feedback', label: 'Feedback' },
];

interface PdnaSnapshot {
  snapshotDate: string;
  totalApps: number;
  publishedCount: number;
  publishRate: number;
  hibernatedCount: number;
  hibernationRate: number;
  deletedCount: number;
  customDomainCount: number;
  customDomainRate: number;
  everPublishedCount: number;
  everPublishedRate: number;
  downgradesCount: number;
  totalSubscriptions: number;
  timeToPublishHours: { p50: number | null; p75: number | null; p90: number | null; p95: number | null; p99: number | null };
  cells: Record<string, number>;
  appsCreatedDaily: Array<{ date: string; created: number }>;
  appsCreatedDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  appsDeletedDaily: Array<{ date: string; deleted: number }>;
  appsDeletedDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  appsPublishedDaily: Array<{ date: string; published: number }>;
  everPublishedDaily: Array<{ date: string; everPublished: number }>;
  everPublishedDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  appsHibernatedDaily: Array<{ date: string; hibernated: number }>;
  appsHibernatedDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  appsCustomDomainDaily: Array<{ date: string; customDomain: number }>;
  appsCustomDomainDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  uniqueCustomersDaily: Array<{ date: string; uniqueCustomers: number }>;
  subscriptionsDaily: Array<{ date: string; subscriptions: number }>;
  subscriptionsDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  timeToPublishDaily: Array<{ date: string; medianHours: number }>;
  statuses: Record<string, number>;
  plans: Record<string, number>;
  subscriptionPlans: Record<string, number>;
}

function AnalyticsContent() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-section / per-tab date state. Each section owns its own selector so
  // the PDNA snapshot section can live on a multi-day window while the
  // dynamic real-time section defaults to 1h (5-min buckets).

  // Apps tab — PDNA section (snapshot source, no sub-day granularity)
  const [pdnaDatePreset, setPdnaDatePreset] = useState<PdnaDatePreset>('30d');
  const [pdnaCustomStart, setPdnaCustomStart] = useState<string>('');
  const [pdnaCustomEnd, setPdnaCustomEnd] = useState<string>('');
  // TLA filter (`non-tla` = customer apps; `tla` = internal/test; `all`).
  // Flows into every PDNA query + hourly drilldown.
  type TlaFilter = 'non-tla' | 'tla' | 'all';
  const [pdnaTlaFilter, setPdnaTlaFilter] = useState<TlaFilter>('non-tla');

  // Chart size mode for the PDNA chart grid. Small = default 2-col,
  // Large = 2x minimum so fewer fit per row, Full = single column.
  type PdnaChartSize = 'small' | 'large' | 'full';
  const [pdnaChartSize, setPdnaChartSize] = useState<PdnaChartSize>('small');
  const pdnaGridColumns =
    pdnaChartSize === 'full' ? '1fr'
    : pdnaChartSize === 'large' ? 'repeat(auto-fit, minmax(560px, 1fr))'
    : 'repeat(auto-fit, minmax(280px, 1fr))';

  // Shared dataZoom window for every chart in the PDNA group. Held in
  // React state (not left to ECharts `connect`) so the window survives
  // re-renders where `notMerge` replaces the option, and so all charts
  // paint the same window even when their data lengths differ.
  const [pdnaZoomStart, setPdnaZoomStart] = useState<number>(0);
  const [pdnaZoomEnd, setPdnaZoomEnd] = useState<number>(100);
  const onPdnaZoomChange = useCallback((start: number, end: number) => {
    setPdnaZoomStart(start);
    setPdnaZoomEnd(end);
  }, []);
  // Reset the zoom window whenever the selected range changes — the
  // user has picked a new date span, so "focus the most-recent slice"
  // intent is satisfied by the range change itself; the slider should
  // start fully-open on the new range.
  useEffect(() => {
    setPdnaZoomStart(0);
    setPdnaZoomEnd(100);
  }, [pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  // Apps tab — Dynamic section (Loki + Katana ES real-time)
  const [dynamicDatePreset, setDynamicDatePreset] = useState<DatePreset>('1h');
  const [dynamicCustomStart, setDynamicCustomStart] = useState<string>('');
  const [dynamicCustomEnd, setDynamicCustomEnd] = useState<string>('');

  // Langfuse tab
  const [langfuseDatePreset, setLangfuseDatePreset] = useState<StandardDatePreset>('7d');
  const [langfuseCustomStart, setLangfuseCustomStart] = useState<string>('');
  const [langfuseCustomEnd, setLangfuseCustomEnd] = useState<string>('');

  // C1 tab
  const [c1DatePreset, setC1DatePreset] = useState<StandardDatePreset>('7d');
  const [c1CustomStart, setC1CustomStart] = useState<string>('');
  const [c1CustomEnd, setC1CustomEnd] = useState<string>('');

  // Feedback tab
  const [feedbackDatePreset, setFeedbackDatePreset] = useState<StandardDatePreset>('7d');
  const [feedbackCustomStart, setFeedbackCustomStart] = useState<string>('');
  const [feedbackCustomEnd, setFeedbackCustomEnd] = useState<string>('');

  // Cloudflare tab — CDN logs (airo-app-cloudflare-cdn-logs-prod-*).
  // Same preset family as Dynamic section since the index is near-real-time.
  const [cloudflareDatePreset, setCloudflareDatePreset] = useState<DatePreset>('1h');
  const [cloudflareCustomStart, setCloudflareCustomStart] = useState<string>('');
  const [cloudflareCustomEnd, setCloudflareCustomEnd] = useState<string>('');
  const [cloudflareOverview, setCloudflareOverview] = useState<CloudflareOverview | null>(null);
  const [cloudflareLoading, setCloudflareLoading] = useState(false);
  const [cloudflareError, setCloudflareError] = useState<string | null>(null);
  const [cloudflareChartSize, setCloudflareChartSize] = useState<'small' | 'large' | 'full'>('large');
  const [cloudflareZoomStart, setCloudflareZoomStart] = useState<number>(0);
  const [cloudflareZoomEnd, setCloudflareZoomEnd] = useState<number>(100);
  const onCloudflareZoomChange = useCallback((s: number, e: number) => {
    setCloudflareZoomStart(s);
    setCloudflareZoomEnd(e);
  }, []);
  useEffect(() => {
    // Reset zoom window when the range changes — same rationale as PDNA.
    setCloudflareZoomStart(0);
    setCloudflareZoomEnd(100);
  }, [cloudflareDatePreset, cloudflareCustomStart, cloudflareCustomEnd]);

  const langfuseWindow = useMemo(() => {
    if (langfuseDatePreset === 'custom' && langfuseCustomStart && langfuseCustomEnd) {
      return {
        start: new Date(`${langfuseCustomStart}T00:00:00.000Z`).toISOString(),
        end: new Date(`${langfuseCustomEnd}T23:59:59.999Z`).toISOString(),
      };
    }
    const range = getDateRange(langfuseDatePreset);
    return { start: range.start.toISOString(), end: range.end.toISOString() };
  }, [langfuseDatePreset, langfuseCustomStart, langfuseCustomEnd]);

  const c1Period = useMemo(
    () => datePresetToC1Period(c1DatePreset, c1CustomStart, c1CustomEnd),
    [c1DatePreset, c1CustomStart, c1CustomEnd],
  );

  // Error stats state
  const [errorStats, setErrorStats] = useState<ErrorStats | null>(null);
  const [hourlyWsErrorData, setHourlyWsErrorData] = useState<HourlyErrorStats | null>(null);
  const [hourlyBudgetErrorData, setHourlyBudgetErrorData] = useState<HourlyErrorStats | null>(null);
  const [hourlyWsErrorLoading, setHourlyWsErrorLoading] = useState(false);
  const [hourlyBudgetErrorLoading, setHourlyBudgetErrorLoading] = useState(false);

  // Last 24 hours rolling window stats
  const [last24hWsErrors, setLast24hWsErrors] = useState<Last24HoursErrorStats | null>(null);
  const [last24hBudgetErrors, setLast24hBudgetErrors] = useState<Last24HoursErrorStats | null>(null);

  // Last 1 hour rolling stats (12 × 5-min buckets). Shape mirrors the
  // last-24h variants but stored in `minute_stats` keyed by `minutesAgo`.
  const [last1hWsErrors, setLast1hWsErrors] = useState<{ minute_stats: Array<{ minutesAgo: number; timestamp: string; errors: number; apps: number }> } | null>(null);
  const [last1hBudgetErrors, setLast1hBudgetErrors] = useState<{ minute_stats: Array<{ minutesAgo: number; timestamp: string; errors: number; apps: number }> } | null>(null);
  const [last1hSummarizations, setLast1hSummarizations] = useState<{ minute_stats: Array<{ minutesAgo: number; timestamp: string; total: number; successful: number; failed: number; apps: number }> } | null>(null);
  const [last1hPublish, setLast1hPublish] = useState<{ minute_stats: Array<{ minutesAgo: number; timestamp: string; begins: number; successes: number; failures: number }> } | null>(null);
  const [last1hClientErrors, setLast1hClientErrors] = useState<{ minute_stats: Array<{ minutesAgo: number; timestamp: string; errors: number; apps: number }> } | null>(null);
  const [last1hUiAuthEvents, setLast1hUiAuthEvents] = useState<{ minute_stats: Array<{ minutesAgo: number; timestamp: string; errors: number; apps: number }> } | null>(null);

  // Summarization stats
  const [summarizationStats, setSummarizationStats] = useState<SummarizationStats | null>(null);
  const [hourlySummarizationData, setHourlySummarizationData] = useState<HourlySummarizationStats | null>(null);
  const [hourlySummarizationLoading, setHourlySummarizationLoading] = useState(false);
  const [last24hSummarizations, setLast24hSummarizations] = useState<Last24HoursSummarizationStats | null>(null);

  // Publish stats
  const [publishStats, setPublishStats] = useState<PublishStats | null>(null);
  const [hourlyPublishData, setHourlyPublishData] = useState<HourlyPublishStats | null>(null);
  const [hourlyPublishLoading, setHourlyPublishLoading] = useState(false);
  const [last24hPublish, setLast24hPublish] = useState<Last24HoursPublishStats | null>(null);

  // Client error stats
  const [clientErrorStats, setClientErrorStats] = useState<{ total: number; daily_stats: Array<{ date: string; errors: number; apps: number }> } | null>(null);
  const [hourlyClientErrorData, setHourlyClientErrorData] = useState<{ hourly_stats: Array<{ hour: number; errors: number; apps: number }> } | null>(null);
  const [hourlyClientErrorLoading, setHourlyClientErrorLoading] = useState(false);
  const [last24hClientErrors, setLast24hClientErrors] = useState<{ hourly_stats: Array<{ hoursAgo: number; timestamp: string; errors: number; apps: number }> } | null>(null);

  // UI auth event stats
  const [uiAuthEventStats, setUiAuthEventStats] = useState<{ total: number; daily_stats: Array<{ date: string; errors: number; apps: number }> } | null>(null);
  const [hourlyUiAuthEventData, setHourlyUiAuthEventData] = useState<{ hourly_stats: Array<{ hour: number; errors: number; apps: number }> } | null>(null);
  const [hourlyUiAuthEventLoading, setHourlyUiAuthEventLoading] = useState(false);
  const [last24hUiAuthEvents, setLast24hUiAuthEvents] = useState<{ hourly_stats: Array<{ hoursAgo: number; timestamp: string; errors: number; apps: number }> } | null>(null);

  // PDNA hourly drilldown (one state shared across the three PDNA charts —
  // only one is active at a time, gated by `pdnaHourlyMetric`).
  type PdnaHourlyMetric = 'created' | 'deleted' | 'unique_customers';
  const [pdnaHourlyMetric, setPdnaHourlyMetric] = useState<PdnaHourlyMetric | null>(null);
  const [pdnaHourlyData, setPdnaHourlyData] = useState<{ date: string; hourly_stats: Array<{ hour: number; value: number }> } | null>(null);
  const [pdnaHourlyLoading, setPdnaHourlyLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<AnalyticsTabId>('apps');
  const [visitedTabs, setVisitedTabs] = useState(() => new Set<AnalyticsTabId>(['apps']));

  useEffect(() => {
    const tab = parseAnalyticsTab(searchParams?.get('tab') ?? undefined);
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [searchParams]);

  const navigateToTab = useCallback(
    (tab: AnalyticsTabId) => {
      setActiveTab(tab);
      setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
      const path = tab === 'apps' ? '/analytics' : `/analytics?tab=${encodeURIComponent(tab)}`;
      router.replace(path, { scroll: false });
    },
    [router],
  );

  // PDNA provisioning state
  const [pdnaSnapshot, setPdnaSnapshot] = useState<PdnaSnapshot | null>(null);
  const [pdnaLoading, setPdnaLoading] = useState(false);
  const [pdnaError, setPdnaError] = useState<string | null>(null);

  const pdnaAppsCreatedInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];

    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }

    return pdnaSnapshot.appsCreatedDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  const pdnaAppsDeletedInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];

    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }

    return pdnaSnapshot.appsDeletedDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  const pdnaUniqueCustomersInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];

    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }

    return pdnaSnapshot.uniqueCustomersDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  const pdnaAppsHibernatedInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];
    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }
    return pdnaSnapshot.appsHibernatedDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  const pdnaSubscriptionsInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];
    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }
    return pdnaSnapshot.subscriptionsDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  const pdnaCustomDomainInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];
    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }
    return pdnaSnapshot.appsCustomDomainDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  const pdnaEverPublishedInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];
    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }
    return pdnaSnapshot.everPublishedDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  /**
   * Build a stacked-by-plan series aligned 1:1 with a caller's x-axis
   * data array. Plans are ordered lowest-tier → highest-tier; any plan
   * ES returns that isn't in that list falls through alphabetically.
   * Returns `null` when the snapshot isn't loaded yet.
   */
  const buildStackedByPlan = useCallback((
    source: Array<{ date: string; byPlan: Record<string, number> }> | undefined,
    rangeDates: Array<{ date: string }>,
  ) => {
    if (!source) return null;
    const planColors: Record<string, string> = {
      free: '#60a5fa',
      starter: '#34d399',
      professional: '#f59e0b',
      ultimate: '#a78bfa',
      __unknown__: '#94a3b8',
    };
    const orderedPlans = ['free', 'starter', 'professional', 'ultimate'];
    const seen = new Set<string>();
    for (const d of source) for (const k of Object.keys(d.byPlan)) seen.add(k);
    const plans = [
      ...orderedPlans.filter(p => seen.has(p)),
      ...Array.from(seen).filter(p => !orderedPlans.includes(p)).sort(),
    ];
    const byDate = new Map(source.map(d => [d.date, d.byPlan]));
    return plans.map(plan => ({
      name: plan === '__unknown__' ? 'unknown' : plan,
      color: planColors[plan] ?? '#94a3b8',
      values: rangeDates.map(day => (byDate.get(day.date) ?? {})[plan] ?? 0),
    }));
  }, []);

  const pdnaAppsCreatedStackedByPlan = useMemo(
    () => buildStackedByPlan(pdnaSnapshot?.appsCreatedDailyByPlan, pdnaAppsCreatedInRange),
    [buildStackedByPlan, pdnaSnapshot, pdnaAppsCreatedInRange],
  );
  const pdnaAppsDeletedStackedByPlan = useMemo(
    () => buildStackedByPlan(pdnaSnapshot?.appsDeletedDailyByPlan, pdnaAppsDeletedInRange),
    [buildStackedByPlan, pdnaSnapshot, pdnaAppsDeletedInRange],
  );
  const pdnaEverPublishedStackedByPlan = useMemo(
    () => buildStackedByPlan(pdnaSnapshot?.everPublishedDailyByPlan, pdnaEverPublishedInRange),
    [buildStackedByPlan, pdnaSnapshot, pdnaEverPublishedInRange],
  );
  const pdnaAppsHibernatedStackedByPlan = useMemo(
    () => buildStackedByPlan(pdnaSnapshot?.appsHibernatedDailyByPlan, pdnaAppsHibernatedInRange),
    [buildStackedByPlan, pdnaSnapshot, pdnaAppsHibernatedInRange],
  );
  const pdnaCustomDomainStackedByPlan = useMemo(
    () => buildStackedByPlan(pdnaSnapshot?.appsCustomDomainDailyByPlan, pdnaCustomDomainInRange),
    [buildStackedByPlan, pdnaSnapshot, pdnaCustomDomainInRange],
  );
  const pdnaSubscriptionsStackedByPlan = useMemo(
    () => buildStackedByPlan(pdnaSnapshot?.subscriptionsDailyByPlan, pdnaSubscriptionsInRange),
    [buildStackedByPlan, pdnaSnapshot, pdnaSubscriptionsInRange],
  );

  const pdnaCreatedToEverPublishedPct = useMemo<Array<number | null>>(() => {
    if (!pdnaSnapshot) return [];
    const everByDate = new Map(pdnaSnapshot.everPublishedDaily.map(d => [d.date, d.everPublished]));
    return pdnaAppsCreatedInRange.map(day => {
      if (day.created <= 0) return null;
      const ever = everByDate.get(day.date) ?? 0;
      return Math.round((ever / day.created) * 100);
    });
  }, [pdnaSnapshot, pdnaAppsCreatedInRange]);

  const pdnaTimeToPublishInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];
    let startDate: string;
    let endDate: string;
    if (pdnaDatePreset === 'custom' && pdnaCustomStart && pdnaCustomEnd && isDateRangeValid(pdnaCustomStart, pdnaCustomEnd)) {
      startDate = pdnaCustomStart;
      endDate = pdnaCustomEnd;
    } else {
      const range = getDateRange(pdnaDatePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }
    return pdnaSnapshot.timeToPublishDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, pdnaDatePreset, pdnaCustomStart, pdnaCustomEnd]);

  // Indices of Saturday/Sunday rows in each chart's in-range slice, for
  // the weekend background shading. UTC is the right frame here since
  // the PDNA daily buckets are UTC-day aligned (see pdna-db.ts
  // date_histogram). Each metric gets its own index set because the aggs
  // don't force min_doc_count:0, so zero-day buckets may be absent and
  // the arrays can desync between charts.
  const pdnaWeekendIndices = useMemo(() => {
    const dow = (dateStr: string): number => new Date(dateStr + 'T00:00:00Z').getUTCDay();
    const indicesOf = (range: Array<{ date: string }>): number[] => {
      const out: number[] = [];
      for (let i = 0; i < range.length; i++) {
        const d = dow(range[i].date);
        if (d === 0 || d === 6) out.push(i);
      }
      return out;
    };
    return {
      created: indicesOf(pdnaAppsCreatedInRange),
      deleted: indicesOf(pdnaAppsDeletedInRange),
      uniqueCustomers: indicesOf(pdnaUniqueCustomersInRange),
      everPublished: indicesOf(pdnaEverPublishedInRange),
      hibernated: indicesOf(pdnaAppsHibernatedInRange),
      customDomain: indicesOf(pdnaCustomDomainInRange),
      subscriptions: indicesOf(pdnaSubscriptionsInRange),
      timeToPublish: indicesOf(pdnaTimeToPublishInRange),
    };
  }, [
    pdnaAppsCreatedInRange, pdnaAppsDeletedInRange, pdnaUniqueCustomersInRange,
    pdnaEverPublishedInRange, pdnaAppsHibernatedInRange, pdnaCustomDomainInRange,
    pdnaSubscriptionsInRange, pdnaTimeToPublishInRange,
  ]);

  const fetchData = useCallback(async function fetchData() {
    try {
      setLoading(true);

      let start: string;
      let end: string;

      if (dynamicDatePreset === 'custom' && dynamicCustomStart && dynamicCustomEnd) {
        start = new Date(`${dynamicCustomStart}T00:00:00.000Z`).toISOString();
        end = new Date(`${dynamicCustomEnd}T23:59:59.999Z`).toISOString();
      } else {
        const range = getDateRange(dynamicDatePreset);
        start = range.start.toISOString();
        end = range.end.toISOString();
      }

      const params = new URLSearchParams({ start, end });
      const shouldFetchDailyEventCharts = dynamicDatePreset !== '1d' && dynamicDatePreset !== '1h';

      const [errorsRes, budgetErrorsRes, sumRes, pubRes, clientErrRes, uiAuthRes] = await Promise.all([
        fetch(`/api/analytics?action=errors&${params}`),
        fetch(`/api/analytics?action=budget-errors&${params}`),
        shouldFetchDailyEventCharts ? fetch(`/api/analytics?action=summarizations&${params}`) : Promise.resolve(null),
        shouldFetchDailyEventCharts ? fetch(`/api/analytics?action=publish&${params}`) : Promise.resolve(null),
        fetch(`/api/analytics?action=client-errors&${params}`),
        fetch(`/api/analytics?action=ui-auth-events&${params}`),
      ]);

      if (errorsRes.ok || budgetErrorsRes.ok) {
        const wsStats = errorsRes.ok ? await errorsRes.json() : null;
        const budgetStats = budgetErrorsRes.ok ? await budgetErrorsRes.json() : wsStats?.budget;
        setErrorStats({
          websocket: wsStats?.websocket ?? { total: 0, daily_stats: [] },
          budget: budgetStats ?? { total: 0, daily_stats: [] }
        });
      }
      if (sumRes?.ok) {
        setSummarizationStats(await sumRes.json());
      } else if (!shouldFetchDailyEventCharts) {
        setSummarizationStats(null);
      }
      if (pubRes?.ok) {
        setPublishStats(await pubRes.json());
      } else if (!shouldFetchDailyEventCharts) {
        setPublishStats(null);
      }
      if (clientErrRes.ok) {
        setClientErrorStats(await clientErrRes.json());
      }
      if (uiAuthRes.ok) {
        setUiAuthEventStats(await uiAuthRes.json());
      }
      setError(null);

      // Auto-fetch the rolling hourly (24h) variants when 1d preset is active.
      if (dynamicDatePreset === '1d') {
        const [last24hWsRes, last24hBudgetRes, last24hSumRes, last24hPubRes, last24hClientErrRes, last24hUiAuthRes] = await Promise.all([
          fetch('/api/analytics?action=last-24h-errors&errorType=websocket'),
          fetch('/api/analytics?action=last-24h-errors&errorType=budget'),
          fetch('/api/analytics?action=last-24h-summarizations'),
          fetch('/api/analytics?action=last-24h-publish'),
          fetch('/api/analytics?action=last-24h-client-errors'),
          fetch('/api/analytics?action=last-24h-ui-auth-events'),
        ]);
        if (last24hWsRes.ok) setLast24hWsErrors(await last24hWsRes.json());
        if (last24hBudgetRes.ok) setLast24hBudgetErrors(await last24hBudgetRes.json());
        if (last24hSumRes.ok) setLast24hSummarizations(await last24hSumRes.json());
        if (last24hPubRes.ok) setLast24hPublish(await last24hPubRes.json());
        if (last24hClientErrRes.ok) setLast24hClientErrors(await last24hClientErrRes.json());
        if (last24hUiAuthRes.ok) setLast24hUiAuthEvents(await last24hUiAuthRes.json());
        setLast1hWsErrors(null); setLast1hBudgetErrors(null); setLast1hSummarizations(null);
        setLast1hPublish(null); setLast1hClientErrors(null); setLast1hUiAuthEvents(null);
        setHourlyWsErrorData(null); setHourlyBudgetErrorData(null); setHourlySummarizationData(null);
        setHourlyPublishData(null); setHourlyClientErrorData(null); setHourlyUiAuthEventData(null);
      } else if (dynamicDatePreset === '1h') {
        // 5-minute bucket fetches for the 1h preset (real-time pulse view).
        const [last1hWsRes, last1hBudgetRes, last1hSumRes, last1hPubRes, last1hClientErrRes, last1hUiAuthRes] = await Promise.all([
          fetch('/api/analytics?action=last-1h-errors&errorType=websocket'),
          fetch('/api/analytics?action=last-1h-errors&errorType=budget'),
          fetch('/api/analytics?action=last-1h-summarizations'),
          fetch('/api/analytics?action=last-1h-publish'),
          fetch('/api/analytics?action=last-1h-client-errors'),
          fetch('/api/analytics?action=last-1h-ui-auth-events'),
        ]);
        if (last1hWsRes.ok) setLast1hWsErrors(await last1hWsRes.json());
        if (last1hBudgetRes.ok) setLast1hBudgetErrors(await last1hBudgetRes.json());
        if (last1hSumRes.ok) setLast1hSummarizations(await last1hSumRes.json());
        if (last1hPubRes.ok) setLast1hPublish(await last1hPubRes.json());
        if (last1hClientErrRes.ok) setLast1hClientErrors(await last1hClientErrRes.json());
        if (last1hUiAuthRes.ok) setLast1hUiAuthEvents(await last1hUiAuthRes.json());
        setLast24hWsErrors(null); setLast24hBudgetErrors(null); setLast24hSummarizations(null);
        setLast24hPublish(null); setLast24hClientErrors(null); setLast24hUiAuthEvents(null);
        setHourlyWsErrorData(null); setHourlyBudgetErrorData(null); setHourlySummarizationData(null);
        setHourlyPublishData(null); setHourlyClientErrorData(null); setHourlyUiAuthEventData(null);
      } else {
        setLast24hWsErrors(null); setLast24hBudgetErrors(null); setLast24hSummarizations(null);
        setLast24hClientErrors(null); setLast24hUiAuthEvents(null); setLast24hPublish(null);
        setLast1hWsErrors(null); setLast1hBudgetErrors(null); setLast1hSummarizations(null);
        setLast1hPublish(null); setLast1hClientErrors(null); setLast1hUiAuthEvents(null);
        setHourlyWsErrorData(null); setHourlyBudgetErrorData(null); setHourlySummarizationData(null);
        setHourlyPublishData(null); setHourlyClientErrorData(null); setHourlyUiAuthEventData(null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [dynamicDatePreset, dynamicCustomStart, dynamicCustomEnd]);

  // Fetch app analytics data when Apps tab is active
  useEffect(() => {
    if (activeTab !== 'apps') return;
    fetchData();
  }, [activeTab, fetchData]);

  // Fetch PDNA snapshot when Apps tab is active OR when the TLA filter
  // changes. PDNA is a complete daily dump — no date range needed, just
  // the latest snapshot filtered by tla_flag.
  useEffect(() => {
    if (activeTab !== 'apps') return;
    setPdnaLoading(true);
    setPdnaError(null);
    setPdnaSnapshot(null);
    setPdnaHourlyMetric(null);
    setPdnaHourlyData(null);
    fetch(`/api/analytics?action=pdna-snapshot&tla=${encodeURIComponent(pdnaTlaFilter)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.snapshotDate) setPdnaSnapshot(data);
        else setPdnaError('No PDNA snapshot data available');
      })
      .catch((err) => {
        setPdnaError(err instanceof Error ? err.message : 'Failed to fetch PDNA data');
      })
      .finally(() => setPdnaLoading(false));
  }, [activeTab, pdnaTlaFilter]);

  // Fetch Cloudflare overview when the Cloudflare tab is active. Re-runs
  // whenever the preset or custom range changes.
  useEffect(() => {
    if (activeTab !== 'cloudflare') return;
    const { startMs, endMs, bucketInterval } = resolveCloudflareWindow(cloudflareDatePreset, cloudflareCustomStart, cloudflareCustomEnd);
    if (startMs == null || endMs == null) {
      setCloudflareOverview(null);
      setCloudflareError(null);
      return;
    }
    setCloudflareLoading(true);
    setCloudflareError(null);
    const controller = new AbortController();
    fetch(`/api/analytics?action=cloudflare-overview&startMs=${startMs}&endMs=${endMs}&bucketInterval=${bucketInterval}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data: CloudflareOverview = await res.json();
        setCloudflareOverview(data);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setCloudflareError(err instanceof Error ? err.message : 'Failed to fetch Cloudflare data');
      })
      .finally(() => setCloudflareLoading(false));
    return () => controller.abort();
  }, [activeTab, cloudflareDatePreset, cloudflareCustomStart, cloudflareCustomEnd]);

  async function fetchHourlyWsErrorData(date: string) {
    setHourlyWsErrorLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly-errors&date=${encodeURIComponent(date)}&errorType=websocket`);
      if (res.ok) {
        setHourlyWsErrorData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly websocket error data:', err);
    } finally {
      setHourlyWsErrorLoading(false);
    }
  }

  async function fetchHourlyBudgetErrorData(date: string) {
    setHourlyBudgetErrorLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly-errors&date=${encodeURIComponent(date)}&errorType=budget`);
      if (res.ok) {
        setHourlyBudgetErrorData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly budget error data:', err);
    } finally {
      setHourlyBudgetErrorLoading(false);
    }
  }

  async function fetchHourlySummarizationData(date: string) {
    setHourlySummarizationLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly-summarizations&date=${encodeURIComponent(date)}`);
      if (res.ok) {
        setHourlySummarizationData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly summarization data:', err);
    } finally {
      setHourlySummarizationLoading(false);
    }
  }

  async function fetchHourlyPublishData(date: string) {
    setHourlyPublishLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly-publish&date=${encodeURIComponent(date)}`);
      if (res.ok) {
        setHourlyPublishData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly publish data:', err);
    } finally {
      setHourlyPublishLoading(false);
    }
  }

  async function fetchHourlyClientErrorData(date: string) {
    setHourlyClientErrorLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly-client-errors&date=${encodeURIComponent(date)}`);
      if (res.ok) {
        setHourlyClientErrorData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly client error data:', err);
    } finally {
      setHourlyClientErrorLoading(false);
    }
  }

  async function fetchHourlyUiAuthEventData(date: string) {
    setHourlyUiAuthEventLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly-ui-auth-events&date=${encodeURIComponent(date)}`);
      if (res.ok) {
        setHourlyUiAuthEventData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly UI auth event data:', err);
    } finally {
      setHourlyUiAuthEventLoading(false);
    }
  }

  async function fetchPdnaHourlyData(date: string, metric: PdnaHourlyMetric) {
    setPdnaHourlyLoading(true);
    setPdnaHourlyMetric(metric);
    // Clear stale data upfront so the chart shows the loading state
    // instead of flashing the previous day's bars during the fetch.
    setPdnaHourlyData(null);
    try {
      const res = await fetch(`/api/analytics?action=hourly-pdna&date=${encodeURIComponent(date)}&metric=${metric}&tla=${encodeURIComponent(pdnaTlaFilter)}`);
      if (res.ok) {
        setPdnaHourlyData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch PDNA hourly data:', err);
    } finally {
      setPdnaHourlyLoading(false);
    }
  }

  function resetPdnaHourly() {
    setPdnaHourlyMetric(null);
    setPdnaHourlyData(null);
  }


  function formatShortDay(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '1rem 2vw' }}>
      <div style={{ width: '100%', maxWidth: '98vw', margin: '0 auto' }}>
        {/* Header */}
        <header style={{
          backgroundColor: 'rgba(255,255,255,0.97)',
          padding: '1.25rem 1.5rem',
          borderRadius: '12px',
          marginBottom: '1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>
              📊 Apps Analytics
            </h1>
            <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
              App creation, usage, and error analytics
            </p>
          </div>

          {/* Date range selectors live inside each tab / section. */}

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <a
              href="/"
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#f1f5f9',
                color: '#334155',
                borderRadius: '6px',
                textDecoration: 'none',
                fontSize: '0.8rem',
                fontWeight: 500
              }}
            >
              ← Dashboard
            </a>
          </div>
        </header>

        <nav
          aria-label="Analytics sections"
          role="tablist"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.35rem',
            marginBottom: '1.25rem',
            backgroundColor: 'rgba(255,255,255,0.97)',
            padding: '0.5rem',
            borderRadius: '12px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          }}
        >
          {ANALYTICS_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`analytics-tab-${id}`}
              aria-selected={activeTab === id}
              aria-controls={`analytics-panel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => navigateToTab(id)}
              style={{
                padding: '0.45rem 0.85rem',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600,
                backgroundColor: activeTab === id ? '#1d4ed8' : 'transparent',
                color: activeTab === id ? '#fff' : '#475569',
                transition: 'background-color 0.15s, color 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        {visitedTabs.has('apps') && (
          <div
            id="analytics-panel-apps"
            role="tabpanel"
            aria-labelledby="analytics-tab-apps"
            hidden={activeTab !== 'apps'}
            style={{ marginBottom: '1.25rem' }}
          >
            {loading && (
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.75rem' }}>Loading app analytics...</div>
            )}
            {error && (
            <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '1.5rem', borderLeft: '4px solid #ef4444', marginBottom: '0.75rem' }}>
              <p style={{ margin: '0 0 0.5rem 0', color: '#dc2626', fontWeight: 600 }}>Error</p>
              <p style={{ margin: 0, color: '#666' }}>{error}</p>
              <button type="button" onClick={() => fetchData()} style={{ marginTop: '0.75rem', padding: '0.4rem 0.75rem', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>Retry</button>
            </div>
            )}
            {/* ---------- PDNA Section (daily snapshot, 3-4 day lag) ---------- */}
            {/* PDNA provisioning data is a once-a-day full-fleet snapshot of    */}
            {/* `airo_apps_provisioning_summary`. Granularity cannot go below a  */}
            {/* day's resolution (hourly drilldowns query the same snapshot,    */}
            {/* bucketing on per-record `app_create_utc_ts` / `app_delete_utc_ts`*/}
            {/* timestamps). A "1h" preset is therefore not offered here.        */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
                  App provisioning <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>(PDNA daily snapshot)</span>
                </h2>
                {/* TLA filter — drives every PDNA metric + hourly drilldown. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  backgroundColor: 'rgba(255,255,255,0.97)',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '10px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                }}>
                  <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>TLA</span>
                  {([
                    { id: 'non-tla' as TlaFilter, label: 'Non-TLA', hint: 'Customer-facing apps (tla_flag=false)' },
                    { id: 'tla' as TlaFilter, label: 'TLA', hint: 'Internal / test apps (tla_flag=true)' },
                    { id: 'all' as TlaFilter, label: 'All', hint: 'No tla_flag filter' },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      title={opt.hint}
                      onClick={() => setPdnaTlaFilter(opt.id)}
                      style={{
                        padding: '0.3rem 0.65rem',
                        backgroundColor: pdnaTlaFilter === opt.id ? '#1d4ed8' : '#f3f4f6',
                        color: pdnaTlaFilter === opt.id ? 'white' : '#374151',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.72rem',
                        fontWeight: 500,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <HelpBadge info={{
                    what: 'Filters every chart & pill in this section by the tla_flag on each PDNA doc.',
                    how: '`Non-TLA` → tla_flag=false (customer-facing apps — default). `TLA` → tla_flag=true (internal/test/demo tenants). `All` → no filter on tla_flag.',
                    reading: 'Default Non-TLA keeps the numbers focused on real usage. Switch to TLA to see internal test volume; switch to All for total fleet.',
                  }} color="#1d4ed8" />
                </div>
                {/* Chart-size toggle — changes the grid column width and
                    chart height for all PDNA charts. Small is the default. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  backgroundColor: 'rgba(255,255,255,0.97)',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '10px',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                }}>
                  <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Size</span>
                  {([
                    { id: 'small' as PdnaChartSize, label: 'S', hint: 'Small — 2-col default' },
                    { id: 'large' as PdnaChartSize, label: 'L', hint: 'Large — 2× width' },
                    { id: 'full' as PdnaChartSize, label: 'Full', hint: 'Full width — one chart per row' },
                  ]).map(opt => (
                    <button
                      key={opt.id}
                      title={opt.hint}
                      onClick={() => setPdnaChartSize(opt.id)}
                      style={{
                        padding: '0.3rem 0.65rem',
                        backgroundColor: pdnaChartSize === opt.id ? '#1d4ed8' : '#f3f4f6',
                        color: pdnaChartSize === opt.id ? 'white' : '#374151',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.72rem',
                        fontWeight: 500,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <DateRangeSelector
                presets={['7d', '14d', '30d', '90d', '6mo', '1yr', 'custom'] as const}
                value={pdnaDatePreset}
                onValueChange={(v) => { setPdnaDatePreset(v); resetPdnaHourly(); }}
                customStart={pdnaCustomStart}
                customEnd={pdnaCustomEnd}
                onCustomStartChange={setPdnaCustomStart}
                onCustomEndChange={setPdnaCustomEnd}
                onCustomApply={() => { /* PDNA memoized filters react to state */ }}
              />

              {/* Summary pills (headline totals at snapshot time). Each shows a
                  1-line explanation so non-engineer viewers understand what the
                  number represents. All counts come from the most recent daily
                  snapshot; the selected date range only affects the charts. */}
              {pdnaLoading ? (
                <div style={{ backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: '10px', padding: '1rem', textAlign: 'center', marginBottom: '1rem' }}>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Loading PDNA snapshot…</span>
                </div>
              ) : pdnaError ? (
                <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '10px', padding: '1rem', borderLeft: '4px solid #ef4444', marginBottom: '1rem' }}>
                  <p style={{ margin: 0, color: '#dc2626', fontWeight: 600, fontSize: '0.8rem' }}>PDNA error: {pdnaError}</p>
                </div>
              ) : pdnaSnapshot ? (
                <>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                    gap: '0.6rem',
                    marginBottom: '0.75rem',
                  }}>
                    {[
                      { label: 'Snapshot Date', value: pdnaSnapshot.snapshotDate, color: '#475569', desc: 'Latest daily PDNA dump', help: { what: 'Date of the most recent complete PDNA snapshot used for every number on this page.', how: 'max(summary_timestamp) across the index, then filtered to that day.', reading: 'PDNA snapshots usually lag 3–4 days. If this date is older than ~4 days, the upstream pipeline may be stalled.' } },
                      { label: 'Total Apps', value: pdnaSnapshot.totalApps.toLocaleString(), color: '#1d4ed8', desc: 'Non-TLA apps in snapshot', help: { what: 'All apps currently provisioned, excluding TLA/internal tenants.', how: 'value_count(app_id) in the latest snapshot with tla_flag=false (and a fixed excluded-customer list).', reading: 'This is the denominator for most rates on this page.' } },
                      { label: 'Published', value: `${pdnaSnapshot.publishedCount.toLocaleString()} (${pdnaSnapshot.publishRate}%)`, color: '#0d9488', desc: 'Live on public URL right now', help: { what: 'Apps currently live (publish_flag=true).', how: 'filter { publish_flag=true } / Total Apps.', reading: 'Point-in-time — may dip when users hibernate. See "Ever Published" for lifetime reach.' } },
                      { label: 'Ever Published', value: `${pdnaSnapshot.everPublishedCount.toLocaleString()} (${pdnaSnapshot.everPublishedRate}%)`, color: '#0369a1', desc: 'Reached publish at least once', help: { what: 'Apps that reached first-publish at any point (even if later hibernated).', how: 'filter { first_publish_utc_ts exists } / Total Apps.', reading: 'Truer product-value signal than "Published" — customers who made it to the goal once.' } },
                      { label: 'Hibernated', value: `${pdnaSnapshot.hibernatedCount.toLocaleString()} (${pdnaSnapshot.hibernationRate}%)`, color: '#be185d', desc: 'Paused / dormant apps', help: { what: 'Apps currently hibernated (resource-parked to save cost).', how: 'filter { hibernation_flag=true } / Total Apps.', reading: 'High hibernation rate is normal for long-tail; watch the ratio vs Ever Published.' } },
                      { label: 'Deleted', value: pdnaSnapshot.deletedCount.toLocaleString(), color: '#dc2626', desc: 'Have app_delete_utc_ts', help: { what: 'Apps marked for deletion (app_delete_utc_ts populated).', how: 'filter { exists: app_delete_utc_ts }.', reading: 'Raw count; PDNA keeps the doc around for bookkeeping.' } },
                      { label: 'Custom Domain', value: `${pdnaSnapshot.customDomainCount.toLocaleString()} (${pdnaSnapshot.customDomainRate}%)`, color: '#ea580c', desc: 'Real domain (not *.airoapp.ai)', help: { what: 'Apps with a customer-owned domain attached — strong value-achieved signal.', how: 'filter { primary_domain_name exists AND NOT matches *.airoapp.ai }.', reading: '~50% of currently-published apps have one. High correlation with "reached the goal".' } },
                      { label: 'Subscriptions', value: pdnaSnapshot.totalSubscriptions.toLocaleString(), color: '#7c3aed', desc: 'Distinct airo_subscription_id', help: { what: 'Unique subscriptions backing all apps in the snapshot.', how: 'cardinality(airo_subscription_id).', reading: 'Less than Total Apps — many apps share a subscription.' } },
                      { label: 'Downgrades Pending', value: pdnaSnapshot.downgradesCount.toLocaleString(), color: '#f59e0b', desc: 'Subs with a downgrade queued', help: { what: 'Subscriptions with a scheduled/recorded downgrade.', how: 'filter { airo_subscription_downgrade_utc_ts exists } → cardinality(airo_subscription_id).', reading: 'Lead indicator for churn / plan-tier shifts at next renewal.' } },
                      { label: 'Time-to-Publish p50', value: pdnaSnapshot.timeToPublishHours.p50 != null ? `${pdnaSnapshot.timeToPublishHours.p50.toFixed(1)} h` : '—', color: '#0ea5e9', desc: 'Median first-publish latency', help: { what: 'Median hours from app_create_utc_ts to first_publish_utc_ts (across all ever-published apps).', how: 'percentiles(50) on runtime field: (first_publish_utc_ts - app_create_utc_ts) / hour.', reading: `Fast users publish within hours. p90 is ${pdnaSnapshot.timeToPublishHours.p90?.toFixed(0) ?? '—'}h, p99 ${pdnaSnapshot.timeToPublishHours.p99?.toFixed(0) ?? '—'}h. Outliers are typically stalled drafts.` } },
                      ...Object.entries(pdnaSnapshot.statuses).map(([status, count]) => ({
                        label: `Sub · ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                        value: count.toLocaleString(),
                        color: status === 'active' ? '#16a34a' : status === 'cancelled' ? '#dc2626' : '#d97706',
                        desc: `Distinct subs, status=${status}`,
                        help: { what: `Distinct subscriptions currently in status "${status}".`, how: `terms(airo_subscription_status) → cardinality(airo_subscription_id) per bucket.`, reading: 'Sum across Active / Cancelled / Suspended should approximate Total Subscriptions.' },
                      })),
                    ].map(({ label, value, color, help }) => (
                      <div key={label} style={{
                        backgroundColor: 'rgba(255,255,255,0.97)',
                        padding: '0.6rem 0.8rem',
                        borderRadius: '10px',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.35rem' }}>
                          <span style={{ fontSize: '0.58rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                          {help && <HelpBadge info={help} color={color} />}
                        </div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color, fontFamily: 'monospace', marginTop: '0.15rem' }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Subscription plan mix — uses airo_subscription_plan (not token_budget_id). */}
                  {Object.keys(pdnaSnapshot.subscriptionPlans).length > 0 && (
                    <div style={{
                      backgroundColor: 'rgba(255,255,255,0.97)',
                      padding: '0.5rem 0.8rem',
                      borderRadius: '10px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                      marginBottom: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Subscription plans</span>
                      {Object.entries(pdnaSnapshot.subscriptionPlans).sort((a, b) => b[1] - a[1]).map(([plan, count]) => (
                        <span key={plan} style={{ fontSize: '0.75rem', color: '#374151' }}>
                          <strong style={{ fontFamily: 'monospace' }}>{plan}</strong>: {count.toLocaleString()}
                        </span>
                      ))}
                      <HelpBadge info={{ what: 'Distinct subscriptions by plan tier.', how: 'terms(airo_subscription_plan.keyword) → cardinality(airo_subscription_id) per bucket.', reading: 'Free-tier dominant is expected; paid-tier shifts indicate revenue movement.' }} color="#64748b" />
                    </div>
                  )}

                  {/* Cell distribution — shows how apps are routed across cells. */}
                  {Object.keys(pdnaSnapshot.cells).length > 0 && (
                    <div style={{
                      backgroundColor: 'rgba(255,255,255,0.97)',
                      padding: '0.5rem 0.8rem',
                      borderRadius: '10px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                      marginBottom: '0.75rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Cell distribution</span>
                      {Object.entries(pdnaSnapshot.cells).sort((a, b) => b[1] - a[1]).map(([cell, count]) => (
                        <span key={cell} style={{ fontSize: '0.75rem', color: '#374151' }}>
                          <strong style={{ fontFamily: 'monospace' }}>{cell}</strong>: {count.toLocaleString()}
                        </span>
                      ))}
                      <HelpBadge info={{ what: 'Count of apps per Nomad cell (region + capacity shard).', how: 'terms(cell_id) — doc_count is per app (one PDNA doc per app).', reading: 'Uneven distribution can signal a cell hitting capacity or a placement-policy change.' }} color="#64748b" />
                    </div>
                  )}
                </>
              ) : null}

              <div style={{
                display: 'grid',
                gridTemplateColumns: pdnaGridColumns,
                gap: '1rem',
              }}>
                {/* Apps Created Chart */}
            {(() => {
              if (pdnaLoading || (pdnaHourlyLoading && pdnaHourlyMetric === 'created')) {
                return <ChartLoadingState />;
              }
              if (pdnaHourlyMetric === 'created' && pdnaHourlyData) {
                const total = pdnaHourlyData.hourly_stats.reduce((a, h) => a + h.value, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title={`Apps Created/Hour (${pdnaHourlyData.date})`}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#3b82f6"
                    data={buildHourlyChartData(pdnaHourlyData.hourly_stats, h => h.value, (hr, h) => `${hr}:00 - ${h.value} created`)}
                    barColor="#3b82f6"
                    barColorLight="#60a5fa"
                    showBack
                    backAction={resetPdnaHourly}
                  />
                );
              }
              if (pdnaAppsCreatedInRange.length > 0) {
                const totalCreated = pdnaAppsCreatedInRange.reduce((sum, day) => sum + day.created, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Apps Created by Plan + Ever-Publish %"
                    chartNumber={1}
                    help={{
                      what: 'Bars: new apps per day split by subscription plan (free / starter / professional / ultimate). Line: % of that day\'s cohort that ever reached first publish.',
                      how: 'Bars = date_histogram(app_create_utc_ts, 1d) with a terms(airo_subscription_plan.keyword) sub-agg per day. Line = everPublishedDaily[day] / appsCreatedDaily[day] × 100. Click a bar for hourly drilldown.',
                      reading: 'The stack shows plan-mix of acquisition; the line shows cohort survival to first-publish. A paid-tier surge combined with a low Ever-Publish % means engagement isn\'t following the signup. Older cohorts naturally sit higher on the line.',
                    }}
                    value={`Total: ${totalCreated.toLocaleString()}`}
                    valueColor="#3b82f6"
                    data={buildDailyChartData(pdnaAppsCreatedInRange, s => s.created, (d, s) => `${formatShortDay(d)}: ${s.created} created`, formatShortDay)}
                    barColor="#3b82f6"
                    barColorLight="#60a5fa"
                    seriesName="Created"
                    stackedSeries={pdnaAppsCreatedStackedByPlan ?? undefined}
                    overlay={{
                      name: 'Ever-Publish %',
                      values: pdnaCreatedToEverPublishedPct,
                      color: '#0369a1',
                      unit: '%',
                      max: 100,
                    }}
                    markAverage
                    weekendIndices={pdnaWeekendIndices.created}
                    onClick={(i) => fetchPdnaHourlyData(pdnaAppsCreatedInRange[i].date, 'created')}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA app creation data'} />;
            })()}

            {/* Apps Deleted Chart */}
            {(() => {
              if (pdnaLoading || (pdnaHourlyLoading && pdnaHourlyMetric === 'deleted')) {
                return <ChartLoadingState />;
              }
              if (pdnaHourlyMetric === 'deleted' && pdnaHourlyData) {
                const total = pdnaHourlyData.hourly_stats.reduce((a, h) => a + h.value, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title={`Apps Deleted/Hour (${pdnaHourlyData.date})`}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#dc2626"
                    data={buildHourlyChartData(pdnaHourlyData.hourly_stats, h => h.value, (hr, h) => `${hr}:00 - ${h.value} deleted`)}
                    barColor="#dc2626"
                    barColorLight="#f87171"
                    showBack
                    backAction={resetPdnaHourly}
                  />
                );
              }
              if (pdnaAppsDeletedInRange.length > 0) {
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Apps Deleted by Plan"
                    chartNumber={2}
                    help={{ what: 'Apps marked deleted per day, split by subscription plan.', how: 'date_histogram(app_delete_utc_ts, 1d) with terms(airo_subscription_plan.keyword) sub-agg. Plan = snapshot-time plan, not the plan at deletion. Click a bar for hourly drilldown.', reading: 'Deletion != churn — apps can be deleted by automation after long inactivity. Plan mix of deletions tells you which tier is churning hardest.' }}
                    value={`Total: ${pdnaAppsDeletedInRange.reduce((s, d) => s + d.deleted, 0).toLocaleString()}`}
                    valueColor="#dc2626"
                    data={buildDailyChartData(pdnaAppsDeletedInRange, s => s.deleted, (d, s) => `${formatShortDay(d)}: ${s.deleted} deleted`, formatShortDay)}
                    barColor="#dc2626"
                    barColorLight="#f87171"
                    stackedSeries={pdnaAppsDeletedStackedByPlan ?? undefined}
                    markAverage
                    weekendIndices={pdnaWeekendIndices.deleted}
                    onClick={(i) => fetchPdnaHourlyData(pdnaAppsDeletedInRange[i].date, 'deleted')}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA app deletion data'} />;
            })()}

            {/* Unique Customers Chart */}
            {(() => {
              if (pdnaLoading || (pdnaHourlyLoading && pdnaHourlyMetric === 'unique_customers')) {
                return <ChartLoadingState />;
              }
              if (pdnaHourlyMetric === 'unique_customers' && pdnaHourlyData) {
                const total = pdnaHourlyData.hourly_stats.reduce((a, h) => a + h.value, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title={`Unique Customers/Hour (${pdnaHourlyData.date})`}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#7c3aed"
                    data={buildHourlyChartData(pdnaHourlyData.hourly_stats, h => h.value, (hr, h) => `${hr}:00 - ${h.value} customers`)}
                    barColor="#7c3aed"
                    barColorLight="#a78bfa"
                    showBack
                    backAction={resetPdnaHourly}
                  />
                );
              }
              if (pdnaUniqueCustomersInRange.length > 0) {
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Unique Customers"
                    chartNumber={3}
                    help={{ what: 'Distinct customer_ids who created at least one app that day.', how: 'date_histogram(app_create_utc_ts, 1d) → cardinality(customer_id).', reading: 'Lower-bound on daily active creators. Summing bars overcounts customers who return on multiple days.' }}
                    value={`Total: ${pdnaUniqueCustomersInRange.reduce((s, d) => s + d.uniqueCustomers, 0).toLocaleString()}`}
                    valueColor="#7c3aed"
                    data={buildDailyChartData(pdnaUniqueCustomersInRange, s => s.uniqueCustomers, (d, s) => `${formatShortDay(d)}: ${s.uniqueCustomers} customers`, formatShortDay)}
                    barColor="#7c3aed"
                    barColorLight="#a78bfa"
                    markAverage
                    weekendIndices={pdnaWeekendIndices.uniqueCustomers}
                    onClick={(i) => fetchPdnaHourlyData(pdnaUniqueCustomersInRange[i].date, 'unique_customers')}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA unique customer data'} />;
            })()}

            {/* Ever Published Chart (cohort that reached first-publish at least once). */}
            {(() => {
              if (pdnaLoading) return <ChartLoadingState />;
              if (pdnaEverPublishedInRange.length > 0) {
                const total = pdnaEverPublishedInRange.reduce((s, d) => s + d.everPublished, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Ever Published by Plan"
                    chartNumber={4}
                    help={{ what: 'Of apps created on day X, how many ever reached first publish (even if later hibernated), split by subscription plan.', how: 'date_histogram(app_create_utc_ts, 1d) filtered to first_publish_utc_ts exists, with terms(airo_subscription_plan.keyword) sub-agg.', reading: '"Did the customer reach the goal" cohort. Plan mix shows which tier converts best to first-publish.' }}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#0369a1"
                    data={buildDailyChartData(pdnaEverPublishedInRange, s => s.everPublished, (d, s) => `${formatShortDay(d)}: ${s.everPublished} ever-published`, formatShortDay)}
                    barColor="#0369a1"
                    barColorLight="#7dd3fc"
                    stackedSeries={pdnaEverPublishedStackedByPlan ?? undefined}
                    markAverage
                    weekendIndices={pdnaWeekendIndices.everPublished}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA ever-published data'} />;
            })()}

            {/* Apps Hibernated Chart (cohort by creation date currently hibernated). */}
            {(() => {
              if (pdnaLoading) return <ChartLoadingState />;
              if (pdnaAppsHibernatedInRange.length > 0) {
                const total = pdnaAppsHibernatedInRange.reduce((s, d) => s + d.hibernated, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Apps Hibernated by Plan"
                    chartNumber={5}
                    help={{ what: 'Of apps created on day X, how many are CURRENTLY hibernated, split by subscription plan.', how: 'date_histogram(app_create_utc_ts, 1d) filtered to hibernation_flag=true, with terms(airo_subscription_plan.keyword) sub-agg.', reading: 'Older cohorts naturally hibernate more. A sudden spike in recent cohorts flags an onboarding issue. Plan mix shows which tier drops off most.' }}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#be185d"
                    data={buildDailyChartData(pdnaAppsHibernatedInRange, s => s.hibernated, (d, s) => `${formatShortDay(d)}: ${s.hibernated} hibernated`, formatShortDay)}
                    barColor="#be185d"
                    barColorLight="#f9a8d4"
                    stackedSeries={pdnaAppsHibernatedStackedByPlan ?? undefined}
                    markAverage
                    weekendIndices={pdnaWeekendIndices.hibernated}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA hibernation data'} />;
            })()}

            {/* Apps with Custom Domain Chart (cohort by creation date —
                primary_domain_name set and not *.airoapp.ai; strong value
                signal since ~50% of published apps have one). */}
            {(() => {
              if (pdnaLoading) return <ChartLoadingState />;
              if (pdnaCustomDomainInRange.length > 0) {
                const total = pdnaCustomDomainInRange.reduce((s, d) => s + d.customDomain, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Custom Domain by Plan"
                    chartNumber={6}
                    help={{ what: 'Apps from creation-date cohort X with a real domain attached today, split by subscription plan.', how: 'date_histogram(app_create_utc_ts, 1d) filtered to primary_domain_name exists AND NOT matches *.airoapp.ai, with terms(airo_subscription_plan.keyword) sub-agg.', reading: 'Strong value signal. Plan mix here tends to skew more paid than #1 — custom domains correlate with intent to stay.' }}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#ea580c"
                    data={buildDailyChartData(pdnaCustomDomainInRange, s => s.customDomain, (d, s) => `${formatShortDay(d)}: ${s.customDomain} with custom domain`, formatShortDay)}
                    barColor="#ea580c"
                    barColorLight="#fdba74"
                    stackedSeries={pdnaCustomDomainStackedByPlan ?? undefined}
                    markAverage
                    weekendIndices={pdnaWeekendIndices.customDomain}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA custom-domain data'} />;
            })()}

            {/* Subscriptions Chart (unique subscriptions created per day — from
                airo_subscription_create_utc_ts). */}
            {(() => {
              if (pdnaLoading) return <ChartLoadingState />;
              if (pdnaSubscriptionsInRange.length > 0) {
                const total = pdnaSubscriptionsInRange.reduce((s, d) => s + d.subscriptions, 0);
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Subscriptions Created by Plan"
                    chartNumber={7}
                    help={{ what: 'New distinct subscriptions per day, split by plan tier (by airo_subscription_create_utc_ts).', how: 'date_histogram(airo_subscription_create_utc_ts, 1d) with terms(airo_subscription_plan.keyword) sub-agg, each bucketed with cardinality(airo_subscription_id).', reading: 'Acquisition signal at the subscription level, with plan composition. Paid-tier share is the monetization signal.' }}
                    value={`Total: ${total.toLocaleString()}`}
                    valueColor="#7c3aed"
                    data={buildDailyChartData(pdnaSubscriptionsInRange, s => s.subscriptions, (d, s) => `${formatShortDay(d)}: ${s.subscriptions} subscriptions`, formatShortDay)}
                    barColor="#7c3aed"
                    barColorLight="#c4b5fd"
                    stackedSeries={pdnaSubscriptionsStackedByPlan ?? undefined}
                    markAverage
                    weekendIndices={pdnaWeekendIndices.subscriptions}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA subscription data'} />;
            })()}

            {/* Time-to-Publish Median Chart (p50 hours per creation-date cohort). */}
            {(() => {
              if (pdnaLoading) return <ChartLoadingState />;
              if (pdnaTimeToPublishInRange.length > 0) {
                const rounded = pdnaTimeToPublishInRange.map(d => ({ date: d.date, value: Math.round(d.medianHours * 10) / 10 }));
                const avgMedian = rounded.reduce((s, d) => s + d.value, 0) / rounded.length;
                return (
                  <EChartsMiniChart group="pdna" size={pdnaChartSize} zoomStart={pdnaZoomStart} zoomEnd={pdnaZoomEnd} onZoomChange={onPdnaZoomChange}
                    title="Time-to-Publish p50 (hours)"
                    chartNumber={8}
                    help={{ what: 'Median hours from app-creation to first-publish, per creation-date cohort.', how: 'For each day: percentiles(50) of (first_publish_utc_ts − app_create_utc_ts) / hour, over apps in that cohort that ever published.', reading: `Lower = faster. Flat is healthy. Spikes in recent cohorts = onboarding friction. Global medians: p50=${pdnaSnapshot?.timeToPublishHours.p50?.toFixed(1) ?? '—'}h, p90=${pdnaSnapshot?.timeToPublishHours.p90?.toFixed(0) ?? '—'}h, p99=${pdnaSnapshot?.timeToPublishHours.p99?.toFixed(0) ?? '—'}h.` }}
                    value={`Avg p50: ${avgMedian.toFixed(1)} h`}
                    valueColor="#0ea5e9"
                    data={buildDailyChartData(rounded, s => s.value, (d, s) => `${formatShortDay(d)}: ${s.value} h median`, formatShortDay)}
                    barColor="#0ea5e9"
                    barColorLight="#7dd3fc"
                    areaMode
                    markAverage
                    weekendIndices={pdnaWeekendIndices.timeToPublish}
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA time-to-publish data'} />;
            })()}
              </div>
            </div>

            {/* ---------- Dynamic Section (real-time Loki + Katana ES) ---------- */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
                  Real-time activity <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>(Loki + Katana ES)</span>
                </h2>
              </div>
              <DateRangeSelector
                presets={['1h', '1d', '7d', '14d', '30d', 'custom'] as const}
                value={dynamicDatePreset}
                onValueChange={setDynamicDatePreset}
                customStart={dynamicCustomStart}
                customEnd={dynamicCustomEnd}
                onCustomStartChange={setDynamicCustomStart}
                onCustomEndChange={setDynamicCustomEnd}
                onCustomApply={() => fetchData()}
              />
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1rem',
              }}>
                {/* WebSocket Errors Chart */}
            {(() => {
              if (loading || hourlyWsErrorLoading) {
                return <ChartLoadingState />;
              }
              if (dynamicDatePreset === '1h' && last1hWsErrors) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="WS Errors (Last 1h, 5m buckets)"
                    value={`Total: ${last1hWsErrors.minute_stats.reduce((sum, h) => sum + h.errors, 0)}`}
                    valueColor="#dc2626"
                    data={buildRolling1hChartData(last1hWsErrors.minute_stats, s => s.errors, (m, s) => `${m}m ago: ${s.errors} WS errors`)}
                    barColor="#f87171"
                  />
                );
              }
              if (dynamicDatePreset === '1d' && last24hWsErrors) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="WS Errors (Last 24h)"
                    value={`Total: ${last24hWsErrors.hourly_stats.reduce((sum, h) => sum + h.errors, 0)}`}
                    valueColor="#dc2626"
                    data={buildRolling24hChartData(last24hWsErrors.hourly_stats, s => s.errors, (h, s) => `${h}h ago: ${s.errors} WS errors`)}
                    barColor="#f87171"
                  />
                );
              }
              if (hourlyWsErrorData) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="WS Errors/Hour"
                    value={`Total: ${hourlyWsErrorData.hourly_stats.reduce((sum, h) => sum + h.errors, 0)}`}
                    valueColor="#dc2626"
                    data={buildHourlyChartData(hourlyWsErrorData.hourly_stats, s => s.errors, (h, s) => `${h}:00 - ${s.errors} WS errors`)}
                    barColor="#f87171"
                    showBack={true}
                    backAction={() => setHourlyWsErrorData(null)}
                  />
                );
              }
              if (errorStats?.websocket?.daily_stats && errorStats.websocket.daily_stats.length > 0) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="WS Errors/Day"
                    value={`Total: ${errorStats.websocket.total}`}
                    valueColor="#dc2626"
                    data={buildDailyChartData(errorStats.websocket.daily_stats, s => s.errors, (d, s) => `${formatShortDay(d)}: ${s.errors} WS errors`, formatShortDay)}
                    barColor="#dc2626"
                    barColorLight="#f87171"
                    onClick={(i) => fetchHourlyWsErrorData(errorStats.websocket.daily_stats[i].date)}
                  />
                );
              }
              return <ChartEmptyState message="No WS error data" />;
            })()}

            {/* Budget Errors/Day Chart */}
            {(() => {
              if (loading || hourlyBudgetErrorLoading) {
                return <ChartLoadingState />;
              }
              if (dynamicDatePreset === '1h' && last1hBudgetErrors) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Budget Errors (Last 1h, 5m buckets)"
                    value={`Total: ${last1hBudgetErrors.minute_stats.reduce((sum, h) => sum + h.errors, 0)}`}
                    valueColor="#f59e0b"
                    data={buildRolling1hChartData(last1hBudgetErrors.minute_stats, s => s.errors, (m, s) => `${m}m ago: ${s.errors} budget errors`)}
                    barColor="#fbbf24"
                  />
                );
              }
              if (dynamicDatePreset === '1d' && last24hBudgetErrors) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Budget Errors (Last 24h)"
                    value={`Total: ${last24hBudgetErrors.hourly_stats.reduce((sum, h) => sum + h.errors, 0)}`}
                    valueColor="#f59e0b"
                    data={buildRolling24hChartData(last24hBudgetErrors.hourly_stats, s => s.errors, (h, s) => `${h}h ago: ${s.errors} budget errors`)}
                    barColor="#fbbf24"
                  />
                );
              }
              if (hourlyBudgetErrorData) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Budget Errors/Hour"
                    value={`Total: ${hourlyBudgetErrorData.hourly_stats.reduce((sum, h) => sum + h.errors, 0)}`}
                    valueColor="#f59e0b"
                    data={buildHourlyChartData(hourlyBudgetErrorData.hourly_stats, s => s.errors, (h, s) => `${h}:00 - ${s.errors} budget errors`)}
                    barColor="#fbbf24"
                    showBack={true}
                    backAction={() => setHourlyBudgetErrorData(null)}
                  />
                );
              }
              if (errorStats?.budget?.daily_stats && errorStats.budget.daily_stats.length > 0) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Budget Errors/Day"
                    value={`Total: ${errorStats.budget.total}`}
                    valueColor="#f59e0b"
                    data={buildDailyChartData(errorStats.budget.daily_stats, s => s.errors, (d, s) => `${formatShortDay(d)}: ${s.errors} budget errors`, formatShortDay)}
                    barColor="#f59e0b"
                    barColorLight="#fbbf24"
                    onClick={(i) => fetchHourlyBudgetErrorData(errorStats.budget.daily_stats[i].date)}
                  />
                );
              }
              return <ChartEmptyState message="No budget error data" />;
            })()}

            {/* Summarizations Chart */}
            {(() => {
              if (loading || hourlySummarizationLoading) {
                return <ChartLoadingState />;
              }
              if (dynamicDatePreset === '1h' && last1hSummarizations) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Summarizations (Last 1h, 5m buckets)"
                    value={`Total: ${last1hSummarizations.minute_stats.reduce((sum, h) => sum + h.total, 0)}`}
                    valueColor="#0ea5e9"
                    data={buildRolling1hChartData(last1hSummarizations.minute_stats, s => s.total, (m, s) => `${m}m ago: ${s.total} (${s.failed} failed)`)}
                    barColor="#38bdf8"
                  />
                );
              }
              if (dynamicDatePreset === '1d' && last24hSummarizations) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Summarizations (Last 24h)"
                    value={`Total: ${last24hSummarizations.hourly_stats.reduce((sum, h) => sum + h.total, 0)}`}
                    valueColor="#0ea5e9"
                    data={buildRolling24hChartData(last24hSummarizations.hourly_stats, s => s.total, (h, s) => `${h}h ago: ${s.total} (${s.failed} failed)`)}
                    barColor="#38bdf8"
                  />
                );
              }
              if (hourlySummarizationData) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Summarizations/Hour"
                    value={`Total: ${hourlySummarizationData.hourly_stats.reduce((sum, h) => sum + h.total, 0)}`}
                    valueColor="#0ea5e9"
                    data={buildHourlyChartData(hourlySummarizationData.hourly_stats, s => s.total, (h, s) => `${h}:00 - ${s.total} (${s.failed} failed)`)}
                    barColor="#38bdf8"
                    showBack={true}
                    backAction={() => setHourlySummarizationData(null)}
                  />
                );
              }
              if (summarizationStats?.daily_stats && summarizationStats.daily_stats.length > 0) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Summarizations/Day"
                    value={`Total: ${summarizationStats.total}`}
                    valueColor="#0ea5e9"
                    data={buildDailyChartData(summarizationStats.daily_stats, s => s.total, (d, s) => `${formatShortDay(d)}: ${s.total} (${s.failed} failed)`, formatShortDay)}
                    barColor="#0ea5e9"
                    barColorLight="#38bdf8"
                    onClick={(i) => fetchHourlySummarizationData(summarizationStats.daily_stats[i].date)}
                  />
                );
              }
              return <ChartEmptyState message="No summarization data" />;
            })()}

            {/* Publish Success Rate Chart */}
            {(() => {
              const calcRate = (successes: number, begins: number) => begins > 0 ? Math.round((successes / begins) * 100) : 0;

              if (loading || hourlyPublishLoading) {
                return <ChartLoadingState />;
              }
              if (hourlyPublishData?.hourly_stats) {
                const hourlyStats = hourlyPublishData.hourly_stats.map(h => ({
                  hour: new Date(h.hour).getHours(),
                  begins: h.begins,
                  successes: h.successes,
                  failures: h.failures,
                  rate: calcRate(h.successes, h.begins)
                }));
                const totalBegins = hourlyStats.reduce((a, h) => a + h.begins, 0);
                const totalSuccesses = hourlyStats.reduce((a, h) => a + h.successes, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title={`Publish Rate/Hour (${hourlyPublishData.date.split('T')[0]})`}
                    value={`${calcRate(totalSuccesses, totalBegins)}% (${totalSuccesses}/${totalBegins})`}
                    valueColor="#22c55e"
                    data={buildHourlyChartData(hourlyStats, h => h.rate, (hr, h) => `${hr}:00 - ${h.rate}% (${h.successes}/${h.begins})`)}
                    barColor="#22c55e"
                    barColorLight="#4ade80"
                    showBack
                    backAction={() => setHourlyPublishData(null)}
                  />
                );
              }
              if (dynamicDatePreset === '1h' && last1hPublish?.minute_stats) {
                const totalBegins = last1hPublish.minute_stats.reduce((a, h) => a + h.begins, 0);
                const totalSuccesses = last1hPublish.minute_stats.reduce((a, h) => a + h.successes, 0);
                const calcRate = (s: number, b: number) => b > 0 ? Math.round((s / b) * 100) : 0;
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Publish Rate (Last 1h, 5m)"
                    value={`${calcRate(totalSuccesses, totalBegins)}% (${totalSuccesses}/${totalBegins})`}
                    valueColor="#22c55e"
                    data={buildRolling1hChartData(last1hPublish.minute_stats, h => calcRate(h.successes, h.begins), (m, s) => `${m}m ago: ${calcRate(s.successes, s.begins)}% (${s.successes}/${s.begins})`)}
                    barColor="#22c55e"
                    barColorLight="#4ade80"
                  />
                );
              }
              if (dynamicDatePreset === '1d' && last24hPublish?.hourly_stats) {
                const totalBegins = last24hPublish.hourly_stats.reduce((a, h) => a + h.begins, 0);
                const totalSuccesses = last24hPublish.hourly_stats.reduce((a, h) => a + h.successes, 0);
                const overallRate = calcRate(totalSuccesses, totalBegins);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Publish Rate/24h"
                    value={`${overallRate}% (${totalSuccesses}/${totalBegins})`}
                    valueColor="#22c55e"
                    data={buildRolling24hChartData(last24hPublish.hourly_stats, h => calcRate(h.successes, h.begins), (hr, s) => `${hr}h ago: ${calcRate(s.successes, s.begins)}% (${s.successes}/${s.begins})`)}
                    barColor="#22c55e"
                    barColorLight="#4ade80"
                  />
                );
              }
              if (publishStats?.daily_stats && publishStats.daily_stats.length > 0) {
                const totalBegins = publishStats.daily_stats.reduce((a, s) => a + s.begins, 0);
                const totalSuccesses = publishStats.successes;
                const overallRate = calcRate(totalSuccesses, totalBegins);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="Publish Rate/Day"
                    value={`${overallRate}% (${totalSuccesses}/${totalBegins})`}
                    valueColor="#22c55e"
                    data={buildDailyChartData(publishStats.daily_stats, s => calcRate(s.successes, s.begins), (d, s) => `${formatShortDay(d)}: ${calcRate(s.successes, s.begins)}% (${s.successes}/${s.begins})`, formatShortDay)}
                    barColor="#22c55e"
                    barColorLight="#4ade80"
                    onClick={(i) => fetchHourlyPublishData(publishStats.daily_stats[i].date)}
                  />
                );
              }
              return <ChartEmptyState message="No publish data" />;
            })()}

            {/* Client Errors Chart */}
            {(() => {
              if (loading || hourlyClientErrorLoading) {
                return <ChartLoadingState />;
              }
              if (hourlyClientErrorData?.hourly_stats) {
                const total = hourlyClientErrorData.hourly_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title={`CS Errors/Hour`}
                    value={`${total.toLocaleString()}`}
                    valueColor="#f97316"
                    data={buildHourlyChartData(hourlyClientErrorData.hourly_stats, h => h.errors, (hr, h) => `${hr}:00 - ${h.errors} errors`)}
                    barColor="#f97316"
                    barColorLight="#fb923c"
                    showBack
                    backAction={() => setHourlyClientErrorData(null)}
                  />
                );
              }
              if (dynamicDatePreset === '1h' && last1hClientErrors?.minute_stats) {
                const total = last1hClientErrors.minute_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="CS Errors (Last 1h, 5m)"
                    value={`${total.toLocaleString()}`}
                    valueColor="#f97316"
                    data={buildRolling1hChartData(last1hClientErrors.minute_stats, h => h.errors, (m, s) => `${m}m ago: ${s.errors} errors`)}
                    barColor="#f97316"
                    barColorLight="#fb923c"
                  />
                );
              }
              if (dynamicDatePreset === '1d' && last24hClientErrors?.hourly_stats) {
                const total = last24hClientErrors.hourly_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="CS Errors/24h"
                    value={`${total.toLocaleString()}`}
                    valueColor="#f97316"
                    data={buildRolling24hChartData(last24hClientErrors.hourly_stats, h => h.errors, (hr, s) => `${hr}h ago: ${s.errors} errors`)}
                    barColor="#f97316"
                    barColorLight="#fb923c"
                  />
                );
              }
              if (clientErrorStats?.daily_stats && clientErrorStats.daily_stats.length > 0) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="CS Errors/Day"
                    value={`${clientErrorStats.total.toLocaleString()}`}
                    valueColor="#f97316"
                    data={buildDailyChartData(clientErrorStats.daily_stats, s => s.errors, (d, s) => `${formatShortDay(d)}: ${s.errors} errors`, formatShortDay)}
                    barColor="#f97316"
                    barColorLight="#fb923c"
                    onClick={(i) => fetchHourlyClientErrorData(clientErrorStats.daily_stats[i].date)}
                  />
                );
              }
              return <ChartEmptyState message="No client error data" />;
            })()}

            {/* UI Auth Events Chart */}
            {(() => {
              if (loading || hourlyUiAuthEventLoading) {
                return <ChartLoadingState />;
              }
              if (hourlyUiAuthEventData?.hourly_stats) {
                const total = hourlyUiAuthEventData.hourly_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="UI Auth Events/Hour"
                    value={`${total.toLocaleString()}`}
                    valueColor="#0ea5e9"
                    data={buildHourlyChartData(hourlyUiAuthEventData.hourly_stats, h => h.errors, (hr, h) => `${hr}:00 - ${h.errors} events`)}
                    barColor="#0ea5e9"
                    barColorLight="#38bdf8"
                    showBack
                    backAction={() => setHourlyUiAuthEventData(null)}
                  />
                );
              }
              if (dynamicDatePreset === '1h' && last1hUiAuthEvents?.minute_stats) {
                const total = last1hUiAuthEvents.minute_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="UI Auth Events (Last 1h, 5m)"
                    value={`${total.toLocaleString()}`}
                    valueColor="#0ea5e9"
                    data={buildRolling1hChartData(last1hUiAuthEvents.minute_stats, h => h.errors, (m, s) => `${m}m ago: ${s.errors} events`)}
                    barColor="#0ea5e9"
                    barColorLight="#38bdf8"
                  />
                );
              }
              if (dynamicDatePreset === '1d' && last24hUiAuthEvents?.hourly_stats) {
                const total = last24hUiAuthEvents.hourly_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <EChartsMiniChart group="dynamic"
                    title="UI Auth Events/24h"
                    value={`${total.toLocaleString()}`}
                    valueColor="#0ea5e9"
                    data={buildRolling24hChartData(last24hUiAuthEvents.hourly_stats, h => h.errors, (hr, s) => `${hr}h ago: ${s.errors} events`)}
                    barColor="#0ea5e9"
                    barColorLight="#38bdf8"
                  />
                );
              }
              if (uiAuthEventStats?.daily_stats && uiAuthEventStats.daily_stats.length > 0) {
                return (
                  <EChartsMiniChart group="dynamic"
                    title="UI Auth Events/Day"
                    value={`${uiAuthEventStats.total.toLocaleString()}`}
                    valueColor="#0ea5e9"
                    data={buildDailyChartData(uiAuthEventStats.daily_stats, s => s.errors, (d, s) => `${formatShortDay(d)}: ${s.errors} events`, formatShortDay)}
                    barColor="#0ea5e9"
                    barColorLight="#38bdf8"
                    onClick={(i) => fetchHourlyUiAuthEventData(uiAuthEventStats.daily_stats[i].date)}
                  />
                );
              }
              return <ChartEmptyState message="No UI auth event data" />;
            })()}
              </div>
            </div>

          </div>
        )}

        {activeTab === 'cloudflare' && (
          <div
            id="analytics-panel-cloudflare"
            role="tabpanel"
            aria-labelledby="analytics-tab-cloudflare"
            style={{ marginBottom: '1.25rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '1rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#e2e8f0' }}>
                Cloudflare CDN <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 500 }}>(all airoapp domains)</span>
              </h2>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                backgroundColor: 'rgba(255,255,255,0.97)',
                padding: '0.3rem 0.5rem',
                borderRadius: '10px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
              }}>
                <span style={{ fontSize: '0.62rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Size</span>
                {(['small', 'large', 'full'] as const).map(id => (
                  <button
                    key={id}
                    title={id === 'small' ? 'Small — 2-col default' : id === 'large' ? 'Large — 2× width' : 'Full width — one per row'}
                    onClick={() => setCloudflareChartSize(id)}
                    style={{
                      padding: '0.3rem 0.65rem',
                      backgroundColor: cloudflareChartSize === id ? '#1d4ed8' : '#f3f4f6',
                      color: cloudflareChartSize === id ? 'white' : '#374151',
                      border: 'none', borderRadius: '6px', cursor: 'pointer',
                      fontSize: '0.72rem', fontWeight: 500,
                    }}
                  >{id === 'small' ? 'S' : id === 'large' ? 'L' : 'Full'}</button>
                ))}
              </div>
            </div>
            <DateRangeSelector
              presets={['1h', '1d', '7d', '14d', '30d', 'custom'] as const}
              value={cloudflareDatePreset}
              onValueChange={setCloudflareDatePreset}
              customStart={cloudflareCustomStart}
              customEnd={cloudflareCustomEnd}
              onCustomStartChange={setCloudflareCustomStart}
              onCustomEndChange={setCloudflareCustomEnd}
              onCustomApply={() => { /* fetch effect reacts to state */ }}
            />

            {cloudflareLoading && !cloudflareOverview ? (
              <ChartLoadingState />
            ) : cloudflareError ? (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '10px', padding: '1rem', borderLeft: '4px solid #ef4444', marginBottom: '1rem' }}>
                <p style={{ margin: 0, color: '#dc2626', fontWeight: 600, fontSize: '0.8rem' }}>Cloudflare error: {cloudflareError}</p>
              </div>
            ) : cloudflareOverview ? (
              <>
                {/* Summary pills — mirror the PDNA pills grid. */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                  gap: '0.6rem',
                  marginBottom: '0.75rem',
                }}>
                  {[
                    { label: 'Total Requests', value: cloudflareOverview.totalRequests.toLocaleString(), color: '#1e40af' },
                    { label: 'Unique Domains', value: cloudflareOverview.uniqueDomains.toLocaleString(), color: '#7c3aed' },
                    { label: 'Unique Clients', value: cloudflareOverview.uniqueClients.toLocaleString(), color: '#0ea5e9' },
                    { label: 'Bandwidth', value: formatBandwidth(cloudflareOverview.sumBytes), color: '#10b981' },
                    { label: 'p50 Latency', value: cloudflareOverview.p50Ms != null ? `${cloudflareOverview.p50Ms.toFixed(0)} ms` : '—', color: '#0ea5e9' },
                    { label: 'p95 Latency', value: cloudflareOverview.p95Ms != null ? `${cloudflareOverview.p95Ms.toFixed(0)} ms` : '—', color: '#0284c7' },
                    (() => {
                      const total = cloudflareOverview.statusClassDaily.reduce((s, d) => s + d.c2xx + d.c3xx + d.c4xx + d.c5xx + d.cOther, 0);
                      const c4xx = cloudflareOverview.statusClassDaily.reduce((s, d) => s + d.c4xx, 0);
                      const pct = total > 0 ? ((c4xx / total) * 100).toFixed(1) : '0.0';
                      return { label: '4xx Rate', value: `${pct}% (${c4xx.toLocaleString()})`, color: '#f59e0b' };
                    })(),
                    (() => {
                      const total = cloudflareOverview.statusClassDaily.reduce((s, d) => s + d.c2xx + d.c3xx + d.c4xx + d.c5xx + d.cOther, 0);
                      const c5xx = cloudflareOverview.statusClassDaily.reduce((s, d) => s + d.c5xx, 0);
                      const pct = total > 0 ? ((c5xx / total) * 100).toFixed(1) : '0.0';
                      return { label: '5xx Rate', value: `${pct}% (${c5xx.toLocaleString()})`, color: '#dc2626' };
                    })(),
                    (() => {
                      const hit = cloudflareOverview.cacheResult.find(c => c.key === 'hit')?.count ?? 0;
                      const miss = cloudflareOverview.cacheResult.find(c => c.key === 'miss')?.count ?? 0;
                      const denom = hit + miss;
                      const pct = denom > 0 ? ((hit / denom) * 100).toFixed(1) : '—';
                      return { label: 'Cache Hit %', value: `${pct}%${denom > 0 ? ` (${hit.toLocaleString()}/${denom.toLocaleString()})` : ''}`, color: '#22c55e' };
                    })(),
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{
                      backgroundColor: 'rgba(255,255,255,0.97)',
                      padding: '0.6rem 0.8rem',
                      borderRadius: '10px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                    }}>
                      <div style={{ fontSize: '0.58rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color, fontFamily: 'monospace', marginTop: '0.15rem' }}>{value}</div>
                    </div>
                  ))}
                </div>

                <CloudflareChartsGrid
                  data={cloudflareOverview}
                  group="cloudflare"
                  zoomStart={cloudflareZoomStart}
                  zoomEnd={cloudflareZoomEnd}
                  onZoomChange={onCloudflareZoomChange}
                  chartSize={cloudflareChartSize}
                  showEdgeCharts
                />
              </>
            ) : (
              <ChartEmptyState message="No Cloudflare data for this window" />
            )}
          </div>
        )}

        {activeTab === 'langfuse' && (
          <div
            id="analytics-panel-langfuse"
            role="tabpanel"
            aria-labelledby="analytics-tab-langfuse"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.25rem' }}
          >
            <DateRangeSelector
              presets={['1d', '7d', '14d', '30d', 'custom'] as const}
              value={langfuseDatePreset}
              onValueChange={setLangfuseDatePreset}
              customStart={langfuseCustomStart}
              customEnd={langfuseCustomEnd}
              onCustomStartChange={setLangfuseCustomStart}
              onCustomEndChange={setLangfuseCustomEnd}
              onCustomApply={() => { /* memoized window reacts to state */ }}
            />
            <LangfuseInsightsPanel fromTimestamp={langfuseWindow.start} toTimestamp={langfuseWindow.end} />
          </div>
        )}

        {activeTab === 'c1' && (
          <div
            id="analytics-panel-c1"
            role="tabpanel"
            aria-labelledby="analytics-tab-c1"
            style={{ marginBottom: '1.25rem' }}
          >
            <DateRangeSelector
              presets={['1d', '7d', '14d', '30d', 'custom'] as const}
              value={c1DatePreset}
              onValueChange={setC1DatePreset}
              customStart={c1CustomStart}
              customEnd={c1CustomEnd}
              onCustomStartChange={setC1CustomStart}
              onCustomEndChange={setC1CustomEnd}
              onCustomApply={() => { /* memoized c1Period reacts to state */ }}
            />
            <C1AnalyticsPanel period={c1Period} />
          </div>
        )}

        {activeTab === 'feedback' && (
          <div
            id="analytics-panel-feedback"
            role="tabpanel"
            aria-labelledby="analytics-tab-feedback"
            style={{ marginBottom: '1.25rem' }}
          >
            <DateRangeSelector
              presets={['1d', '7d', '14d', '30d', 'custom'] as const}
              value={feedbackDatePreset}
              onValueChange={setFeedbackDatePreset}
              customStart={feedbackCustomStart}
              customEnd={feedbackCustomEnd}
              onCustomStartChange={setFeedbackCustomStart}
              onCustomEndChange={setFeedbackCustomEnd}
              onCustomApply={() => { /* FeedbackAnalyticsPanel props drive the fetch */ }}
            />
            <FeedbackAnalyticsPanel datePreset={feedbackDatePreset} customStart={feedbackCustomStart} customEnd={feedbackCustomEnd} />
          </div>
        )}

      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <ProtectedRoute>
      <AnalyticsContent />
    </ProtectedRoute>
  );
}
