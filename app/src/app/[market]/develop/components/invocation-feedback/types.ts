/**
 * Invocation-level feedback types for the develop chat response footer.
 * Maps UI reason ids to Event Bus `feedbackCategory` strings from the shared schema.
 */

export type InvocationFeedbackVote = 'negative' | 'positive' | null;

export type FeedbackReason =
  | 'not_factually_correct'
  | 'not_relevant'
  | 'did_not_follow_instructions'
  | 'poor_quality_or_too_generic'
  | 'confusing_or_unclear'
  | 'other';

/** Event Bus user-feedback schema category labels (examples from events-team schema). */
const FEEDBACK_CATEGORY_BY_REASON: Record<FeedbackReason, string> = {
  not_factually_correct: 'Not accurate',
  not_relevant: 'Not relevant',
  did_not_follow_instructions: "Didn't follow instructions",
  poor_quality_or_too_generic: 'Too generic',
  confusing_or_unclear: 'Confusing response',
  other: 'Other',
};

export function feedbackCategoryForReason(reason: FeedbackReason): string {
  return FEEDBACK_CATEGORY_BY_REASON[reason];
}
