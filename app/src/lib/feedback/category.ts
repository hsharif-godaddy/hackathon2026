/**
 * Single source of truth for the feedback fanout category union.
 *
 * Imported from:
 *   - `app/src/lib/crm/case-client.ts` (CRM case body builder)
 *   - `app/src/lib/feedback/fanout-types.ts` (request payloads)
 *   - `app/src/lib/feedback/fanout-validation.ts` (server-side validator)
 *   - `app/src/lib/investigate/invoke.ts` (Lambda payload)
 *
 * **debug-console** lives in a separate package without an `@airo/shared`
 * workspace dep, so it keeps an inline literal at
 * `debug-console/src/lib/investigate/types.ts`. That file has a comment
 * pointing back here; if you add a 4th category, update both.
 */

export type FeedbackCategory = 'issue' | 'support' | 'feedback';

/**
 * Runtime list of all valid categories. Useful for `Array.includes()` checks
 * and exhaustive switch coverage in tests. Kept aligned with the type union
 * by the `satisfies` clause — a missing entry fails typecheck.
 */
export const FEEDBACK_CATEGORIES = ['issue', 'support', 'feedback'] as const satisfies readonly FeedbackCategory[];

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string'
    && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}
