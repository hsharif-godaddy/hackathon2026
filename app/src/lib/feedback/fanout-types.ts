// app/src/lib/feedback/fanout-types.ts

import type { FeedbackCategory } from './category';

export type { FeedbackCategory };

// Issue and Support payloads are structurally identical for v1.
// Kept as separate types so category-specific fields can be added later
// without a breaking change to the union.
//
// `topics` is `readonly` so a value that crosses the BFF boundary
// (validator → route → CRM client → Lambda payload) cannot be mutated
// in flight — matches the immutable-data-flow guideline. `fullStoryUrl`
// drops the `?` because the validator always normalizes it to
// `string | null`; the optional + nullable double-encoding was a footgun.

export interface FanoutIssuePayload {
  category: 'issue';
  description: string;
  followUp: boolean;
  topics: readonly string[];
  appId: string | null;
  fullStoryUrl: string | null;
}

export interface FanoutSupportPayload {
  category: 'support';
  description: string;
  followUp: boolean;
  topics: readonly string[];
  appId: string | null;
  fullStoryUrl: string | null;
}

export interface FanoutFeedbackPayload {
  category: 'feedback';
  comment: string;
  rating: number;
  topics: readonly string[];
  /**
   * Strict required boolean — the validator rejects `undefined` so
   * "missing" is never silently coerced to `false`. The BFF threads
   * this into the CRM caseNote (`consent=yes` / `consent=no` marker
   * inside `escalationDetails`) and into the Lambda payload so the
   * investigation report can include consent context.
   */
  customerConsent: boolean;
  appId: string | null;
  fullStoryUrl: string | null;
}

export type FanoutSubmitRequest =
  | FanoutIssuePayload
  | FanoutSupportPayload
  | FanoutFeedbackPayload;

export interface FanoutSubmitResponse {
  success: boolean;
  caseId: string | null;
  caseNumber: string | null;
  investigationId: string | null;
  warnings?: {
    crmFailed?: boolean;
    /**
     * CRM returned 2xx but the response body was empty / non-JSON / had
     * no recognized id field. The case may or may not have been filed —
     * there's no audit trail without a caseId. UI should surface a
     * "submitted, no confirmation" state distinct from `crmFailed: true`
     * (where we know the POST failed).
     */
    crmIncomplete?: boolean;
    investigateFailed?: boolean;
    /**
     * Set when an investigation is already running for this (customerId,
     * appId) and the new submission was deduplicated against it. **A
     * fresh CRM case IS still opened** for the new submission (the
     * "always file a case" product contract); only the investigator
     * Lambda invoke is short-circuited. The new case gets a fire-and-
     * forget cross-link note pointing at the running investigation.
     * UI should treat the response as a successful submit pointing at
     * the in-flight investigation — `caseId` and `caseNumber` are still
     * populated when CRM open succeeded.
     */
    reusedExisting?: boolean;
  };
}
