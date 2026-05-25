'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { LogEntry, LogSource } from '@/lib/log-types';
import {
  isMergedLokiSource,
  MERGED_LOKI_SOURCE_ID,
  MERGED_LOKI_SOURCE_IDS,
} from '@/lib/loki-source-ids';

/**
 * Shared per-source fetcher for `/api/es-logs`. Both the raw Logs view and
 * the grouped Summary view call this hook; when their input shapes happen to
 * produce the same per-request cache keys, the second consumer hits the cache
 * with no network round-trip. That's the win: toggling Logs ↔ Summary doesn't
 * refetch when the user has only "error" checked and no filter text.
 *
 * The cache is module-level (survives in-SPA navigation, not full reload) and
 * keyed per-`requestId` (the merged-loki sentinel or a single source id) — NOT
 * per-fan-out — so each leg is shared independently.
 */

const ALL_SOURCES = 'all';

const SOURCE_FIELD_MAPPINGS: Record<string, { appIdFilterMode: 'field' | 'query' | 'none' }> = {
  'airo-agents': { appIdFilterMode: 'field' },
  'airo-app': { appIdFilterMode: 'field' },
  'airo-preview': { appIdFilterMode: 'field' },
  'airo-publish': { appIdFilterMode: 'field' },
  'airo-pre-start': { appIdFilterMode: 'field' },
  'airo-db-init': { appIdFilterMode: 'field' },
  'airo-secrets-worker': { appIdFilterMode: 'field' },
  'control_plane': { appIdFilterMode: 'field' },
};
const DEFAULT_FIELD_MAPPING = { appIdFilterMode: 'field' as const };

export interface RequestState {
  logs: LogEntry[];
  nextCursor?: string;
  total?: number;
  warning?: string;
}

interface CacheEntry {
  state: RequestState;
  expiresAt: number;
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 50;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RequestState>>();

interface KeyArgs {
  requestId: string;
  appId: string;
  timeKey: string;
  levelsKey: string;
  filterText: string;
  query: string;
}

function makeKey(args: KeyArgs): string {
  return [
    args.requestId,
    args.appId,
    args.timeKey,
    args.levelsKey,
    args.filterText,
    args.query,
  ].join('|');
}

function readCache(key: string): RequestState | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() >= hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.state;
}

function writeCache(key: string, state: RequestState): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { state, expiresAt: Date.now() + TTL_MS });
}

/**
 * Drop cached entries for an appId. Called when the user clicks Refresh so
 * they always see a live fetch on demand. Scoped by appId rather than
 * globally so an unrelated tab doesn't lose its entries.
 */
export function invalidateLogFetcherCache(appId: string): void {
  for (const key of cache.keys()) {
    // Cache key shape puts requestId first, appId second — match on the
    // segment after the first separator.
    const [, keyAppId] = key.split('|');
    if (keyAppId === appId) cache.delete(key);
  }
}

/** Test-only: wipe the entire cache + in-flight maps so each test sees a clean slate. */
export function __clearLogFetcherCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}

export interface UseLogFetcherInput {
  sources: LogSource[];
  selectedSource: string;
  appId?: string;
  rangeMode: 'preset' | 'custom';
  presetValue: string;
  customStartIso: string | null;
  customEndIso: string | null;
  levels: { error: boolean; warn: boolean };
  filterText: string;
  query: string;
  refreshKey: number;
  /**
   * When false, the hook holds whatever state it had and skips fetching.
   * Used by LogsPanel/LogsSummaryView to gate the off-screen view's fetch.
   */
  enabled: boolean;
}

export interface UseLogFetcherOutput {
  requestStates: Record<string, RequestState>;
  requestSourceIds: string[];
  allLogs: LogEntry[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  warnings: { id: string; message: string }[];
  loadMore: () => Promise<void>;
  retryRequest: (requestId: string) => Promise<void>;
}

interface FetchPageArgs {
  requestId: string;
  cursor?: string;
  appId: string;
  timeKey: string;
  levelsKey: string;
  filterText: string;
  query: string;
  rangeMode: 'preset' | 'custom';
  presetValue: string;
  customStartIso: string | null;
  customEndIso: string | null;
  levels: { error: boolean; warn: boolean };
}

async function fetchPage(args: FetchPageArgs): Promise<RequestState> {
  const fm = SOURCE_FIELD_MAPPINGS[args.requestId] || DEFAULT_FIELD_MAPPING;
  const urlParams = new URLSearchParams();
  urlParams.set('source', args.requestId);

  const levelTerms = Object.entries(args.levels)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(' ');
  const searchTerms = [levelTerms, args.filterText, args.query].filter(Boolean).join(' ');

  if (args.appId && fm.appIdFilterMode !== 'none') {
    if (fm.appIdFilterMode === 'field') {
      urlParams.set('appId', args.appId);
      if (searchTerms) urlParams.set('query', searchTerms);
    } else if (fm.appIdFilterMode === 'query') {
      const combined = `${searchTerms} ${args.appId}`.trim();
      if (combined) urlParams.set('query', combined);
    }
  } else if (searchTerms) {
    urlParams.set('query', searchTerms);
  }

  if (args.rangeMode === 'custom') {
    if (args.customStartIso) urlParams.set('startTime', args.customStartIso);
    if (args.customEndIso) urlParams.set('endTime', args.customEndIso);
  } else if (args.presetValue !== 'all') {
    const now = new Date();
    const value = parseInt(args.presetValue.slice(0, -1), 10);
    const unit = args.presetValue.slice(-1);
    const startTime = new Date(now);
    switch (unit) {
      case 'm': startTime.setMinutes(startTime.getMinutes() - value); break;
      case 'h': startTime.setHours(startTime.getHours() - value); break;
      case 'd': startTime.setDate(startTime.getDate() - value); break;
    }
    urlParams.set('startTime', startTime.toISOString());
    urlParams.set('endTime', now.toISOString());
  }

  if (args.cursor) urlParams.set('cursor', args.cursor);

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
  const logs: LogEntry[] = (data.logs || []).map((log: LogEntry) =>
    log.sourceId ? log : { ...log, sourceId: args.requestId },
  );
  const warningText = data.warning
    ? data.details
      ? `${data.warning}: ${data.details}`
      : (data.warning as string)
    : undefined;
  return {
    logs,
    nextCursor: data.nextCursor as string | undefined,
    total: typeof data.total === 'number' ? data.total : undefined,
    warning: warningText,
  };
}

function buildLevelsKey(levels: { error: boolean; warn: boolean }): string {
  const enabled: string[] = [];
  if (levels.error) enabled.push('error');
  if (levels.warn) enabled.push('warn');
  return enabled.sort().join(',');
}

function buildTimeKey(input: Pick<UseLogFetcherInput, 'rangeMode' | 'presetValue' | 'customStartIso' | 'customEndIso'>): string {
  if (input.rangeMode === 'custom') {
    return `c:${input.customStartIso ?? ''}..${input.customEndIso ?? ''}`;
  }
  return `p:${input.presetValue}`;
}

export function useLogFetcher(input: UseLogFetcherInput): UseLogFetcherOutput {
  const {
    sources,
    selectedSource,
    appId = '',
    rangeMode,
    presetValue,
    customStartIso,
    customEndIso,
    levels,
    filterText,
    query,
    refreshKey,
    enabled,
  } = input;

  const [requestStates, setRequestStates] = useState<Record<string, RequestState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache key fragments. Stable strings so React deps compare cleanly.
  const timeKey = buildTimeKey({ rangeMode, presetValue, customStartIso, customEndIso });
  const levelsKey = buildLevelsKey(levels);

  // "All" → fan out across every configured source, swapping the three
  // Loki sources for one merged-Loki request when all three are present.
  const requestSourceIds = useMemo(() => {
    if (selectedSource === ALL_SOURCES) {
      const allIds = sources.map((s) => s.id);
      const lokiIds = allIds.filter(isMergedLokiSource);
      if (lokiIds.length === MERGED_LOKI_SOURCE_IDS.length) {
        return [MERGED_LOKI_SOURCE_ID, ...allIds.filter((id) => !isMergedLokiSource(id))];
      }
      return allIds;
    }
    return [selectedSource];
  }, [sources, selectedSource]);

  // Stable joined string for use as a useEffect dep — array identity changes
  // on every render even when contents match.
  const requestSourceIdsKey = requestSourceIds.join(',');

  // Per-instance generation. Every fetchInitial bumps it; in-flight legs that
  // resolve under a stale generation skip the React commit.
  const fetchGenRef = useRef(0);

  // Pin the latest `levels` object on a ref so the fetch callback can read
  // current content without taking the object as a useCallback dep — callers
  // that pass an inline object literal would otherwise create a fresh
  // identity every render and re-trigger the fetch effect, freezing the tab.
  // `levelsKey` is the source of truth in the dep list; the ref just lets
  // `fetchPage` enumerate the enabled keys.
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  // Fetch a single requestId via the shared in-flight + cache. The in-flight
  // map coalesces concurrent calls for the same key (e.g. both views asking
  // at once); cache hits short-circuit before any network or in-flight work.
  const fetchPageCached = useCallback(
    async (requestId: string, cursor?: string): Promise<RequestState> => {
      const baseArgs: FetchPageArgs = {
        requestId,
        appId,
        timeKey,
        levelsKey,
        filterText,
        query,
        rangeMode,
        presetValue,
        customStartIso,
        customEndIso,
        levels: levelsRef.current,
      };

      // Pagination bypasses the cache — only first-page fetches participate
      // in cache hit/coalesce. A cursored request is a continuation owned by
      // the calling component's local state.
      if (cursor) return fetchPage({ ...baseArgs, cursor });

      const key = makeKey({
        requestId,
        appId,
        timeKey,
        levelsKey,
        filterText,
        query,
      });

      const cached = readCache(key);
      if (cached) return cached;

      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = fetchPage(baseArgs)
        .then((state) => {
          writeCache(key, state);
          return state;
        })
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });

      inFlight.set(key, promise);
      return promise;
    },
    [
      appId,
      timeKey,
      levelsKey,
      filterText,
      query,
      rangeMode,
      presetValue,
      customStartIso,
      customEndIso,
    ],
  );

  // Initial / refresh fetch: clear all state, fetch first page from every
  // active requestId in parallel. Uses `Promise.allSettled` so a single
  // rejected leg doesn't discard every other source's successful response —
  // failed legs are written into `requestStates[id].warning`, which the
  // WarningStrip surfaces with a per-source Retry button. The top-level
  // `error` only fires when EVERY leg failed (no partial successes to show).
  const fetchInitial = useCallback(async () => {
    if (requestSourceIds.length === 0) {
      setRequestStates({});
      setLoading(false);
      setError(null);
      return;
    }

    const gen = ++fetchGenRef.current;
    setLoading(true);
    setError(null);

    const settled = await Promise.allSettled(
      requestSourceIds.map((id) => fetchPageCached(id).then((state) => [id, state] as const)),
    );
    if (gen !== fetchGenRef.current) return;

    const next: Record<string, RequestState> = {};
    let failed = 0;
    let firstFailureMessage: string | null = null;
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const id = requestSourceIds[i];
      if (result.status === 'fulfilled') {
        const [, state] = result.value;
        next[id] = state;
      } else {
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        next[id] = { logs: [], warning: message };
        failed++;
        if (firstFailureMessage === null) firstFailureMessage = message;
      }
    }
    setRequestStates(next);
    setError(failed === requestSourceIds.length ? firstFailureMessage : null);
    setLoading(false);
  }, [requestSourceIds, fetchPageCached]);

  // refreshKey changes purge the cache for this appId before re-fetching, so
  // the user always sees a live result on demand.
  const lastRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (!enabled) return;
    if (lastRefreshKeyRef.current !== refreshKey) {
      lastRefreshKeyRef.current = refreshKey;
      if (appId) invalidateLogFetcherCache(appId);
    }
    fetchInitial();
  }, [enabled, fetchInitial, refreshKey, appId, requestSourceIdsKey]);

  const allLogs = useMemo(() => {
    // Dedupe by `log.id` across all per-request buckets — the same Loki line
    // can land in two streams at the same nanosecond and produce identical ids.
    const seen = new Map<string, LogEntry>();
    for (const id of requestSourceIds) {
      const bucket = requestStates[id];
      if (!bucket) continue;
      for (const log of bucket.logs) {
        if (!seen.has(log.id)) seen.set(log.id, log);
      }
    }
    const merged = Array.from(seen.values());
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return merged;
  }, [requestSourceIds, requestStates]);

  const hasMore = useMemo(
    () => requestSourceIds.some((id) => Boolean(requestStates[id]?.nextCursor)),
    [requestSourceIds, requestStates],
  );

  const loadMore = useCallback(async () => {
    const ids = requestSourceIds.filter((id) => requestStates[id]?.nextCursor);
    if (ids.length === 0) return;
    const gen = fetchGenRef.current;
    setLoading(true);
    setError(null);
    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const cursor = requestStates[id]?.nextCursor;
        const page = await fetchPageCached(id, cursor);
        return [id, page] as const;
      }),
    );
    if (gen !== fetchGenRef.current) return;

    const updates: Array<readonly [string, RequestState]> = [];
    const failures: Array<readonly [string, string]> = [];
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const id = ids[i];
      if (result.status === 'fulfilled') {
        updates.push(result.value);
      } else {
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push([id, message]);
      }
    }
    setRequestStates((prev) => {
      const out = { ...prev };
      for (const [id, page] of updates) {
        const existing = out[id] ?? { logs: [] };
        out[id] = {
          logs: [...existing.logs, ...page.logs],
          nextCursor: page.nextCursor,
          total: page.total ?? existing.total,
          warning: page.warning,
        };
      }
      // Stamp a synthetic warning on rejected legs so the WarningStrip
      // surfaces them with a Retry button. Preserves the existing logs and
      // nextCursor so the user retries just the failing leg without losing
      // pages already loaded.
      for (const [id, message] of failures) {
        const existing = out[id] ?? { logs: [] };
        out[id] = { ...existing, warning: message };
      }
      return out;
    });
    setLoading(false);
  }, [requestSourceIds, requestStates, fetchPageCached]);

  const retryRequest = useCallback(
    async (requestId: string) => {
      const gen = fetchGenRef.current;
      setLoading(true);
      setError(null);
      try {
        // Bypass the cache on retry — the entry is for a soft-failed call
        // we're explicitly trying to redo.
        const key = makeKey({
          requestId,
          appId,
          timeKey,
          levelsKey,
          filterText,
          query,
        });
        cache.delete(key);
        const page = await fetchPageCached(requestId);
        if (gen !== fetchGenRef.current) return;
        setRequestStates((prev) => ({ ...prev, [requestId]: page }));
      } catch (err) {
        if (gen !== fetchGenRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to retry');
      } finally {
        if (gen === fetchGenRef.current) setLoading(false);
      }
    },
    [appId, timeKey, levelsKey, filterText, query, fetchPageCached],
  );

  const warnings = useMemo(() => {
    const out: { id: string; message: string }[] = [];
    for (const id of requestSourceIds) {
      const w = requestStates[id]?.warning;
      if (w) out.push({ id, message: w });
    }
    return out;
  }, [requestSourceIds, requestStates]);

  return {
    requestStates,
    requestSourceIds,
    allLogs,
    hasMore,
    loading,
    error,
    warnings,
    loadMore,
    retryRequest,
  };
}
