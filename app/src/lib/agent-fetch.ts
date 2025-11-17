/**
 * Agent Fetch Utility
 * Simple client-side utility for making authenticated requests to agents
 */

export interface AgentFetchOptions extends RequestInit {
  siteId: string;
}

/**
 * Simple token cache
 */
const tokenCache = new Map<string, { token: string; expires: Date }>();

/**
 * Get JWT token for agent communication (with caching)
 */
async function getAgentToken(siteId: string): Promise<string> {
  // Check cache first
  const cached = tokenCache.get(siteId);
  if (cached && cached.expires.getTime() > (Date.now() + 2 * 60 * 60 * 1000)) {
    return cached.token;
  }
  
  // Get token based on environment
  const isServer = typeof window === 'undefined';
  let token: string;
  let expires: Date;
  
  if (isServer) {
    // Server: Use JWT service directly
    const { getJWTService } = await import('./jwt-service');
    const result = await getJWTService().getToken({ siteId });
    token = result.token;
    expires = result.expires;
  } else {
    // Browser: Call API endpoint
    const response = await fetch('/api/auth/agent-token', {
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
}

/**
 * Authenticated fetch for agent API calls
 */
export async function agentFetch(url: string, options: AgentFetchOptions): Promise<Response> {
  const { siteId, ...fetchOptions } = options;
  
  // Get JWT token
  const token = await getAgentToken(siteId);
  
  // Don't set Content-Type for FormData (browser will set it with boundary)
  const isFormData = fetchOptions.body instanceof FormData;
  const headers: HeadersInit = {
    'Authorization': `Bearer ${token}`,
    ...(!isFormData && { 'Content-Type': 'application/json' }),
    ...(fetchOptions.headers || {})
  };
  
  // Make request to agent
  const response = await fetch(url, {
    ...fetchOptions,
    headers
  });
  
  // Handle token expiration by retrying once
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