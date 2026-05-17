/**
 * Merged-streams Loki helper.
 *
 * Loki performs much better when one query covers all three streams
 * (`airo-agents` + `airo-preview-application` + `airo-publish-application`)
 * than when three independent queries fan out — the support team
 * specifically called out that "amount of simultaneous queries" is the
 * bottleneck. This helper centralizes the merged query so every caller
 * (the Logs tab API, app-context aggregation, and any future surface)
 * uses the same shape.
 *
 * When an `appId` is provided the cluster is resolved from the agent URL
 * and added as a label selector (`cluster="<id>"`). Without cluster, Loki
 * regex-scans every cluster's logs even when the app lives in only one.
 */

import { resolveAppCluster } from '@/lib/investigate/evidence';
import { getLogSourceConfig } from '@/lib/log-sources';
import type { LogSourceConfig } from '@/lib/log-sources';
import { buildLokiQuery, findMinTimestampNs, findMinTimestampNsRaw, MAX_LOKI_FETCH, queryLoki, transformLokiResponse } from '@/lib/loki-client';
import type { LogEntry } from '@/lib/loki-client';

// Shared identifiers (also imported directly by the client component).
export { MERGED_LOKI_SOURCE_IDS, MERGED_LOKI_SOURCE_ID, isMergedLokiSource } from '@/lib/loki-source-ids';
import { isMergedLokiSource, MERGED_LOKI_SOURCE_IDS } from '@/lib/loki-source-ids';

/**
 * Maps a Loki `job` stream label to the per-source `sourceId` we tag each
 * log with. Keep in sync with the Loki source registry in `log-sources.ts`.
 */
export const MERGED_LOKI_JOB_TO_SOURCE_ID: Record<string, string> = {
  'airo-agents': 'airo-agents',
  'airo-preview-application': 'airo-preview',
  'airo-publish-application': 'airo-publish',
};
export const MERGED_LOKI_JOBS = Object.keys(MERGED_LOKI_JOB_TO_SOURCE_ID);

export interface MergedLokiQueryParams {
  appId?: string;
  levelsFilter?: string;
  query?: string;
  startTime?: string;
  endTime?: string;
  /**
   * Full-precision override for Loki's `end` parameter as a nanosecond string.
   * When set, takes precedence over `endTime` (which would otherwise be ISO
   * → ms → ns and lose sub-ms precision). Used for cursor pagination so the
   * next-page boundary is exactly `cursorNs - 1n`, not `floor(cursorNs/1e6)
   * × 1e6`.
   */
  endTimeNs?: string;
  // Optional override; defaults to MAX_LOKI_FETCH. Keep the seam for callers
  // that genuinely want a tighter cap (e.g. evidence sampling), but most
  // surfaces should let it default.
  size?: number;
}

export interface MergedLokiQueryResult {
  logs: LogEntry[];
  /**
   * `true` when the response exactly hit the requested cap, so older logs
   * almost certainly exist. Kept for backwards-compat with app-context callers
   * that don't paginate; the Logs tab uses `nextCursor` instead.
   */
  truncated: boolean;
  /**
   * Opaque cursor for the next page. For Loki this is the nanosecond
   * timestamp of the oldest returned log (`_loki_timestamp_ns`); the caller
   * passes it back as `endTime - 1ns` for the next request, which causes
   * Loki to return logs strictly older than the last seen one. Undefined
   * when no further pages exist (response shorter than requested cap).
   */
  nextCursor?: string;
}

/**
 * Run one merged Loki query covering all three jobs. Returns logs tagged
 * with their per-source `sourceId` derived from the `job` stream label.
 *
 * The caller is responsible for catching errors — we re-throw so callers can
 * decide whether to log + fall through (typical for app-context summaries)
 * or surface to the user (typical for the Logs tab API).
 */
export async function queryMergedLokiSources(
  params: MergedLokiQueryParams
): Promise<MergedLokiQueryResult> {
  // Reuse the airo-agents config for endpoint/apiKey/env. All three jobs
  // live on the same Loki instance — `job` is what differentiates them and
  // we replace it with a regex matcher below via `lokiJobsRegex`.
  const baseConfig = getLogSourceConfig('airo-agents');
  if (!baseConfig) {
    throw new Error('Loki not configured (airo-agents source missing)');
  }

  const labelsWithoutJob: Record<string, string> = {};
  for (const [k, v] of Object.entries(baseConfig.lokiLabels || {})) {
    if (k !== 'job') labelsWithoutJob[k] = v;
  }
  if (params.appId) {
    const cluster = await resolveAppCluster(params.appId);
    if (cluster) labelsWithoutJob.cluster = cluster;
  }

  const config = {
    lokiEndpoint: baseConfig.lokiEndpoint,
    lokiApiKey: baseConfig.lokiApiKey,
    lokiLabels: labelsWithoutJob,
    lokiJobsRegex: MERGED_LOKI_JOBS,
    environment: baseConfig.environment,
  };

  const lokiParams = await buildLokiQuery({
    levelsFilter: params.levelsFilter,
    query: params.query,
    appId: params.appId,
    startTime: params.startTime,
    endTime: params.endTime,
    size: params.size,
  }, config);

  if (params.endTimeNs) {
    // Override after build to bypass the ISO→ms→ns conversion in
    // buildLokiQuery and preserve the full nanosecond precision the caller
    // computed (e.g. `cursorNs - 1n`).
    lokiParams.end = params.endTimeNs;
  }

  const response = await queryLoki(config, lokiParams);

  const logs = transformLokiResponse(
    response,
    baseConfig.fieldMapping,
    (streamLabels) => MERGED_LOKI_JOB_TO_SOURCE_ID[streamLabels.job] || 'unknown',
  );

  // Truncation = "Loki returned the cap; there may be more." Compare against
  // the raw entry count from Loki, not `logs.length` — `transformLokiResponse`
  // silently skips malformed JSON entries, so a fully-saturated `cap`-sized
  // response with K parse failures would otherwise look "complete" (length
  // < cap → truncated false) and the cursor would disappear with older logs
  // still available.
  const cap = params.size ?? MAX_LOKI_FETCH;
  const rawEntryCount = response.data.result.reduce((sum, s) => sum + s.values.length, 0);
  const truncated = rawEntryCount >= cap;
  // Cursor uses the parsed-logs min, falling back to raw streams when every
  // entry on a saturated page failed to parse — see findMinTimestampNsRaw
  // jsdoc for why the fallback exists.
  const nextCursor = truncated
    ? (findMinTimestampNs(logs) ?? findMinTimestampNsRaw(response.data.result))
    : undefined;
  return { logs, truncated, nextCursor };
}

/**
 * Partition a list of source IDs into "the ones the merged query covers"
 * vs "everyone else." Callers use this to decide whether to fire the
 * merged path at all.
 */
export function partitionMergedLokiSources(sourceIds: string[]): {
  mergedLokiIds: string[];
  otherIds: string[];
} {
  const mergedLokiIds: string[] = [];
  const otherIds: string[] = [];
  for (const id of sourceIds) {
    if (isMergedLokiSource(id)) {
      mergedLokiIds.push(id);
    } else {
      otherIds.push(id);
    }
  }
  return { mergedLokiIds, otherIds };
}

/**
 * `true` when all three merged-query Loki source IDs are present in the
 * input — only then is firing the merged query strictly equivalent to per-
 * source fan-out. With a partial subset we fall back to per-source so we
 * don't over-fetch.
 */
export function shouldUseMergedLokiQuery(sourceIds: string[]): boolean {
  return MERGED_LOKI_SOURCE_IDS.every((id) => sourceIds.includes(id));
}

// Type re-export for callers that want to keep their imports tight.
export type { LogSourceConfig };
