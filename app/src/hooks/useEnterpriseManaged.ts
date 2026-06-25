'use client';

import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

/**
 * Owner-product string mhp-core uses for the Airo Enterprise tier. Apps
 * with this `ownerProduct` are part of a subscription managed by an
 * enterprise admin, NOT self-serve — the customer logging in here is
 * a member of the enterprise, not the buyer.
 *
 * Surfaces that imply self-serve upgrade (upgrade buttons, stripe modals,
 * plan-comparison CTAs) must NOT render for these apps. Replace with
 * `<EnterpriseUpgradeNotice />` (or equivalent inline copy) telling the
 * customer to contact their enterprise admin.
 */
export const ENTERPRISE_OWNER_PRODUCT: string = 'aab-ent-v1';

interface EnterpriseManagedStatus {
  /** Whether the currently-active site is on an enterprise-managed plan. */
  isEnterpriseManaged: boolean;
  /**
   * The raw `ownerProduct` value from `SiteInfo`. Surfaced for tests and
   * for cases that need to discriminate between product variants beyond
   * the binary ent/non-ent split.
   */
  ownerProduct: string | undefined;
}

/**
 * Returns whether the currently-active develop-page site is part of an
 * enterprise-managed subscription. Reads directly from the develop-page
 * store so callers don't have to thread `site.ownerProduct` through
 * every component manually.
 *
 * SSR-safe: returns `isEnterpriseManaged=false` when the site hasn't
 * loaded yet, which matches the safer default for upgrade-button visibility
 * (show the button until we know otherwise; don't show a misleading admin-
 * contact message to non-ent customers during hydration).
 */
export function useEnterpriseManaged(): EnterpriseManagedStatus {
  const ownerProduct: string | undefined = useDevelopPageStore((s) => s.site?.ownerProduct);
  const isEnterpriseManaged: boolean = ownerProduct === ENTERPRISE_OWNER_PRODUCT;
  return { isEnterpriseManaged, ownerProduct };
}
