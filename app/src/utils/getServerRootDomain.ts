import { NextRequest } from 'next/server';

/**
 * Get the root domain based on the server request
 * Used in API routes (server-side) to determine environment
 *
 * @param request - Next.js request object
 * @returns Root domain (e.g., 'dev-godaddy.com', 'test-godaddy.com', 'godaddy.com')
 */
export function getServerRootDomain(request: NextRequest): string {
  const host = request.headers.get('host') || '';

  if (host.includes('test-godaddy.com')) {
    return 'test-godaddy.com';
  }
  if (host.includes('dev-godaddy.com') || host.includes('localhost')) {
    return 'dev-godaddy.com';
  }
  return 'godaddy.com';
}

/**
 * Build API URL for a given subdomain
 *
 * @param request - Next.js request object
 * @param subdomain - API subdomain (e.g., 'content-inspirations.api')
 * @returns Full API base URL
 *
 * @example
 * ```ts
 * const baseUrl = getApiBaseUrl(request, 'content-inspirations.api');
 * // Returns: https://content-inspirations.api.dev-godaddy.com
 * ```
 */
export function getApiBaseUrl(request: NextRequest, subdomain: string): string {
  const rootDomain = getServerRootDomain(request);
  return `https://${subdomain}.${rootDomain}`;
}
