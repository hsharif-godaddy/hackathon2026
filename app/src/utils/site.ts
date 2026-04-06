import { DomainStatus, DomainType, SiteStatus } from '@/lib/control-plane/types';

type SiteWithOptionalStatus = { status?: SiteStatus } | null | undefined;

/**
 * True when the control plane reports this site as suspended (publish must be blocked).
 */
export function isSiteSuspended(site: SiteWithOptionalStatus): boolean {
  return site?.status === SiteStatus.Suspended;
}

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
 * Handles both variantsWithLifecycle and variants formats.
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

  // Fallback: Check variants array for 'publish'
  if (site?.variants?.length) {
    return site.variants.includes('publish');
  }

  return false;
}

type DomainListSite = {
  domains?: Array<{ domainType: DomainType | null; status: DomainStatus }>;
} | null | undefined;

/**
 * True when the site has a non-prefix (custom) domain that can be managed or removed.
 * Used so domain settings stay available when publish is inactive but DNS/custom
 * domains still need cleanup (suspended or unpublished apps).
 */
export function hasCustomDomainAttachments(site: DomainListSite): boolean {
  if (!site?.domains?.length) {
    return false;
  }
  return site.domains.some(
    d => d.domainType !== DomainType.PREFIX && d.status !== DomainStatus.DELETING
  );
}

/**
 * Settings → Domains: show full domain UI when user has ever published or still
 * has custom domains to detach (including suspended / inactive publish).
 */
export function canAccessDomainManagement(site: PublishCheckableSite & DomainListSite): boolean {
  return hasBeenPublished(site) || hasCustomDomainAttachments(site);
}

