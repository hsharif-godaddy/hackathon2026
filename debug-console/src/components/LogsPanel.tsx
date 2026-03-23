'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { formatTimestamp } from '@/lib/date-utils';

export interface LogSource {
  id: string;
  name: string;
  description: string;
  kibanaUrl?: string;
}

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
  sourceId?: string;
  data?: {
    message?: string;
    [key: string]: unknown;
  };
  raw: Record<string, unknown>;
}

const BASE_LOG_LEVEL_STYLE: React.CSSProperties = {
  padding: '0.125rem 0.5rem',
  borderRadius: '4px',
  fontSize: '0.75rem',
  fontFamily: 'monospace',
  fontWeight: 600,
  border: '1px solid',
  display: 'inline-block',
};

const LOG_LEVEL_COLORS: Record<string, React.CSSProperties> = {
  ERROR: { backgroundColor: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' },
  WARN:  { backgroundColor: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' },
  INFO:  { backgroundColor: '#dbeafe', color: '#1e40af', borderColor: '#93c5fd' },
  DEBUG: { backgroundColor: '#f3f4f6', color: '#374151', borderColor: '#d1d5db' },
};
const DEFAULT_LOG_LEVEL_COLORS: React.CSSProperties = { backgroundColor: '#f3f4f6', color: '#4b5563', borderColor: '#e5e7eb' };

function getLogLevelBadgeStyle(level: string): React.CSSProperties {
  const upper = level ? String(level).toUpperCase() : '';
  return { ...BASE_LOG_LEVEL_STYLE, ...(LOG_LEVEL_COLORS[upper] ?? DEFAULT_LOG_LEVEL_COLORS) };
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

// Prepare log JSON for display: remove timestamp, promote message/data/error to top
function formatLogJson(raw: Record<string, unknown>): string {
  const promoted: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  const skipKeys = new Set(['@timestamp', 'time', 'timestamp']);
  const promoteKeys = ['message', 'msg', 'data', 'error'];

  for (const key of promoteKeys) {
    if (key in raw) promoted[key] = raw[key];
  }
  for (const [key, value] of Object.entries(raw)) {
    if (skipKeys.has(key) || promoteKeys.includes(key)) continue;
    rest[key] = value;
  }
  return JSON.stringify({ ...promoted, ...rest });
}

interface LogsPanelProps {
  sources: LogSource[];
  globalAppId?: string;
  timeRange?: string;
  query?: string;
  refreshKey?: number;
  onRefresh?: () => void;
}

const INITIAL_COLUMN_WIDTHS = {
  timestamp: 160,
  source: 80
};

// Source-specific field mappings
const SOURCE_FIELD_MAPPINGS: Record<string, {
  idField: string;
  idLabel: string;
  getIdValue: (log: LogEntry) => string | undefined;
  appIdFilterMode: 'field' | 'query' | 'none'; // 'field' = filter by specific field, 'query' = free-text search, 'none' = no filter
}> = {
  'airo-agents': {
    idField: 'appId',
    idLabel: 'App ID',
    getIdValue: (log) => log.appId,
    appIdFilterMode: 'field'
  },
  'airo-app': {
    idField: 'customerId',
    idLabel: 'Customer ID',
    getIdValue: (log) => (log.raw?.customerId as string) || (log.raw?.['customer.id'] as string) || (log.raw?.['user.id'] as string) || ((log.raw?.data as Record<string, unknown>)?.customerId as string) || undefined,
    appIdFilterMode: 'field'
  },
  'airo-preview': {
    idField: 'appId',
    idLabel: 'App ID',
    getIdValue: (log) => log.appId,
    appIdFilterMode: 'field'
  },
  'airo-publish': {
    idField: 'appId',
    idLabel: 'App ID',
    getIdValue: (log) => log.appId,
    appIdFilterMode: 'field'
  },
  'control_plane': {
    idField: 'appId',
    idLabel: 'App ID',
    getIdValue: (log) => log.appId,
    appIdFilterMode: 'field'
  }
};

const DEFAULT_FIELD_MAPPING = {
  idField: 'appId',
  idLabel: 'App ID',
  getIdValue: (log: LogEntry) => log.appId,
  appIdFilterMode: 'field' as const
};

const SOURCE_LABELS: Record<string, string> = {
  'airo-agents': 'Agent',
  'airo-preview': 'Preview',
  'airo-publish': 'Publish',
  'airo-app': 'UI Client',
  'control_plane': 'CP',
};

export default function LogsPanel({
  sources,
  globalAppId,
  timeRange = '1h',
  query = '',
  refreshKey = 0,
  onRefresh
}: LogsPanelProps) {
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [accumulatedLogs, setAccumulatedLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [levelFilters, setLevelFilters] = useState({ error: true, warn: false });
  const PAGE_SIZE = 50;
  const panelRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Column resizing state
  const [columnWidths, setColumnWidths] = useState(INITIAL_COLUMN_WIDTHS);
  const resizingColumnRef = useRef<keyof typeof INITIAL_COLUMN_WIDTHS | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  // Column resize handlers
  const handleColumnMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingColumnRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const newWidth = Math.max(50, startWidthRef.current + deltaX);
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumnRef.current as string]: newWidth
    }));
  }, []);

  const handleColumnMouseUp = useCallback(() => {
    resizingColumnRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleColumnMouseMove);
    document.removeEventListener('mouseup', handleColumnMouseUp);
  }, [handleColumnMouseMove]);

  const handleColumnMouseDown = useCallback((column: keyof typeof INITIAL_COLUMN_WIDTHS, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumnRef.current = column;
    startXRef.current = e.clientX;
    startWidthRef.current = columnWidths[column];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleColumnMouseMove);
    document.addEventListener('mouseup', handleColumnMouseUp);
  }, [columnWidths, handleColumnMouseMove, handleColumnMouseUp]);

  const handleColumnKeyDown = useCallback((column: keyof typeof INITIAL_COLUMN_WIDTHS, e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setColumnWidths(prev => ({
        ...prev,
        [column]: Math.max(50, prev[column] - step)
      }));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setColumnWidths(prev => ({
        ...prev,
        [column]: prev[column] + step
      }));
    }
  }, []);

  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleColumnMouseMove);
      document.removeEventListener('mouseup', handleColumnMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleColumnMouseMove, handleColumnMouseUp]);

  const buildTimeParams = useCallback(function buildTime(params: URLSearchParams) {
    if (timeRange !== 'all') {
      const now = new Date();
      const value = parseInt(timeRange.slice(0, -1), 10);
      const unit = timeRange.slice(-1);
      const startTime = new Date(now);
      switch (unit) {
        case 'm': startTime.setMinutes(startTime.getMinutes() - value); break;
        case 'h': startTime.setHours(startTime.getHours() - value); break;
        case 'd': startTime.setDate(startTime.getDate() - value); break;
      }
      params.set('startTime', startTime.toISOString());
      params.set('endTime', now.toISOString());
    }
  }, [timeRange]);

  const fetchSingleSource = useCallback(async function fetchSingle(sourceId: string): Promise<{ logs: LogEntry[]; total: number }> {
    const fm = SOURCE_FIELD_MAPPINGS[sourceId] || DEFAULT_FIELD_MAPPING;
    const urlParams = new URLSearchParams();
    urlParams.set('source', sourceId);
    urlParams.set('size', PAGE_SIZE.toString());
    urlParams.set('from', (page * PAGE_SIZE).toString());

    // Combine level checkboxes + filter text + external query as free-text search
    const levelTerms = Object.entries(levelFilters).filter(([, on]) => on).map(([k]) => k).join(' ');
    const searchTerms = [levelTerms, filterText, query].filter(Boolean).join(' ');

    if (globalAppId && fm.appIdFilterMode !== 'none') {
      if (fm.appIdFilterMode === 'field') {
        urlParams.set('appId', globalAppId);
        if (searchTerms) urlParams.set('query', searchTerms);
      } else if (fm.appIdFilterMode === 'query') {
        const combined = globalAppId ? `${searchTerms} ${globalAppId}`.trim() : searchTerms;
        if (combined) urlParams.set('query', combined);
      }
    } else if (searchTerms) {
      urlParams.set('query', searchTerms);
    }
    buildTimeParams(urlParams);

    const response = await fetch(`/api/es-logs?${urlParams.toString()}`);
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
    const logs = (data.logs || []).map((log: LogEntry) => ({ ...log, sourceId }));
    return { logs, total: data.total || 0 };
  }, [filterText, levelFilters, query, globalAppId, page, buildTimeParams]);

  const fetchLogs = useCallback(async function fetchLogsInternal() {
    setLoading(true);
    setError(null);

    try {
      if (selectedSource === 'all') {
        const results = await Promise.all(sources.map(s => fetchSingleSource(s.id)));
        const merged = results.flatMap(r => r.logs)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const totalSum = results.reduce((sum, r) => sum + r.total, 0);
        setTotal(totalSum);
        if (page === 0) {
          setAccumulatedLogs(merged);
        } else {
          setAccumulatedLogs(prev => [...prev, ...merged].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
        }
      } else {
        const result = await fetchSingleSource(selectedSource);
        setTotal(result.total);
        if (page === 0) {
          setAccumulatedLogs(result.logs);
        } else {
          setAccumulatedLogs(prev => [...prev, ...result.logs]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
      console.error('Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSource, sources, fetchSingleSource, page]); // refreshKey triggers via reset effect → page=0 → re-fetch

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(0);
    setAccumulatedLogs([]);
  }, [selectedSource, filterText, levelFilters, query, timeRange, globalAppId, refreshKey]);

  const loadMore = () => {
    if (!loading && accumulatedLogs.length < total) {
      setPage((prev) => prev + 1);
    }
  };

  const toggleLog = (index: number) => {
    setSelectedLogIndex(selectedLogIndex === index ? null : index);
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
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #e5e7eb',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}
    >
      {/* Header with source selector, level filters and refresh button */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.75rem',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            style={{
              padding: '0.375rem 0.625rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.813rem',
              backgroundColor: 'white',
              cursor: 'pointer',
              color: '#374151',
              fontWeight: 500
            }}
          >
            <option value="all">All Sources</option>
            {sources.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
            {accumulatedLogs.length} of {total.toLocaleString()} logs
            {globalAppId && ` for ${globalAppId}`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {(['error', 'warn'] as const).map((lvl) => (
            <label key={lvl} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.813rem', color: '#6b7280', cursor: 'pointer', textTransform: 'capitalize' }}>
              <input
                type="checkbox"
                checked={levelFilters[lvl]}
                onChange={(e) => setLevelFilters(prev => ({ ...prev, [lvl]: e.target.checked }))}
                style={{ cursor: 'pointer' }}
              />
              {lvl}
            </label>
          ))}
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter..."
            style={{
              padding: '0.375rem 0.625rem',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              fontSize: '0.813rem',
              width: '150px'
            }}
          />
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              style={{
                padding: '0.625rem 1.25rem',
                backgroundColor: loading ? '#9ca3af' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1
              }}
            >
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          border: '1px solid #ef4444',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          backgroundColor: '#fef2f2'
        }}>
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600, color: '#dc2626' }}>
            Error loading logs
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#991b1b' }}>
            {error}
          </p>
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
          display: 'flex',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden',
          minHeight: '200px'
        }}>
          <div
            ref={tableContainerRef}
            style={{
              flex: 1,
              overflow: 'auto',
              minWidth: 0
            }}
          >
            <table style={{
              width: '100%',
              fontSize: '0.875rem',
              borderCollapse: 'collapse',
              tableLayout: 'fixed'
            }}>
              <thead style={{
                backgroundColor: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
                position: 'sticky',
                top: 0,
                zIndex: 5
              }}>
                <tr>
                  <th style={{
                    textAlign: 'left',
                    padding: '0.75rem 1rem',
                    fontWeight: 600,
                    width: `${columnWidths.timestamp}px`,
                    color: '#374151',
                    position: 'relative',
                    borderRight: '1px solid #e5e7eb'
                  }}>
                    Timestamp
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnMouseDown('timestamp', e)}
                      onKeyDown={(e) => handleColumnKeyDown('timestamp', e)}
                      style={{
                        position: 'absolute',
                        right: -3,
                        top: 0,
                        bottom: 0,
                        width: '6px',
                        cursor: 'col-resize',
                        backgroundColor: 'transparent',
                        zIndex: 10,
                        border: 'none',
                        padding: 0
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3b82f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onFocus={(e) => { e.currentTarget.style.backgroundColor = '#3b82f6'; }}
                      onBlur={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      aria-label="Resize timestamp column"
                      role="separator"
                      aria-orientation="vertical"
                    />
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: '0.75rem 1rem',
                    fontWeight: 600,
                    width: `${columnWidths.source}px`,
                    color: '#374151',
                    position: 'relative',
                    borderRight: '1px solid #e5e7eb'
                  }}>
                    Source
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnMouseDown('source', e)}
                      onKeyDown={(e) => handleColumnKeyDown('source', e)}
                      style={{
                        position: 'absolute',
                        right: -3,
                        top: 0,
                        bottom: 0,
                        width: '6px',
                        cursor: 'col-resize',
                        backgroundColor: 'transparent',
                        zIndex: 10,
                        border: 'none',
                        padding: 0
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#3b82f6'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onFocus={(e) => { e.currentTarget.style.backgroundColor = '#3b82f6'; }}
                      onBlur={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      aria-label="Resize source column"
                      role="separator"
                      aria-orientation="vertical"
                    />
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: '0.75rem 1rem',
                    fontWeight: 600,
                    color: '#374151'
                  }}>
                    Log
                  </th>
                </tr>
              </thead>
              <tbody>
                {accumulatedLogs.map((log, index) => {
                  const isSelected = selectedLogIndex === index;
                  const logJson = formatLogJson(log.raw);
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => toggleLog(index)}
                        style={{
                          cursor: 'pointer',
                          transition: 'background-color 0.15s',
                          borderBottom: isSelected ? 'none' : '1px solid #f3f4f6',
                          backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                          borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent'
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <td style={{
                          padding: '0.5rem 0.75rem', fontFamily: 'monospace',
                          whiteSpace: 'nowrap', fontSize: '0.7rem',
                          color: isSelected ? '#1e40af' : '#6b7280'
                        }}>
                          {formatTimestamp(log.timestamp)}
                        </td>
                        <td style={{ padding: '0.5rem 0.5rem', fontSize: '0.65rem', fontWeight: 600, color: '#6b7280', whiteSpace: 'nowrap' }}>
                          {SOURCE_LABELS[log.sourceId || selectedSource] || log.sourceId || selectedSource}
                        </td>
                        <td style={{
                          padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          color: isSelected ? '#1e40af' : '#374151'
                        }}>
                          {logJson}
                        </td>
                      </tr>
                      {isSelected && (
                        <tr>
                          <td colSpan={3} style={{ padding: 0, borderBottom: '1px solid #e5e7eb' }}>
                            <pre style={{
                              margin: 0, padding: '0.5rem 0.75rem',
                              backgroundColor: '#1e293b', color: '#e2e8f0',
                              fontSize: '0.7rem', lineHeight: 1.5,
                              fontFamily: 'monospace', overflow: 'auto',
                              maxHeight: '300px', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                            }}>
                              {JSON.stringify(JSON.parse(logJson), null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>

            {/* Load more */}
            {accumulatedLogs.length < total && (
              <div style={{
                padding: '1rem',
                borderTop: '1px solid #e5e7eb',
                textAlign: 'center',
                backgroundColor: '#fafafa'
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
        </div>
      )}

    </div>
  );
}
