import { logger } from '@/lib/logger';

const ALLOWED_ROOT_DOMAINS = [
    'godaddy.com',
    'test-godaddy.com',
    'dev-godaddy.com',
    'gdcorp.tools',
    'test-gdcorp.tools',
    'dev-gdcorp.tools',
];

/**
 * Extract root domain from a hostname and validate against allowlist.
 *
 * @param hostname - The hostname to extract root domain from
 * @returns Root domain or null if invalid or not allowlisted
 */
function extractRootDomain(hostname: string): string | null {
  const hostWithoutPort = hostname.split(':')[0];

  if (
    hostWithoutPort.startsWith('localhost') ||
    hostWithoutPort.startsWith('127.0.0.1') ||
    hostWithoutPort === 'local.gasket.dev-godaddy.com'
  ) {
    return 'dev-godaddy.com';
  }

  const matches = hostWithoutPort.match(/([\w-]+\.\w+)$/);
  const root = matches ? matches[0] : null;

  if (!root || !ALLOWED_ROOT_DOMAINS.includes(root)) {
    logger.warn('getRootDomain.rejected', {
      message: 'Host resolved to a domain not in the allowlist',
      host: hostWithoutPort,
    });
    return null;
  }

  return root;
}

/**
 * Get the root domain from request headers (server-side)
 *
 * @param headers - Request headers to extract host from
 * @returns Root domain or null if no host header
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
