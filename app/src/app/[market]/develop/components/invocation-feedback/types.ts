/**
 * Invocation-level feedback types for the develop chat response footer.
 * Maps UI reason ids to Event Bus `feedbackCategory` strings from the shared schema.
 */

export type InvocationFeedbackVote = 'negative' | 'positive' | null;

export { parseMessageFeedbackMetadata as invocationFeedbackVoteFromMetadata } from '@/lib/message-metadata-client';

export type FeedbackReason =
  | 'not_factually_correct'
  | 'not_relevant'
  | 'did_not_follow_instructions'
  | 'poor_quality_or_too_generic'
  | 'confusing_or_unclear'
  | 'dont_match_my_brand'
  | 'generic_or_unoriginal'
  | 'other';

/** Event Bus user-feedback schema category labels (examples from events-team schema). */
const FEEDBACK_CATEGORY_BY_REASON: Record<FeedbackReason, string> = {
  not_factually_correct: 'Not accurate',
  not_relevant: 'Not relevant',
  did_not_follow_instructions: "Didn't follow instructions",
  poor_quality_or_too_generic: 'Too generic',
  confusing_or_unclear: 'Confusing response',
  dont_match_my_brand: "Doesn't match my brand",
  generic_or_unoriginal: 'Generic or unoriginal',
  other: 'Other',
};

export function feedbackCategoryForReason(reason: FeedbackReason): string {
  return FEEDBACK_CATEGORY_BY_REASON[reason];
}

/**
 * Reason ids shown for artifact-type feedback (flow === 'artifact') on a
 * generated logo / website / brand / domain. Distinct from the
 * conversation-level reasons above: an artifact is judged on brand fit and
 * originality, not factual accuracy. Ordering is the display order.
 */
export const ARTIFACT_FEEDBACK_REASONS: readonly FeedbackReason[] = [
  'dont_match_my_brand',
  'did_not_follow_instructions',
  'generic_or_unoriginal',
  'other',
];
