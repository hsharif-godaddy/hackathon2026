/**
 * DEV-ONLY outbound fetch instrumentation.
 *
 * Monkey-patches `globalThis.fetch` at server startup so we can see every
 * outbound HTTP call from this process: when it fired, where it went, how
 * long it took, and how often the same URL gets hit.
 *
 * Catches anything that goes through global fetch (Loki, ES, mgmt control
 * plane, agent-client, gd-auth-client). Does NOT catch AWS SDK clients —
 * those use `node:http` directly and bypass `globalThis.fetch`.
 *
 * Activated only when `NODE_ENV !== 'production'` AND
 * `DEBUG_FETCH=1` is set, so it's a deliberate opt-in (some noise on the
 * console). Import at the top of `server.ts` BEFORE any module that calls
 * `fetch` at import time.
 */

import { logger } from './logger';

interface CallStats {
  count: number;
  totalDurationMs: number;
  errors: number;
  lastCallAt: number;
  minBetweenCallsMs: number;
}

const stats = new Map<string, CallStats>();
let totalCalls = 0;
let inFlight = 0;
let peakInFlight = 0;
let summaryTimer: ReturnType<typeof setInterval> | null = null;

/** Drop query string + #fragment so different param values group together. */
function normalizeUrl(input: RequestInfo | URL): string {
  let raw: string;
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = input.url;
  const q = raw.indexOf('?');
  const h = raw.indexOf('#');
  const cut = Math.min(
    q === -1 ? raw.length : q,
    h === -1 ? raw.length : h,
  );
  return raw.slice(0, cut);
}

/**
 * Allow-list filter for which URLs to log. The user's question is "are we
 * making unnecessary repeat calls" — to answer that we want our outbound
 * traffic, not Next.js HMR/dev internal chatter (e.g. localhost source-map
 * fetches), which would drown the signal.
 */
function shouldLog(url: string): boolean {
  // Skip Next.js internal localhost dev traffic (HMR, source maps, etc.).
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) return false;
  if (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) return false;
  return true;
}

export function installDevFetchInstrumentation(): void {
  if (process.env.NODE_ENV === 'production') return;
  if (process.env.DEBUG_FETCH !== '1') return;

  const original = globalThis.fetch;
  if ((original as unknown as { __instrumented?: boolean }).__instrumented) return;

  const patched: typeof fetch = async function patchedFetch(input, init) {
    const url = normalizeUrl(input);
    const method = init?.method || 'GET';

    if (!shouldLog(url)) {
      return original(input as RequestInfo, init);
    }

    totalCalls++;
    inFlight++;
    if (inFlight > peakInFlight) peakInFlight = inFlight;

    const callNum = totalCalls;
    const start = Date.now();

    const prev = stats.get(url);
    const sinceLast = prev ? start - prev.lastCallAt : Infinity;
    const next: CallStats = prev
      ? {
          count: prev.count + 1,
          totalDurationMs: prev.totalDurationMs,
          errors: prev.errors,
          lastCallAt: start,
          minBetweenCallsMs: Math.min(prev.minBetweenCallsMs, sinceLast),
        }
      : {
          count: 1,
          totalDurationMs: 0,
          errors: 0,
          lastCallAt: start,
          minBetweenCallsMs: Infinity,
        };
    stats.set(url, next);

    // Flag near-duplicate calls (same URL within 100ms).
    const isRepeat = sinceLast < 100;

    logger.info('fetch.out', {
      n: callNum,
      url,
      method,
      perUrl: next.count,
      sinceLastMs: Number.isFinite(sinceLast) ? sinceLast : null,
      inFlight,
      ...(isRepeat ? { repeat: true } : {}),
    });

    try {
      const response = await original(input as RequestInfo, init);
      const durationMs = Date.now() - start;
      const cur = stats.get(url);
      if (cur) cur.totalDurationMs += durationMs;
      logger.info('fetch.out.done', {
        n: callNum,
        url,
        status: response.status,
        durationMs,
      });
      return response;
    } catch (err) {
      const cur = stats.get(url);
      if (cur) cur.errors += 1;
      logger.warn('fetch.out.failed', {
        n: callNum,
        url,
        durationMs: Date.now() - start,
        error: (err as Error)?.message,
      });
      throw err;
    } finally {
      inFlight--;
    }
  };

  (patched as unknown as { __instrumented: boolean }).__instrumented = true;
  globalThis.fetch = patched;

  // Periodic top-N summary so the user can spot offenders without scrolling.
  summaryTimer = setInterval(() => {
    const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
    const top = sorted.map(([url, s]) => ({
      url,
      count: s.count,
      avgMs: s.count > 0 ? Math.round(s.totalDurationMs / s.count) : 0,
      errors: s.errors,
      minBetweenMs: Number.isFinite(s.minBetweenCallsMs) ? s.minBetweenCallsMs : null,
    }));
    logger.info('fetch.summary', {
      totalCalls,
      uniqueUrls: stats.size,
      inFlight,
      peakInFlight,
      heapMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      top,
    });
  }, 15_000);
  if (typeof summaryTimer.unref === 'function') summaryTimer.unref();

  logger.info('fetch.instrumentation.installed', {
    note: 'Set DEBUG_FETCH=0 or restart without it to disable.',
  });
}

/**
 * Snapshot of current counters. Useful from a debug endpoint.
 */
export function getDevFetchStats() {
  return {
    totalCalls,
    uniqueUrls: stats.size,
    inFlight,
    peakInFlight,
    perUrl: [...stats.entries()].map(([url, s]) => ({
      url,
      count: s.count,
      avgMs: s.count > 0 ? Math.round(s.totalDurationMs / s.count) : 0,
      errors: s.errors,
      minBetweenMs: Number.isFinite(s.minBetweenCallsMs) ? s.minBetweenCallsMs : null,
    })).sort((a, b) => b.count - a.count),
  };
}
