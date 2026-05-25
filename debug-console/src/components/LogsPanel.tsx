'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatTimestamp } from '@/lib/date-utils';
import type { LogEntry, LogSource } from '@/lib/log-types';
import {
  LOG_TIME_PRESETS,
  resolveInitialPreset,
  resolveSyncedPreset,
  type RangeMode,
} from '@/lib/log-time-range';
import { MERGED_LOKI_SOURCE_ID } from '@/lib/loki-source-ids';
import { useAppCluster } from '@/hooks/useAppCluster';
import { useLogFetcher } from '@/hooks/useLogFetcher';
import LogsSummaryView from './LogsSummaryView';
import QueryInspector from './QueryInspector';
import WarningStrip from './WarningStrip';

export type LogsView = 'logs' | 'summary';

export type { LogEntry, LogSource };

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
  /**
   * View mode. `logs` shows the table; `summary` swaps in the error-summary
   * aggregation. Source picker, time range, and refresh button are shared
   * across both.
   */
  view?: LogsView;
  onViewChange?: (view: LogsView) => void;
}

const INITIAL_COLUMN_WIDTHS = {
  timestamp: 160,
  source: 80
};

const SOURCE_LABELS: Record<string, string> = {
  'airo-agents': 'Agent',
  'airo-preview': 'Preview',
  'airo-publish': 'Publish',
  'airo-app': 'UI Client',
  'control_plane': 'CP',
  'loki-merged': 'Loki (Agent + Preview + Publish)',
};

// Sentinel `selectedSource` value meaning "fan out across every configured
// source (using merged Loki when all 3 Loki sources are present)". The
// merged-Loki coordination itself lives inside `useLogFetcher`.
const ALL_SOURCES = 'all';


// Frozen at module scope so it has stable identity across renders. Passing
// a fresh `{ error: true, warn: false }` object literal every render would
// thrash the hook's deps.
const SUMMARY_LEVELS = { error: true, warn: false } as const;

// localStorage key for the dropdown selection. Survives reloads so a user
// who's debugging one source repeatedly doesn't have to reselect it.
const SELECTED_SOURCE_STORAGE_KEY = 'debug-console.logs.selectedSource';

// Convert ISO string to datetime-local input value (YYYY-MM-DDTHH:MM)
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}

/**
 * Tiny CSS spinner used inline in buttons (alongside text). Reuses the
 * `spin` keyframe defined in globals.css.
 */
function InlineSpinner({ color = '#374151' }: { color?: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: '12px',
        height: '12px',
        border: `2px solid ${color === 'white' ? 'rgba(255,255,255,0.4)' : '#e5e7eb'}`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Standard debounce hook: returns the latest `value` after `delayMs` of
 * stillness. Used so a user typing in the filter input doesn't fire one
 * `Promise.all` of network requests per keystroke.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

interface LogRowProps {
  log: LogEntry;
  isSelected: boolean;
  fallbackSourceId: string;
  onToggle: () => void;
}

/**
 * Memoized row. The previous implementation re-ran `formatLogJson(log.raw)`
 * for every row on every render — selecting a row caused 50 JSON.stringify
 * calls. With React.memo + useMemo keyed on `log.id` we only do that work
 * once per log.
 */
const LogRow = React.memo(function LogRow({
  log,
  isSelected,
  fallbackSourceId,
  onToggle,
}: LogRowProps) {
  const logJson = useMemo(() => formatLogJson(log.raw), [log.id, log.raw]);
  const prettyJson = useMemo(
    () => (isSelected ? JSON.stringify(JSON.parse(logJson), null, 2) : ''),
    [isSelected, logJson]
  );
  const sourceLabel = SOURCE_LABELS[log.sourceId || fallbackSourceId] || log.sourceId || fallbackSourceId;

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          cursor: 'pointer',
          transition: 'background-color 0.15s',
          borderBottom: isSelected ? 'none' : '1px solid #f3f4f6',
          backgroundColor: isSelected ? '#eff6ff' : 'transparent',
          borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
          // F — virtualize via the platform: rows scrolled off-screen skip
          // layout/paint and report a 60 px placeholder (rough average for
          // wrapped JSON log rows) so the scroll height stays approximately
          // accurate. The browser substitutes the measured height once the
          // row enters the viewport. The selected row opts out — its
          // expanded `<pre>` is variable-height and we want it to render
          // even when scrolled to the edge.
          contentVisibility: isSelected ? undefined : 'auto',
          containIntrinsicSize: '0 60px',
        } as React.CSSProperties}
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
          {sourceLabel}
        </td>
        <td style={{
          padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem',
          // Wrap full log JSON inline. `break-all` covers very long unbroken
          // strings (URLs, base64 blobs, single-token JSON values) that
          // `break-word` won't split.
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
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
              {prettyJson}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
});

export default function LogsPanel({
  sources,
  globalAppId,
  timeRange = '1h',
  query = '',
  refreshKey = 0,
  onRefresh,
  view = 'logs',
  onViewChange,
}: LogsPanelProps) {
  const isSummary = view === 'summary';
  const [selectedLogIndex, setSelectedLogIndex] = useState<number | null>(null);
  const [filterText, setFilterText] = useState('');
  const [levelFilters, setLevelFilters] = useState({ error: true, warn: false });
  // Single-select source picker. Defaults to "all" (every configured source);
  // initial value comes from localStorage so the user's last pick survives
  // reloads. SSR-safe: `typeof window` guard means the server-render path
  // sees the default and the client hydrates with the persisted value on
  // first effect tick.
  const [selectedSource, setSelectedSource] = useState<string>(() => {
    if (typeof window === 'undefined') return ALL_SOURCES;
    return localStorage.getItem(SELECTED_SOURCE_STORAGE_KEY) || ALL_SOURCES;
  });


  // Cluster lookup tri-state for the LogQL preview. The viewer wants:
  //   - `undefined` while loading (renders `<resolved>` placeholder)
  //   - `null` when resolution returned no cluster (renders no cluster label)
  //   - the resolved id string otherwise
  const clusterResolution = useAppCluster(globalAppId);
  const inspectorCluster: string | null | undefined =
    clusterResolution.status === 'resolved' ? clusterResolution.cluster : undefined;

  // Date range state: preset dropdown OR custom absolute start/end
  const [rangeMode, setRangeMode] = useState<RangeMode>('preset');
  const [presetValue, setPresetValue] = useState<string>(() => resolveInitialPreset(timeRange));
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    return isoToLocalInput(d.toISOString());
  });
  const [customEnd, setCustomEnd] = useState<string>(() => isoToLocalInput(new Date().toISOString()));

  // Once sources are loaded, validate the persisted dropdown value: if the
  // saved id no longer matches a configured source (renamed, removed, or
  // initial pick was made before sources arrived), fall back to "all". This
  // also handles the SSR seam where the initial state defaulted to "all"
  // before localStorage was readable.
  useEffect(() => {
    if (sources.length === 0) return;
    if (selectedSource === ALL_SOURCES) return;
    const known = sources.some((s) => s.id === selectedSource);
    if (!known) setSelectedSource(ALL_SOURCES);
  }, [sources, selectedSource]);

  // Persist dropdown changes to localStorage so the next session restores
  // the same pick.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SELECTED_SOURCE_STORAGE_KEY, selectedSource);
  }, [selectedSource]);

  // Keep the local preset in sync when the parent Dashboard changes its
  // top-level time-range selector. Custom ranges are user-owned and aren't
  // overwritten by parent updates. `presetValue` is intentionally not in the
  // deps — including it would cause user-driven dropdown changes to be reset
  // back to the parent value (see resolveSyncedPreset jsdoc).
  useEffect(() => {
    const next = resolveSyncedPreset(timeRange, rangeMode);
    if (next !== null) setPresetValue(next);
  }, [timeRange, rangeMode]);

  // C — Debounce filter text. Without this, every keystroke fires a
  // Promise.all of N upstream queries.
  const debouncedFilterText = useDebouncedValue(filterText, 300);

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

  // Pre-compute the absolute ISO bounds for custom ranges so the hook's
  // cache key sees stable input strings (the user-facing inputs are local
  // datetime; the hook keys on UTC ISO).
  const customStartIso = rangeMode === 'custom' && customStart ? localInputToIso(customStart) : null;
  const customEndIso = rangeMode === 'custom' && customEnd ? localInputToIso(customEnd) : null;

  // Logs view: respects the user's level checkboxes + filter text + parent
  // query. Disabled (frozen state, no fetch) while the Summary view is
  // active.
  const logsHook = useLogFetcher({
    sources,
    selectedSource,
    appId: globalAppId,
    rangeMode,
    presetValue,
    customStartIso,
    customEndIso,
    levels: levelFilters,
    filterText: debouncedFilterText,
    query,
    refreshKey,
    enabled: !isSummary,
  });

  // Summary view: forces level=error, no free-text. When the user happens
  // to also have only "error" checked in Logs view, this hook hits the same
  // cache entries as `logsHook` — toggling between views is a no-op. Both
  // are mounted always; the `enabled` flag gates fetching.
  const summaryHook = useLogFetcher({
    sources,
    selectedSource,
    appId: globalAppId,
    rangeMode,
    presetValue,
    customStartIso,
    customEndIso,
    levels: SUMMARY_LEVELS,
    filterText: '',
    query: '',
    refreshKey,
    enabled: isSummary,
  });

  const {
    requestSourceIds,
    allLogs,
    hasMore,
    loading,
    error,
    warnings,
    loadMore,
    retryRequest,
  } = logsHook;

  // Loading state for the shared header controls (Refresh button text + the
  // indeterminate progress bar). Reads from whichever hook is currently
  // backing the active view so a refresh in summary mode actually shows the
  // user something is happening.
  const activeLoading = isSummary ? summaryHook.loading : loading;

  // Reset selection when the result set is about to change shape. The hook
  // refetches on its own when these change; here we just clear the row
  // selection so the index isn't an orphan offset into the new list.
  useEffect(() => {
    setSelectedLogIndex(null);
  }, [
    globalAppId,
    timeRange,
    rangeMode,
    presetValue,
    customStart,
    customEnd,
    debouncedFilterText,
    levelFilters,
    selectedSource,
  ]);

  /**
   * Latest values of `loadMore` / `hasMore` / `loading`, kept in refs so the
   * IntersectionObserver callback always reads current state without needing
   * to re-attach the observer on every state flip.
   */
  const loadMoreRef = useRef<() => void>(() => undefined);
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(false);

  // Mirror the latest values into refs for the IntersectionObserver callback.
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  /**
   * Auto-load on scroll: a ref callback attached to the Load More sentinel
   * wires up an IntersectionObserver. When the sentinel scrolls within 200 px
   * of the viewport bottom AND there's more to load AND we're not already
   * fetching, fire `loadMore()` automatically. The button stays in place as
   * a manual fallback.
   *
   * `root: null` watches the viewport rather than the table's overflow
   * container — this avoids depending on ref-ordering between the inner
   * sentinel and the outer container during commit, and matches user-
   * perceived "is the sentinel actually visible?".
   */
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRefCallback = useCallback((node: HTMLDivElement | null) => {
    // Tear down a previous observer first — happens when the sentinel
    // unmounts (hasMore→false) or remounts.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMoreRef.current && !loadingRef.current) {
            loadMoreRef.current();
          }
        }
      },
      { root: null, rootMargin: '200px 0px', threshold: 0 },
    );
    observerRef.current.observe(node);
  }, []);
  useEffect(() => () => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  const toggleLog = (index: number) => {
    setSelectedLogIndex((prev) => (prev === index ? null : index));
  };

  // Stable per-row toggle callbacks — avoids invalidating React.memo on every render.
  const toggleByIndex = useMemo(() => {
    const cache: Record<number, () => void> = {};
    return (index: number) => {
      if (!cache[index]) cache[index] = () => toggleLog(index);
      return cache[index];
    };
  }, []);

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
      {/* Header: source checkboxes, level filters, filter input, time-range, refresh */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.75rem',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* [Logs | Summary] segmented control. Hidden when no callback is
              passed (back-compat for any other consumer of LogsPanel). */}
          {onViewChange && (
            <div
              role="tablist"
              aria-label="View mode"
              style={{
                display: 'inline-flex',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                overflow: 'hidden',
                backgroundColor: 'white',
              }}
            >
              {(['logs', 'summary'] as const).map((mode) => {
                const active = view === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onViewChange(mode)}
                    style={{
                      padding: '0.375rem 0.875rem',
                      backgroundColor: active ? '#3b82f6' : 'white',
                      color: active ? 'white' : '#374151',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.813rem',
                      fontWeight: 500,
                      textTransform: 'capitalize',
                    }}
                  >
                    {mode}
                  </button>
                );
              })}
            </div>
          )}
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
              fontWeight: 500,
            }}
            title="Source"
          >
            <option value={ALL_SOURCES}>All Sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {!isSummary && (
            <span style={{ fontSize: '0.875rem', color: '#6b7280', marginLeft: '0.5rem' }}>
              {allLogs.length.toLocaleString()} logs
              {globalAppId && ` for ${globalAppId}`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {!isSummary && (['error', 'warn'] as const).map((lvl) => (
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
          {!isSummary && (
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
          )}
          <select
            value={rangeMode === 'custom' ? 'custom' : presetValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                setRangeMode('custom');
              } else {
                setRangeMode('preset');
                setPresetValue(v);
              }
            }}
            style={{
              padding: '0.375rem 0.5rem',
              borderRadius: '4px',
              border: '1px solid #d1d5db',
              fontSize: '0.813rem',
              backgroundColor: 'white',
              cursor: 'pointer'
            }}
            title="Time range"
          >
            {LOG_TIME_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
            <option value="custom">Custom range…</option>
          </select>
          {rangeMode === 'custom' && (
            <>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{
                  padding: '0.375rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  fontSize: '0.813rem'
                }}
                title="Start"
              />
              <span style={{ fontSize: '0.813rem', color: '#6b7280' }}>→</span>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{
                  padding: '0.375rem 0.5rem',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  fontSize: '0.813rem'
                }}
                title="End"
              />
            </>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={activeLoading}
              style={{
                padding: '0.625rem 1.25rem',
                backgroundColor: activeLoading ? '#9ca3af' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: activeLoading ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                opacity: activeLoading ? 0.85 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {activeLoading && <InlineSpinner color="white" />}
              {activeLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Indeterminate progress bar — visible on every fetch (Logs or
          Summary) so the user has an in-flight signal even when stale
          results are already on screen and only the data underneath is
          being refetched. Drives off `activeLoading` so refresh in summary
          mode shows feedback. Sits directly under the header so it reads
          as "the toolbar is working" regardless of which view is active. */}
      <div
        aria-hidden
        style={{
          position: 'relative',
          height: '2px',
          backgroundColor: '#f3f4f6',
          borderRadius: '2px',
          overflow: 'hidden',
          marginBottom: '0.5rem',
          opacity: activeLoading ? 1 : 0,
          transition: 'opacity 150ms ease',
        }}
      >
        {activeLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: '25%',
              backgroundColor: '#3b82f6',
              borderRadius: '2px',
              animation: 'indeterminateProgress 1.1s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* Summary view — error aggregation derived from logs the hook just
          fetched. Same source picker drives both views; when filter shapes
          match (user has only "error" checked), the underlying cache is
          shared with the Logs view and toggling between them is free. */}
      {isSummary && globalAppId && (
        <LogsSummaryView
          allLogs={summaryHook.allLogs}
          loading={summaryHook.loading}
          error={summaryHook.error}
          hasMore={summaryHook.hasMore}
          warnings={summaryHook.warnings}
          loadMore={summaryHook.loadMore}
          retryRequest={summaryHook.retryRequest}
          sourceLabels={SOURCE_LABELS}
        />
      )}
      {isSummary && !globalAppId && (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            color: '#6b7280',
            backgroundColor: '#f9fafb',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
          }}
        >
          Enter an app ID to see the error summary.
        </div>
      )}

      {/* Error state — fatal, the entire fetch threw (e.g. network down or
          /api/es-logs returned non-2xx). Per-source soft failures use the
          warnings strip below. */}
      {!isSummary && error && (
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

      {!isSummary && (
        <WarningStrip
          warnings={warnings}
          loading={loading}
          onRetry={retryRequest}
          sourceLabels={SOURCE_LABELS}
        />
      )}

      {/* Query viewer — collapsible read-only panel showing the query the
          panel is about to send. Renders LogQL for Loki sources and the ES
          request body for Elasticsearch sources. Hidden in Summary view
          (a derived aggregation, not a user-editable query). */}
      {!isSummary && (
        <QueryInspector
          // For "All sources" anchor on the merged-Loki sentinel — that's
          // the dominant Loki fetch path and the most useful preview, even
          // when ES sources are also fanned out behind the scenes.
          sourceId={
            selectedSource === 'all'
              ? MERGED_LOKI_SOURCE_ID
              : (requestSourceIds[0] || selectedSource)
          }
          appId={globalAppId || ''}
          cluster={inspectorCluster}
          levels={levelFilters}
          filterText={debouncedFilterText}
        />
      )}

      {/* Loading state */}
      {!isSummary && loading && allLogs.length === 0 && (
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

      {/* Empty state — only when there are also no warnings, otherwise the
          warning strip is the more accurate explanation of "why empty?". */}
      {!isSummary && !loading && !error && allLogs.length === 0 && warnings.length === 0 && (
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
      {!isSummary && allLogs.length > 0 && (
        <div style={{
          display: 'flex',
          border: '1px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden',
          minHeight: '200px'
        }}>
          <div
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
              <colgroup>
                <col style={{ width: `${columnWidths.timestamp}px` }} />
                <col style={{ width: `${columnWidths.source}px` }} />
                <col />
              </colgroup>
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
                {allLogs.map((log, index) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    isSelected={selectedLogIndex === index}
                    fallbackSourceId={log.sourceId || requestSourceIds[0] || ''}
                    onToggle={toggleByIndex(index)}
                  />
                ))}
              </tbody>
            </table>

            {/* Load more — visible whenever any active source has a server-side
                cursor for the next page. The container is also the
                IntersectionObserver sentinel, so scrolling near the bottom
                auto-fires loadMore(); the button is a manual fallback. */}
            {hasMore && (
              <div ref={sentinelRefCallback} style={{
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
                    fontWeight: 500,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {loading && <InlineSpinner />}
                  {loading ? 'Loading more…' : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
