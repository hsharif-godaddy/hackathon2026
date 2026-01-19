'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import LogDetailPanel from './LogDetailPanel';

const ERROR_WARN_LEVELS = ['ERROR', 'WARN'];

export interface LogSource {
  id: string;
  name: string;
  description: string;
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
  onAppIdClick?: (appId: string) => void;
  // Central filter controls
  timeRange?: string;
  query?: string;
  showAllLogs?: boolean;
}

const INITIAL_COLUMN_WIDTHS = {
  timestamp: 160,
  level: 80,
  appId: 120,
  event: 200
};

// Source-specific field mappings
const SOURCE_FIELD_MAPPINGS: Record<string, {
  idField: string;
  idLabel: string;
  getIdValue: (log: LogEntry) => string | undefined;
  supportsAppIdFilter: boolean;
}> = {
  'airo-agents': {
    idField: 'appId',
    idLabel: 'App ID',
    getIdValue: (log) => log.appId,
    supportsAppIdFilter: true
  },
  'airo-app': {
    idField: 'customerId',
    idLabel: 'Customer ID',
    getIdValue: (log) => (log.raw?.customerId as string) || (log.raw?.['customer.id'] as string) || (log.raw?.['user.id'] as string),
    supportsAppIdFilter: false
  },
  'control_plane': {
    idField: 'appId',
    idLabel: 'App ID',
    getIdValue: (log) => log.appId,
    supportsAppIdFilter: true
  }
};

const DEFAULT_FIELD_MAPPING = {
  idField: 'appId',
  idLabel: 'App ID',
  getIdValue: (log: LogEntry) => log.appId,
  supportsAppIdFilter: true
};

export default function LogsPanel({
  sources,
  defaultSource,
  isWidget,
  globalAppId,
  onAppIdClick: _onAppIdClick,
  timeRange = '1h',
  query = '',
  showAllLogs = false
}: LogsPanelProps) {
  const [selectedSource, setSelectedSource] = useState<string>(defaultSource || sources[0]?.id || '');
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [accumulatedLogs, setAccumulatedLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);

  const fieldMapping = SOURCE_FIELD_MAPPINGS[selectedSource] || DEFAULT_FIELD_MAPPING;

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

      if (!showAllLogs) {
        urlParams.set('levels', ERROR_WARN_LEVELS.join(','));
      }

      if (query) {
        urlParams.set('query', query);
      }

      if (globalAppId && fieldMapping.supportsAppIdFilter) {
        urlParams.set('appId', globalAppId);
      }

      if (timeRange !== 'all') {
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
  }, [selectedSource, showAllLogs, timeRange, query, globalAppId, page, fieldMapping]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    setPage(0);
  }, [selectedSource, showAllLogs, query, timeRange, globalAppId]);

  const loadMore = () => {
    if (!loading && accumulatedLogs.length < total) {
      setPage((prev) => prev + 1);
    }
  };

  const selectLog = (index: number) => {
    setSelectedLogIndex(index);
  };

  const closeDetailPanel = () => {
    setSelectedLogIndex(null);
  };

  const selectPreviousLog = useCallback(() => {
    if (selectedLogIndex !== null && selectedLogIndex > 0) {
      setSelectedLogIndex(selectedLogIndex - 1);
    }
  }, [selectedLogIndex]);

  const selectNextLog = useCallback(() => {
    if (selectedLogIndex !== null && selectedLogIndex < accumulatedLogs.length - 1) {
      setSelectedLogIndex(selectedLogIndex + 1);
    }
  }, [selectedLogIndex, accumulatedLogs.length]);

  useEffect(() => {
    if (selectedRowRef.current && tableContainerRef.current) {
      selectedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedLogIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedLogIndex === null) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          selectPreviousLog();
          break;
        case 'ArrowDown':
          e.preventDefault();
          selectNextLog();
          break;
        case 'Escape':
          e.preventDefault();
          closeDetailPanel();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedLogIndex, selectPreviousLog, selectNextLog]);

  const selectedLog = selectedLogIndex !== null ? accumulatedLogs[selectedLogIndex] : null;

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
        marginBottom: '1.5rem',
        paddingLeft: isWidget ? '36px' : '0'
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
          {globalAppId && fieldMapping.supportsAppIdFilter && ` for App: ${globalAppId}`}
        </span>
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
          border: '1px solid #9ca3af',
          borderRadius: '8px',
          overflow: 'hidden',
          flex: panelHeight ? '1 1 auto' : '0 0 auto',
          minHeight: panelHeight ? '200px' : '400px',
          maxHeight: panelHeight ? `${Math.max(200, panelHeight - 300)}px` : (isWidget ? '400px' : '600px')
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
              fontSize: isWidget ? '0.75rem' : '0.875rem',
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
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
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
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: `${columnWidths.level}px`,
                    color: '#374151',
                    position: 'relative',
                    borderRight: '1px solid #e5e7eb'
                  }}>
                    Level
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnMouseDown('level', e)}
                      onKeyDown={(e) => handleColumnKeyDown('level', e)}
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
                      aria-label="Resize level column"
                      role="separator"
                      aria-orientation="vertical"
                    />
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: `${columnWidths.appId}px`,
                    color: '#374151',
                    position: 'relative',
                    borderRight: '1px solid #e5e7eb'
                  }}>
                    {fieldMapping.idLabel}
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnMouseDown('appId', e)}
                      onKeyDown={(e) => handleColumnKeyDown('appId', e)}
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
                      aria-label="Resize ID column"
                      role="separator"
                      aria-orientation="vertical"
                    />
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                    fontWeight: 600,
                    width: `${columnWidths.event}px`,
                    color: '#374151',
                    position: 'relative',
                    borderRight: '1px solid #e5e7eb'
                  }}>
                    Event
                    <button
                      type="button"
                      onMouseDown={(e) => handleColumnMouseDown('event', e)}
                      onKeyDown={(e) => handleColumnKeyDown('event', e)}
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
                      aria-label="Resize event column"
                      role="separator"
                      aria-orientation="vertical"
                    />
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
                {accumulatedLogs.map((log, index) => {
                  const isSelected = selectedLogIndex === index;
                  return (
                    <tr
                      key={log.id}
                      ref={isSelected ? selectedRowRef : null}
                      onClick={() => selectLog(index)}
                      style={{
                        cursor: 'pointer',
                        transition: 'background-color 0.15s',
                        borderBottom: '1px solid #f3f4f6',
                        backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                        borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent'
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <td style={{
                        padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                        fontSize: isWidget ? '0.7rem' : '0.75rem',
                        color: isSelected ? '#1e40af' : '#6b7280'
                      }}>
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td style={{ padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem' }}>
                        <span style={getLogLevelBadgeStyle(log.level || '')}>
                          {(log.level || '').toString().toLowerCase()}
                        </span>
                      </td>
                      <td style={{
                        padding: isWidget ? '0.5rem 0.75rem' : '0.75rem 1rem',
                        fontFamily: 'monospace',
                        fontSize: isWidget ? '0.7rem' : '0.75rem',
                        color: '#6b7280'
                      }}>
                        {safeRender(fieldMapping.getIdValue(log)) || '-'}
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
                        whiteSpace: 'nowrap',
                        color: isSelected ? '#1e40af' : 'inherit'
                      }}>
                        {safeRender(log?.data?.message || log.message)}
                      </td>
                    </tr>
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

      {/* Drawer overlay */}
      {selectedLog && (
        <>
          <div
            style={{
              position: 'fixed',
              top: '60px',
              right: 0,
              bottom: 0,
              width: '500px',
              maxWidth: '90vw',
              backgroundColor: 'white',
              boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
              zIndex: 50,
              animation: 'slideIn 0.25s ease-out',
              display: 'flex',
              flexDirection: 'column',
              borderTopLeftRadius: '8px'
            }}
          >
            <LogDetailPanel
              log={selectedLog}
              fieldMapping={fieldMapping}
              onClose={closeDetailPanel}
              onPrevious={selectPreviousLog}
              onNext={selectNextLog}
              hasPrevious={selectedLogIndex !== null && selectedLogIndex > 0}
              hasNext={selectedLogIndex !== null && selectedLogIndex < accumulatedLogs.length - 1}
            />
          </div>

          <style>{`
            @keyframes slideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>
        </>
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
