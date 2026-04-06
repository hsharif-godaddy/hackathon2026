import { type SiteInfo, SiteStatus } from '@/lib/control-plane/types';
import { SubscriptionStatus, SubscriptionSuspendReason } from '@/types/credits';


const COMPLIANCE_SUSPEND_REASONS: ReadonlySet<string> = new Set([
  SubscriptionSuspendReason.Legal,
  SubscriptionSuspendReason.Policy,
  SubscriptionSuspendReason.Fraud,
  SubscriptionSuspendReason.PolicyOverage,
]);

export type SubscriptionComplianceCheckable = {
  status?: string;
  reason?: SubscriptionSuspendReason | string;
};

export function isComplianceSuspensionReason(
  reason: string | undefined
): boolean {
  return !!reason && COMPLIANCE_SUSPEND_REASONS.has(reason);
}

/**
 * True when the account subscription is suspended for a compliance reason.
 * Does not apply feature-flag gating — callers must check the switchboard flag.
 */
export function isSubscriptionNonCompliant(
  subscription: SubscriptionComplianceCheckable | undefined | null
): boolean {
  return (
    !!subscription &&
    subscription.status === SubscriptionStatus.Suspended &&
    isComplianceSuspensionReason(subscription.reason)
  );
}

/**
 * True when suspended specifically for non-payment (renewal / downgrade path).
 */
export function isSubscriptionSuspendedForNonPayment(
  subscription: SubscriptionComplianceCheckable | undefined | null
): boolean {
  return (
    !!subscription &&
    subscription.status === SubscriptionStatus.Suspended &&
    subscription.reason === SubscriptionSuspendReason.NonPayment
  );
}

/**
 * Whether an app card should show the suspended / non-compliant tag.
 *
 * - **Site-level**: hosting marks this app `status: suspended` → only that app matches.
 */
export function shouldShowAppNonCompliantSuspendedTag(
  site: Pick<SiteInfo, 'status'>
): boolean {
  return site.status === SiteStatus.Suspended;
}

/**
 * When `complianceSubscriptionRulesEnabled` is true (Switchboard loaded and on), publishing is also
 * blocked for any app if the account subscription is suspended for a compliance reason.
 * Site-level `SiteStatus.Suspended` always blocks regardless of the flag.
 */
export function isPublishBlockedByComplianceRules(
  site: Pick<SiteInfo, 'status'> | null | undefined,
  subscription: SubscriptionComplianceCheckable | undefined | null,
  complianceSubscriptionRulesEnabled: boolean
): boolean {
  if (site?.status === SiteStatus.Suspended) {
    return true;
  }
  if (!complianceSubscriptionRulesEnabled) {
    return false;
  }
  return isSubscriptionNonCompliant(subscription);
}

export enum PublishComplianceBlockReason {
  SiteSuspended = 'site_suspended',
  SubscriptionNonCompliant = 'subscription_non_compliant',
}

export function getPublishComplianceBlockReason(
  site: Pick<SiteInfo, 'status'> | null | undefined,
  subscription: SubscriptionComplianceCheckable | undefined | null,
  complianceSubscriptionRulesEnabled: boolean
): PublishComplianceBlockReason | null {
  if (site?.status === SiteStatus.Suspended) {
    return PublishComplianceBlockReason.SiteSuspended;
  }
  if (complianceSubscriptionRulesEnabled && isSubscriptionNonCompliant(subscription)) {
    return PublishComplianceBlockReason.SubscriptionNonCompliant;
  }
  return null;
}

/**
 * Apps list: show suspended / non-compliant tag when the site is suspended or (Switchboard flag
 * strictly true) the account is in compliance suspension.
 */
export function shouldShowAppNonCompliantOrAccountComplianceTag(
  site: Pick<SiteInfo, 'status'>,
  subscription: SubscriptionComplianceCheckable | undefined | null,
  complianceSubscriptionRulesEnabled: boolean | undefined
): boolean {
  if (shouldShowAppNonCompliantSuspendedTag(site)) {
    return true;
  }
  return complianceSubscriptionRulesEnabled === true && isSubscriptionNonCompliant(subscription);
}
