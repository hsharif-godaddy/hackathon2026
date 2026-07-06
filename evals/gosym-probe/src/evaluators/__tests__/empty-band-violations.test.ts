import { describe, it, expect } from 'vitest';

import type { DOMSnapshot } from '../../runner/transcript.js';
import type { EmptyBandViolation, EmptyBandKind } from '@airo/shared/brand-data';
import { EmptyBandViolationsEvaluator } from '../empty-band-violations.js';

function violation(kind: EmptyBandKind): EmptyBandViolation {
  return {
    selector: 'section.hero',
    className: 'full-bleed',
    tag: kind === 'divider' ? 'hr' : 'section',
    heightPx: 200,
    fullBleed: kind === 'full-bleed-band',
    hasHr: kind === 'divider',
    kind,
  };
}

function snapshotWith(violations: EmptyBandViolation[], bandsScanned = 8): DOMSnapshot {
  return {
    url: 'http://preview',
    screenshotPath: '0.png',
    htmlPath: '0.html',
    timestamp: '2026-06-30T00:00:00Z',
    consoleLogs: [],
    emptyBandAudit: { bandsScanned, violations },
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

describe('EmptyBandViolationsEvaluator', () => {
  const evaluator = new EmptyBandViolationsEvaluator();

  it('scores the count of content-less divider / full-bleed bands', async () => {
    const res = await evaluator.evaluate(
      NOOP,
      NOOP,
      snapshotWith([violation('full-bleed-band'), violation('divider'), violation('full-bleed-band')]),
    );
    expect(res.score).toBe(3);
    expect(res.verdict).toBe('directional');
    expect((res.details?.byKind as Record<string, number>)['full-bleed-band']).toBe(2);
    expect((res.details?.byKind as Record<string, number>).divider).toBe(1);
  });

  it('is score-mode, lower-is-better (more empty bands = regression)', () => {
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });

  it('reports the bands-scanned denominator so a clean score is interpretable', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotWith([], 12));
    expect(res.score).toBe(0);
    expect(res.verdict).toBe('directional');
    expect(res.details?.bandsScanned).toBe(12);
    expect(res.reason).toContain('12 band(s)');
  });

  it('returns verdict incomplete when no snapshot was captured', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, undefined);
    expect(res.verdict).toBe('incomplete');
  });

  it('returns verdict incomplete when the snapshot has no emptyBandAudit (audit did not run)', async () => {
    const res = await evaluator.evaluate(NOOP, NOOP, snapshotNoAudit());
    expect(res.verdict).toBe('incomplete');
  });
});
