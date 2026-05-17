/**
 * Shared, zero-dependency identifiers for the merged-Loki request shape.
 *
 * Lives in its own file (rather than `loki-merged.ts`) so a client component
 * — which can't import the server-only helpers — can still reference the
 * same constants. Any import added here MUST stay free of process.env reads
 * and other server-only modules.
 */

/**
 * The three per-source IDs that share a Loki backend and can be queried as
 * a single merged regex-job request. Order matches the typical UI display
 * (Agent → Preview → Publish).
 */
export const MERGED_LOKI_SOURCE_IDS = ['airo-agents', 'airo-preview', 'airo-publish'] as const;

export type MergedLokiSourceId = (typeof MERGED_LOKI_SOURCE_IDS)[number];

export function isMergedLokiSource(id: string): id is MergedLokiSourceId {
  return (MERGED_LOKI_SOURCE_IDS as readonly string[]).includes(id);
}

/**
 * Synthetic source id used in `/api/es-logs?source=loki-merged` URL params
 * to pick the merged-streams handler. Not a real configured source — there
 * is no entry for this in `log-sources.ts`.
 */
export const MERGED_LOKI_SOURCE_ID = 'loki-merged';
