import { describe, expect, it } from 'vitest';

import { SiteStatus } from '@/lib/control-plane/types';
import { SubscriptionStatus, SubscriptionSuspendReason } from '@/types/credits';
import {
  getPublishComplianceBlockReason,
  isComplianceSuspensionReason,
  isPublishBlockedByComplianceRules,
  isSubscriptionNonCompliant,
  isSubscriptionSuspendedForNonPayment,
  PublishComplianceBlockReason,
  shouldShowAppNonCompliantOrAccountComplianceTag,
  shouldShowAppNonCompliantSuspendedTag,
} from '.';

describe('subscription compliance', function subscriptionComplianceTests() {
  describe('#isComplianceSuspensionReason', function complianceReasonTests() {
    it('should return true for compliance enum values', function complianceEnums() {
      expect(isComplianceSuspensionReason(SubscriptionSuspendReason.Legal)).toBe(true);
      expect(isComplianceSuspensionReason(SubscriptionSuspendReason.Policy)).toBe(true);
      expect(isComplianceSuspensionReason(SubscriptionSuspendReason.Fraud)).toBe(true);
      expect(isComplianceSuspensionReason(SubscriptionSuspendReason.PolicyOverage)).toBe(true);
    });

    it('should return false for non-payment and empty', function nonCompliance() {
      expect(isComplianceSuspensionReason(SubscriptionSuspendReason.NonPayment)).toBe(false);
      expect(isComplianceSuspensionReason(undefined)).toBe(false);
      expect(isComplianceSuspensionReason('')).toBe(false);
    });
  });

  describe('#isSubscriptionNonCompliant', function nonCompliantTests() {
    it('should return true when suspended with compliance reason', function suspendedCompliance() {
      expect(
        isSubscriptionNonCompliant({
          status: SubscriptionStatus.Suspended,
          reason: SubscriptionSuspendReason.Fraud,
        })
      ).toBe(true);
    });

    it('should return false when suspended for non-payment', function suspendedPayment() {
      expect(
        isSubscriptionNonCompliant({
          status: SubscriptionStatus.Suspended,
          reason: SubscriptionSuspendReason.NonPayment,
        })
      ).toBe(false);
    });

    it('should return false when active', function activeSubscription() {
      expect(
        isSubscriptionNonCompliant({
          status: SubscriptionStatus.Active,
          reason: SubscriptionSuspendReason.Legal,
        })
      ).toBe(false);
    });
  });

  describe('#isSubscriptionSuspendedForNonPayment', function nonPaymentTests() {
    it('should return true only for non-payment suspension', function onlyNonPayment() {
      expect(
        isSubscriptionSuspendedForNonPayment({
          status: SubscriptionStatus.Suspended,
          reason: SubscriptionSuspendReason.NonPayment,
        })
      ).toBe(true);
      expect(
        isSubscriptionSuspendedForNonPayment({
          status: SubscriptionStatus.Suspended,
          reason: SubscriptionSuspendReason.Legal,
        })
      ).toBe(false);
    });
  });

  describe('#shouldShowAppNonCompliantSuspendedTag', function appTagTests() {
    it('should be true for site-level suspended status', function siteSuspended() {
      expect(
        shouldShowAppNonCompliantSuspendedTag({ status: SiteStatus.Suspended })
      ).toBe(true);
    });

    it('should be false when running', function notTagged() {
      expect(
        shouldShowAppNonCompliantSuspendedTag({ status: SiteStatus.Running })
      ).toBe(false);
    });

    it('should be false when status is error', function errorStatus() {
      expect(
        shouldShowAppNonCompliantSuspendedTag({ status: SiteStatus.Error })
      ).toBe(false);
    });
  });

  describe('#isPublishBlockedByComplianceRules', function publishBlockedTests() {
    it('should block when site is suspended regardless of flag', function siteSuspended() {
      expect(
        isPublishBlockedByComplianceRules(
          { status: SiteStatus.Suspended },
          { status: SubscriptionStatus.Active, reason: undefined },
          false
        )
      ).toBe(true);
    });

    it('should block subscription when flag on and subscription non-compliant', function subBlocked() {
      expect(
        isPublishBlockedByComplianceRules(
          { status: SiteStatus.Running },
          { status: SubscriptionStatus.Suspended, reason: SubscriptionSuspendReason.Legal },
          true
        )
      ).toBe(true);
    });

    it('should not block subscription when flag off', function flagOff() {
      expect(
        isPublishBlockedByComplianceRules(
          { status: SiteStatus.Running },
          { status: SubscriptionStatus.Suspended, reason: SubscriptionSuspendReason.Legal },
          false
        )
      ).toBe(false);
    });
  });

  describe('#getPublishComplianceBlockReason', function blockReasonTests() {
    it('should prefer site_suspended', function siteFirst() {
      expect(
        getPublishComplianceBlockReason(
          { status: SiteStatus.Suspended },
          { status: SubscriptionStatus.Suspended, reason: SubscriptionSuspendReason.Legal },
          true
        )
      ).toBe(PublishComplianceBlockReason.SiteSuspended);
    });

    it('should return subscription_non_compliant when site running', function subReason() {
      expect(
        getPublishComplianceBlockReason(
          { status: SiteStatus.Running },
          { status: SubscriptionStatus.Suspended, reason: SubscriptionSuspendReason.Policy },
          true
        )
      ).toBe(PublishComplianceBlockReason.SubscriptionNonCompliant);
    });
  });

  describe('#shouldShowAppNonCompliantOrAccountComplianceTag', function combinedTagTests() {
    it('should be true for site suspended', function siteTag() {
      expect(
        shouldShowAppNonCompliantOrAccountComplianceTag(
          { status: SiteStatus.Suspended },
          null,
          false
        )
      ).toBe(true);
    });

    it('should be true for compliant flag and non-compliant subscription', function accountTag() {
      expect(
        shouldShowAppNonCompliantOrAccountComplianceTag(
          { status: SiteStatus.Running },
          { status: SubscriptionStatus.Suspended, reason: SubscriptionSuspendReason.Fraud },
          true
        )
      ).toBe(true);
    });

    it('should be false when flag off and site running', function noTag() {
      expect(
        shouldShowAppNonCompliantOrAccountComplianceTag(
          { status: SiteStatus.Running },
          { status: SubscriptionStatus.Suspended, reason: SubscriptionSuspendReason.Fraud },
          false
        )
      ).toBe(false);
    });
  });
});
