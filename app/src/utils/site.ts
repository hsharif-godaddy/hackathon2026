/**
 * Minimal shape required for checking publish status.
 * Allows passing partial objects in tests without full SiteInfo.
 */
type PublishCheckableSite = {
  variants?: string[];
  variantsWithLifecycle?: Array<{
    variant: string;
    status: string;
  }>;
} | null | undefined;

/**
 * Check if a site has an active publish variant
 *
 * The publish variant indicates that a site is currently published to production.
 * Handles both V2 (variantsWithLifecycle) and legacy (variants) formats.
 *
 * @param site - The site information object (only needs variants/variantsWithLifecycle)
 * @returns true if the site has an active publish variant, false otherwise
 *
 * @example
 * ```typescript
 * if (hasBeenPublished(site)) {
 *   // Show published status
 * }
 * ```
 */
export function hasBeenPublished(site: PublishCheckableSite): boolean {
  // V2: Check variantsWithLifecycle for active publish variant
  if (site?.variantsWithLifecycle?.length) {
    return site.variantsWithLifecycle.some(
      v => v.variant === 'publish' && v.status === 'active'
    );
  }

  // Legacy fallback: Check variants array for 'publish'
  if (site?.variants?.length) {
    return site.variants.includes('publish');
  }

  return false;
}

