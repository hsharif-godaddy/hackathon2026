import { createIntl, createIntlCache, type IntlShape } from '@formatjs/intl';
import { fetchTranslationPackages } from './fetch-translations';
import { logger } from '../request-context';
import { resolveGasketData } from '@gasket/data';
import { request } from '@gasket/nextjs/request';
import gasket from '../../../gasket';

/**
 * Detect user's locale using Gasket's built-in locale detection
 * 
 * Uses Gasket's `resolveGasketData` which handles:
 * - Cookie-based locale detection (`market_locale`, `locale`)
 * - Accept-Language header parsing
 * - Locale validation against supported locales
 * - Fallback to defaultLocale
 * 
 * This ensures consistency between server-side and client-side locale detection.
 * 
 * @returns Promise resolving to detected locale string (e.g., 'en-US', 'es-MX', 'fr-FR')
 */
export async function detectLocale(): Promise<string> {
  try {
    const req = await request();
    const data: any = await resolveGasketData(gasket, req);
    
    const locale = data?.intl?.locale;

    if (locale && typeof locale === 'string') {
      logger.debug('locale.detected.gasket', { locale, source: 'gasket' });
      return locale;
    }
    
    // Fallback to Gasket's default locale if detection fails
    const defaultLocale = gasket.config.intl?.defaultLocale || 'en-US';
    logger.debug('locale.detected.default', { locale: defaultLocale });
    return defaultLocale;
  } catch (error) {
    // Fallback to default on any error
    const defaultLocale = gasket.config.intl?.defaultLocale || 'en-US';
    logger.warn('locale.detection.failure', {
      error: error instanceof Error ? error.message : String(error),
      fallback: defaultLocale,
    });
    return defaultLocale;
  }
}

/**
 * Server-side translation cache to avoid recreating intl instances
 * 
 * This cache is reused across requests to improve performance
 */
const cache = createIntlCache();

/**
 * Cache entry with messages and timestamp
 */
interface CacheEntry {
  messages: Record<string, string>;
  timestamp: number;
}

/**
 * Translation messages cache to avoid refetching
 * 
 * Key format: `${locale}:${packages.join(',')}`
 * Entries expire after 5 minutes (300,000ms)
 */
const messagesCache = new Map<string, CacheEntry>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Options for server-side intl initialization
 */
export interface ServerIntlOptions {
  /**
   * Locale to use for translations (default: 'en-US')
   */
  locale?: string;
  /**
   * Translation packages to load (default: ['@airo/app-builder'])
   */
  packages?: string[];
  /**
   * Whether to use cached messages (default: true)
   */
  useCache?: boolean;
}

/**
 * Create a server-side intl instance for translations in Server Components
 * 
 * This utility function creates an IntlShape instance that can be used in
 * Server Components, async functions, and API routes. It fetches translation
 * messages from the same BFF endpoint as the client-side hook.
 * 
 * @param options - Configuration options for intl initialization
 * @returns Promise resolving to IntlShape instance
 * 
 * @example
 * ```typescript
 * // Basic usage in Server Component
 * export default async function Page() {
 *   const intl = await getServerIntl();
 *   
 *   return (
 *     <h1>{intl.formatMessage({ id: 'builder_project_domain_title' })}</h1>
 *   );
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Usage with custom packages
 * export default async function Page() {
 *   const intl = await getServerIntl({
 *     locale: 'es-ES',
 *     packages: ['@airo/app-builder', '@airo/custom-package']
 *   });
 *   
 *   return <h1>{intl.formatMessage({ id: 'my_key' })}</h1>;
 * }
 * ```
 */
export async function getServerIntl(options: ServerIntlOptions = {}): Promise<IntlShape> {
  const {
    locale = 'en-US',
    packages = ['@airo/app-builder'],
    useCache = true,
  } = options;

  // Generate cache key
  const cacheKey = `${locale}:${packages.join(',')}`;

  // Check cache first
  let messages: Record<string, string>;
  const cachedEntry = messagesCache.get(cacheKey);
  const now = Date.now();
  
  // Check if cache exists and is still valid (not expired)
  if (useCache && cachedEntry && (now - cachedEntry.timestamp) < CACHE_TTL) {
    messages = cachedEntry.messages;
  } else {
    // Cache miss or expired - fetch fresh translations
    messages = await fetchTranslationPackages(packages, {
      credentials: 'include',
      cache: 'force-cache',
    });
    logger.info('translations.fetch.success');
    
    // Cache the messages with current timestamp
    if (useCache) {
      messagesCache.set(cacheKey, {
        messages,
        timestamp: now,
      });
      
      // Clean up expired entries after storing new one
      cleanupExpiredCache();
    }
  }

  // Create and return intl instance
  return createIntl(
    {
      locale,
      messages,
    },
    cache
  );
}

/**
 * Manually clear the translation messages cache
 */
export function clearServerIntlCache(): void {
  messagesCache.clear();
}

/**
 * Remove expired entries from the cache
 * 
 * This function cleans up cache entries that have exceeded the TTL.
 * Called automatically during cache checks to prevent memory leaks.
 */
function cleanupExpiredCache(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  
  for (const [key, entry] of messagesCache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL) {
      keysToDelete.push(key);
    }
  }
  
  for (const key of keysToDelete) {
    logger.info('translations.cache.delete', { key });
    messagesCache.delete(key);
  }
}

