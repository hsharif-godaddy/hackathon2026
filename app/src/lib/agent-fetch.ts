/**
 * Agent Fetch Utility
 * Simple client-side utility for making authenticated requests to agents
 *
 * Uses appFetch for token acquisition (SSO cookies → JWT), but agent requests
 * themselves use Bearer token auth with retry-on-401 logic — a different auth
 * mechanism from appFetch's cookie-based SSO flow.
 */

import { appFetch } from '@/lib/gasket-config'

export interface AgentFetchOptions extends RequestInit {
  siteId: string;
}

/**
 * Simple token cache
 */
const tokenCache = new Map<string, { token: string; expires: Date }>();

/**
 * In-flight token requests to prevent duplicate calls
 */
const pendingTokenRequests = new Map<string, Promise<string>>();

/**
 * Get JWT token for agent communication (with caching and deduplication)
 */
export async function getAgentToken(siteId: string): Promise<string> {
  // Check cache first - token is valid if it expires more than 5 minutes from now
  const cached = tokenCache.get(siteId);
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
  if (cached && cached.expires.getTime() > fiveMinutesFromNow) {
    return cached.token;
  }
  
  // Check if there's already a pending request for this siteId
  const pending = pendingTokenRequests.get(siteId);
  if (pending) {
    return pending;
  }
  
  // Create new token request
  const tokenPromise = (async () => {
    try {
      // Get token based on environment
      const isServer = typeof window === 'undefined';
      let token: string;
      let expires: Date;

      if (isServer) {
        // Server: Use JWT service directly
        // Default to no special permissions - operations that need them will regenerate
        const { getJWTService } = await import('./jwt-service');
        const result = await getJWTService().getToken({
          siteId,
          canDownload: false,
          canPublish: false,
          isE2S: false  // Server-side calls default to non-impersonation
        });
        token = result.token;
        expires = result.expires;
      } else {
        // Browser: Call API endpoint
        const response = await appFetch('/api/auth/agent-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId })
        });
        
        if (!response.ok) {
          throw new Error(`Failed to get agent token: ${response.status}`);
        }
        
        const data = await response.json();
        token = data.token;
        expires = new Date(data.expires);
      }
      
      // Cache and return token
      tokenCache.set(siteId, { token, expires });
      return token;
    } finally {
      // Always clean up pending request
      pendingTokenRequests.delete(siteId);
    }
  })();
  
  // Store pending request
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
    tokenCache.delete(siteId);

    const freshToken = await getAgentToken(siteId);

    const retryHeaders: HeadersInit = {
      'Authorization': `Bearer ${freshToken}`,
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...(fetchOptions.headers || {})
    };

    return fetch(url, {
      ...fetchOptions,
      headers: retryHeaders
    });
  }

  return response;
}
