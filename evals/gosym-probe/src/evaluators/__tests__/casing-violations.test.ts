import { describe, it, expect } from 'vitest';

import type { DOMSnapshot } from '../../runner/transcript.js';
import type { CasingViolation, CasingTokenGuess } from '../../clients/site-capture/casing.js';
import { CasingViolationsEvaluator } from '../casing-violations.js';

function violation(tokenGuess: CasingTokenGuess, wideTracking = false): CasingViolation {
  return {
    selector: 'span.eyebrow',
    className: tokenGuess === 'eyebrow' ? 'section-eyebrow' : 'section-label',
    text: 'what we do',
    textTransform: 'uppercase',
    letterSpacingEm: wideTracking ? 0.15 : 0,
    fontPx: 12,
    tokenGuess,
    wideTracking,
  };
}

function snapshotWith(violations: CasingViolation[], textNodesScanned = 40): DOMSnapshot {
  return {
    url: 'http://preview',
    screenshotPath: '0.png',
    htmlPath: '0.html',
    timestamp: '2026-06-30T00:00:00Z',
    consoleLogs: [],
    casingAudit: { textNodesScanned, violations },
  };
}

function snapshotNoAudit(): DOMSnapshot {
  return {
    url: 'http://preview',
    screenshotPath: '0.png',
    htmlPath: '0.html',
    timestamp: '2026-06-30T00:00:00Z',
    consoleLogs: [],
  };
}

const NOOP = {} as never;

describe('CasingViolationsEvaluator', () => {
  const evaluator = new CasingViolationsEvaluator();

  it('scores the count of gratuitous all-caps eyebrow/label nodes', async () => {
    const res = await evaluator.evaluate(
      NOOP,
      NOOP,
      snapshotWith([violation('eyebrow', true), violation('label'), violation('label')]),
    );
    expect(res.score).toBe(3);
    expect(res.verdict).toBe('observed');
    expect((res.details?.byToken as Record<string, number>).eyebrow).toBe(1);
    expect((res.details?.byToken as Record<string, number>).label).toBe(2);
    expect(res.details?.wideTracking).toBe(1);
  });

  it('is score-mode, lower-is-better (more all-caps eyebrows = regression)', () => {
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });

  it('reports the text-nodes-scanned denominator so a clean score is interpretable', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotWith([], 120));
    expect(res.score).toBe(0);
    expect(res.verdict).toBe('observed');
    expect(res.details?.textNodesScanned).toBe(120);
    expect(res.reason).toContain('120 text node(s)');
  });

  it('returns verdict unknown when no snapshot was captured', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, undefined);
    expect(res.verdict).toBe('unknown');
  });

  it('returns verdict unknown when the snapshot has no casingAudit (audit did not run)', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotNoAudit());
    expect(res.verdict).toBe('unknown');
  });
});
