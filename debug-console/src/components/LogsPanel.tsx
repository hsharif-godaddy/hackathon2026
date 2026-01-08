'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import LogSourceSelector, { type LogSource } from './LogSourceSelector';

const LOG_LEVELS = ['all', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

const TIME_RANGES = [
  { label: 'Last 15 minutes', value: '15m' },
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'All time', value: 'all' }
] as const;

export interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  event?: string;
  appId?: string;
  logger?: string;
  service?: string;
  hostname?: string;
  environment?: string;
  region?: string;
  version?: string;
  data?: {
    message?: string;
    [key: string]: unknown;
  };
  raw: Record<string, unknown>;
}

function getLogLevelBadgeStyle(level: string): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '0.125rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontFamily: 'monospace',
    fontWeight: 600,
    border: '1px solid',
    display: 'inline-block'
  };

  const levelStr = level != null ? String(level) : '';
  const upperLevel = levelStr.toUpperCase();

  switch (upperLevel) {
    case 'ERROR':
      return {
        ...base,
        backgroundColor: '#fee2e2',
        color: '#991b1b',
        borderColor: '#fca5a5'
      };
    case 'WARN':
      return {
        ...base,
        backgroundColor: '#fef3c7',
        color: '#92400e',
        borderColor: '#fcd34d'
      };
    case 'INFO':
      return {
        ...base,
        backgroundColor: '#dbeafe',
        color: '#1e40af',
        borderColor: '#93c5fd'
      };
    case 'DEBUG':
      return {
        ...base,
        backgroundColor: '#f3f4f6',
        color: '#374151',
        borderColor: '#d1d5db'
      };
    default:
      return {
        ...base,
        backgroundColor: '#f3f4f6',
        color: '#4b5563',
        borderColor: '#e5e7eb'
      };
  }
}

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    return timestamp;
  }
}

function safeRender(value: unknown): string {
  if (value == null) {
    return '-';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

interface LogsPanelProps {
  sources: LogSource[];
  defaultSource?: string;
  isWidget?: boolean;
  globalAppId?: string;
  onRemove?: () => void;
  onAppIdClick?: (appId: string) => void;
}

export default function LogsPanel({ sources, defaultSource, isWidget, globalAppId, onRemove, onAppIdClick }: LogsPanelProps) {
  const [selectedSource, setSelectedSource] = useState<string>(defaultSource || sources[0]?.id || '');
  const [level, setLevel] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('6h');
  const [useCustomTime, setUseCustomTime] = useState<boolean>(false);
  const [customStartTime, setCustomStartTime] = useState<string>('');
  const [customEndTime, setCustomEndTime] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [appIdFilter, setAppIdFilter] = useState<string>('');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(0);
  const [accumulatedLogs, setAccumulatedLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const PAGE_SIZE = 50;
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);

  // Compute the effective appId filter
  const effectiveAppId = globalAppId || appIdFilter;

  // Use a ref to track if we've initialized the source from props
  const initializedRef = useRef(false);

  useEffect(() => {
    if (defaultSource && !initializedRef.current) {
      setSelectedSource(defaultSource);
      initializedRef.current = true;
    }
  }, [defaultSource]);

  const fetchLogs = useCallback(async function fetchLogsInternal() {
    if (!selectedSource) return;

    setLoading(true);
    setError(null);

    try {
      const urlParams = new URLSearchParams();
      urlParams.set('source', selectedSource);
      urlParams.set('size', PAGE_SIZE.toString());
      urlParams.set('from', (page * PAGE_SIZE).toString());

      if (level !== 'all') {
        urlParams.set('level', level);
      }

      if (query) {
        urlParams.set('query', query);
      }

      if (effectiveAppId) {
        urlParams.set('appId', effectiveAppId);
      }

      if (useCustomTime && customStartTime && customEndTime) {
        const startDate = new Date(customStartTime);
        const endDate = new Date(customEndTime);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error('Invalid date format');
        }
        urlParams.set('startTime', startDate.toISOString());
        urlParams.set('endTime', endDate.toISOString());
      } else if (timeRange !== 'all') {
        const now = new Date();
        const value = parseInt(timeRange.slice(0, -1), 10);
        const unit = timeRange.slice(-1);
        const startTime = new Date(now);

        switch (unit) {
          case 'm':
            startTime.setMinutes(startTime.getMinutes() - value);
            break;
          case 'h':
            startTime.setHours(startTime.getHours() - value);
            break;
          case 'd':
            startTime.setDate(startTime.getDate() - value);
            break;
        }
        urlParams.set('startTime', startTime.toISOString());
        urlParams.set('endTime', now.toISOString());
      }

      const response = await fetch(`/api/es-logs?${urlParams.toString()}`);

      if (!response) {
        throw new Error('No response received from server');
      }

      if (!response.ok) {
        let errorMessage = 'Failed to fetch logs';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
        } catch {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setTotal(data.total || 0);

      if (page === 0) {
        setAccumulatedLogs(data.logs || []);
      } else {
        setAccumulatedLogs((prev) => [...prev, ...(data.logs || [])]);
      }
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : 'Failed to fetch logs';
      setError(errorMessage);
      console.error('Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSource, level, timeRange, useCustomTime, customStartTime, customEndTime, query, effectiveAppId, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(0);
  }, [selectedSource, level, query, timeRange, useCustomTime, customStartTime, customEndTime, effectiveAppId]);

  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        setPage(0);
        fetchLogs();
      }, 10000);
    } else if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh, fetchLogs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
  };

  const handleRefresh = () => {
    setPage(0);
    fetchLogs();
  };

  const loadMore = () => {
    if (!loading && accumulatedLogs.length < total) {
      setPage((prev) => prev + 1);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLog(expandedLog === id ? null : id);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      const rect = panelRef.current.getBoundingClientRect();
      const newHeight = e.clientY - rect.top;
      const minHeight = 300;
      const maxHeight = window.innerHeight - rect.top - 100;

      if (newHeight >= minHeight && newHeight <= maxHeight) {
        setPanelHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  if (sources.length === 0) {
    return (
      <div style={{
        backgroundColor: 'white',
        padding: '1.5rem',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <p style={{ color: '#ef4444' }}>No log sources configured</p>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      style={{
        backgroundColor: 'white',
        padding: isWidget ? '1rem' : '1.5rem',
        borderRadius: '8px',
        boxShadow: isWidget ? 'none' : '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: isWidget ? '0' : '2rem',
        border: '2px solid #9ca3af',
        height: panelHeight ? `${panelHeight}px` : 'auto',
        maxHeight: panelHeight ? `${panelHeight}px` : 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: panelHeight ? 'hidden' : 'visible'
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem'
      }}>
        <div>
          <h2 style={{
            margin: '0 0 0.25rem 0',
            fontSize: isWidget ? '1rem' : '1.125rem',
            fontWeight: 600,
            color: '#1a1a1a'
          }}>
            {isWidget ? sources.find(s => s.id === selectedSource)?.name || 'Logs' : 'Application Logs'}
          </h2>
          {!isWidget && (
            <p style={{
              margin: 0,
              fontSize: '0.875rem',
              color: '#666'
            }}>
              View logs from multiple Elasticsearch sources
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.75rem' }}>Auto-refresh</span>
          </label>
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              padding: '0.4rem 0.75rem',
              backgroundColor: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 500
            }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              style={{
                padding: '0.4rem 0.75rem',
                backgroundColor: '#fee2e2',
                color: '#ef4444',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 500,
                marginLeft: '0.5rem'
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.75rem',
        padding: '0.75rem',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        marginBottom: '1rem',
        backgroundColor: '#f9fafb',
        alignItems: 'flex-start'
      }}>
        {!isWidget && (
          <LogSourceSelector
            sources={sources}
            selectedSource={selectedSource}
            onSourceChange={setSelectedSource}
          />
        )}

        <form onSubmit={handleSearch} style={{ flex: '1 1 200px', minWidth: '150px' }}>
          <label style={{
            display: 'block',
            fontSize: '0.75rem',
            fontWeight: 500,
            marginBottom: '0.25rem',
            color: '#374151'
          }}>
            Search
          </label>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search logs..."
            style={{
              width: '100%',
              padding: '0.4rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.75rem'
            }}
          />
        </form>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          flex: useCustomTime ? '1 1 100%' : '0 0 auto',
          minWidth: '200px',
          width: useCustomTime ? '100%' : 'auto',
          order: useCustomTime ? 999 : 'auto'
        }}>
          <label style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: '#374151',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}>
            <input
              type="checkbox"
              checked={useCustomTime}
              onChange={(e) => {
                setUseCustomTime(e.target.checked);
                if (!e.target.checked) {
                  setCustomStartTime('');
                  setCustomEndTime('');
                } else {
                  const now = new Date();
                  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
                  const formatForInput = (date: Date) => {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const hours = String(date.getHours()).padStart(2, '0');
                    const minutes = String(date.getMinutes()).padStart(2, '0');
                    return `${year}-${month}-${day}T${hours}:${minutes}`;
                  };
                  setCustomStartTime(formatForInput(oneHourAgo));
                  setCustomEndTime(formatForInput(now));
                }
              }}
              style={{ cursor: 'pointer', flexShrink: 0 }}
            />
            <span>Use Custom Time Range</span>
          </label>
          {useCustomTime ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              padding: '0.75rem',
              backgroundColor: '#f9fafb',
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
              width: '100%',
              minWidth: '280px'
            }}>
              <div>
                <label htmlFor="custom-start-time" style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: '#374151',
                  display: 'block',
                  marginBottom: '0.375rem'
                }}>
                  Start Time
                </label>
                <input
                  id="custom-start-time"
                  type="datetime-local"
                  value={customStartTime}
                  onChange={(e) => setCustomStartTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    backgroundColor: 'white',
                    cursor: 'text'
                  }}
                />
              </div>
              <div>
                <label htmlFor="custom-end-time" style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: '#374151',
                  display: 'block',
                  marginBottom: '0.375rem'
                }}>
                  End Time
                </label>
                <input
                  id="custom-end-time"
                  type="datetime-local"
                  value={customEndTime}
                  onChange={(e) => setCustomEndTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '0.875rem',
                    backgroundColor: 'white',
                    cursor: 'text'
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              <label htmlFor="time-range" style={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: '#374151',
                display: 'block',
                marginBottom: '0.25rem'
              }}>
                Time Range
              </label>
              <select
                id="time-range"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  backgroundColor: 'white'
                }}
              >
                {TIME_RANGES.map((range) => (
                  <option key={range.value} value={range.value}>
                    {range.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="log-level" style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: '#374151'
          }}>
            Level
          </label>
          <select
            id="log-level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            style={{
              padding: '0.4rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              backgroundColor: 'white'
            }}
          >
            {LOG_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl.toLowerCase()}>
                {lvl === 'all' ? 'All Levels' : lvl}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="app-id" style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            color: '#374151'
          }}>
            App ID {globalAppId && <span style={{ color: '#3b82f6', fontSize: '0.65rem' }}>(Global Active)</span>}
          </label>
          <input
            id="app-id"
            type="text"
            value={appIdFilter}
            onChange={(e) => setAppIdFilter(e.target.value)}
            disabled={!!globalAppId}
            placeholder={globalAppId ? globalAppId : "Filter by app ID..."}
            style={{
              padding: '0.4rem',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '0.75rem',
              backgroundColor: globalAppId ? '#f3f4f6' : 'white',
              cursor: globalAppId ? 'not-allowed' : 'text'
            }}
          />
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.875rem',
        marginBottom: '1rem',
        color: '#6b7280'
      }}>
        <span>
          Showing {accumulatedLogs.length} of {total.toLocaleString()} logs
          {selectedSource && ` from ${sources.find(s => s.id === selectedSource)?.name}`}
          {effectiveAppId && ` for App: ${effectiveAppId}`}
        </span>
        {autoRefresh && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            }} />
            Auto-refreshing every 10s
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          border: '1px solid #ef4444',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          backgroundColor: '#fef2f2',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'start'
        }}>
          <div>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: '#dc2626' }}>
              Error loading logs
            </p>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#991b1b' }}>
              {error}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && accumulatedLogs.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '200px',
          gap: '1rem'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '4px solid #e5e7eb',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <p style={{ color: '#6b7280' }}>Loading logs...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && accumulatedLogs.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}>
          <p style={{ fontSize: '1.125rem', margin: '0 0 0.5rem 0', color: '#1a1a1a' }}>
            No logs found
          </p>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
            Try adjusting your filters or time range
          </p>
        </div>
      )}

      {/* Logs table */}
      {accumulatedLogs.length > 0 && (
        <div style={{
          border: '1px solid #9ca3af',
          borderRadius: '8px',
          overflow: 'hidden',
          maxHeight: panelHeight ? `${Math.max(200, panelHeight - 450)}px` : (isWidget ? '400px' : 'none'),
          overflowY: panelHeight || isWidget ? 'auto' : 'visible',
          flex: panelHeight ? '1 1 auto' : '0 0 auto',
          minHeight: panelHeight ? '200px' : 'auto'
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              fontSize: isWidget ? '0.75rem' : '0.875rem',
              borderCollapse: 'collapse'
            }}>
              <thead style={{
                backgroundColor: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
                position: isWidget ? 'sticky' : 'static',
                top: 0,
                zIndex: 5
              }}>
                <tr>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: isWidget ? '130px' : '160px',
                    color: '#374151'
                  }}>
                    Timestamp
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: isWidget ? '60px' : '80px',
                    color: '#374151'
                  }}>
                    Level
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: isWidget ? '100px' : '120px',
                    color: '#374151'
                  }}>
                    App ID
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: isWidget ? '100px' : '200px',
                    color: '#374151'
                  }}>
                    Event
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    color: '#374151'
                  }}>
                    Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {accumulatedLogs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => toggleExpand(log.id)}
                      style={{
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                        borderBottom: '1px solid #f3f4f6'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <td style={{
                        padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                        fontSize: isWidget ? '0.7rem' : '0.75rem',
                        color: '#6b7280'
                      }}>
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td style={{ padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem' }}>
                        <span style={getLogLevelBadgeStyle(log.level || '')}>
                          {(log.level || '').toString().toLowerCase()}
                        </span>
                      </td>
                      <td style={{ padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem' }}>
                        {log.appId ? (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const appIdStr = safeRender(log.appId);
                                setAppIdFilter(appIdStr !== '-' ? appIdStr : '');
                              }}
                              style={{
                                fontFamily: 'monospace',
                                fontSize: isWidget ? '0.7rem' : '0.75rem',
                                background: 'none',
                                border: 'none',
                                color: '#3b82f6',
                                cursor: 'pointer',
                                textDecoration: 'underline'
                              }}
                              title="Filter by this app ID"
                            >
                              {safeRender(log.appId)}
                            </button>
                            {onAppIdClick && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const appIdStr = safeRender(log.appId);
                                  onAppIdClick(appIdStr !== '-' ? appIdStr : '');
                                }}
                                style={{
                                  fontSize: '0.65rem',
                                  padding: '0.125rem 0.375rem',
                                  backgroundColor: '#f3f4f6',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  color: '#374151'
                                }}
                                title="View app context"
                              >
                                Context
                              </button>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af' }}>-</span>
                        )}
                      </td>
                      <td style={{
                        padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        color: '#6b7280',
                        maxWidth: isWidget ? '100px' : '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }} title={safeRender(log.event)}>
                        {safeRender(log.event)}
                      </td>
                      <td style={{
                        padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                        fontSize: isWidget ? '0.75rem' : '0.875rem',
                        maxWidth: isWidget ? '200px' : '400px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {safeRender(log?.data?.message || log.message)}
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr>
                        <td colSpan={5} style={{
                          padding: isWidget ? '0.75rem' : '1rem',
                          backgroundColor: '#f9fafb',
                          borderBottom: '1px solid #e5e7eb'
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div>
                              <div style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                marginBottom: '0.25rem',
                                color: '#6b7280'
                              }}>
                                Full Message
                              </div>
                              <pre style={{
                                fontSize: isWidget ? '0.75rem' : '0.875rem',
                                padding: '0.5rem',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb',
                                backgroundColor: 'white',
                                overflowX: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                margin: 0
                              }}>
                                {safeRender(log?.data?.message || log.message)}
                              </pre>
                            </div>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                              gap: '0.75rem',
                              fontSize: isWidget ? '0.75rem' : '0.875rem'
                            }}>
                              {log.appId && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>App ID:</span>{' '}
                                  <span style={{ fontFamily: 'monospace' }}>{safeRender(log.appId)}</span>
                                </div>
                              )}
                              {log.service && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>Service:</span>{' '}
                                  <span style={{ fontFamily: 'monospace' }}>{safeRender(log.service)}</span>
                                </div>
                              )}
                              {log.hostname && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>Host:</span>{' '}
                                  <span style={{ fontFamily: 'monospace' }}>{safeRender(log.hostname)}</span>
                                </div>
                              )}
                              {log.version && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>Version:</span>{' '}
                                  <span style={{ fontFamily: 'monospace' }}>{safeRender(log.version)}</span>
                                </div>
                              )}
                              {log.environment && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>Environment:</span>{' '}
                                  <span style={{ fontFamily: 'monospace' }}>{safeRender(log.environment)}</span>
                                </div>
                              )}
                              {log.region && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>Region:</span>{' '}
                                  <span style={{ fontFamily: 'monospace' }}>{safeRender(log.region)}</span>
                                </div>
                              )}
                            </div>
                            <div>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '0.25rem'
                              }}>
                                <div style={{
                                  fontSize: '0.7rem',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  color: '#6b7280'
                                }}>
                                  Raw JSON
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(JSON.stringify(log.raw, null, 2));
                                  }}
                                  style={{
                                    fontSize: '0.65rem',
                                    padding: '0.1rem 0.4rem',
                                    backgroundColor: '#f3f4f6',
                                    border: '1px solid #d1d5db',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    color: '#374151'
                                  }}
                                >
                                  Copy
                                </button>
                              </div>
                              <pre style={{
                                fontSize: isWidget ? '0.7rem' : '0.75rem',
                                padding: isWidget ? '0.5rem' : '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #e5e7eb',
                                backgroundColor: 'white',
                                overflowX: 'auto',
                                maxHeight: isWidget ? '200px' : '300px',
                                overflowY: 'auto',
                                margin: 0,
                                fontFamily: 'monospace'
                              }}>
                                {JSON.stringify(log.raw, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {accumulatedLogs.length < total && (
            <div style={{
              padding: '1rem',
              borderTop: '1px solid #e5e7eb',
              textAlign: 'center'
            }}>
              <button
                onClick={loadMore}
                disabled={loading}
                style={{
                  padding: '0.5rem 1.5rem',
                  backgroundColor: '#f3f4f6',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}
              >
                {loading ? 'Loading...' : `Load More (${total - accumulatedLogs.length} remaining)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Resize handle - only show when not in widget mode */}
      {!isWidget && (
        <div
          ref={resizeHandleRef}
          onMouseDown={handleResizeStart}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '12px',
            cursor: 'row-resize',
            backgroundColor: 'transparent',
            borderTop: '2px solid #9ca3af',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            transition: 'background-color 0.2s, border-color 0.2s'
          }}
          onMouseEnter={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
              e.currentTarget.style.borderTopColor = '#3b82f6';
            }
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderTopColor = '#9ca3af';
            }
          }}
        >
          <div
            style={{
              width: '50px',
              height: '4px',
              backgroundColor: isResizing ? '#3b82f6' : '#9ca3af',
              borderRadius: '2px',
              transition: isResizing ? 'none' : 'background-color 0.2s'
            }}
          />
        </div>
      )}
    </div>
  );
}
