// app/src/lib/feedback/fanout-validation.ts

import { MAX_DESCRIPTION_CHARS } from '@/lib/crm/constants';
import type { FanoutSubmitRequest } from './fanout-types';

export type ValidationError =
  | 'invalid-category'
  | 'description-required'
  | 'description-too-long'
  | 'rating-required'
  // Numeric value outside the accepted [1, 4] feedback-fanout range.
  // 5+ ratings exist on the form but never trigger fan-out (the client
  // gates it); 0 / negative / > 7 are protocol violations.
  | 'rating-out-of-range'
  // Non-integer ratings (the form ships integers; floats indicate a
  // tampered or malformed payload).
  | 'rating-not-integer'
  // For category === 'feedback': customerConsent must be sent as an
  // explicit boolean. Silently coercing `undefined` to `false` would
  // conflate "customer declined" with "form bug dropped the field" —
  // a real risk for compliance/audit (we can't tell whether opt-out
  // was a deliberate user action). The client form ALWAYS ships either
  // true or false; missing means malformed payload.
  | 'consent-required';

export type ValidationResult =
  | { ok: true; payload: FanoutSubmitRequest }
  | { ok: false; error: ValidationError };

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function checkLength(text: string): ValidationError | null {
  if (text.length === 0) return 'description-required';
  if (text.length > MAX_DESCRIPTION_CHARS) return 'description-too-long';
  return null;
}

export function validateFanoutPayload(raw: unknown): ValidationResult {
  // Reject arrays explicitly: `typeof [] === 'object'` and `[]` is truthy,
  // so a hostile array would slip through a bare `typeof === 'object'`
  // guard. The category lookup would resolve to `undefined` and the
  // 'invalid-category' branch would fire eventually — but rejecting at the
  // top makes the failure mode obvious and forecloses any future code
  // that tries to read `.length`/`.map` off the cast `Record`.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid-category' };
  }
  const obj = raw as Record<string, unknown>;
  const category = obj.category;

  if (category === 'issue' || category === 'support') {
    const description = trim(obj.description);
    const lenErr = checkLength(description);
    if (lenErr) return { ok: false, error: lenErr };

    return {
      ok: true,
      payload: {
        category,
        description,
        followUp: obj.followUp === true,
        topics: Array.isArray(obj.topics)
          ? obj.topics.filter((t): t is string => typeof t === 'string')
          : [],
        appId:
          typeof obj.appId === 'string' && obj.appId.length > 0
            ? obj.appId
            : null,
        fullStoryUrl: typeof obj.fullStoryUrl === 'string' ? obj.fullStoryUrl : null,
      },
    };
  }

  if (category === 'feedback') {
    const comment = trim(obj.comment);
    const lenErr = checkLength(comment);
    if (lenErr) return { ok: false, error: lenErr };

    const rating = obj.rating;
    if (typeof rating !== 'number' || Number.isNaN(rating)) {
      return { ok: false, error: 'rating-required' };
    }
    // Order matters: integer check before range so a float sentinel like
    // 4.5 reports the more specific `rating-not-integer` rather than
    // landing in `rating-out-of-range`.
    if (!Number.isInteger(rating)) {
      return { ok: false, error: 'rating-not-integer' };
    }
    if (rating < 1 || rating >= 5) {
      return { ok: false, error: 'rating-out-of-range' };
    }
    // Require explicit boolean — distinguish "declined" from "missing".
    // The form always sends a boolean; a missing/non-boolean field means
    // a tampered or malformed payload, not an implicit opt-out. Logging
    // a silent `false` would put unverifiable consent records into CRM.
    if (typeof obj.customerConsent !== 'boolean') {
      return { ok: false, error: 'consent-required' };
    }

    return {
      ok: true,
      payload: {
        category,
        comment,
        rating,
        topics: Array.isArray(obj.topics)
          ? obj.topics.filter((t): t is string => typeof t === 'string')
          : [],
        customerConsent: obj.customerConsent,
        appId:
          typeof obj.appId === 'string' && obj.appId.length > 0
            ? obj.appId
            : null,
        fullStoryUrl: typeof obj.fullStoryUrl === 'string' ? obj.fullStoryUrl : null,
      },
    };
  }

  return { ok: false, error: 'invalid-category' };
}
