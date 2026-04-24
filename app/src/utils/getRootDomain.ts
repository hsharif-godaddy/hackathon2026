import { logger } from '@/lib/request-context';

/**
 * Known valid GoDaddy root domains.
 * Defense-in-depth: validates extracted root domain to prevent spoofed Host
 * headers from routing requests to unintended servers.
 *
 * Note: OTE hostnames (ote-godaddy.com) are covered by stg-godaddy.com since
 * extractRootDomain() replaces 'ote' with 'stg' before validation.
 */
const VALID_ROOT_DOMAINS = new Set([
  'godaddy.com',
  'dev-godaddy.com',
  'test-godaddy.com',
  'stg-godaddy.com',
]);

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
  // Use exact matches to prevent bypass via hostnames like localhost.evil.com
  if (
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === '127.0.0.1' ||
    hostWithoutPort === 'local.gasket.dev-godaddy.com'
  ) {
    return process.env.PAYWALL_DEV_DOMAIN || 'dev-godaddy.com';
  }

  // Extract root domain (e.g., "builder.test-godaddy.com" -> "test-godaddy.com")
  const matches = hostWithoutPort.match(/([\w-]+\.\w+)$/);
  if (!matches) return null;

  const rootDomain = matches[0].replace('ote', 'stg');

  // Validate against known GoDaddy domains
  if (!VALID_ROOT_DOMAINS.has(rootDomain)) {
    logger.warn('getRootDomain.unknown-domain', { rootDomain });
    return null;
  }

  return rootDomain;
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
  if (typeof window === 'undefined') return null;

  // Client-side: fall back to godaddy.com for safety since window.location.hostname
  // can't be spoofed (unlike server-side Host headers). This prevents broken URLs
  // in callers that interpolate the result without null checks.
  return extractRootDomain(window.location.hostname) ?? 'godaddy.com';
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

