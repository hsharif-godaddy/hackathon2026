'use client';

import Link from 'next/link';
import React, { useEffect, useState, useCallback } from 'react';

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

  function formatBytes(bytes: number) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB';
    if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB';
    return bytes + ' B';
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

  function formatFullTimestamp(dateStr: string) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Return original if invalid
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${mins}:${secs} ${ampm}`;
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

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '1rem 2vw' }}>
        <div style={{ width: '100%', maxWidth: '98vw', margin: '0 auto' }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '3rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⏳</div>
            <p style={{ color: '#64748b', margin: 0 }}>Loading analytics data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '1rem 2vw' }}>
        <div style={{ width: '100%', maxWidth: '98vw', margin: '0 auto' }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '12px', padding: '2rem', borderLeft: '4px solid #ef4444' }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#dc2626' }}>Error</h2>
            <p style={{ margin: 0, color: '#666' }}>{error}</p>
            <button
              onClick={fetchData}
              style={{
                marginTop: '1rem',
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
        </div>
      </div>
    );
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
              AI Agent usage and cost analytics
            </p>
          </div>

          {/* Date Range Selector */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {presetBtn('1d', '24h')}
            {presetBtn('7d', '7 days')}
            {presetBtn('14d', '14 days')}
            {presetBtn('30d', '30 days')}
            {presetBtn('custom', 'Custom')}
          </div>

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
            {schedulerStatus && (
              <div style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'right' }}>
                <div>
                  {schedulerStatus.running ? '🟢' : '🔴'} Scheduler
                  {schedulerStatus.isCurrentlyFetching && ' (syncing...)'}
                </div>
                {schedulerStatus.lastRun && (
                  <div style={{ marginTop: '0.15rem' }}>
                    Last: {formatTimestamp(schedulerStatus.lastRun.endTime)}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Custom Date Range */}
        {datePreset === 'custom' && (
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

        {/* Daily Stats Charts */}
        {summary && summary.daily_stats.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            marginBottom: '1.25rem'
          }}>
            {/* Apps/Day Chart */}
            {(() => {
              if (hourlyLoading) {
                return <ChartLoadingState />;
              }
              if (datePreset === '1d' && last24hStats) {
                return (
                  <MiniChart
                    title="Apps (Last 24h)"
                    value={`Total: ${last24hStats.hourly_stats.reduce((sum, h) => sum + h.apps, 0)}`}
                    valueColor="#3b82f6"
                    data={buildRolling24hChartData(last24hStats.hourly_stats, s => s.apps, (h, s) => `${h}h ago: ${s.apps} apps`)}
                    barColor="#60a5fa"
                  />
                );
              }
              if (hourlyData) {
                return (
                  <MiniChart
                    title="Apps/Hour"
                    value={`Total: ${hourlyData.hourly_stats.reduce((sum, h) => sum + h.apps, 0)}`}
                    valueColor="#3b82f6"
                    data={buildHourlyChartData(hourlyData.hourly_stats, s => s.apps, (h, s) => `${h}:00 - ${s.apps} apps`)}
                    barColor="#60a5fa"
                    showBack={true}
                    backAction={() => setHourlyData(null)}
                  />
                );
              }
              return (
                <MiniChart
                  title="Apps/Day"
                  value={`Avg: ${summary.apps_per_day.toFixed(1)}`}
                  valueColor="#3b82f6"
                  data={buildDailyChartData(summary.daily_stats, s => s.apps, (d, s) => `${formatShortDay(d)}: ${s.apps} apps`, formatShortDay)}
                  barColor="#3b82f6"
                  barColorLight="#60a5fa"
                  onClick={(i) => fetchHourlyData(summary.daily_stats[i].date)}
                />
              );
            })()}

            {/* Avg Cost/App Chart */}
            {(() => {
              if (datePreset === '1d' && last24hStats) {
                const totalCost = last24hStats.hourly_stats.reduce((sum, h) => sum + h.cost, 0);
                const totalApps = last24hStats.hourly_stats.reduce((sum, h) => sum + h.apps, 0);
                const avgCost = totalApps > 0 ? totalCost / totalApps : 0;
                return (
                  <MiniChart
                    title="Avg Cost/App (Last 24h)"
                    value={`Avg: ${formatCost(avgCost)}`}
                    valueColor="#059669"
                    data={buildRolling24hChartData(last24hStats.hourly_stats, s => s.apps > 0 ? s.cost / s.apps : 0, (h, s) => `${h}h ago: ${formatCost(s.apps > 0 ? s.cost / s.apps : 0)} (${s.apps} apps)`)}
                    barColor="#10b981"
                  />
                );
              }
              return (
                <MiniChart
                  title="Avg Cost/App"
                  value={`Avg: ${formatCost(summary.avg_cost_per_app)}`}
                  valueColor="#059669"
                  data={buildDailyChartData(summary.daily_stats, s => s.avg_cost_per_app, (d, s) => `${formatShortDay(d)}: ${formatCost(s.avg_cost_per_app)}`, formatShortDay)}
                  barColor="#059669"
                  barColorLight="#10b981"
                />
              );
            })()}

            {/* Avg Steps/Run Chart */}
            {(() => {
              if (datePreset === '1d' && last24hStats) {
                const totalSteps = last24hStats.hourly_stats.reduce((sum, h) => sum + h.steps, 0);
                const totalRuns = last24hStats.hourly_stats.reduce((sum, h) => sum + h.runs, 0);
                const avgSteps = totalRuns > 0 ? totalSteps / totalRuns : 0;
                return (
                  <MiniChart
                    title="Avg Steps/Run (Last 24h)"
                    value={`Avg: ${avgSteps.toFixed(1)}`}
                    valueColor="#8b5cf6"
                    data={buildRolling24hChartData(last24hStats.hourly_stats, s => s.runs > 0 ? s.steps / s.runs : 0, (h, s) => `${h}h ago: ${(s.runs > 0 ? s.steps / s.runs : 0).toFixed(1)} steps/run (${s.runs} runs)`)}
                    barColor="#a78bfa"
                  />
                );
              }
              return (
                <MiniChart
                  title="Avg Steps/Run"
                  value={`Avg: ${(summary.daily_stats.reduce((sum, d) => sum + d.avg_steps_per_run, 0) / summary.daily_stats.length).toFixed(1)}`}
                  valueColor="#8b5cf6"
                  data={buildDailyChartData(summary.daily_stats, s => s.avg_steps_per_run, (d, s) => `${formatShortDay(d)}: ${s.avg_steps_per_run.toFixed(1)} steps/run`, formatShortDay)}
                  barColor="#8b5cf6"
                  barColorLight="#a78bfa"
                />
              );
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

        {/* Filter */}
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.97)',
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          marginBottom: '1.25rem',
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)'
        }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔍 Filter by App ID..."
            style={{
              width: '100%',
              padding: '0.6rem 0.75rem',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              fontSize: '0.85rem',
              backgroundColor: '#f8fafc'
            }}
          />
        </div>

        {/* Apps Table */}
        <div style={{
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          overflow: 'hidden'
        }}>
          <div ref={tableContainerRef} onScroll={handleTableScroll} style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  <th style={thStyle} onClick={() => handleSort('first_event')} title="First agent activity timestamp for this app">
                    First {sortCol === 'first_event' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('last_event')} title="Most recent agent activity timestamp for this app">
                    Last {sortCol === 'last_event' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('app_id')} title="Unique application identifier">
                    App ID {sortCol === 'app_id' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={{ ...thStyle, cursor: 'default' }} title="Link to open app in builder">Link</th>
                  <th style={thStyle} onClick={() => handleSort('run_count')} title="Total number of agent runs (conversations)">
                    Runs {sortCol === 'run_count' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('total_steps')} title="Total LLM inference steps across all runs">
                    Steps {sortCol === 'total_steps' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('steps_per_run')} title="Average steps per run (total_steps / run_count)">
                    Steps/Run {sortCol === 'steps_per_run' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('total_cost')} title="Total estimated LLM cost in USD">
                    Cost {sortCol === 'total_cost' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('summarizations')} title="Number of context summarization events (memory optimization)">
                    Sums {sortCol === 'summarizations' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('token_limits')} title="Number of token limit warnings hit">
                    Limits {sortCol === 'token_limits' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('budget_errors')} title="Number of budget exceeded errors">
                    Budget {sortCol === 'budget_errors' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('ws_errors')} title="Number of WebSocket errors">
                    WS Err {sortCol === 'ws_errors' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('publish_failed')} title="Publish build/archive failures">
                    Pub Err {sortCol === 'publish_failed' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('client_errors')} title="Client-side errors (websocket, paywall)">
                    CS Err {sortCol === 'client_errors' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('errors')} title="Total error count across all runs">
                    Errors {sortCol === 'errors' && (sortAsc ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((app, idx) => (
                  <tr key={app.app_id} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {formatTimestamp(app.first_event)}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {formatTimestamp(app.last_event)}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      <Link
                        href={`/analytics/app/${app.app_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
                      >
                        {app.app_id}
                      </Link>
                    </td>
                    <td style={tdStyle}>
                      <a
                        href={`https://${app.app_id}.preview.c24.airoapp.ai`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#f97316', textDecoration: 'none', fontSize: '0.9rem' }}
                        title="Open preview"
                      >
                        ↗
                      </a>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{app.run_count}</td>
                    <td style={tdStyle}>{formatNumber(app.total_steps)}</td>
                    <td style={{ ...tdStyle, color: '#64748b' }}>
                      {app.run_count > 0 ? (app.total_steps / app.run_count).toFixed(1) : '-'}
                    </td>
                    <td style={{ ...tdStyle, color: '#059669', fontWeight: 600 }}>
                      {formatCost(app.total_cost)}
                    </td>
                    <td style={{ ...tdStyle, color: '#8b5cf6' }}>{app.summarizations}</td>
                    <td style={{ ...tdStyle, color: app.token_limits > 0 ? '#dc2626' : '#94a3b8' }}>
                      {app.token_limits}
                    </td>
                    <td style={{ ...tdStyle, color: app.budget_errors > 0 ? '#dc2626' : '#94a3b8', fontWeight: app.budget_errors > 0 ? 600 : 400 }}>
                      {app.budget_errors}
                    </td>
                    <td style={{ ...tdStyle, color: app.ws_errors > 0 ? '#dc2626' : '#94a3b8', fontWeight: app.ws_errors > 0 ? 600 : 400 }}>
                      {app.ws_errors}
                    </td>
                    <td style={{ ...tdStyle, color: app.publish_failed > 0 ? '#dc2626' : '#94a3b8', fontWeight: app.publish_failed > 0 ? 600 : 400 }}>
                      {app.publish_total > 0 ? `${app.publish_failed}/${app.publish_total}` : '-'}
                    </td>
                    <td style={{ ...tdStyle, color: app.client_errors > 0 ? '#f97316' : '#94a3b8', fontWeight: app.client_errors > 0 ? 600 : 400 }}>
                      {app.client_errors || 0}
                    </td>
                    <td style={{ ...tdStyle, color: app.errors > 0 ? '#dc2626' : '#94a3b8' }}>
                      {app.errors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sorted.length === 0 && (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
              {filter ? 'No apps match the filter' : 'No analytics data available for selected date range'}
            </div>
          )}
          {sorted.length > 0 && (
            <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '0.75rem', color: '#64748b' }}>
              Showing {displayed.length} of {sorted.length} apps{filter && ` (filtered from ${apps.length})`}{hasMore && ' — scroll for more'}
            </div>
          )}
        </div>
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
