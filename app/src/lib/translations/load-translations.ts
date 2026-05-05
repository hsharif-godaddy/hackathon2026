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
 * Uses Next.js Data Cache with 2-minute revalidation in production.
 * Uses cache: 'no-store' in development — next: { revalidate: false } looks like
 * "no caching" but actually means "cache indefinitely" (persisted to disk under
 * .next/dev/cache/fetch-cache with a ~1-year TTL, surviving restarts).
 *
 * @param locale - Locale string (e.g., 'en-US')
 * @param packages - Array of package names to load
 * @returns Merged translation strings from all packages
 *
 * @example
 * ```typescript
 * // Server component
 * const messages = await loadTranslations('en-US', ['@airo-app-builder/aab']);
 * ```
 */
export async function loadTranslations(
  locale: string,
  packages: string[]
): Promise<TranslationStrings> {
  const translationApiUrl = 'https://api.i18n.int.gdcorp.tools/api/v2';
  const isDev = process.env.NODE_ENV === 'development';

  try {
    const responses = await Promise.all(
      packages.map(async (packageName) => {
        const url = `${translationApiUrl}/package/market/${locale.toLowerCase()}/${encodeURIComponent(packageName)}`;

        const response = await fetch(url, isDev
          ? { cache: 'no-store' }
          : { next: { revalidate: 120 } }
        );

        if (!response.ok) {
          logger.error('translations.load.failure', {
            status: response.status,
            locale,
            packageName,
            url,
          });
          return {};
        }

        return response.json();
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

