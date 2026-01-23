/**
 * Token Age Monitoring Utilities
 *
 * Provides functions to monitor JWT token ages for observability.
 *
 * Gateway Requirements (from SSO team):
 * - vat (validated at time) must be ≤ 5 minutes old
 *   → Browser heartbeat updates this automatically every ~4 minutes
 * - iat (issued at time) must be ≤ 12 hours old (per=true tokens, 99% of cases)
 *   → Requires full re-login after 12 hours
 *
 * Philosophy:
 * - Gateway is the authoritative source of truth for token validity
 * - These utilities provide proactive fail-fast validation to:
 *   - Prevent wasted gateway API calls
 *   - Stop retry loops before they start
 *   - Provide better error messages and UX
 * - Also used for logging and diagnostics
 * - If gateway rejects a token (401), authFetch handles the redirect to SSO
 */

import { getAuthTokenFromCookie } from '@/lib/auth/cookie-utils';
import { logger } from '@/lib/request-context';
import { decodeJWT as decodeJWTUtil } from '@/lib/utils/jwt-utils';

// Re-export for convenience
export { decodeJWT } from '@/lib/utils/jwt-utils';

/**
 * Parse environment variable as integer with fallback default
 */
function parseEnvInt(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  return parseInt(envVar, 10);
}

// Gateway requirements (from SSO team):
// - vat must be ≤ 5 minutes old (browser heartbeat handles this automatically every ~4 min)
// - iat must be ≤ 12 hours old for per=true tokens (99% of tokens)
// - iat must be ≤ 1 hour old for per=false tokens

// Maximum iat age for per=true tokens (configurable via env)
const MAX_IAT_AGE_WITH_PER_MS = parseEnvInt(
  process.env.MAX_IAT_AGE_WITH_PER_MS,
  12 * 60 * 60 * 1000 // Default: 12 hours
);

// Maximum iat age for per=false tokens (configurable via env)
const MAX_IAT_AGE_WITHOUT_PER_MS = parseEnvInt(
  process.env.MAX_IAT_AGE_WITHOUT_PER_MS,
  60 * 60 * 1000 // Default: 1 hour
);

// Maximum vat age before gateway rejects (configurable via env)
const MAX_VAT_AGE_MS = parseEnvInt(
  process.env.MAX_VAT_AGE_MS,
  5 * 60 * 1000 // Default: 5 minutes
);

// Refresh threshold - when to proactively refresh (configurable via env)
// Default to 11 hours for per=true tokens (1 hour buffer before 12-hour limit)
const REFRESH_THRESHOLD_MS = parseEnvInt(
  process.env.REFRESH_THRESHOLD_MS,
  11 * 60 * 60 * 1000 // Default: 11 hours
);

/**
 * Check if a JWT token exceeds gateway age limits
 *
 * Gateway checks BOTH timestamps:
 * 1. vat (validated at time) must be ≤ 5 minutes old
 *    - Browser heartbeat updates this automatically every ~4 minutes
 *    - This check catches cases where heartbeat failed
 * 2. iat (issued at time) must be within limit based on per flag:
 *    - per=true (99% of tokens): ≤ 12 hours
 *    - per=false: ≤ 1 hour
 *
 * Fail-fast pattern benefits:
 * - Prevents wasted gateway API calls for tokens we know will be rejected
 * - Stops retry loops before they start (better UX)
 * - Provides clearer error context in logs
 *
 * The gateway remains the authoritative source - if a token passes our checks
 * but gateway still rejects it (401), authFetch will handle the SSO redirect.
 */
export function isTokenTooOld(token: string): boolean {
  try {
    const payload = decodeJWTUtil(token);

    // Check vat (validated at time) - must be ≤ 5 minutes old
    if (payload?.vat) {
      const vatAge = Date.now() - (payload.vat * 1000);
      if (vatAge > MAX_VAT_AGE_MS) {
        return true; // vat too old - heartbeat may have failed
      }
    }

    // Check iat (issued at time) based on per flag
    if (payload?.iat) {
      const iatAge = Date.now() - (payload.iat * 1000);
      const hasPer = payload.per === true || payload.per === 'true';
      const maxIatAge = hasPer ? MAX_IAT_AGE_WITH_PER_MS : MAX_IAT_AGE_WITHOUT_PER_MS;

      if (iatAge > maxIatAge) {
        return true; // iat too old - need full re-login
      }
    }

    return false;
  } catch (error) {
    logger.debug('auth.token.decode-failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to decode JWT token, treating as too old'
    });
    return true; // If we can't decode it, consider it too old
  }
}

/**
 * Check if a JWT token is approaching the gateway age limit
 *
 * Returns true if iat is approaching the 12-hour limit (default: 11 hours).
 * vat is automatically kept fresh by browser heartbeat, so we don't check it here.
 *
 * NOTE: This is for monitoring/diagnostic purposes only. The browser heartbeat
 * and natural re-login flow will handle token refresh automatically.
 */
export function shouldRefreshToken(token: string): boolean {
  try {
    const payload = decodeJWTUtil(token);

    // Check if iat is approaching the limit (default: 11 hours for per=true)
    if (payload?.iat) {
      const iatAge = Date.now() - (payload.iat * 1000);
      return iatAge > REFRESH_THRESHOLD_MS;
    }

    return false;
  } catch (error) {
    logger.debug('auth.token.decode-failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to decode JWT token in shouldRefreshToken'
    });
    return true;
  }
}

/**
 * Get token age in minutes based on iat (issued at time)
 *
 * This is used for logging and diagnostics to show how long since original login.
 */
export function getTokenAgeMinutes(token: string): number {
  try {
    const payload = decodeJWTUtil(token);
    if (!payload?.iat) return Infinity;

    const tokenAge = Date.now() - (payload.iat * 1000);
    return Math.floor(tokenAge / (60 * 1000));
  } catch (error) {
    logger.debug('auth.token.decode-failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to decode JWT token in getTokenAgeMinutes'
    });
    return Infinity;
  }
}

/**
 * Get token validation age in minutes based on vat (validated at time)
 *
 * This shows how long since the token was last validated via heartbeat.
 */
export function getTokenValidationAgeMinutes(token: string): number {
  try {
    const payload = decodeJWTUtil(token);
    if (!payload?.vat) return Infinity;

    const vatAge = Date.now() - (payload.vat * 1000);
    return Math.floor(vatAge / (60 * 1000));
  } catch (error) {
    logger.debug('auth.token.decode-failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to decode JWT token in getTokenValidationAgeMinutes'
    });
    return Infinity;
  }
}

/**
 * Trigger token refresh via SSO redirect
 * This forces a new authentication flow to get a fresh token
 */
export async function triggerTokenRefresh(): Promise<void> {
  logger.info('auth.token-refresh.triggered', {
    message: 'Token too old for gateway, triggering refresh'
  });
  
  // Get current URL for redirect after refresh
  const returnUrl = window.location.href;
  
  // Import gasket config to get login URL
  const { getLoginUrl } = await import('@/lib/gasket-config');
  const loginUrl = await getLoginUrl(returnUrl);
  
  // Redirect to SSO for fresh token
  window.location.href = loginUrl;
}

/**
 * Check token and refresh if needed (for use in API calls)
 */
export async function ensureFreshToken(): Promise<boolean> {
  const token = getAuthTokenFromCookie();
  if (!token) {
    logger.warn('auth.token-refresh.no-token', 'No token found, need to login');
    await triggerTokenRefresh();
    return false;
  }
  
  if (isTokenTooOld(token)) {
    const iatAge = getTokenAgeMinutes(token);
    const vatAge = getTokenValidationAgeMinutes(token);
    logger.warn('auth.token-refresh.too-old', {
      iatAgeMinutes: iatAge,
      vatAgeMinutes: vatAge
    });
    await triggerTokenRefresh();
    return false;
  }

  if (shouldRefreshToken(token)) {
    logger.info('auth.token-refresh.proactive', {
      iatAgeMinutes: getTokenAgeMinutes(token),
      thresholdMinutes: REFRESH_THRESHOLD_MS / (60 * 1000)
    });
    // Don't block current operation, but trigger refresh in background
    setTimeout(() => triggerTokenRefresh(), 1000);
  }
  
  return true;
}

