/**
 * Shared helper for detecting whether the agent is operating on an
 * enterprise-managed app. Mirrors `useEnterpriseManaged` on the web
 * side — single source-of-truth for the literal product string so
 * both sides can't drift.
 *
 * Enterprise-managed apps (`ownerProduct === 'aab-ent-v1'`) have plan
 * upgrades + billing owned by the enterprise admin, not the customer
 * the agent is chatting with. Agent responses MUST therefore avoid:
 *   - "Upgrade your plan to..." / "You can upgrade to..."
 *   - Plan-comparison links / Stripe checkout URLs
 *   - "I'll help you upgrade..." offers
 * …and SHOULD replace them with: "Plan upgrades for this app are
 * managed by your enterprise admin — please contact them to request
 * a plan change."
 */
export const ENTERPRISE_OWNER_PRODUCT: string = 'aab-ent-v1';

export function isEnterpriseManagedApp(ownerProduct: string | undefined): boolean {
  return ownerProduct === ENTERPRISE_OWNER_PRODUCT;
}
