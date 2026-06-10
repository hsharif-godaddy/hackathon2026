/**
 * ITC Storage Utilities
 *
 * Handles localStorage-based storage of ITC overrides with TTL expiration.
 * The stored ITC takes precedence over default PAYWALL_ITC values.
 */

import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { ITC_STORAGE_KEY, ITC_TTL_MS } from './constants';

/**
 * Structure stored in localStorage
 */
interface StoredItc {
  /** The ITC value */
  value: string;
  /** Expiration timestamp (ms since epoch) */
  expiresAt: number;
}

/** Max ITC length to prevent localStorage abuse */
const MAX_ITC_LENGTH = 128;

/** Valid ITC format: alphanumeric, underscores, hyphens */
const ITC_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Check if we're in a browser environment
 * Handles Safari private mode where localStorage access can throw
 */
function isBrowser(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return 'localStorage' in window && window.localStorage !== undefined;
  } catch {
    // Accessing localStorage may throw (e.g., SecurityError in Safari private mode)
    return false;
  }
}

/**
 * Validate and sanitize an ITC value.
 *
 * Shared single source of truth for "what is a valid `itc`": alphanumeric,
 * underscores, hyphens, non-empty, <= 128 chars. Also reused for the
 * deep-link `itc`/`itc_source` query params (see `@/lib/deeplink-prompt`),
 * which share these rules. Rejects (does not strip) disallowed input.
 *
 * @returns The trimmed ITC or null if invalid/empty/missing
 */
export function validateItc(itc: string | null | undefined): string | null {
  if (!itc) {
    return null;
  }

  const trimmed = itc.trim();

  if (!trimmed || trimmed.length > MAX_ITC_LENGTH) {
    return null;
  }

  if (!ITC_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Store an ITC override in localStorage with TTL
 *
 * @param itc - The ITC value to store
 * @param ttlMs - Time-to-live in milliseconds (defaults to 24 hours)
 */
export function setItcOverride(itc: string, ttlMs: number = ITC_TTL_MS): void {
  if (!isBrowser()) return;

  const validatedItc = validateItc(itc);
  if (!validatedItc) return;

  const stored: StoredItc = {
    value: validatedItc,
    expiresAt: Date.now() + ttlMs,
  };

  try {
    localStorage.setItem(ITC_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage might be full or disabled - fail silently
  }
}

/**
 * Get the stored ITC override if it exists and hasn't expired
 *
 * @returns The stored ITC value, or null if not found/expired
 */
export function getItcOverride(): string | null {
  if (!isBrowser()) return null;

  try {
    const raw = localStorage.getItem(ITC_STORAGE_KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as unknown;

    // Runtime validation of parsed structure
    if (
      typeof stored !== 'object' ||
      stored === null ||
      typeof (stored as StoredItc).value !== 'string' ||
      typeof (stored as StoredItc).expiresAt !== 'number' ||
      !Number.isFinite((stored as StoredItc).expiresAt)
    ) {
      clearItcOverride();
      return null;
    }

    const validStored = stored as StoredItc;

    // Check if expired
    if (Date.now() > validStored.expiresAt) {
      clearItcOverride();
      return null;
    }

    return validStored.value;
  } catch {
    // Invalid JSON or other error - clear and return null
    clearItcOverride();
    return null;
  }
}

/**
 * Clear the stored ITC override
 */
export function clearItcOverride(): void {
  if (!isBrowser()) return;

  try {
    localStorage.removeItem(ITC_STORAGE_KEY);
  } catch {
    // Fail silently
  }
}

/**
 * Get the effective ITC for a given paywall type
 *
 * Returns the stored override if available, otherwise falls back to the
 * default PAYWALL_ITC constant for the specified type.
 *
 * @param type - The paywall type: 'PUBLISH', 'UPGRADE', or 'CREDITS'
 * @returns The ITC to use for purchase attribution
 */
export function getEffectiveItc(type: keyof typeof PAYWALL_ITC): string {
  const override = getItcOverride();
  return override ?? PAYWALL_ITC[type];
}
