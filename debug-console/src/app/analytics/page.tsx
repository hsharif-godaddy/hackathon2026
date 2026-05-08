'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import C1AnalyticsPanel from '@/components/C1AnalyticsPanel';
import FeedbackAnalyticsPanel from '@/components/FeedbackAnalyticsPanel';
import LangfuseInsightsPanel from '@/components/LangfuseInsightsPanel';
import ProtectedRoute from '@/components/ProtectedRoute';

import type { C1Period } from '@/lib/c1-analytics-server';
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

// Chart density thresholds for label frequency
const DAILY_VIEW_MAX_POINTS = 7;   // Weekly view: show all labels
const WEEKLY_VIEW_MAX_POINTS = 14; // Bi-weekly view: show every other label

// Bar sizing for visual density at different data point counts
const BAR_WIDTH_DAILY = '40px';   // Wide bars for ≤7 points
const BAR_WIDTH_WEEKLY = '28px';  // Medium bars for 8-14 points
const BAR_WIDTH_HOURLY = '14px';  // Narrow bars for >14 points
const BAR_GAP_SPARSE = '3px';     // Gap for ≤14 points
const BAR_GAP_DENSE = '1px';      // Gap for >14 points

const chartLoadingStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  padding: '1rem 1.25rem',
  borderRadius: '10px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '120px',
  color: '#64748b'
};

const chartEmptyStyle: React.CSSProperties = {
  ...chartLoadingStyle,
  color: '#94a3b8',
  fontSize: '0.75rem'
};

function ChartLoadingState() {
  return <div style={chartLoadingStyle}>Loading...</div>;
}

function ChartEmptyState({ message }: { message: string }) {
  return <div style={chartEmptyStyle}>{message}</div>;
}

interface MiniChartProps {
  title: string;
  value: string;
  valueColor: string;
  data: Array<{ value: number; label: string; tooltip: string }>;
  barColor: string;
  barColorLight?: string;
  onClick?: (index: number) => void;
  backAction?: () => void;
  showBack?: boolean;
}

function MiniChart({ title, value, valueColor, data, barColor, barColorLight, onClick, backAction, showBack }: MiniChartProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const barHeight = 70;

  const labelInterval = data.length <= DAILY_VIEW_MAX_POINTS ? 1 : data.length <= WEEKLY_VIEW_MAX_POINTS ? 2 : 4;
  const barMaxWidth = data.length <= DAILY_VIEW_MAX_POINTS ? BAR_WIDTH_DAILY : data.length <= WEEKLY_VIEW_MAX_POINTS ? BAR_WIDTH_WEEKLY : BAR_WIDTH_HOURLY;
  const barGap = data.length <= WEEKLY_VIEW_MAX_POINTS ? BAR_GAP_SPARSE : BAR_GAP_DENSE;

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.97)',
      padding: '1rem 1.25rem',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.08)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {title}
          {showBack && backAction && (
            <span style={{ fontSize: '0.6rem', color: valueColor, cursor: 'pointer', fontWeight: 500 }} onClick={backAction}>← back</span>
          )}
        </div>
        <div style={{ fontSize: '1rem', fontWeight: 700, color: valueColor }}>
          {value}
        </div>
      </div>

      {/* Chart Area */}
      <div style={{ position: 'relative', height: `${barHeight + 20}px` }}>
        {/* Grid lines */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barHeight, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ borderBottom: '1px solid #f1f5f9', width: '100%' }} />
          ))}
        </div>

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', height: barHeight, gap: barGap, position: 'relative', zIndex: 1 }}>
          {data.map((d, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: onClick ? 'pointer' : 'default'
              }}
              onClick={onClick ? () => onClick(i) : undefined}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: barMaxWidth,
                  height: `${(d.value / maxValue) * barHeight}px`,
                  backgroundColor: onClick ? barColor : (barColorLight || barColor),
                  borderRadius: '2px 2px 0 0',
                  minHeight: d.value > 0 ? '3px' : '0',
                  transition: 'opacity 0.15s, transform 0.1s',
                  transformOrigin: 'bottom'
                }}
                title={d.tooltip}
                onMouseOver={(e) => {
                  e.currentTarget.style.opacity = '0.85';
                  e.currentTarget.style.transform = 'scaleY(1.02)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.transform = 'scaleY(1)';
                }}
              />
            </div>
          ))}
        </div>

        {/* X-axis labels */}
        <div style={{ display: 'flex', height: '20px', alignItems: 'flex-start', paddingTop: '4px' }}>
          {data.map((d, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              {i % labelInterval === 0 && (
                <span style={{ fontSize: '0.55rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                  {d.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
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

type DatePreset = '1d' | '7d' | '14d' | '30d' | 'custom';

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
    case '1d':
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000); // 6 days back + today = 7 total
      break;
    case '14d':
      start = new Date(now.getTime() - 13 * 24 * 60 * 60 * 1000); // 13 days back + today = 14 total
      break;
    case '30d':
      start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000); // 29 days back + today = 30 total
      break;
    default:
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ANALYTICS_TAB_IDS = ['apps', 'langfuse', 'c1', 'feedback'] as const;
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
  appsCreatedDaily: Array<{ date: string; created: number }>;
  appsDeletedDaily: Array<{ date: string; deleted: number }>;
  uniqueCustomersDaily: Array<{ date: string; uniqueCustomers: number }>;
  statuses: Record<string, number>;
  plans: Record<string, number>;
}

function AnalyticsContent() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>('1d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  const langfuseWindow = useMemo(() => {
    if (datePreset === 'custom' && customStart && customEnd) {
      return {
        start: new Date(`${customStart}T00:00:00.000Z`).toISOString(),
        end: new Date(`${customEnd}T23:59:59.999Z`).toISOString(),
      };
    }
    const range = getDateRange(datePreset);
    return { start: range.start.toISOString(), end: range.end.toISOString() };
  }, [datePreset, customStart, customEnd]);

  const c1Period = useMemo(
    () => datePresetToC1Period(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd],
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

  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<AnalyticsTabId>('apps');
  const [visitedTabs, setVisitedTabs] = useState(() => new Set<AnalyticsTabId>(['apps']));

  useEffect(() => {
    const tab = parseAnalyticsTab(searchParams?.get('tab') ?? undefined);
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [searchParams]);

  const showDateRangeControls =
    activeTab === 'apps' || activeTab === 'langfuse' || activeTab === 'c1' || activeTab === 'feedback';

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
    if (datePreset === 'custom' && customStart && customEnd && isDateRangeValid(customStart, customEnd)) {
      startDate = customStart;
      endDate = customEnd;
    } else {
      const range = getDateRange(datePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }

    return pdnaSnapshot.appsCreatedDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, datePreset, customStart, customEnd]);

  const pdnaAppsDeletedInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];

    let startDate: string;
    let endDate: string;
    if (datePreset === 'custom' && customStart && customEnd && isDateRangeValid(customStart, customEnd)) {
      startDate = customStart;
      endDate = customEnd;
    } else {
      const range = getDateRange(datePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }

    return pdnaSnapshot.appsDeletedDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, datePreset, customStart, customEnd]);

  const pdnaUniqueCustomersInRange = useMemo(() => {
    if (!pdnaSnapshot) return [];

    let startDate: string;
    let endDate: string;
    if (datePreset === 'custom' && customStart && customEnd && isDateRangeValid(customStart, customEnd)) {
      startDate = customStart;
      endDate = customEnd;
    } else {
      const range = getDateRange(datePreset);
      startDate = formatDateInput(range.start);
      endDate = formatDateInput(range.end);
    }

    return pdnaSnapshot.uniqueCustomersDaily.filter((day) => day.date >= startDate && day.date <= endDate);
  }, [pdnaSnapshot, datePreset, customStart, customEnd]);

  const fetchData = useCallback(async function fetchData() {
    try {
      setLoading(true);

      let start: string;
      let end: string;

      if (datePreset === 'custom' && customStart && customEnd) {
        start = new Date(`${customStart}T00:00:00.000Z`).toISOString();
        end = new Date(`${customEnd}T23:59:59.999Z`).toISOString();
      } else {
        const range = getDateRange(datePreset);
        start = range.start.toISOString();
        end = range.end.toISOString();
      }

      const params = new URLSearchParams({ start, end });
      const shouldFetchDailyEventCharts = datePreset !== '1d';

      const [errorsRes, budgetErrorsRes, sumRes, pubRes, clientErrRes] = await Promise.all([
        fetch(`/api/analytics?action=errors&${params}`),
        fetch(`/api/analytics?action=budget-errors&${params}`),
        shouldFetchDailyEventCharts ? fetch(`/api/analytics?action=summarizations&${params}`) : Promise.resolve(null),
        shouldFetchDailyEventCharts ? fetch(`/api/analytics?action=publish&${params}`) : Promise.resolve(null),
        fetch(`/api/analytics?action=client-errors&${params}`)
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
      setError(null);

      // Auto-fetch rolling 24h hourly data when 24h is selected
      if (datePreset === '1d') {
        const [last24hWsRes, last24hBudgetRes, last24hSumRes, last24hPubRes, last24hClientErrRes] = await Promise.all([
          fetch('/api/analytics?action=last-24h-errors&errorType=websocket'),
          fetch('/api/analytics?action=last-24h-errors&errorType=budget'),
          fetch('/api/analytics?action=last-24h-summarizations'),
          fetch('/api/analytics?action=last-24h-publish'),
          fetch('/api/analytics?action=last-24h-client-errors')
        ]);
        if (last24hWsRes.ok) setLast24hWsErrors(await last24hWsRes.json());
        if (last24hBudgetRes.ok) setLast24hBudgetErrors(await last24hBudgetRes.json());
        if (last24hSumRes.ok) setLast24hSummarizations(await last24hSumRes.json());
        if (last24hPubRes.ok) setLast24hPublish(await last24hPubRes.json());
        if (last24hClientErrRes.ok) setLast24hClientErrors(await last24hClientErrRes.json());
        setHourlyWsErrorData(null);
        setHourlyBudgetErrorData(null);
        setHourlySummarizationData(null);
        setHourlyPublishData(null);
        setHourlyClientErrorData(null);
      } else {
        setLast24hWsErrors(null);
        setLast24hBudgetErrors(null);
        setLast24hSummarizations(null);
        setLast24hClientErrors(null);
        setHourlyWsErrorData(null);
        setHourlyBudgetErrorData(null);
        setHourlySummarizationData(null);
        setHourlyClientErrorData(null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [datePreset, customStart, customEnd]);

  // Fetch app analytics data when Apps tab is active
  useEffect(() => {
    if (activeTab !== 'apps') return;
    fetchData();
  }, [activeTab, fetchData]);

  // Fetch PDNA latest snapshot when Apps tab is active (skip if already loaded)
  // PDNA is a complete daily dump — no date range needed, just the latest snapshot
  useEffect(() => {
    if (activeTab !== 'apps' || pdnaSnapshot) return;
    setPdnaLoading(true);
    setPdnaError(null);
    fetch('/api/analytics?action=pdna-snapshot')
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
  }, [activeTab, pdnaSnapshot]);

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


  function formatShortDay(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // Preset button style
  const presetBtn = (preset: DatePreset, label: string) => (
    <button
      onClick={() => setDatePreset(preset)}
      style={{
        padding: '0.4rem 0.75rem',
        backgroundColor: datePreset === preset ? '#1d4ed8' : '#f3f4f6',
        color: datePreset === preset ? 'white' : '#374151',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '0.8rem',
        fontWeight: 500,
        transition: 'all 0.15s'
      }}
    >
      {label}
    </button>
  );

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

          {/* Date Range Selector - only when charts expanded */}
          {showDateRangeControls && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {presetBtn('1d', '24h')}
              {presetBtn('7d', '7 days')}
              {presetBtn('14d', '14 days')}
              {presetBtn('30d', '30 days')}
              {presetBtn('custom', 'Custom')}
            </div>
          )}

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

        {/* Custom Date Range — shown when any section is open */}
        {showDateRangeControls && datePreset === 'custom' && (
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.97)',
            padding: '1rem 1.5rem',
            borderRadius: '12px',
            marginBottom: '1.25rem',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <label style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>From:</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              max={customEnd || formatDateInput(new Date())}
              style={{
                padding: '0.4rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.8rem'
              }}
            />
            <label style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500 }}>To:</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              min={customStart}
              max={formatDateInput(new Date())}
              style={{
                padding: '0.4rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.8rem'
              }}
            />
            <button
              onClick={fetchData}
              disabled={!customStart || !customEnd || !isDateRangeValid(customStart, customEnd)}
              style={{
                padding: '0.4rem 1rem',
                backgroundColor: customStart && customEnd && isDateRangeValid(customStart, customEnd) ? '#1d4ed8' : '#94a3b8',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: customStart && customEnd && isDateRangeValid(customStart, customEnd) ? 'pointer' : 'not-allowed',
                fontSize: '0.8rem',
                fontWeight: 500
              }}
            >
              Apply
            </button>
            {getDateRangeError(customStart, customEnd) && (
              <span style={{ color: '#dc2626', fontSize: '0.75rem', fontWeight: 500 }}>
                {getDateRangeError(customStart, customEnd)}
              </span>
            )}
          </div>
        )}

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
            {(errorStats || summarizationStats || publishStats || clientErrorStats || pdnaSnapshot || pdnaLoading || pdnaError) && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            marginBottom: '1.25rem'
          }}>
            {/* Apps Created Chart */}
            {(() => {
              if (pdnaLoading) {
                return <ChartLoadingState />;
              }
              if (pdnaAppsCreatedInRange.length > 0) {
                const totalCreated = pdnaAppsCreatedInRange.reduce((sum, day) => sum + day.created, 0);
                return (
                  <MiniChart
                    title="Apps Created"
                    value={`Total: ${totalCreated.toLocaleString()}`}
                    valueColor="#3b82f6"
                    data={buildDailyChartData(pdnaAppsCreatedInRange, s => s.created, (d, s) => `${formatShortDay(d)}: ${s.created} created`, formatShortDay)}
                    barColor="#3b82f6"
                    barColorLight="#60a5fa"
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA app creation data'} />;
            })()}

            {/* Apps Deleted Chart */}
            {(() => {
              if (pdnaLoading) {
                return <ChartLoadingState />;
              }
              if (pdnaAppsDeletedInRange.length > 0) {
                return (
                  <MiniChart
                    title="Apps Deleted"
                    value={`Total: ${pdnaAppsDeletedInRange.reduce((s, d) => s + d.deleted, 0).toLocaleString()}`}
                    valueColor="#dc2626"
                    data={buildDailyChartData(pdnaAppsDeletedInRange, s => s.deleted, (d, s) => `${formatShortDay(d)}: ${s.deleted} deleted`, formatShortDay)}
                    barColor="#dc2626"
                    barColorLight="#f87171"
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA app deletion data'} />;
            })()}

            {/* Unique Customers Chart */}
            {(() => {
              if (pdnaLoading) {
                return <ChartLoadingState />;
              }
              if (pdnaUniqueCustomersInRange.length > 0) {
                return (
                  <MiniChart
                    title="Unique Customers"
                    value={`Total: ${pdnaUniqueCustomersInRange.reduce((s, d) => s + d.uniqueCustomers, 0).toLocaleString()}`}
                    valueColor="#7c3aed"
                    data={buildDailyChartData(pdnaUniqueCustomersInRange, s => s.uniqueCustomers, (d, s) => `${formatShortDay(d)}: ${s.uniqueCustomers} customers`, formatShortDay)}
                    barColor="#7c3aed"
                    barColorLight="#a78bfa"
                  />
                );
              }
              return <ChartEmptyState message={pdnaError || 'No PDNA unique customer data'} />;
            })()}

            {/* WebSocket Errors/Day Chart */}
            {(() => {
              if (hourlyWsErrorLoading) {
                return <ChartLoadingState />;
              }
              if (datePreset === '1d' && last24hWsErrors) {
                return (
                  <MiniChart
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
                  <MiniChart
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
                  <MiniChart
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
              if (hourlyBudgetErrorLoading) {
                return <ChartLoadingState />;
              }
              if (datePreset === '1d' && last24hBudgetErrors) {
                return (
                  <MiniChart
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
                  <MiniChart
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
                  <MiniChart
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
              if (hourlySummarizationLoading) {
                return <ChartLoadingState />;
              }
              if (datePreset === '1d' && last24hSummarizations) {
                return (
                  <MiniChart
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
                  <MiniChart
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
                  <MiniChart
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

              if (hourlyPublishLoading) {
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
                  <MiniChart
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
              if (datePreset === '1d' && last24hPublish?.hourly_stats) {
                const totalBegins = last24hPublish.hourly_stats.reduce((a, h) => a + h.begins, 0);
                const totalSuccesses = last24hPublish.hourly_stats.reduce((a, h) => a + h.successes, 0);
                const overallRate = calcRate(totalSuccesses, totalBegins);
                return (
                  <MiniChart
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
                  <MiniChart
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
              if (hourlyClientErrorLoading) {
                return <ChartLoadingState />;
              }
              if (hourlyClientErrorData?.hourly_stats) {
                const total = hourlyClientErrorData.hourly_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <MiniChart
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
              if (datePreset === '1d' && last24hClientErrors?.hourly_stats) {
                const total = last24hClientErrors.hourly_stats.reduce((a, h) => a + h.errors, 0);
                return (
                  <MiniChart
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
                  <MiniChart
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

          </div>
            )}
            {pdnaLoading ? (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: '10px', padding: '2rem', textAlign: 'center', marginBottom: '1.25rem' }}>
                <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Loading PDNA snapshot...</span>
              </div>
            ) : pdnaError ? (
              <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '10px', padding: '1.5rem', borderLeft: '4px solid #ef4444', marginBottom: '1.25rem' }}>
                <p style={{ margin: '0 0 0.5rem 0', color: '#dc2626', fontWeight: 600, fontSize: '0.85rem' }}>PDNA Error</p>
                <p style={{ margin: 0, color: '#666', fontSize: '0.8rem' }}>{pdnaError}</p>
              </div>
            ) : pdnaSnapshot ? (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}>
                  {[
                    { label: 'Snapshot Date', value: pdnaSnapshot.snapshotDate, color: '#475569' },
                    { label: 'Total Apps', value: pdnaSnapshot.totalApps.toLocaleString(), color: '#1d4ed8' },
                    { label: 'Published', value: `${pdnaSnapshot.publishedCount.toLocaleString()} (${pdnaSnapshot.publishRate}%)`, color: '#0d9488' },
                    { label: 'Hibernated', value: `${pdnaSnapshot.hibernatedCount.toLocaleString()} (${pdnaSnapshot.hibernationRate}%)`, color: '#be185d' },
                    { label: 'Deleted', value: pdnaSnapshot.deletedCount.toLocaleString(), color: '#dc2626' },
                    ...Object.entries(pdnaSnapshot.statuses).map(([status, count]) => ({
                      label: status.charAt(0).toUpperCase() + status.slice(1),
                      value: count.toLocaleString(),
                      color: status === 'active' ? '#16a34a' : status === 'cancelled' ? '#dc2626' : '#d97706',
                    })),
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{
                      backgroundColor: 'rgba(255,255,255,0.97)',
                      padding: '0.75rem 1rem',
                      borderRadius: '10px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                    }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
                    </div>
                  ))}
                </div>

                {Object.keys(pdnaSnapshot.plans).length > 0 && (
                  <div style={{
                    backgroundColor: 'rgba(255,255,255,0.97)',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                    marginBottom: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1.5rem',
                    flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Plans</span>
                    {Object.entries(pdnaSnapshot.plans).sort((a, b) => b[1] - a[1]).map(([plan, count]) => (
                      <span key={plan} style={{ fontSize: '0.8rem', color: '#374151' }}>
                        <strong style={{ fontFamily: 'monospace' }}>{plan}</strong>: {count.toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}

              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'langfuse' && (
          <div
            id="analytics-panel-langfuse"
            role="tabpanel"
            aria-labelledby="analytics-tab-langfuse"
            style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.25rem' }}
          >
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>
              Uses the date range from the page header (presets or custom).
            </p>
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
            <FeedbackAnalyticsPanel datePreset={datePreset} customStart={customStart} customEnd={customEnd} />
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
