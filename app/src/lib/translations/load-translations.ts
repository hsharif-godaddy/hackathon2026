import { logger } from '@/lib/request-context';

interface TranslationStrings {
  [key: string]: string;
}

/**
 * Load translation packages directly from the translation API
 * 
 * Shared utility used by:
 * - Server components (direct call, no HTTP overhead)
 * - API routes (for client-side requests)
 * 
 * Uses Next.js Data Cache with 2-minute revalidation.
 * Next.js automatically caches fetch responses and handles cache invalidation.
 * 
 * @param locale - Locale string (e.g., 'en-US')
 * @param packages - Array of package names to load
 * @returns Merged translation strings from all packages
 * 
 * @example
 * ```typescript
 * // Server component
 * const messages = await loadTranslations('en-US', ['@airo/app-builder']);
 * ```
 */
export async function loadTranslations(
  locale: string,
  packages: string[]
): Promise<TranslationStrings> {
  const translationApiUrl = 'https://api.i18n.int.gdcorp.tools/api/v2';
  
  try {
    const responses = await Promise.all(
      packages.map(async (packageName) => {
        const url = `${translationApiUrl}/package/market/${locale.toLowerCase()}/${encodeURIComponent(packageName)}`;
        
        logger.debug('translations.load.fetch', { url, locale, packageName });
        
        const response = await fetch(url, {
          next: { revalidate: 120 }, // Next.js Data Cache: revalidate every 2 minutes
        });
        
        if (!response.ok) {
          logger.error('translations.load.failure', {
            status: response.status,
            locale,
            packageName,
            url,
          });
          return {};
        }
        
        const data = await response.json();
        
        logger.debug('translations.load.success', {
          locale,
          packageName,
          translationCount: Object.keys(data).length,
        });
        
        return data;
      })
    );
    
    // Merge all package translations
    const merged = responses.reduce(
      (acc, pkg) => ({ ...acc, ...(typeof pkg === 'object' && pkg !== null ? pkg : {}) }),
      {}
    );
    
    const translationCount = Object.keys(merged).length;
    if (translationCount === 0) {
      logger.warn('translations.load.empty', {
        message: 'No translations loaded',
        packages,
        locale,
      });
    }
    
    return merged;
  } catch (error) {
    logger.error('translations.load.error', {
      error: error instanceof Error ? {
        message: error.message,
        name: error.name,
      } : String(error),
      packages,
      locale,
    });
    return {};
  }
}

