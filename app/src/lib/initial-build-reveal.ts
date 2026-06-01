export type FeedbackRevealMilestone = 'firstFileEdit' | 'logoCreation' | 'imageSelection';

/**
 * Milestones that currently gate feedback banners.
 * Add `'logoCreation' | 'imageSelection'` here once their trigger workflows are defined.
 */
export const ACTIVE_FEEDBACK_REVEAL_MILESTONES: readonly FeedbackRevealMilestone[] = [
  'firstFileEdit',
];

export interface FeedbackRevealSignals {
  firstFileEdit: boolean;
  /** Reserved — wire `markFeedbackRevealMilestone(appId, 'logoCreation')` when ready. */
  logoCreation: boolean;
  /** Reserved — wire `markFeedbackRevealMilestone(appId, 'imageSelection')` when ready. */
  imageSelection: boolean;
}

export function isFeedbackRevealReady(signals: FeedbackRevealSignals): boolean {
  for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
    if (signals[milestone]) return true;
  }
  return false;
}

/**
 * Next active milestone that is satisfied but not yet shown for agent-work feedback.
 */
export function resolvePendingFeedbackRevealMilestone(
  signals: FeedbackRevealSignals,
  shownMilestones: ReadonlySet<FeedbackRevealMilestone>
): FeedbackRevealMilestone | null {
  for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
    if (signals[milestone] && !shownMilestones.has(milestone)) {
      return milestone;
    }
  }
  return null;
}
