/**
 * Authenticated fetch for agent API calls
 * Always includes JWT token regardless of environment (agents always require auth)
 */

import { NextRequest } from 'next/server';

/**
 * Get current JWT token from browser cookies (client-side)
 */
function getCurrentJWTToken(): string | null {
  if (typeof document === 'undefined') {
    return null; // Server-side rendering
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'auth_idp') {
      return decodeURIComponent(value);
    }
  }
  return null;
}

/**
 * Get JWT token from server-side request cookies
 */
function getServerJWTToken(request?: NextRequest): string | null {
  if (!request) return null;
  
  const token = request.cookies.get('auth_idp')?.value;
  return token ? decodeURIComponent(token) : null;
}

/**
 * Authenticated fetch for agent API calls (client-side)
 * Always includes JWT token in Authorization header
 */
export async function agentFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = getCurrentJWTToken();
  
  if (!token) {
    throw new Error('No authentication token found. Please log in to access agent services.');
  }

  return makeAuthenticatedRequest(url, token, options);
}

/**
 * Authenticated fetch for agent API calls (server-side)
 * Always includes JWT token in Authorization header
 */
export async function serverAgentFetch(url: string, request: NextRequest, options?: RequestInit): Promise<Response> {
  const token = getServerJWTToken(request);
  
  if (!token) {
    throw new Error('No authentication token found. Please log in to access agent services.');
  }

  return makeAuthenticatedRequest(url, token, options);
}

/**
 * Internal helper to make authenticated requests
 */
function makeAuthenticatedRequest(url: string, token: string, options?: RequestInit): Promise<Response> {
  // Prepare headers with JWT authentication
  const headers = new Headers(options?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  
  // Only set Content-Type if not already set and if we have a body
  if (!headers.has('Content-Type') && options?.body) {
    headers.set('Content-Type', 'application/json');
  }

  const authenticatedOptions: RequestInit = {
    ...options,
    headers
  };

  return fetch(url, authenticatedOptions);
}
