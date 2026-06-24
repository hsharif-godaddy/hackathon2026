import { queryTranscripts } from '@/lib/supportplane/db/l1-transcript-db';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — matches dynamo-store FULL_SCAN_CACHE_TTL_MS

interface CacheEntry {
  rows: TranscriptRow[];
  expiresAt: number;
  inFlight: Promise<TranscriptRow[]> | null;
}

const cache: CacheEntry = { rows: [], expiresAt: 0, inFlight: null };

export async function getAllTranscriptsCached(): Promise<TranscriptRow[]> {
  if (Date.now() < cache.expiresAt) return cache.rows;
  if (cache.inFlight) return cache.inFlight;

  cache.inFlight = queryTranscripts({}).then((rows: TranscriptRow[]) => {
    cache.rows = rows;
    cache.expiresAt = Date.now() + CACHE_TTL_MS;
    cache.inFlight = null;
    return rows;
  }).catch((err: unknown) => {
    cache.inFlight = null;
    throw err;
  });

  return cache.inFlight;
}

export function invalidateTranscriptCache(): void {
  cache.expiresAt = 0;
  cache.rows = [];
}

// Returns cached count without triggering a scan. null = cache is cold.
// Used by the health check to report count when warm, without blocking on a slow scan.
export function getCachedTranscriptCount(): number | null {
  return Date.now() < cache.expiresAt ? cache.rows.length : null;
}
