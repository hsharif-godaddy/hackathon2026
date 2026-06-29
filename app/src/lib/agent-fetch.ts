/**
 * Agent Fetch Utility
 * Simple client-side utility for making authenticated requests to agents
 *
 * Uses appFetch for token acquisition (SSO cookies → JWT), but agent requests
 * themselves use Bearer token auth with retry-on-401 logic — a different auth
 * mechanism from appFetch's cookie-based SSO flow.
 */

import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useBillingModeStore } from '@/stores/useBillingModeStore'

export interface AgentTokenResponse {
  token: string;
  expires: string;
  siteId: string;
  type: 'jwt';
  budgetServiceEnabled: boolean;
}

export interface AgentFetchOptions extends RequestInit {
  siteId: string;
}

/** Long-running agent requests (SSE turns, etc.) can run up to ~10 minutes. */
const AGENT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Lead time before agent JWT expiry when cached tokens are treated as stale,
 * proactive refresh is scheduled, and tab-wake prefetch runs.
 * Must exceed {@link AGENT_REQUEST_TIMEOUT_MS} so a minted token outlives in-flight work.
 */
export const CACHE_BUFFER_MS = AGENT_REQUEST_TIMEOUT_MS + 5 * 60 * 1000;

/** User closed SSO without completing re-auth vs. re-auth completed but token mint still 401'd. */
export type AgentTokenFailureReason = 'auth_dismissed' | 'auth_failed';

/** Thrown when browser-side agent-token acquisition fails after handle401 recovery. */
export class AgentTokenAcquisitionError extends Error {
  readonly reason: AgentTokenFailureReason;

  constructor(reason: AgentTokenFailureReason, message: string) {
    super(message);
    this.name = 'AgentTokenAcquisitionError';
    this.reason = reason;
  }
}

/** Returns a typed auth failure reason, or null for non-auth errors. */
export function getAgentTokenAuthFailureReason(
  error: unknown,
): AgentTokenFailureReason | null {
  if (error instanceof AgentTokenAcquisitionError) {
    return error.reason;
  }
  if (error instanceof AuthDismissedError) {
    return 'auth_dismissed';
  }
  return null;
}

/** True when `error` is an agent-token auth/session failure (dismissed SSO or 401 after re-auth). */
export function isAgentTokenAuthError(error: unknown): boolean {
  return getAgentTokenAuthFailureReason(error) !== null;
}

function proactiveRefreshFailureReason(
  error: unknown,
): AgentTokenFailureReason | 'other' {
  const authReason = getAgentTokenAuthFailureReason(error);
  return authReason ?? 'other';
}

const tokenCache = new Map<string, { token: string; expires: Date }>();
const pendingTokenRequests = new Map<string, Promise<string>>();
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
let visibilityListenerAttached = false;

function attachVisibilityListener(): void {
  if (visibilityListenerAttached || typeof document === 'undefined') {
    return;
  }
  visibilityListenerAttached = true;
  document.addEventListener('visibilitychange', function onVisibilityChange() {
    if (document.visibilityState !== 'visible') {
      return;
    }
    for (const siteId of tokenCache.keys()) {
      void prefetchAgentTokenIfStale(siteId);
    }
  });
}

function clearRefreshTimer(siteId: string): void {
  const timer = refreshTimers.get(siteId);
  if (timer !== undefined) {
    clearTimeout(timer);
    refreshTimers.delete(siteId);
  }
}

function scheduleProactiveRefresh(siteId: string, expires: Date): void {
  if (typeof window === 'undefined') {
    return;
  }
  clearRefreshTimer(siteId);
  const delay = expires.getTime() - CACHE_BUFFER_MS - Date.now();
  if (delay <= 0) {
    return;
  }
  const timer = setTimeout(function proactiveRefresh() {
    refreshTimers.delete(siteId);
    void prefetchAgentTokenIfStale(siteId);
  }, delay);
  refreshTimers.set(siteId, timer);
}

function cacheBrowserToken(siteId: string, token: string, expires: Date): void {
  tokenCache.set(siteId, { token, expires });
  scheduleProactiveRefresh(siteId, expires);
  attachVisibilityListener();
}

async function prefetchAgentTokenIfStale(siteId: string): Promise<void> {
  const cached = tokenCache.get(siteId);
  if (!cached) {
    return;
  }
  const bufferThreshold = Date.now() + CACHE_BUFFER_MS;
  if (cached.expires.getTime() > bufferThreshold) {
    return;
  }
  tokenCache.delete(siteId);
  try {
    await getAgentToken(siteId);
  } catch (error) {
    logger.warn('agent-token.proactive-refresh.failed', {
      siteId,
      reason: proactiveRefreshFailureReason(error),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function requestBrowserAgentToken(siteId: string): Promise<string> {
  try {
    const response = await appFetch('/api/auth/agent-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    }, { handle401: true });

    if (!response.ok) {
      if (response.status === 401) {
        throw new AgentTokenAcquisitionError('auth_failed', 'Failed to get agent token: 401');
      }
      throw new Error(`Failed to get agent token: ${response.status}`);
    }

    const data: AgentTokenResponse = await response.json();
    cacheBrowserToken(siteId, data.token, new Date(data.expires));
    useBillingModeStore.getState().setMode(siteId, data.budgetServiceEnabled);
    return data.token;
  } catch (error) {
    if (error instanceof AuthDismissedError) {
      throw new AgentTokenAcquisitionError('auth_dismissed', 'Authentication dismissed');
    }
    throw error;
  }
}

/**
 * Get JWT token for agent communication (with caching and deduplication)
 */
export async function getAgentToken(siteId: string): Promise<string> {
  const cached = tokenCache.get(siteId);
  const bufferThreshold = Date.now() + CACHE_BUFFER_MS;
  if (cached && cached.expires.getTime() > bufferThreshold) {
    return cached.token;
  }

  const pending = pendingTokenRequests.get(siteId);
  if (pending) {
    return pending;
  }

  const tokenPromise = (async function fetchToken(): Promise<string> {
    try {
      if (typeof window === 'undefined') {
        const { getJWTService } = await import('./jwt-service');
        const result = await getJWTService().getToken({
          siteId,
          canDownload: false,
          canPublish: false,
          isE2S: false,
        });
        tokenCache.set(siteId, { token: result.token, expires: result.expires });
        return result.token;
      }
      return await requestBrowserAgentToken(siteId);
    } finally {
      pendingTokenRequests.delete(siteId);
    }
  })();

  pendingTokenRequests.set(siteId, tokenPromise);

  return tokenPromise;
}

/**
 * Clear the cached agent token for a site. Use when another transport layer
 * (e.g. the SSE EventSource) has observed a 401 and the next getAgentToken()
 * call needs to fetch a fresh token rather than hand back the stale one.
 */
export function clearAgentTokenCache(siteId: string): void {
  tokenCache.delete(siteId);
  pendingTokenRequests.delete(siteId);
  clearRefreshTimer(siteId);
  useBillingModeStore.getState().clearMode(siteId);
}

/**
 * Authenticated fetch for agent API calls.
 * Uses Bearer token auth with retry-on-401 logic.
 */
export async function agentFetch(url: string, options: AgentFetchOptions): Promise<Response> {
  const { siteId, ...fetchOptions } = options;

  const token = await getAgentToken(siteId);

  const isFormData = fetchOptions.body instanceof FormData;
  const headers: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(fetchOptions.headers || {})
  };

  const response = await fetch(url, {
    ...fetchOptions,
    headers
  });

  if (response.status === 401) {
    clearAgentTokenCache(siteId);

    const freshToken = await getAgentToken(siteId);

    const retryHeaders: HeadersInit = {
      'Authorization': `Bearer ${freshToken}`,
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...(fetchOptions.headers || {})
    };

    const retryResponse = await fetch(url, {
      ...fetchOptions,
      headers: retryHeaders
    });

    if (retryResponse.status === 401) {
      logger.warn('agent-fetch.retry.still-unauthorized', {
        siteId,
        url: typeof url === 'string' ? url : '<non-string>',
      });
    }

    return retryResponse;
  }

  return response;
}
