import { logger } from '../request-context';

/**
 * Fetch translation packages from the API route (client-side only)
 * 
 * Makes HTTP request to `/api/i18n/package` endpoint which wraps `loadTranslations`.
 * 
 * @param packages - Array of package names to load translations from
 * @param locale - Locale string (e.g., 'en-US')
 * @param options - Optional fetch configuration
 * @returns Promise resolving to merged translation messages (empty object `{}` if fetch fails)
 * 
 * @example
 * ```typescript
 * // Client-side usage (in React Query hook)
 * const { data } = useTranslationPackages(['@airo/app-builder'], 'en-US');
 * ```
 */
export async function fetchTranslationPackages(
  packages: string[],
  locale: string = 'en-US',
  options?: {
    credentials?: RequestCredentials;
    cache?: RequestCache;
  }
): Promise<Record<string, string>> {
  try {
    // Client-side only: Use relative URL to API route
    const baseUrl = `/api/i18n/package`;
    
    logger.debug('translations.fetch.client.start', {
      packages,
      locale,
      message: 'Client-side translation fetch via API route'
    });
    
    const fetchOptions: RequestInit = {
      credentials: options?.credentials || 'include',
      cache: options?.cache || 'no-store',
    };
    
    const responses = await Promise.all(
      packages.map((pkg) => {
        const url = `${baseUrl}?packageName=${encodeURIComponent(pkg)}&locale=${encodeURIComponent(locale)}`;
        return fetch(url, fetchOptions);
      })
    );

    const data = await Promise.all(
      responses.map(async (response, index) => {
        if (!response.ok) {
          logger.error('translations.fetch.client.failure', { 
            package: packages[index], 
            status: response.status,
          });
          return {};
        }
        
        const text = await response.text();
        
        if (!text || text.trim() === '') {
          logger.error('translations.fetch.client.empty', { package: packages[index] });
          return {};
        }
        
        try {
          return JSON.parse(text);
        } catch (err) {
          logger.error('translations.fetch.client.parse_error', { error: err });
          return {};
        }
      })
    );

    const merged = data.reduce(
      (acc, pkg) => ({ ...acc, ...(typeof pkg === 'object' && pkg !== null ? pkg : {}) }),
      {}
    );
    
    const translationCount = Object.keys(merged).length;
    if (translationCount === 0) {
      logger.warn('translations.fetch.client.empty_result', { 
        message: 'Client-side translation fetch returned empty',
        packages
      });
    } else {
      logger.debug('translations.fetch.client.success', { 
        packages,
        translationCount 
      });
    }
        
    return merged;
  } catch (error) {
    logger.error('translations.fetch.client.error', { 
      error: error instanceof Error ? error.message : String(error),
      packages 
    });
    return {};
  }
}

