import { describe, expect, it } from 'vitest';

import { getFeedbackItemsCached } from '@/lib/feedback-s3';

const live =
  process.env.FEEDBACK_S3_LIVE_TEST === '1' && Boolean(process.env.FEEDBACK_S3_BUCKET?.trim());

// Opt-in: default AWS credential chain; skipped in CI unless FEEDBACK_S3_LIVE_TEST=1 and bucket set.

describe.skipIf(!live)('feedback-s3 real S3 bucket', function realBucket() {
  it('fetches rolling-window feedback from the configured bucket (may be zero rows)', async function fetchRolling() {
    const out = await getFeedbackItemsCached({ kind: 'rolling', days: 7 });
    expect(typeof out.merged_truncated).toBe('boolean');
    expect(typeof out.partition_errors).toBe('number');
    expect(Array.isArray(out.items)).toBe(true);
    for (const item of out.items.slice(0, 10)) {
      expect(item).toMatchObject({
        feedback_text: expect.any(String),
        rating: expect.any(Number),
      });
    }
  });
});
