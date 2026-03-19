import { logger } from '@/lib/request-context';

/**
 * Extract root domain from a hostname
 *
 * @param hostname - The hostname to extract root domain from
 * @returns Root domain with 'ote' replaced by 'stg', or null if invalid
 */
function extractRootDomain(hostname: string): string | null {
  // Strip port number if present
  const hostWithoutPort = hostname.split(':')[0];

  // Development fallback for local development domains
  if (
    hostWithoutPort.startsWith('localhost') ||
    hostWithoutPort.startsWith('127.0.0.1') ||
    hostWithoutPort === 'local.gasket.dev-godaddy.com'
  ) {
    return process.env.PAYWALL_DEV_DOMAIN || 'dev-godaddy.com';
  }

  // Extract root domain (e.g., "builder.test-godaddy.com" -> "test-godaddy.com")
  const matches = hostWithoutPort.match(/([\w-]+\.\w+)$/);
  return matches ? matches[0].replace('ote', 'stg') : null;
}

/**
 * Get the root domain from the current window location (client-side)
 *
 * @returns Root domain with 'ote' replaced by 'stg', or null if running server-side
 *
 * @example
 * ```typescript
 * // On airo-builder.test-godaddy.com
 * getRootDomain() // 'test-godaddy.com'
 * ```
 */
export function getRootDomain(): string | null {
  if (typeof window === 'undefined') {return null;}

  return extractRootDomain(window.location.hostname);
}

/**
 * Get the root domain from request headers (server-side)
 *
 * @param headers - Request headers to extract host from
 * @returns Root domain with 'ote' replaced by 'stg', or null if no host header
 *
 * @example
 * ```typescript
 * const rootDomain = getRootDomainFromHeaders(request.headers);
 * ```
 */
export function getRootDomainFromHeaders(headers: Headers): string | null {
  const host = headers.get('host');

  if (!host) {
    logger.warn('getRootDomainFromHeaders.no-host', {
      message: 'Host header is missing or null',
    });
    return null;
  }

  return extractRootDomain(host);
}

