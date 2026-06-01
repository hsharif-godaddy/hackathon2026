import { describe, expect, it } from 'vitest';

import {
  isFeedbackRevealReady,
  resolvePendingFeedbackRevealMilestone,
} from './initial-build-reveal';

describe('initial-build-reveal', function initialBuildRevealTests() {
  describe('#isFeedbackRevealReady', function isReadyTests() {
    it('returns true when firstFileEdit is satisfied', function firstFileEdit() {
      expect(
        isFeedbackRevealReady({
          firstFileEdit: true,
          logoCreation: false,
          imageSelection: false,
        })
      ).toBe(true);
    });

    it('returns false when no active milestone is satisfied', function none() {
      expect(
        isFeedbackRevealReady({
          firstFileEdit: false,
          logoCreation: false,
          imageSelection: false,
        })
      ).toBe(false);
    });

    it('ignores reserved logo and image flags until added to ACTIVE_FEEDBACK_REVEAL_MILESTONES', function reserved() {
      expect(
        isFeedbackRevealReady({
          firstFileEdit: false,
          logoCreation: true,
          imageSelection: true,
        })
      ).toBe(false);
    });
  });

  describe('#resolvePendingFeedbackRevealMilestone', function pendingTests() {
    it('returns firstFileEdit when satisfied and not yet shown', function pending() {
      expect(
        resolvePendingFeedbackRevealMilestone(
          { firstFileEdit: true, logoCreation: false, imageSelection: false },
          new Set()
        )
      ).toBe('firstFileEdit');
    });

    it('returns null when the milestone was already shown', function alreadyShown() {
      expect(
        resolvePendingFeedbackRevealMilestone(
          { firstFileEdit: true, logoCreation: false, imageSelection: false },
          new Set(['firstFileEdit'])
        )
      ).toBeNull();
    });
  });
});
