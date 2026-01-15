/**
 * Token Refresh Utilities
 * 
 * Handles automatic JWT token refresh when tokens become too old
 * for the gateway, even if they haven't expired yet.
 */

import { getAuthTokenFromCookie } from '@/lib/auth/cookie-utils';
import { logger } from '@/lib/request-context';
import { decodeJWT } from '@/lib/utils/jwt-utils';

/**
 * Parse environment variable as integer with fallback default
 */
function parseEnvInt(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  return parseInt(envVar, 10);
}

// Maximum token age before gateway rejects (configurable via env)
const MAX_TOKEN_AGE_MS = parseEnvInt(
  process.env.MAX_TOKEN_AGE_MS,
  30 * 60 * 1000 // Default: 30 minutes
);

// Refresh threshold - when to proactively refresh (configurable via env)
const REFRESH_THRESHOLD_MS = parseEnvInt(
  process.env.REFRESH_THRESHOLD_MS,
  25 * 60 * 1000 // Default: 25 minutes (5 min buffer)
);

/**
 * Check if a JWT token is too old for the gateway
 */
export function isTokenTooOld(token: string): boolean {
  try {
    const payload = decodeJWT(token);
    if (!payload?.iat) return true;
    
    const tokenAge = Date.now() - (payload.iat * 1000);
    return tokenAge > MAX_TOKEN_AGE_MS;
  } catch {
    return true; // If we can't decode it, consider it too old
  }
}

/**
 * Check if a JWT token should be refreshed soon
 */
export function shouldRefreshToken(token: string): boolean {
  try {
    const payload = decodeJWT(token);
    if (!payload?.iat) return true;
    
    const tokenAge = Date.now() - (payload.iat * 1000);
    return tokenAge > REFRESH_THRESHOLD_MS;
  } catch {
    return true;
  }
}

/**
 * Get token age in minutes
 */
export function getTokenAgeMinutes(token: string): number {
  try {
    const payload = decodeJWT(token);
    if (!payload?.iat) return Infinity;
    
    const tokenAge = Date.now() - (payload.iat * 1000);
    return Math.floor(tokenAge / (60 * 1000));
  } catch {
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
    logger.warn('auth.token-refresh.too-old', {
      tokenAge: getTokenAgeMinutes(token),
      maxAge: MAX_TOKEN_AGE_MS / (60 * 1000)
    });
    await triggerTokenRefresh();
    return false;
  }
  
  if (shouldRefreshToken(token)) {
    logger.info('auth.token-refresh.proactive', {
      tokenAge: getTokenAgeMinutes(token),
      threshold: REFRESH_THRESHOLD_MS / (60 * 1000)
    });
    // Don't block current operation, but trigger refresh in background
    setTimeout(() => triggerTokenRefresh(), 1000);
  }
  
  return true;
}

