import { hasBeenPublished as hasBeenPublishedShared, type PublishCheckableSite } from '@airo/shared';

import { DomainStatus, DomainType, SiteStatus } from '@/lib/control-plane/types';

type SiteWithOptionalStatus = { status?: SiteStatus } | null | undefined;

/**
 * True when the control plane reports this site as suspended (publish must be blocked).
 */
export function isSiteSuspended(site: SiteWithOptionalStatus): boolean {
  return site?.status === SiteStatus.Suspended;
}

export type { PublishCheckableSite } from '@airo/shared';

/**
 * @see {@link hasBeenPublishedShared} in `@airo/shared` — shared with agents SEO audit gating.
 */
export function hasBeenPublished(site: PublishCheckableSite): boolean {
  return hasBeenPublishedShared(site);
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

