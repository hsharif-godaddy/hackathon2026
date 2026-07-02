import { logger } from '@/lib/request-context';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';

/**
 * Workers Service client (GoDaddy HR).
 *
 * POST /v2/human-resources/search-workers with `Authorization: sso-jwt <JWT>`
 */

const SEARCH_WORKERS_PATH = '/v2/human-resources/search-workers';
const AUTH_SCHEME = 'sso-jwt';

const REQUEST_TIMEOUT_MS = 3_000;

// The accountName → worker GUID mapping is effectively immutable, so cache
// successful resolutions to keep repeat employee sessions off the network.
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1_000;

/** Minimal worker model returned by search-workers (more fields exist via `include`). */
interface WorkerSearchResult {
  id?: string;
  isActive?: boolean;
}

export interface ResolveCareAgentWorkerIdOptions {
  jwt: string;
  /** Request headers — the environment root domain is derived from `host`. */
  headers: Headers;
  accountName?: string;
}

interface CacheEntry {
  workerId: string;
  cachedAt: number;
}

const guidCache = new Map<string, CacheEntry>();

/** Test-only: drop all cached resolutions. */
export function clearWorkersServiceCache(): void {
  guidCache.clear();
}

function getCachedWorkerId(accountName: string): string | undefined {
  const entry: CacheEntry | undefined = guidCache.get(accountName);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    guidCache.delete(accountName);
    return undefined;
  }
  return entry.workerId;
}

function setCachedWorkerId(accountName: string, workerId: string): void {
  // Re-insert pattern for LRU: delete + set bumps to most-recent position.
  if (guidCache.has(accountName)) {
    guidCache.delete(accountName);
  } else if (guidCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey: string | undefined = guidCache.keys().next().value;
    if (oldestKey !== undefined) {
      guidCache.delete(oldestKey);
    }
  }
  guidCache.set(accountName, { workerId, cachedAt: Date.now() });
}

/**
 * Resolve the impersonating care agent's Workers Service worker GUID. Returns
 * the GUID on success, or `undefined` when the lookup cannot be completed
 * (no root domain, non-200, empty result, or transport error).
 */
export async function resolveCareAgentWorkerId(
  opts: ResolveCareAgentWorkerIdOptions,
): Promise<string | undefined> {
  const { jwt, headers, accountName } = opts;

  if (accountName) {
    const cached: string | undefined = getCachedWorkerId(accountName);
    if (cached) {
      return cached;
    }
  }

  const rootDomain: string | null = getRootDomainFromHeaders(headers);
  if (!rootDomain) {
    logger.warn('workers-service.search.failed', { reason: 'no-root-domain' });
    return undefined;
  }

  const url = `https://api.int.${rootDomain}${SEARCH_WORKERS_PATH}`;

  try {
    const response: Response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `${AUTH_SCHEME} ${jwt}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn('workers-service.search.failed', {
        status: response.status,
        statusText: response.statusText,
      });
      return undefined;
    }

    const workers: WorkerSearchResult[] = (await response.json()) as WorkerSearchResult[];
    const workerId: string | undefined =
      Array.isArray(workers) && typeof workers[0]?.id === 'string' ? workers[0].id : undefined;

    if (!workerId) {
      logger.info('workers-service.search.not-found', {});
      return undefined;
    }

    if (accountName) {
      setCachedWorkerId(accountName, workerId);
    }
    logger.debug('workers-service.search.resolved', { workerId });
    return workerId;
  } catch (err) {
    logger.warn('workers-service.search.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
