/**
 * Short-lived cache for site validation results.
 * Keyed on `customerId:siteId:owningProduct`, caches successful validations for 5 minutes.
 * This avoids re-fetching site metadata on reconnects (which are the majority of connections).
 * The JWT itself is still validated on every request — the cache only skips the getSite() lookup.
 */

const SITE_VALIDATION_CACHE_TTL_MS = 300_000; // 5 minutes — site ownership changes are rare and JWT is validated every request
const SITE_VALIDATION_CACHE_MAX_SIZE = 1000;
const cache = new Map<string, { timestamp: number }>();

export function getSiteValidationFromCache(customerId: string, siteId: string, owningProduct?: string): boolean {
  const cacheKey = `${customerId}:${siteId}:${owningProduct ?? ''}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SITE_VALIDATION_CACHE_TTL_MS) {
    return true;
  }
  if (cached) {
    cache.delete(cacheKey);
  }
  return false;
}

export function setSiteValidationCache(customerId: string, siteId: string, owningProduct?: string): void {
  const cacheKey = `${customerId}:${siteId}:${owningProduct ?? ''}`;
  // Evict oldest entries if cache is too large
  if (cache.size >= SITE_VALIDATION_CACHE_MAX_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) {cache.delete(firstKey);}
  }
  cache.set(cacheKey, { timestamp: Date.now() });
}

export function clearSiteValidationCache(): void {
  cache.clear();
}
