'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import { useLogs, type LogEntry } from '@/hooks/useLogs';
import RefreshIcon from '@ux/icon/refresh';
import AlertIcon from '@ux/icon/alert';
import Spinner from '@ux/spinner';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import TextInput from '@ux/text-input';
import text from '@ux/text';

/**
 * Available log levels for filtering
 */
const LOG_LEVELS = ['all', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

/**
 * Time range presets for filtering
 */
const TIME_RANGES = [
  { label: 'Last 15 minutes', value: '15m' },
  { label: 'Last 1 hour', value: '1h' },
  { label: 'Last 6 hours', value: '6h' },
  { label: 'Last 24 hours', value: '24h' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'All time', value: 'all' }
] as const;

/**
 * Returns the CSS class for the log level badge
 *
 * @param level - The log level (DEBUG, INFO, WARN, ERROR)
 * @returns CSS classes for styling the badge
 */
function getLogLevelBadgeClass(level: string): string {
  const base = 'px-2 py-0.5 rounded text-xs font-mono font-semibold';
  switch (level.toUpperCase()) {
    case 'ERROR':
      return `${base} bg-red-100 text-red-800 border border-red-300`;
    case 'WARN':
      return `${base} bg-amber-100 text-amber-800 border border-amber-300`;
    case 'INFO':
      return `${base} bg-blue-100 text-blue-800 border border-blue-300`;
    case 'DEBUG':
      return `${base} bg-gray-100 text-gray-700 border border-gray-300`;
    default:
      return `${base} bg-gray-100 text-gray-600 border border-gray-200`;
  }
}

/**
 * Formats a timestamp for display
 *
 * @param timestamp - ISO timestamp string
 * @returns Formatted date/time string
 */
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

/**
 * Panel component for viewing logs from Elasticsearch
 *
 * Displays logs from the airo-agent-dev Elasticsearch index with
 * filtering by time range, log level, and search query. Supports
 * auto-refresh and infinite scrolling.
 *
 * @example
 * ```tsx
 * <LogsPanel />
 * ```
 */
export default function LogsPanel() {
  const currentAppId = useAppIdFromParams();
  const [level, setLevel] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('6h');
  const [query, setQuery] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [appIdFilter, setAppIdFilter] = useState<string>('');
  const [currentAppOnly, setCurrentAppOnly] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(0);
  const [accumulatedLogs, setAccumulatedLogs] = useState<LogEntry[]>([]);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const PAGE_SIZE = 50;

  // Compute effective app ID
  const effectiveAppId = currentAppOnly && currentAppId ? currentAppId : appIdFilter;

  // Use React Query for fetching logs
  const {
    data: logsData,
    isLoading,
    isFetching,
    error: logsError,
    refetch
  } = useLogs({
    level,
    timeRange,
    query,
    appId: effectiveAppId,
    pageSize: PAGE_SIZE,
    page
  });

  const total = logsData?.total ?? 0;
  const error = logsError?.message ?? null;
  const loading = isLoading || isFetching;

  // Accumulate logs when data changes
  useEffect(() => {
    if (logsData?.logs) {
      if (page === 0) {
        setAccumulatedLogs(logsData.logs);
      } else {
        setAccumulatedLogs((prev) => [...prev, ...logsData.logs]);
      }
    }
  }, [logsData, page]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [level, query, timeRange, effectiveAppId]);

  // Auto-refresh handling
  useEffect(() => {
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        setPage(0);
        refetch();
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
  }, [autoRefresh, refetch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
  };

  const handleRefresh = () => {
    setPage(0);
    refetch();
  };

  const loadMore = () => {
    if (!loading && accumulatedLogs.length < total) {
      setPage((prev) => prev + 1);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLog(expandedLog === id ? null : id);
  };

  return (
    <div className="w-full space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <text.h2 className="text-xl font-semibold">Agent Logs</text.h2>
          <text.p className="text-sm text-gray-500 mt-1">
            Logs from Elasticsearch index: airo-agent-dev
          </text.p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="auto-refresh"
            name="auto-refresh"
            checked={autoRefresh}
            onChange={(checked: boolean) => setAutoRefresh(checked)}
            label="Auto-refresh"
          />
          <Button
            design="secondary"
            icon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={loading}
            text="Refresh"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end p-4 bg-gray-50 rounded-lg border border-gray-200">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
          <TextInput
            label="Search"
            value={searchInput}
            onChange={(value: string) => setSearchInput(value)}
            placeholder="Search in logs..."
          />
        </form>

        {/* Time Range */}
        <div className="flex flex-col gap-1">
          <label htmlFor="time-range" className="text-sm font-medium text-gray-700">
            Time Range
          </label>
          <select
            id="time-range"
            name="time-range"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        {/* Log Level */}
        <div className="flex flex-col gap-1">
          <label htmlFor="log-level" className="text-sm font-medium text-gray-700">
            Level
          </label>
          <select
            id="log-level"
            name="log-level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {LOG_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl === 'all' ? 'All Levels' : lvl}
              </option>
            ))}
          </select>
        </div>

        {/* Current App Only Checkbox */}
        {currentAppId && (
          <div className="flex items-end pb-2">
            <Checkbox
              id="current-app-only"
              name="current-app-only"
              checked={currentAppOnly}
              onChange={(checked: boolean) => {
                setCurrentAppOnly(checked);
                if (checked) {
                  setAppIdFilter('');
                }
              }}
              label={`This app only (${currentAppId})`}
            />
          </div>
        )}

        {/* App ID Filter - shown when "This app only" is unchecked */}
        {!currentAppOnly && (
          <TextInput
            label="App ID"
            value={appIdFilter}
            onChange={(value: string) => setAppIdFilter(value)}
            placeholder="Filter by app..."
          />
        )}
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          Showing {accumulatedLogs.length} of {total.toLocaleString()} logs
        </span>
        {autoRefresh && (
          <span className="flex items-center gap-1 text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Auto-refreshing every 10s
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="border rounded-lg p-4 flex items-start justify-between bg-intents-ux-alert-destructive-backgroundColor border-intents-ux-alert-destructive-borderColor">
          <div className="flex items-start gap-3">
            <AlertIcon className="text-intents-ux-text-destructive size-5" />
            <div>
              <text.p className="font-semibold" emphasis="critical">Error fetching logs</text.p>
              <text.p className="text-sm" emphasis="critical">{error}</text.p>
            </div>
          </div>
          <Button
            design="inline"
            onClick={handleRefresh}
            text="Retry"
          />
        </div>
      )}

      {/* Loading state */}
      {loading && accumulatedLogs.length === 0 && (
        <div className="flex flex-col justify-center items-center h-64 gap-4">
          <Spinner size="md" />
          <text.p className="text-gray-500">Loading logs...</text.p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && accumulatedLogs.length === 0 && (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
          <text.p className="text-gray-500 text-lg mb-2">No logs found</text.p>
          <text.p className="text-gray-400 text-sm">
            Try adjusting your filters or time range
          </text.p>
        </div>
      )}

      {/* Logs table */}
      {accumulatedLogs.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-40">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-16">Level</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-28">App ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-48">Event</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accumulatedLogs.map((log) => (
                  <React.Fragment key={log.id}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(log.id)}
                    >
                      <td className="px-4 py-3 font-mono text-gray-600 whitespace-nowrap text-xs">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={getLogLevelBadgeClass(log.level)}>
                          {log.level.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {log.appId ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAppIdFilter(log.appId || '');
                            }}
                            className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline"
                            title="Click to filter by this App ID"
                          >
                            {log.appId}
                          </button>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 truncate max-w-[200px]" title={log.event}>
                        {log.event || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-800 text-sm truncate max-w-md">
                        {log.message}
                      </td>
                    </tr>
                    {expandedLog === log.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="space-y-3">
                            {/* Full message */}
                            <div>
                              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                                Full Message
                              </div>
                              <pre className="text-sm bg-white p-3 rounded border border-gray-200 overflow-x-auto whitespace-pre-wrap break-words">
                                {log.message}
                              </pre>
                            </div>
                            {/* Metadata */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                              {log.appId && (
                                <div>
                                  <span className="text-gray-500">App ID:</span>{' '}
                                  <span className="font-mono text-gray-700">{log.appId}</span>
                                </div>
                              )}
                              {log.service && (
                                <div>
                                  <span className="text-gray-500">Service:</span>{' '}
                                  <span className="font-mono text-gray-700">{log.service}</span>
                                </div>
                              )}
                              {log.version && (
                                <div>
                                  <span className="text-gray-500">Version:</span>{' '}
                                  <span className="font-mono text-gray-700">{log.version}</span>
                                </div>
                              )}
                              {log.environment && (
                                <div>
                                  <span className="text-gray-500">Environment:</span>{' '}
                                  <span className="font-mono text-gray-700">{log.environment}</span>
                                </div>
                              )}
                              {log.region && (
                                <div>
                                  <span className="text-gray-500">Region:</span>{' '}
                                  <span className="font-mono text-gray-700">{log.region}</span>
                                </div>
                              )}
                              {log.hostname && (
                                <div>
                                  <span className="text-gray-500">Host:</span>{' '}
                                  <span className="font-mono text-gray-700">{log.hostname}</span>
                                </div>
                              )}
                            </div>
                            {/* Raw JSON */}
                            <div>
                              <div className="text-xs font-semibold text-gray-500 uppercase mb-1">
                                Raw Log Data
                              </div>
                              <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
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
            <div className="p-4 border-t border-gray-200 bg-gray-50 text-center">
              <Button
                design="secondary"
                onClick={loadMore}
                disabled={loading}
                text={loading ? 'Loading...' : `Load more (${total - accumulatedLogs.length} remaining)`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

