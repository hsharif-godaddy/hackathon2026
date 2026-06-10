/** A failed request or non-2xx response observed during capture. */
export interface NetworkFailure {
  url: string;
  /** "HTTP 429", "HTTP 500", or the request failure().errorText. */
  detail: string;
  /** True when status is 429 or the response carried a Retry-After header. */
  isRateLimit: boolean;
}

/** Default cap on distinct failures retained per capture (see {@link NetworkFailureLog}). */
export const DEFAULT_MAX_NETWORK_FAILURES = 50;

/**
 * Bounded, de-duplicated recorder for {@link NetworkFailure}s seen during a
 * capture.
 *
 * A capture reloads the preview up to ~6 times across the 30s readiness window,
 * and each reload can re-fire the same failing sub-resource responses. Pushing
 * every event unbounded let a page with many broken sub-resources accumulate
 * 300+ entries that were then serialized verbatim into diagnostics JSON. This
 * log collapses repeats by `url+detail` (so a resource that 500s on every retry
 * is recorded once) and caps the distinct set at {@link DEFAULT_MAX_NETWORK_FAILURES}.
 *
 * Ordering is insertion order of first occurrence, which the readiness loop
 * relies on when it inspects only failures recorded since a given point.
 */
export class NetworkFailureLog {
  // Keyed by `${url}\n${detail}` → the first NetworkFailure recorded for it.
  // A Map preserves first-occurrence order and gives O(1) dedup lookup.
  private readonly byKey = new Map<string, NetworkFailure>();
  private capped = false;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_NETWORK_FAILURES) {}

  /**
   * Record a failure. Duplicates (same url+detail) and entries beyond the cap
   * are dropped. Returns true when this call added a new distinct entry.
   */
  record(failure: NetworkFailure): boolean {
    const key = `${failure.url}\n${failure.detail}`;
    if (this.byKey.has(key)) return false;
    if (this.byKey.size >= this.maxEntries) {
      this.capped = true;
      return false;
    }
    this.byKey.set(key, failure);
    return true;
  }

  /** Number of distinct failures currently recorded. */
  get size(): number {
    return this.byKey.size;
  }

  /** True once at least one failure was dropped because the cap was reached. */
  get wasCapped(): boolean {
    return this.capped;
  }

  /** Distinct failures in first-occurrence order. */
  toArray(): NetworkFailure[] {
    return [...this.byKey.values()];
  }
}
