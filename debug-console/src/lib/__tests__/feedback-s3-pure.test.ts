import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  filterFeedbackItemsForWindow,
  parseFeedbackUtc,
  type FeedbackWindow,
} from '@/lib/feedback-s3';

describe('feedback-s3 parseFeedbackUtc', function parseUtc() {
  it('parses naive space-separated timestamp as UTC', function spaceUtc() {
    const d = parseFeedbackUtc('2026-05-06 14:30:45');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-05-06T14:30:45.000Z');
  });

  it('parses explicit numeric offset without forcing Z', function offsetBare() {
    const d = parseFeedbackUtc('2026-05-06T10:15:00-07:00');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-05-06T17:15:00.000Z');
  });

  it('accepts Z-suffixed ISO', function zSuffix() {
    const d = parseFeedbackUtc('2026-05-05T08:00:00.000Z');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-05-05T08:00:00.000Z');
  });

  it('returns null for empty and unparseable strings', function garbage() {
    expect(parseFeedbackUtc('')).toBeNull();
    expect(parseFeedbackUtc('   ')).toBeNull();
    expect(parseFeedbackUtc('not-a-date')).toBeNull();
  });
});

describe('feedback-s3 filterFeedbackItemsForWindow', function filterWindow() {
  afterEach(function teardown() {
    vi.useRealTimers();
  });

  it('includes only rolling-window rows by feedback_utc_ts', function rollingFilter() {
    vi.useFakeTimers({ now: new Date('2026-05-10T12:00:00.000Z').getTime() });
    const window: FeedbackWindow = { kind: 'rolling', days: 7 };
    const items = [
      { feedback_text: 'a', rating: 7, feedback_utc_ts: '2026-05-09T10:00:00.000Z' },
      { feedback_text: 'b', rating: 2, feedback_utc_ts: '2026-01-01T00:00:00.000Z' },
    ];
    const filtered = filterFeedbackItemsForWindow(items, window);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].feedback_text).toBe('a');
  });

  it('includes absolute-range rows inclusively', function absoluteRange() {
    const window: FeedbackWindow = { kind: 'absolute', startYmd: '2026-05-05', endYmd: '2026-05-06' };
    const items = [
      { feedback_text: 'early', rating: 5, feedback_utc_ts: '2026-05-05T08:00:00.000Z' },
      { feedback_text: 'late', rating: 5, feedback_utc_ts: '2026-05-06T23:00:00.000Z' },
      { feedback_text: 'before', rating: 1, feedback_utc_ts: '2026-05-04T23:59:59.999Z' },
    ];
    const filtered = filterFeedbackItemsForWindow(items, window);
    expect(filtered.map((x) => x.feedback_text).sort()).toEqual(['early', 'late']);
  });
});
