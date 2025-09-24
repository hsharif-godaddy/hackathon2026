/**
 * Authenticated fetch for agent API calls using injected auth service
 */

import { NextRequest } from 'next/server';
import { getAuthService } from './auth';


/**
 * Authenticated fetch for agent API calls (client-side)
 * Uses injected auth service based on configuration
 */
export async function agentFetch(url: string, options?: RequestInit): Promise<Response> {
  try {
    const authService = getAuthService();
    
    const authResult = await authService.authenticate();
    
    if (!authResult.success) {
      throw new Error(authResult.error || 'Authentication failed');
    }
    
    // Make request with auth headers
    const requestOptions: RequestInit = {
      ...options,
      headers: {
        ...options?.headers,
        ...authResult.headers
      }
    };
    
    return fetch(url, requestOptions);
  } catch (error) {
    throw error;
  }
}

/**
 * Authenticated fetch for agent API calls (server-side)
 * Uses injected auth service based on configuration
 */
export async function serverAgentFetch(url: string, request: NextRequest, options?: RequestInit): Promise<Response> {
  try {
    const authService = getAuthService();
    
    // Use JWT service's special server-side method if available
    let authResult;
    if (authService.authenticateWithRequest) {
      authResult = await authService.authenticateWithRequest(request);
    } else {
      authResult = await authService.authenticate();
    }
    
    if (!authResult.success) {
      throw new Error(authResult.error || 'Authentication failed');
    }
    
    // Make request with auth headers
    const requestOptions: RequestInit = {
      ...options,
      headers: {
        ...options?.headers,
        ...authResult.headers
      }
    };
    
    return fetch(url, requestOptions);
  } catch (error) {
    throw error;
  }
}

