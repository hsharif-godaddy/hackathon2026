import { getRootDomain } from '@/utils/getRootDomain';
import { logger } from '../request-context';

/**
 * Get server-side request context (domain and cookies)
 * 
 * @returns Object with domain and cookie header for authenticated requests
 */
async function getServerContext(): Promise<{ domain: string; cookie: string }> {
  // Client-side: use getRootDomain()
  if (typeof window !== 'undefined') {
    return {
      domain: getRootDomain() || 'godaddy.com',
      cookie: '',
    };
  }
  
  try {
    const { headers } = await import('next/headers');
    const headersList = await headers();
    const host = headersList.get('host') || '';
    const cookie = headersList.get('cookie') || '';
    
    const hostname = host.split(':')[0];
    const matches = hostname.match(/([\w-]+\.\w+)$/);
    const domain = matches ? matches[0].replace('ote', 'stg') : 'godaddy.com';

    return { domain, cookie };
  } catch (error) {
    logger.error('translations.fetch.failure', { error });
    return {
      domain: 'godaddy.com',
      cookie: '',
    };
  }
}

/**
 * Fetch translation packages from the BFF i18n endpoint
 * 
 * Shared utility function used by both client-side (React Query) and
 * server-side (getServerIntl) translation systems.
 * 
 * **Auth Handling:**
 * - Always attempts to fetch from BFF API
 * - Forwards cookies if present for authentication
 * - If BFF returns 401 (unauthenticated), returns empty object gracefully
 * - Translation fetch failures are logged but don't break the page
 * 
 * **Behavior:**
 * - Authenticated users: Full translation set from BFF
 * - Unauthenticated users (incognito, logged out): Empty object, falls back to English
 * - The BFF API handles authentication - this layer just fetches data
 * 
 * @param packages - Array of package names to load translations from
 * @param options - Optional fetch configuration
 * @returns Promise resolving to merged translation messages (empty object `{}` if fetch fails)
 * 
 * @example
 * ```typescript
 * const messages = await fetchTranslationPackages(['@airo/app-builder']);
 * // Returns translations if authenticated, {} if not
 * ```
 */
export async function fetchTranslationPackages(
  packages: string[],
  options?: {
    credentials?: RequestCredentials;
    cache?: RequestCache;
  }
): Promise<Record<string, string>> {
  try {
    const { domain, cookie } = await getServerContext();
    const baseUrl = `https://bff.pcx.${domain}/api/i18n/package`;
    
    const fetchOptions: RequestInit = {
      credentials: options?.credentials || 'include',
      cache: options?.cache || 'default',
    };
    
    // On server-side, forward cookies in headers for authentication
    // If no cookies present, fetch will still attempt (BFF handles auth)
    if (cookie) {
      fetchOptions.headers = {
        cookie,
      };
    }
    
    const responses = await Promise.all(
      packages.map((pkg) =>
        fetch(
          `${baseUrl}?packageName=${encodeURIComponent(pkg)}`,
          fetchOptions
        )
      )
    );

    const data = await Promise.all(
      responses.map(async (response, index) => {
        if (!response.ok) {
          logger.error('translations.fetch.response.failure', { package: packages[index], status: response.status });
          return {};
        }
        
        const text = await response.text();
        
        if (!text || text.trim() === '') {
          logger.error('translations.response.empty', { package: packages[index] });
          return {};
        }
        
        try {
          return JSON.parse(text);
        } catch (err) {
          logger.error('translations.parse.failure', { error: err });
          return {};
        }
      })
    );

    const merged = data.reduce(
      (acc, pkg) => ({ ...acc, ...(typeof pkg === 'object' && pkg !== null ? pkg : {}) }),
      {}
    );
        
    return merged;
  } catch (error) {
    logger.error('translations.fetch.failure', { error });
    return {};
  }
}

