/**
 * Default English copy for domain suggestion feedback keys (dev fallback until published in @airo-app-builder/aab).
 */
export const DOMAIN_FEEDBACK_DEFAULT_MESSAGES = {
  builder_domain_suggestion_feedback_reason_mismatch: "Doesn't match my business",
  builder_domain_suggestion_feedback_reason_unavailable: 'Preferred domain unavailable',
  builder_domain_suggestion_feedback_reason_price: 'Too expensive',
  builder_domain_suggestion_feedback_prompt: 'Were these helpful?',
  builder_domain_suggestion_feedback_positive: 'Suggestions were helpful',
  builder_domain_suggestion_feedback_negative: 'Suggestions were not helpful',
} satisfies Record<string, string>

export type DomainFeedbackKey = keyof typeof DOMAIN_FEEDBACK_DEFAULT_MESSAGES

export function defaultMessageForDomainFeedbackKey(key: DomainFeedbackKey): string {
  return DOMAIN_FEEDBACK_DEFAULT_MESSAGES[key]
}
