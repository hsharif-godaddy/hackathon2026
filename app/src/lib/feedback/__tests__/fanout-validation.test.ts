import { describe, expect, it } from 'vitest';

import { validateFanoutPayload } from '../fanout-validation';

describe('validateFanoutPayload', () => {
  it('issue: accepts valid payload', () => {
    const result = validateFanoutPayload({
      category: 'issue',
      description: 'broken',
      followUp: true,
      topics: ['ui'],
      appId: 'a1',
    });
    expect(result.ok).toBe(true);
  });

  it('issue: rejects empty description', () => {
    const result = validateFanoutPayload({
      category: 'issue',
      description: '   ',
      followUp: false,
      topics: [],
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'description-required' });
  });

  it('support: accepts valid payload', () => {
    const result = validateFanoutPayload({
      category: 'support',
      description: 'help',
      followUp: false,
      topics: [],
      appId: 'a1',
    });
    expect(result.ok).toBe(true);
  });

  it('feedback: accepts rating 1-4', () => {
    for (const r of [1, 2, 3, 4]) {
      const result = validateFanoutPayload({
        category: 'feedback',
        comment: 'meh',
        rating: r,
        topics: [],
        customerConsent: true,
        appId: null,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('feedback: rejects rating >= 5 with rating-out-of-range', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'good',
      rating: 5,
      topics: [],
      customerConsent: true,
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'rating-out-of-range' });
  });

  it('feedback: rejects rating < 1 with rating-out-of-range', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'meh',
      rating: 0,
      topics: [],
      customerConsent: true,
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'rating-out-of-range' });
  });

  it('feedback: rejects non-integer rating with rating-not-integer', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'meh',
      rating: 2.5,
      topics: [],
      customerConsent: true,
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'rating-not-integer' });
  });

  it('feedback: rejects missing rating', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'something',
      // @ts-expect-error - intentionally missing
      rating: null,
      topics: [],
      customerConsent: true,
      appId: null,
    } as unknown as Parameters<typeof validateFanoutPayload>[0]);
    expect(result).toEqual({ ok: false, error: 'rating-required' });
  });

  it('feedback: rejects missing customerConsent (cannot infer opt-out)', () => {
    // The form always sends a boolean; a missing field means tampered or
    // malformed payload, not implicit decline. Logging silent `false` would
    // create unverifiable consent records in CRM.
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'meh',
      rating: 2,
      topics: [],
      // customerConsent intentionally omitted
      appId: null,
    } as unknown as Parameters<typeof validateFanoutPayload>[0]);
    expect(result).toEqual({ ok: false, error: 'consent-required' });
  });

  it('feedback: rejects non-boolean customerConsent (e.g. truthy string)', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'meh',
      rating: 2,
      topics: [],
      // @ts-expect-error - intentional non-boolean
      customerConsent: 'yes',
      appId: null,
    } as unknown as Parameters<typeof validateFanoutPayload>[0]);
    expect(result).toEqual({ ok: false, error: 'consent-required' });
  });

  it('feedback: accepts explicit customerConsent: false (declined)', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: 'meh',
      rating: 2,
      topics: [],
      customerConsent: false,
      appId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.category === 'feedback') {
      expect(result.payload.customerConsent).toBe(false);
    }
  });

  it('feedback: rejects empty comment', () => {
    const result = validateFanoutPayload({
      category: 'feedback',
      comment: '',
      rating: 2,
      topics: [],
      customerConsent: true,
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'description-required' });
  });

  it('rejects unknown category', () => {
    const result = validateFanoutPayload({
      // @ts-expect-error - test invalid input
      category: 'other',
      description: 'x',
    } as unknown as Parameters<typeof validateFanoutPayload>[0]);
    expect(result).toEqual({ ok: false, error: 'invalid-category' });
  });

  it('rejects an array payload (typeof [] === "object" loophole)', () => {
    // `typeof [] === 'object'` and `[]` is truthy, so a hostile array
    // would otherwise slip past the bare `typeof === 'object'` guard
    // and get cast to `Record<string, unknown>` — the category lookup
    // would still fail eventually but the error message would be
    // misleading. Reject up front (review S-8).
    const result = validateFanoutPayload(
      [{ category: 'issue', description: 'x' }] as unknown as Parameters<typeof validateFanoutPayload>[0],
    );
    expect(result).toEqual({ ok: false, error: 'invalid-category' });
  });

  it('rejects null', () => {
    const result = validateFanoutPayload(null);
    expect(result).toEqual({ ok: false, error: 'invalid-category' });
  });

  it('rejects description exceeding MAX_DESCRIPTION_LEN', () => {
    const result = validateFanoutPayload({
      category: 'issue',
      description: 'x'.repeat(4001),
      followUp: false,
      topics: [],
      appId: null,
    });
    expect(result).toEqual({ ok: false, error: 'description-too-long' });
  });
});
