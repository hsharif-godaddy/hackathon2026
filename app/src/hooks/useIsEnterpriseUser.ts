'use client';

import { ENTERPRISE_OWNER_PRODUCT } from '@/hooks/useEnterpriseManaged';
import { useSubscription } from '@/hooks/useSubscription';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

/**
 * Enterprise productId. NOT an ownerProduct family — mhp-airo's
 * `?ownerProduct=aab-ent-v1` filter is invalid (it yields
 * `CUSTOMER_NOT_REGISTERED`, see `Untitled.docx`). Use this constant only
 * for productId comparisons on already-returned subscriptions.
 */
const ENTERPRISE_PRODUCT_ID: string = 'aab-ent-v1';

/**
 * Returns whether the *currently signed-in user* is an enterprise member.
 *
 * Different scope than `useEnterpriseManaged` — that hook answers "is THIS
 * APP enterprise-managed?" via the active site's `ownerProduct`. This hook
 * answers "is the USER an enterprise member?" which is needed for surfaces
 * that exist outside a specific app context (UserMenu header entry, the
 * `/manage-plan` page redirect, etc.).
 *
 * Detection uses two signals, ORed together for resilience while the
 * cross-repo enterprise-member surfacing is being deployed:
 *
 *   1. The active develop-page site is enterprise — works today on any
 *      surface where the user has loaded an app first (the develop store
 *      keeps `state.site` across in-app navigation; covers the
 *      develop → settings → user-menu and develop → /manage-plan flows).
 *
 *   2. Any returned subscription is enterprise — kicks in automatically
 *      once mhp-core#749 (airo-go `SubscriptionHandler.List` entMode
 *      override) deploys and the BFF's
 *      `app/src/app/api/subscriptions/route.ts` best-subscription filter
 *      is widened to include `productId === 'aab-ent-v1'` (see
 *      `docs/airo-enterprise/ent-bff-followups.md` once that lands).
 *
 * Until BOTH the airo-go change and the BFF productId broadening ship,
 * direct-URL navigation to `/manage-plan` in a fresh tab (no prior site
 * loaded) cannot be detected by this hook. That gap closes automatically
 * once the upstream change lands — no callsite changes required.
 */
export function useIsEnterpriseUser(): boolean {
  const siteOwnerProduct: string | undefined = useDevelopPageStore((s) => s.site?.ownerProduct);
  const { subscriptions } = useSubscription();

  if (siteOwnerProduct === ENTERPRISE_OWNER_PRODUCT) {
    return true;
  }

  // Signal #2 — subscription-level. ProductId is the durable identifier
  // (per-row in `airo_subscriptions`); `ownerProduct` is the family
  // grouping. Check both so we work against airo-go responses that
  // surface either label depending on the call path. Defensive against
  // `subscriptions` being undefined — older callers of `useSubscription`
  // (and many tests) don't populate that field.
  for (const sub of subscriptions ?? []) {
    if (sub.productId === ENTERPRISE_PRODUCT_ID) return true;
    if (sub.ownerProduct === ENTERPRISE_OWNER_PRODUCT) return true;
  }

  return false;
}
