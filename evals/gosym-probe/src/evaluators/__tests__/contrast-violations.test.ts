import { describe, it, expect } from 'vitest';

import type { DOMSnapshot } from '../../runner/transcript.js';
import type { ContrastViolation, TokenGuess } from '../../clients/site-capture/contrast.js';
import { ContrastViolationsEvaluator } from '../contrast-violations.js';

function violation(tokenGuess: TokenGuess, ratio = 2.5): ContrastViolation {
  return {
    selector: 'p',
    className: tokenGuess === 'muted' ? 'text-muted-foreground' : tokenGuess === 'tertiary' ? 'text-ink-tertiary' : 'text-x',
    fgColor: 'rgb(153, 153, 153)',
    bgColor: 'rgb(255, 255, 255)',
    ratio,
    fontPx: 16,
    bold: false,
    isLargeText: false,
    requiredRatio: 4.5,
    tokenGuess,
  };
}

function snapshotWith(violations: ContrastViolation[], textNodesScanned = 50): DOMSnapshot {
  return {
    url: 'http://preview',
    screenshotPath: '0.png',
    htmlPath: '0.html',
    timestamp: '2026-06-26T00:00:00Z',
    consoleLogs: [],
    contrastAudit: { textNodesScanned, violations },
  };
}

function snapshotNoAudit(): DOMSnapshot {
  return {
    url: 'http://preview',
    screenshotPath: '0.png',
    htmlPath: '0.html',
    timestamp: '2026-06-26T00:00:00Z',
    consoleLogs: [],
  };
}

const NOOP = {} as never;

describe('ContrastViolationsEvaluator', () => {
  const evaluator = new ContrastViolationsEvaluator();

  it('scores all determinate WCAG AA failures, not just muted/tertiary-attributable ones', async () => {
    const snapshot = snapshotWith([
      violation('muted', 2.1),
      violation('tertiary', 3.0),
      violation('other', 2.0),
      violation('indeterminate-bg'),
    ]);
    const res = await evaluator.evaluate(NOOP, NOOP, snapshot);
    expect(res.score).toBe(3); // all determinate (muted + tertiary + other); excludes indeterminate-bg
    expect(res.verdict).toBe('directional');
    expect(res.details?.totalAaViolations).toBe(3);
    expect(res.details?.attributable).toBe(2); // muted + tertiary kept as a diagnostic
    expect(res.details?.indeterminateBg).toBe(1);
    expect(res.details?.worstRatio).toBe(2.0);
    expect((res.details?.byToken as Record<string, number>).muted).toBe(1);
  });

  it('is score-mode, lower-is-better (so regressions = more violations)', () => {
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });

  it('counts non-attributable (other) failures toward the score, reporting attribution in details', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotWith([violation('other'), violation('other')]));
    expect(res.score).toBe(2); // both 'other' are real AA failures
    expect(res.details?.totalAaViolations).toBe(2);
    expect(res.details?.attributable).toBe(0); // none attributable to muted/tertiary
  });

  it('reports the text-nodes-scanned denominator so a clean score is interpretable', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotWith([], 120));
    expect(res.score).toBe(0);
    expect(res.verdict).toBe('directional');
    expect(res.details?.textNodesScanned).toBe(120);
    expect(res.reason).toContain('120 text node(s)');
  });

  it('returns verdict unknown when no snapshot was captured', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, undefined);
    expect(res.verdict).toBe('incomplete');
  });

  it('returns verdict unknown when the snapshot has no contrastAudit (audit did not run)', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotNoAudit());
    expect(res.verdict).toBe('incomplete');
  });
});
