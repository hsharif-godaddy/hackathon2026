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
  
  // Get new token from server
  const response = await fetch('/api/auth/agent-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get agent token: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Cache token
  tokenCache.set(siteId, {
    token: data.token,
    expires: new Date(data.expires)
  });
  
  return data.token;
}

/**
 * Authenticated fetch for agent API calls
 */
export async function agentFetch(url: string, options: AgentFetchOptions): Promise<Response> {
  const { siteId, ...fetchOptions } = options;
  
  // Get JWT token
  const token = await getAgentToken(siteId);
  
  // Make request to agent
  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...fetchOptions.headers
    }
  });
  
  // Handle token expiration by retrying once
  if (response.status === 401) {
    tokenCache.delete(siteId);
    const freshToken = await getAgentToken(siteId);
    
    return fetch(url, {
      ...fetchOptions,
      headers: {
        'Authorization': `Bearer ${freshToken}`,
        'Content-Type': 'application/json',
        ...fetchOptions.headers
      }
    });
  }
  
  return response;
}