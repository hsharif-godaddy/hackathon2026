import type { SiteInfo } from '@/lib/site-adapters/interfaces/ISiteAdapter';

/**
 * Check if a site has the publish variant available
 *
 * The publish variant indicates that a site supports publishing to a production
 * domain, as opposed to only preview deployments.
 *
 * @param site - The site information object
 * @returns true if the site has the publish variant, false otherwise
 *
 * @example
 * ```typescript
 * if (hasBeenPublished(site)) {
 *   // Show publish button
 * }
 * ```
 */
export function hasBeenPublished(site: Pick<SiteInfo, 'variants'> | null | undefined): boolean {
  return site?.variants?.includes('publish') ?? false;
}

