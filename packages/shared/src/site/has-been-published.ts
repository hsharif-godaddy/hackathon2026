/**
 * Minimal shape required for checking publish status.
 * Allows passing partial objects in tests without full site types.
 */
export type PublishCheckableSite = {
  variants?: string[];
  variantsWithLifecycle?: Array<{
    variant: string;
    status: string;
  }>;
} | null | undefined;

/**
 * True when the site is treated as published for gating and SEO HTML audit targeting.
 *
 * When `variantsWithLifecycle` is present, only a `publish` row with status `active`
 * or `provisioning` counts. When lifecycle is absent, uses legacy `variants.includes('publish')`.
 */
export function hasBeenPublished(site: PublishCheckableSite): boolean {
  if (site?.variantsWithLifecycle?.length) {
    return site.variantsWithLifecycle.some(
      v =>
        v.variant === 'publish' &&
        (v.status === 'active' || v.status === 'provisioning'),
    );
  }

  if (site?.variants?.length) {
    return site.variants.includes('publish');
  }

  return false;
}
