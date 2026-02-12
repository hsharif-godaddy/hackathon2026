'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import AlertIcon from '@ux/icon/alert';
import RefreshIcon from '@ux/icon/refresh';
import text from '@ux/text';
import TextInput from '@ux/text-input';

import { SettingsLoadingState } from '@/app/develop/components/settings/components/SettingsLoadingState';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import BigCard from '@/components/layout/BigCard';
import { type LogEntry, useLogs } from '@/hooks/useLogs';
import { useTranslations } from '@/hooks/useTranslations';

/**
 * Initial column widths
 */
const INITIAL_COLUMN_WIDTHS = {
  timestamp: 160,
  level: 64,
  appId: 112,
  event: 192
};

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
      return `${base} bg-gray-100 border border-gray-300`;
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
  const t = useTranslations();
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
  const [columnWidths, setColumnWidths] = useState(INITIAL_COLUMN_WIDTHS);
  const resizingColumnRef = useRef<keyof typeof INITIAL_COLUMN_WIDTHS | null>(null);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const PAGE_SIZE = 50;

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingColumnRef.current) return;

    const deltaX = e.clientX - startXRef.current;
    const newWidth = Math.max(50, startWidthRef.current + deltaX);

    setColumnWidths(prev => ({
      ...prev,
      [resizingColumnRef.current as string]: newWidth
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    resizingColumnRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback((column: keyof typeof INITIAL_COLUMN_WIDTHS, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingColumnRef.current = column;
    startXRef.current = e.clientX;
    startWidthRef.current = columnWidths[column];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [columnWidths, handleMouseMove, handleMouseUp]);

  // Keyboard handler for column resize
  const handleKeyDown = useCallback((column: keyof typeof INITIAL_COLUMN_WIDTHS, e: React.KeyboardEvent) => {
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
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [handleMouseMove, handleMouseUp]);

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
    <Box gap="lg" className="@container">
      <BigCard
        title={t('builder_settings_logs_title')}
        description={t('builder_settings_logs_desc')}
        button={(
          <>
            <Checkbox
              id="auto-refresh"
              name="auto-refresh"
              checked={autoRefresh}
              onChange={(checked: boolean) => setAutoRefresh(checked)}
              label={t('builder_settings_logs_button_autorefresh')}
            />
            <Button
              design="secondary"
              icon={<RefreshIcon />}
              onClick={handleRefresh}
              disabled={loading}
              text={t('builder_settings_logs_button_refresh')}
            />
          </>
        )}
      >
        <div className="cursor-default">
          {/* Filters */}
          <div className="flex flex-wrap gap-4 items-end p-4 rounded-lg border">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
              <TextInput
                label={t('builder_settings_logs_search')}
                value={searchInput}
                onChange={(value: string) => setSearchInput(value)}
                placeholder={t('builder_settings_logs_search_placeholder')}
              />
            </form>

            {/* Time Range */}
            <div className="flex flex-col gap-1">
              <label htmlFor="time-range" className="text-sm font-medium">
                {t('builder_settings_logs_time_range')}
              </label>
              <select
                id="time-range"
                name="time-range"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
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
              <label htmlFor="log-level" className="text-sm font-medium">
                Level
              </label>
              <select
                id="log-level"
                name="log-level"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2"
              >
                {LOG_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl === 'all' ? t('builder_settings_logs_all_levels') : lvl}
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
                  label={t('builder_settings_logs_app_only', { currentAppId })}
                />
              </div>
            )}

            {/* App ID Filter - shown when "This app only" is unchecked */}
            {!currentAppOnly && (
              <TextInput
                label={t('builder_settings_logs_app_id')}
                value={appIdFilter}
                onChange={(value: string) => setAppIdFilter(value)}
                placeholder={t('builder_settings_logs_app_id_placeholder')}
              />
            )}
          </div>

          {/* Stats bar */}
          <div className="flex items-center justify-between text-sm">
            <span>
              Showing {accumulatedLogs.length} of {total.toLocaleString()} logs
            </span>
            {autoRefresh && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full animate-pulse" />
                {t('builder_settings_logs_auto_refresh')}
              </span>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div className="border rounded-lg p-4 flex items-start justify-between bg-intents-ux-alert-destructive-backgroundColor border-intents-ux-alert-destructive-borderColor">
              <div className="flex items-start gap-3">
                <AlertIcon className="text-intents-ux-text-destructive size-5" />
                <div>
                  <text.p className="font-semibold" emphasis="critical">{t('builder_settings_logs_error_logs')}</text.p>
                  <text.p className="text-sm" emphasis="critical">{error}</text.p>
                </div>
              </div>
              <Button
                design="inline"
                onClick={handleRefresh}
                text={t('builder_common_retry')}
              />
            </div>
          )}

          {/* Loading state */}
          {loading && accumulatedLogs.length === 0 && (
            <SettingsLoadingState
              fullPage
              title={t('builder_settings_logs_loading_logs')}
            />
          )}

          {/* Empty state */}
          {!loading && !error && accumulatedLogs.length === 0 && (
            <div className="text-center py-16 rounded-lg border">
              <text.p className="text-lg mb-2">{t('builder_settings_logs_empty_title')}</text.p>
              <text.p className="text-gray-400 text-sm">{t('builder_settings_logs_empty_text')}</text.p>
            </div>
          )}

          {/* Logs table */}
          {accumulatedLogs.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium relative group" style={{ width: columnWidths.timestamp }}>
                        {t('builder_settings_logs_table_timestamp')}
                        <button
                          type="button"
                          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize group-hover:bg-blue-400/50 focus:bg-blue-500 focus:outline-none z-10"
                          onMouseDown={(e) => handleMouseDown('timestamp', e)}
                          onKeyDown={(e) => handleKeyDown('timestamp', e)}
                          aria-label="Resize timestamp column. Use left/right arrow keys to resize."
                          role="separator"
                          aria-orientation="vertical"
                        />
                      </th>
                      <th className="text-left px-4 py-3 font-medium relative group" style={{ width: columnWidths.level }}>
                        {t('builder_settings_logs_table_level')}
                        <button
                          type="button"
                          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize group-hover:bg-blue-400/50 focus:bg-blue-500 focus:outline-none z-10"
                          onMouseDown={(e) => handleMouseDown('level', e)}
                          onKeyDown={(e) => handleKeyDown('level', e)}
                          aria-label="Resize level column. Use left/right arrow keys to resize."
                          role="separator"
                          aria-orientation="vertical"
                        />
                      </th>
                      <th className="text-left px-4 py-3 font-medium relative group" style={{ width: columnWidths.appId }}>
                        {t('builder_settings_logs_table_app_id')}
                        <button
                          type="button"
                          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize group-hover:bg-blue-400/50 focus:bg-blue-500 focus:outline-none z-10"
                          onMouseDown={(e) => handleMouseDown('appId', e)}
                          onKeyDown={(e) => handleKeyDown('appId', e)}
                          aria-label="Resize app ID column. Use left/right arrow keys to resize."
                          role="separator"
                          aria-orientation="vertical"
                        />
                      </th>
                      <th className="text-left px-4 py-3 font-medium relative group" style={{ width: columnWidths.event }}>
                        {t('builder_settings_logs_table_event')}
                        <button
                          type="button"
                          className="absolute -right-1 top-0 bottom-0 w-2 cursor-col-resize group-hover:bg-blue-400/50 focus:bg-blue-500 focus:outline-none z-10"
                          onMouseDown={(e) => handleMouseDown('event', e)}
                          onKeyDown={(e) => handleKeyDown('event', e)}
                          aria-label="Resize event column. Use left/right arrow keys to resize."
                          role="separator"
                          aria-orientation="vertical"
                        />
                      </th>
                      <th className="text-left px-4 py-3 font-medium">{t('builder_settings_logs_table_message')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {accumulatedLogs.map((log) => (
                      <React.Fragment key={log.id}>
                        <tr
                          className="cursor-pointer transition-colors hover:bg-gray-50"
                          onClick={() => toggleExpand(log.id)}
                        >
                          <td className="px-4 py-3 font-mono whitespace-nowrap text-xs overflow-hidden">
                            {formatTimestamp(log.timestamp)}
                          </td>
                          <td className="px-4 py-3 overflow-hidden">
                            <span className={getLogLevelBadgeClass(log.level)}>
                              {log.level.toLowerCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="truncate" style={{ width: columnWidths.appId - 32 }}>
                              {log.appId ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAppIdFilter(log.appId || '');
                                  }}
                                  className="font-mono text-xs hover:underline"
                                  title={t('builder_settings_logs_button_filter')}
                                >
                                  {log.appId}
                                </button>
                              ) : (
                                <span>-</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs truncate" title={log.event}>
                            {log.event || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm truncate">
                            {log.message}
                          </td>
                        </tr>
                        {expandedLog === log.id && (
                          <tr>
                            <td colSpan={5} className="px-4 py-4">
                              <div className="space-y-3">
                                {/* Full message */}
                                <div>
                                  <div className="text-xs font-semibold uppercase mb-1">
                                    {t('builder_settings_logs_expanded_full_message')}
                                  </div>
                                  <pre className="text-sm p-3 rounded border overflow-x-auto whitespace-pre-wrap break-words">
                                    {log.message}
                                  </pre>
                                </div>
                                {/* Metadata */}
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                                  {log.appId && (
                                    <div>
                                      <span>{t('builder_settings_logs_expanded_app_id')}:</span>{' '}
                                      <span className="font-mono">{log.appId}</span>
                                    </div>
                                  )}
                                  {log.service && (
                                    <div>
                                      <span>{t('builder_settings_logs_expanded_service')}:</span>{' '}
                                      <span className="font-mono">{log.service}</span>
                                    </div>
                                  )}
                                  {log.version && (
                                    <div>
                                      <span>{t('builder_settings_logs_expanded_version')}:</span>{' '}
                                      <span className="font-mono">{log.version}</span>
                                    </div>
                                  )}
                                  {log.environment && (
                                    <div>
                                      <span>{t('builder_settings_logs_expanded_environment')}:</span>{' '}
                                      <span className="font-mono">{log.environment}</span>
                                    </div>
                                  )}
                                  {log.region && (
                                    <div>
                                      <span>{t('builder_settings_logs_expanded_region')}:</span>{' '}
                                      <span className="font-mono">{log.region}</span>
                                    </div>
                                  )}
                                  {log.hostname && (
                                    <div>
                                      <span>{t('builder_settings_logs_expanded_host')}:</span>{' '}
                                      <span className="font-mono">{log.hostname}</span>
                                    </div>
                                  )}
                                </div>
                                {/* Raw JSON */}
                                <div>
                                  <div className="text-xs font-semibold uppercase mb-1">
                                    {t('builder_settings_logs_expanded_raw')}
                                  </div>
                                  <pre className="text-xs p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
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
                <div className="p-4 border-t text-center">
                  <Button
                    design="secondary"
                    onClick={loadMore}
                    disabled={loading}
                    text={loading ? t('builder_common_loading') : t('builder_settings_logs_load_more')}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </BigCard>
    </Box>
  );
}
