'use client';

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
}

interface DailyStat {
  date: string;
  apps: number;
  cost: number;
  avg_cost_per_app: number;
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

interface TimelineEntry {
  timestamp: string;
  type: string;
  detail?: string;
  steps?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
  extra_info?: string;
}

interface AgentBreakdown {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  steps: number;
  run_count: number;
  cost: number;
}

interface ToolUsage {
  tool_name: string;
  count: number;
}

interface AppDetails {
  app_id: string;
  run_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_steps: number;
  total_cost: number;
  agent_breakdown: AgentBreakdown[];
  timeline: TimelineEntry[];
  tool_usage: ToolUsage[];
  compression_stats: {
    events: number;
    total_saved_bytes: number;
    avg_compression_ratio: number;
  };
  summarization_stats: {
    total: number;
    successful: number;
    failed: number;
    avg_compression_ratio: number;
  };
  errors: unknown[];
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
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '14d':
      start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function AnalyticsContent() {
  const [apps, setApps] = useState<AppData[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<keyof AppData | 'steps_per_run'>('total_cost');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedApp, setSelectedApp] = useState<AppDetails | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>('1d');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');

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

      const [appsRes, summaryRes, statusRes] = await Promise.all([
        fetch(`/api/analytics?action=apps&${params}`),
        fetch(`/api/analytics?action=summary&${params}`),
        fetch('/api/analytics?action=scheduler-status')
      ]);

      if (!appsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      setApps(await appsRes.json());
      setSummary(await summaryRes.json());
      setSchedulerStatus(await statusRes.json());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [datePreset, customStart, customEnd]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchSchedulerStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  async function fetchSchedulerStatus() {
    try {
      const res = await fetch('/api/analytics?action=scheduler-status');
      if (res.ok) {
        setSchedulerStatus(await res.json());
      }
    } catch {
      // Ignore status fetch errors
    }
  }

  async function showAppDetails(appId: string) {
    setModalLoading(true);
    try {
      const res = await fetch(`/api/analytics/${appId}`);
      if (res.ok) {
        setSelectedApp(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch app details:', err);
    } finally {
      setModalLoading(false);
    }
  }

  function closeModal() {
    setSelectedApp(null);
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
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '2rem' }}>
        <div style={{ maxWidth: '1500px', margin: '0 auto' }}>
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
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '2rem' }}>
        <div style={{ maxWidth: '1500px', margin: '0 auto' }}>
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
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', padding: '1.5rem' }}>
      <div style={{ maxWidth: '1500px', margin: '0 auto' }}>
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
              disabled={!customStart || !customEnd}
              style={{
                padding: '0.4rem 1rem',
                backgroundColor: customStart && customEnd ? '#1d4ed8' : '#94a3b8',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: customStart && customEnd ? 'pointer' : 'not-allowed',
                fontSize: '0.8rem',
                fontWeight: 500
              }}
            >
              Apply
            </button>
          </div>
        )}

        {/* Daily Stats Charts */}
        {summary && summary.daily_stats.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '1rem',
            marginBottom: '1.25rem'
          }}>
            {/* Apps/Day Chart */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.97)',
              padding: '1rem 1.25rem',
              borderRadius: '10px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.08)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Apps/Day
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3b82f6' }}>
                  Avg: {summary.apps_per_day.toFixed(1)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '80px' }}>
                {(() => {
                  const maxApps = Math.max(...summary.daily_stats.map(d => d.apps), 1);
                  return summary.daily_stats.map((day, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        style={{
                          width: '100%',
                          height: `${(day.apps / maxApps) * 70}px`,
                          backgroundColor: '#3b82f6',
                          borderRadius: '2px 2px 0 0',
                          minHeight: day.apps > 0 ? '4px' : '0'
                        }}
                        title={`${formatShortDay(day.date)}: ${day.apps} apps`}
                      />
                      <div style={{ fontSize: '0.55rem', color: '#94a3b8', marginTop: '2px' }}>
                        {formatShortDay(day.date)}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Avg Cost/App Chart */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.97)',
              padding: '1rem 1.25rem',
              borderRadius: '10px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.08)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Avg Cost/App
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669' }}>
                  Avg: {formatCost(summary.avg_cost_per_app)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '80px' }}>
                {(() => {
                  const maxCost = Math.max(...summary.daily_stats.map(d => d.avg_cost_per_app), 0.01);
                  return summary.daily_stats.map((day, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div
                        style={{
                          width: '100%',
                          height: `${(day.avg_cost_per_app / maxCost) * 70}px`,
                          backgroundColor: '#059669',
                          borderRadius: '2px 2px 0 0',
                          minHeight: day.avg_cost_per_app > 0 ? '4px' : '0'
                        }}
                        title={`${formatShortDay(day.date)}: ${formatCost(day.avg_cost_per_app)}`}
                      />
                      <div style={{ fontSize: '0.55rem', color: '#94a3b8', marginTop: '2px' }}>
                        {formatShortDay(day.date)}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  <th style={thStyle} onClick={() => handleSort('first_event')}>
                    First {sortCol === 'first_event' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('last_event')}>
                    Last {sortCol === 'last_event' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('app_id')}>
                    App ID {sortCol === 'app_id' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={{ ...thStyle, cursor: 'default' }}>Link</th>
                  <th style={thStyle} onClick={() => handleSort('run_count')}>
                    Runs {sortCol === 'run_count' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('total_steps')}>
                    Steps {sortCol === 'total_steps' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('steps_per_run')}>
                    Steps/Run {sortCol === 'steps_per_run' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('total_cost')}>
                    Cost {sortCol === 'total_cost' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('summarizations')}>
                    Sums {sortCol === 'summarizations' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('token_limits')}>
                    Limits {sortCol === 'token_limits' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('budget_errors')}>
                    Budget {sortCol === 'budget_errors' && (sortAsc ? '↑' : '↓')}
                  </th>
                  <th style={thStyle} onClick={() => handleSort('errors')}>
                    Errors {sortCol === 'errors' && (sortAsc ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((app, idx) => (
                  <tr key={app.app_id} style={{ backgroundColor: idx % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {formatTimestamp(app.first_event)}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
                      {formatTimestamp(app.last_event)}
                    </td>
                    <td
                      style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.75rem', color: '#2563eb', cursor: 'pointer', fontWeight: 500 }}
                      onClick={() => showAppDetails(app.app_id)}
                    >
                      {app.app_id}
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
              Showing {sorted.length} of {apps.length} apps
            </div>
          )}
        </div>
      </div>

      {/* App Detail Modal */}
      {(selectedApp || modalLoading) && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            zIndex: 1000,
            padding: '1.5rem',
            overflowY: 'auto'
          }}
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '1.5rem',
            boxShadow: '0 25px 50px rgba(0,0,0,0.3)'
          }}>
            {modalLoading ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                <p style={{ color: '#64748b' }}>Loading app details...</p>
              </div>
            ) : selectedApp && (
              <>
                {/* Modal Header */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.25rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid #e5e7eb'
                }}>
                  <div>
                    <h2 style={{ margin: 0, fontFamily: 'monospace', color: '#2563eb', fontSize: '1.25rem' }}>
                      {selectedApp.app_id}
                    </h2>
                    <a
                      href={`https://${selectedApp.app_id}.preview.c24.airoapp.ai`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '0.75rem', color: '#f97316' }}
                    >
                      Open preview ↗
                    </a>
                  </div>
                  <button
                    onClick={closeModal}
                    style={{
                      background: '#f1f5f9',
                      border: 'none',
                      fontSize: '1.25rem',
                      cursor: 'pointer',
                      color: '#64748b',
                      width: '2rem',
                      height: '2rem',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Agent Breakdown */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1.25rem'
                }}>
                  {selectedApp.agent_breakdown.map(agent => (
                    <div key={agent.agent_id} style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '8px',
                      padding: '0.75rem',
                      borderLeft: '3px solid #3b82f6'
                    }}>
                      <div style={{ fontSize: '0.6rem', color: '#64748b', marginBottom: '0.35rem', textTransform: 'uppercase', fontWeight: 600 }}>
                        {agent.agent_id}
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: '#059669' }}>
                        ${agent.cost.toFixed(2)}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        {agent.run_count} runs · {agent.steps} steps
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats Row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '0.75rem',
                  marginBottom: '1.25rem'
                }}>
                  <div style={{ backgroundColor: '#f0f9ff', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: '#0369a1', textTransform: 'uppercase', fontWeight: 600 }}>Compressions</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0284c7' }}>
                      {selectedApp.compression_stats.events}
                    </div>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>
                      Saved {formatBytes(selectedApp.compression_stats.total_saved_bytes)}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#faf5ff', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: '#7c3aed', textTransform: 'uppercase', fontWeight: 600 }}>Summarizations</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#8b5cf6' }}>
                      {selectedApp.summarization_stats.total}
                    </div>
                    <div style={{ fontSize: '0.6rem', color: '#64748b' }}>
                      {selectedApp.summarization_stats.successful} ok, {selectedApp.summarization_stats.failed} failed
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#fef2f2', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: '#b91c1c', textTransform: 'uppercase', fontWeight: 600 }}>Errors</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#dc2626' }}>
                      {selectedApp.errors.length}
                    </div>
                  </div>
                  <div style={{ backgroundColor: '#f0fdf4', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: '#166534', textTransform: 'uppercase', fontWeight: 600 }}>Total Cost</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#059669' }}>
                      ${selectedApp.total_cost.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* Tools Used */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>Tools Used</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {selectedApp.tool_usage.length > 0 ? (
                      selectedApp.tool_usage.map(tool => (
                        <span key={tool.tool_name} style={{
                          backgroundColor: '#f3e8ff',
                          border: '1px solid #c4b5fd',
                          borderRadius: '4px',
                          padding: '0.15rem 0.5rem',
                          fontSize: '0.65rem',
                          fontFamily: 'monospace',
                          color: '#7c3aed'
                        }}>
                          {tool.tool_name} ({tool.count})
                        </span>
                      ))
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>No tool data</span>
                    )}
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <h3 style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: '#374151' }}>Timeline</h3>
                  <div style={{ maxHeight: '350px', overflowY: 'auto', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f8fafc', position: 'sticky', top: 0 }}>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Timestamp</th>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Type</th>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Detail</th>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Steps</th>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Input</th>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Output</th>
                          <th style={{ ...thStyle, fontSize: '0.65rem' }}>Cost/Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedApp.timeline.map((t, idx) => {
                          const isError = t.type === 'error' || (t.type === 'summarization' && t.detail === 'failed') ||
                            (t.type === 'conversation' && (t.detail === 'token_limit_reached' || t.detail === 'budget_exceeded'));

                          const typeColors: Record<string, string> = {
                            run: '#2563eb',
                            error: '#dc2626',
                            summarization: '#8b5cf6',
                            compression: '#0284c7',
                            tool: '#ea580c',
                            conversation: '#0891b2'
                          };

                          let col4 = '-';
                          let col5 = '-';
                          let col6 = '-';
                          let col7 = '-';

                          if (t.type === 'run') {
                            col4 = String(t.steps || 0);
                            col5 = formatNumber(t.input_tokens || 0);
                            col6 = formatNumber(t.output_tokens || 0);
                            col7 = '$' + (t.cost || 0).toFixed(4);
                          } else if (t.type === 'summarization') {
                            col5 = formatNumber(t.input_tokens || 0) + ' tok';
                            col6 = formatNumber(t.output_tokens || 0) + ' tok';
                            col7 = ((t.cost || 0) * 100).toFixed(1) + '%';
                          } else if (t.type === 'compression') {
                            col5 = formatBytes(t.input_tokens || 0);
                            col6 = formatBytes(t.output_tokens || 0);
                            col7 = ((t.cost || 0) * 100).toFixed(1) + '%';
                          } else if (t.type === 'error') {
                            col7 = t.extra_info || '-';
                          } else if (t.type === 'conversation' && t.detail === 'token_limit_reached') {
                            col5 = (t.input_tokens || 0) + ' proc';
                            col6 = (t.output_tokens || 0) + ' drop';
                          }

                          return (
                            <tr key={idx} style={{ backgroundColor: isError ? 'rgba(239, 68, 68, 0.05)' : idx % 2 === 0 ? 'white' : '#fafbfc' }}>
                              <td style={{ ...tdStyle, fontSize: '0.7rem', fontFamily: 'monospace', color: '#64748b' }}>
                                {formatFullTimestamp(t.timestamp)}
                              </td>
                              <td style={tdStyle}>
                                <span style={{
                                  display: 'inline-block',
                                  padding: '0.1rem 0.4rem',
                                  borderRadius: '4px',
                                  fontSize: '0.6rem',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  backgroundColor: `${typeColors[t.type] || '#64748b'}15`,
                                  color: typeColors[t.type] || '#64748b'
                                }}>
                                  {t.type}
                                </span>
                              </td>
                              <td style={{ ...tdStyle, fontSize: '0.7rem' }}>
                                {t.detail === 'budget_exceeded' ? '⚠️ BUDGET' : t.detail || '-'}
                              </td>
                              <td style={{ ...tdStyle, fontSize: '0.75rem' }}>{col4}</td>
                              <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#64748b' }}>{col5}</td>
                              <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#64748b' }}>{col6}</td>
                              <td style={{ ...tdStyle, fontSize: '0.7rem', color: '#059669' }}>{col7}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {selectedApp.timeline.length === 0 && (
                      <p style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem' }}>No timeline data</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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
