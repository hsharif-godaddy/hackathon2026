import { describe, expect, it } from 'vitest';

import {
  ACTIVE_FEEDBACK_REVEAL_MILESTONES,
  isFeedbackRevealReady,
  jtbdFeedbackTargetIdFromMilestone,
  jtbdTargetIdFromMilestone,
  resolvePendingFeedbackRevealMilestone,
} from './initial-build-reveal';

describe('initial-build-reveal', function initialBuildRevealTests() {
  describe('#isFeedbackRevealReady', function isReadyTests() {
    it('returns true when logoDownload is satisfied', function logoDownload() {
      expect(
        isFeedbackRevealReady({
          logoDownload: true,
          logoDownstreamApply: false,
          websitePublish: false,
          websiteDomainConnect: false,
          domainPurchase: false,
          domainDownstreamConnect: false,
          imageSelection: false,
        })
      ).toBe(true);
    });

    it('returns false when no active milestone is satisfied', function none() {
      expect(
        isFeedbackRevealReady({
          logoDownload: false,
          logoDownstreamApply: false,
          websitePublish: false,
          websiteDomainConnect: false,
          domainPurchase: false,
          domainDownstreamConnect: false,
          imageSelection: false,
        })
      ).toBe(false);
    });

    it('ignores reserved image flag until active', function reserved() {
      expect(
        isFeedbackRevealReady({
          logoDownload: false,
          logoDownstreamApply: false,
          websitePublish: false,
          websiteDomainConnect: false,
          domainPurchase: false,
          domainDownstreamConnect: false,
          imageSelection: true,
        })
      ).toBe(false);
    });
  });

  describe('#resolvePendingFeedbackRevealMilestone', function pendingTests() {
    it('returns logoDownload when satisfied and not yet shown', function pending() {
      expect(
        resolvePendingFeedbackRevealMilestone(
          {
            logoDownload: true,
            logoDownstreamApply: false,
            websitePublish: false,
            websiteDomainConnect: false,
            domainPurchase: false,
            domainDownstreamConnect: false,
            imageSelection: false,
          },
          new Set()
        )
      ).toBe('logoDownload');
    });

    it('returns null when the milestone was already shown', function alreadyShown() {
      expect(
        resolvePendingFeedbackRevealMilestone(
          {
            logoDownload: true,
            logoDownstreamApply: false,
            websitePublish: false,
            websiteDomainConnect: false,
            domainPurchase: false,
            domainDownstreamConnect: false,
            imageSelection: false,
          },
          new Set(['logoDownload'])
        )
      ).toBeNull();
    });
  });

  describe('#jtbdTargetIdFromMilestone', function jtbdTargetTests() {
    it('maps logo milestones to logo target id', function logoTarget() {
      expect(jtbdTargetIdFromMilestone('logoDownload')).toBe('logo');
      expect(jtbdTargetIdFromMilestone('logoDownstreamApply')).toBe('logo');
    });

    it('maps website and domain milestones to matching target ids', function groupedTargets() {
      expect(jtbdTargetIdFromMilestone('websitePublish')).toBe('website');
      expect(jtbdTargetIdFromMilestone('domainPurchase')).toBe('domain');
    });

    // Guards the invocation-feedback `targetId` contract: the skill-invoke flow
    // resolves targetId as `jtbdTargetIdFromMilestone(revealMilestone) ?? agentTargetId`.
    // The banner only ever shows with an ACTIVE milestone, so if every active
    // milestone maps to a non-null JTBD id, the agent-id-shaped fallback is
    // unreachable and the emitted targetId stays homogeneous (`logo|website|domain`).
    // A future active milestone that doesn't map here would silently reintroduce
    // a mixed-shape targetId column for downstream S3 consumers — this fails first.
    it('maps every active milestone to a non-null JTBD target id', function totalOverActive() {
      for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
        expect(jtbdTargetIdFromMilestone(milestone)).not.toBeNull();
      }
    });
  });

  describe('#jtbdFeedbackTargetIdFromMilestone', function jtbdFeedbackTargetTests() {
    it('namespaces the JTBD track under the airo-app-builder prefix', function namespaced() {
      expect(jtbdFeedbackTargetIdFromMilestone('logoDownload')).toBe('airo-app-builder-logo');
      expect(jtbdFeedbackTargetIdFromMilestone('logoDownstreamApply')).toBe('airo-app-builder-logo');
      expect(jtbdFeedbackTargetIdFromMilestone('websitePublish')).toBe('airo-app-builder-website');
      expect(jtbdFeedbackTargetIdFromMilestone('domainPurchase')).toBe('airo-app-builder-domain');
    });

    it('returns null for an unmapped milestone', function unmapped() {
      expect(jtbdFeedbackTargetIdFromMilestone('firstFileEdit')).toBeNull();
      expect(jtbdFeedbackTargetIdFromMilestone(null)).toBeNull();
    });

    // Mirrors the totality guard above for the namespaced helper that actually
    // feeds the emitted targetId: every active milestone must produce a non-null
    // `airo-app-builder-*` value so the skill-invoke targetId never falls through
    // to a different-shaped value.
    it('maps every active milestone to a namespaced target id', function totalOverActive() {
      for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
        expect(jtbdFeedbackTargetIdFromMilestone(milestone)).toMatch(/^airo-app-builder-/);
      }
    });
  });
});
