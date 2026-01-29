'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';

import MetricsTrendsCard from '@/components/MetricsTrendsCard';
import ProtectedRoute from '@/components/ProtectedRoute';

interface AppData {
  app_id: string;
  run_count: number;
  total_steps: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  first_event: string;
  last_event: string;
  summarizations: number;
  compressions: number;
  errors: number;
  token_limits: number;
  budget_errors: number;
  ws_errors: number;
  publish_total: number;
  publish_success: number;
  publish_failed: number;
  client_errors: number;
}

interface DailyStat {
  date: string;
  apps: number;
  cost: number;
  runs: number;
  steps: number;
  avg_cost_per_app: number;
  avg_steps_per_run: number;
}

interface Summary {
  total_apps: number;
  apps_per_day: number;
  total_runs: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost: number;
  start_date: string;
  end_date: string;
  avg_cost_per_app: number;
  daily_stats: DailyStat[];
}

interface SchedulerStatus {
  running: boolean;
  isCurrentlyFetching: boolean;
  lastRun: {
    startTime: string;
    endTime: string;
    counts: Record<string, number>;
  } | null;
}

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

interface Last24HoursStats {
  start: string;
  end: string;
  hourly_stats: Array<{ hoursAgo: number; timestamp: string; apps: number; runs: number; cost: number; steps: number }>;
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

const MAX_DATE_RANGE_DAYS = 31;

function isDateRangeValid(start: string, end: string): boolean {
  if (!start || !end) return false;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= MAX_DATE_RANGE_DAYS;
}

function getDateRangeError(start: string, end: string): string | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 'End date must be after start date';
  if (diffDays > MAX_DATE_RANGE_DAYS) return `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`;
  return null;
}

function AnalyticsContent() {
  const [apps, setApps] = useState<AppData[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<keyof AppData | 'steps_per_run'>('last_event');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');

  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>('1d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

  // Hourly drilldown state
  const [hourlyData, setHourlyData] = useState<{ date: string; hourly_stats: Array<{ hour: number; apps: number; runs: number; cost: number; steps: number; avg_steps_per_run: number }> } | null>(null);
  const [hourlyLoading, setHourlyLoading] = useState(false);

  // Error stats state
  const [errorStats, setErrorStats] = useState<ErrorStats | null>(null);
  const [hourlyWsErrorData, setHourlyWsErrorData] = useState<HourlyErrorStats | null>(null);
  const [hourlyBudgetErrorData, setHourlyBudgetErrorData] = useState<HourlyErrorStats | null>(null);
  const [hourlyWsErrorLoading, setHourlyWsErrorLoading] = useState(false);
  const [hourlyBudgetErrorLoading, setHourlyBudgetErrorLoading] = useState(false);

  // Last 24 hours rolling window stats
  const [last24hStats, setLast24hStats] = useState<Last24HoursStats | null>(null);
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

  // Pagination state
  const [displayCount, setDisplayCount] = useState(100);
  const tableContainerRef = React.useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async function fetchData() {
    try {
      setLoading(true);

      let start: string;
      let end: string;

      if (datePreset === 'custom' && customStart && customEnd) {
        start = new Date(customStart).toISOString();
        end = new Date(customEnd + 'T23:59:59').toISOString();
      } else {
        const range = getDateRange(datePreset);
        start = range.start.toISOString();
        end = range.end.toISOString();
      }

      const params = new URLSearchParams({ start, end });

      const [appsRes, summaryRes, statusRes, errorsRes, sumRes, pubRes, clientErrRes] = await Promise.all([
        fetch(`/api/analytics?action=apps&${params}`),
        fetch(`/api/analytics?action=summary&${params}`),
        fetch('/api/analytics?action=scheduler-status'),
        fetch(`/api/analytics?action=errors&${params}`),
        fetch(`/api/analytics?action=summarizations&${params}`),
        fetch(`/api/analytics?action=publish&${params}`),
        fetch(`/api/analytics?action=client-errors&${params}`)
      ]);

      if (!appsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      setApps(await appsRes.json());
      setSummary(await summaryRes.json());
      setSchedulerStatus(await statusRes.json());
      if (errorsRes.ok) {
        setErrorStats(await errorsRes.json());
      }
      if (sumRes.ok) {
        setSummarizationStats(await sumRes.json());
      }
      if (pubRes.ok) {
        setPublishStats(await pubRes.json());
      }
      if (clientErrRes.ok) {
        setClientErrorStats(await clientErrRes.json());
      }
      setError(null);

      // Auto-fetch rolling 24h hourly data when 24h is selected
      if (datePreset === '1d') {
        const [last24hRes, last24hWsRes, last24hBudgetRes, last24hSumRes, last24hPubRes, last24hClientErrRes] = await Promise.all([
          fetch('/api/analytics?action=last-24h'),
          fetch('/api/analytics?action=last-24h-errors&errorType=websocket'),
          fetch('/api/analytics?action=last-24h-errors&errorType=budget'),
          fetch('/api/analytics?action=last-24h-summarizations'),
          fetch('/api/analytics?action=last-24h-publish'),
          fetch('/api/analytics?action=last-24h-client-errors')
        ]);
        if (last24hRes.ok) setLast24hStats(await last24hRes.json());
        if (last24hWsRes.ok) setLast24hWsErrors(await last24hWsRes.json());
        if (last24hBudgetRes.ok) setLast24hBudgetErrors(await last24hBudgetRes.json());
        if (last24hSumRes.ok) setLast24hSummarizations(await last24hSumRes.json());
        if (last24hPubRes.ok) setLast24hPublish(await last24hPubRes.json());
        if (last24hClientErrRes.ok) setLast24hClientErrors(await last24hClientErrRes.json());
        // Clear day-based hourly data
        setHourlyData(null);
        setHourlyWsErrorData(null);
        setHourlyBudgetErrorData(null);
        setHourlySummarizationData(null);
        setHourlyPublishData(null);
        setHourlyClientErrorData(null);
      } else {
        // Clear rolling 24h data for non-24h views
        setLast24hStats(null);
        setLast24hWsErrors(null);
        setLast24hBudgetErrors(null);
        setLast24hSummarizations(null);
        setLast24hClientErrors(null);
        setHourlyData(null);
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

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    async function initFetch() {
      await fetchData();
    }

    initFetch();

    const interval = setInterval(async function refreshStatus() {
      if (!isMounted) return;
      try {
        const res = await fetch('/api/analytics?action=scheduler-status', { signal: abortController.signal });
        if (res.ok && isMounted) {
          setSchedulerStatus(await res.json());
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('analytics.scheduler.status.failed', { error: String(err) });
        }
      }
    }, 30000);

    return () => {
      isMounted = false;
      abortController.abort();
      clearInterval(interval);
    };
  }, [fetchData]);


  async function fetchHourlyData(date: string) {
    setHourlyLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=hourly&date=${encodeURIComponent(date)}`);
      if (res.ok) {
        setHourlyData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch hourly data:', err);
    } finally {
      setHourlyLoading(false);
    }
  }

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

  function handleSort(col: keyof AppData | 'steps_per_run') {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  }

  function formatCost(cost: number) {
    return `$${cost.toFixed(2)}`;
  }

  function formatTimestamp(dateStr: string) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${mins}`;
  }


  function formatShortDay(dateStr: string) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function formatNumber(n: number) {
    return n.toLocaleString();
  }

  const filtered = apps.filter(a =>
    !filter || a.app_id.toLowerCase().includes(filter.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    let av: number | string = a[sortCol as keyof AppData] as number | string;
    let bv: number | string = b[sortCol as keyof AppData] as number | string;

    if (sortCol === 'steps_per_run') {
      av = a.run_count > 0 ? a.total_steps / a.run_count : 0;
      bv = b.run_count > 0 ? b.total_steps / b.run_count : 0;
    }

    if (typeof av === 'string' && typeof bv === 'string') {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  // Paginated display
  const displayed = sorted.slice(0, displayCount);
  const hasMore = displayCount < sorted.length;

  // Handle scroll to load more
  const handleTableScroll = useCallback(function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 100 && hasMore) {
      setDisplayCount(prev => Math.min(prev + 100, sorted.length));
    }
  }, [hasMore, sorted.length]);

  // Reset display count when filter/sort changes
  useEffect(() => {
    setDisplayCount(100);
  }, [filter, sortCol, sortAsc, datePreset, customStart, customEnd]);

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

  const thStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    textAlign: 'left',
    borderBottom: '2px solid #e5e7eb',
    cursor: 'pointer',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap'
  };

  const tdStyle: React.CSSProperties = {
    padding: '0.6rem 0.75rem',
    borderBottom: '1px solid #f3f4f6',
    fontSize: '0.8rem'
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '1rem 2vw' }}>
      <div style={{ width: '100%', maxWidth: '98vw', margin: '0 auto' }}>
        {/* Metrics Trends Card - Always visible, independent of other API calls */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}>
          <MetricsTrendsCard />
        </div>

        {/* Loading State */}
        {loading && (
          <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '3rem', textAlign: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
            <p style={{ color: '#64748b', margin: 0 }}>Loading analytics data...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '2rem', borderLeft: '4px solid #ef4444', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#dc2626' }}>Error Loading Analytics</h2>
            <p style={{ margin: '0 0 1rem 0', color: '#666' }}>{error}</p>
            <button
              onClick={fetchData}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Analytics Content - Only shown when not loading and no error */}
        {!loading && !error && (
          <div style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>
            <p>Analytics dashboard content will be displayed here</p>
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
