import { describe, it, expect } from 'vitest';
import {
  formatCompactNumber,
  classifyEvaluatorSignal,
  formatMarginFloorWarning,
  formatRegressionFailureMessage,
} from '../regression-message.js';
import type {
  ComparedRegressionEvalResult,
  RegressionResult,
  StatisticalMetadata,
} from '../../baselines/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStatistical(
  n: number,
  ciLower: number,
  ciUpper: number,
): StatisticalMetadata {
  return {
    method: 'wilson-score',
    margin: 0.2,
    baselineSD: 0.1,
    k: 2,
    n: { baseline: n, current: n },
    confidenceInterval: { lower: ciLower, upper: ciUpper },
    nonInferiorityProven: false,
  };
}

function makeCompared(
  evaluator: string,
  delta: number,
  exceeded: boolean,
  statistical?: StatisticalMetadata,
): ComparedRegressionEvalResult {
  return {
    type: 'compared',
    evaluator,
    currentScore: 0.5,
    baselineScore: 0.5 - delta,
    delta,
    exceeded,
    statistical,
  };
}

function makeResult(
  scenarioName: string,
  evaluators: RegressionResult['evaluators'],
): RegressionResult {
  return {
    scenarioName,
    gate: 'fail',
    stabilityLevel: 'low',
    evaluators,
  };
}

// ── formatCompactNumber ───────────────────────────────────────────────────────

describe('formatCompactNumber', () => {
  it('returns N/A for NaN', () => {
    expect(formatCompactNumber(NaN)).toBe('N/A');
  });

  it('returns N/A for Infinity', () => {
    expect(formatCompactNumber(Infinity)).toBe('N/A');
  });

  it('returns N/A for -Infinity', () => {
    expect(formatCompactNumber(-Infinity)).toBe('N/A');
  });

  it('formats zero as +0.00', () => {
    expect(formatCompactNumber(0)).toBe('+0.00');
  });

  it('includes explicit + sign for positive values below 1K', () => {
    expect(formatCompactNumber(0.33)).toBe('+0.33');
  });

  it('includes - sign for negative values below 1K', () => {
    expect(formatCompactNumber(-0.33)).toBe('-0.33');
  });

  it('formats values below 1K with two decimal places', () => {
    expect(formatCompactNumber(999)).toBe('+999.00');
  });

  it('formats exactly 1K as +1K', () => {
    expect(formatCompactNumber(1_000)).toBe('+1K');
  });

  it('rounds to nearest K for values in the K range', () => {
    expect(formatCompactNumber(1_500)).toBe('+2K');
    expect(formatCompactNumber(1_400)).toBe('+1K');
  });

  it('formats negative K values with - sign', () => {
    expect(formatCompactNumber(-1_500)).toBe('-2K');
  });

  it('formats exactly 1M with two decimal places', () => {
    expect(formatCompactNumber(1_000_000)).toBe('+1.00M');
  });

  it('formats large M values truncated to two decimal places', () => {
    expect(formatCompactNumber(1_673_295)).toBe('+1.67M');
  });

  it('formats negative M values with - sign', () => {
    expect(formatCompactNumber(-1_673_295)).toBe('-1.67M');
  });
});

// ── classifyEvaluatorSignal ───────────────────────────────────────────────────

describe('classifyEvaluatorSignal', () => {
  it('returns inconclusive when statistical is absent', () => {
    const e = makeCompared('eval', -0.5, true);
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });

  it('returns inconclusive for NaN delta', () => {
    const e = makeCompared('eval', NaN, true, makeStatistical(10, -0.3, -0.1));
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });

  it('returns inconclusive when CI range is zero (upper === lower === 0)', () => {
    const e = makeCompared('eval', 0.5, true, makeStatistical(10, 0, 0));
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });

  it('returns inconclusive when CI range is zero with non-zero bounds', () => {
    const e = makeCompared('eval', 0.5, true, makeStatistical(10, 0.2, 0.2));
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });

  it('returns inconclusive when CI upper is Infinity (infinite range)', () => {
    // ciHalfWidth = Infinity; |delta| > Infinity is always false
    const e = makeCompared('eval', 0.5, true, makeStatistical(10, 0, Infinity));
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });

  it('returns inconclusive at exact boundary where |delta| === ciHalfWidth', () => {
    // delta=0.20, ciHalfWidth=(0.40-0.00)/2=0.20 — strict > required
    const e = makeCompared('eval', 0.20, true, makeStatistical(10, 0.00, 0.40));
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });

  it('returns confirmed when |delta| strictly exceeds ciHalfWidth', () => {
    // delta=0.21, ciHalfWidth=0.20
    const e = makeCompared('eval', 0.21, true, makeStatistical(10, 0.00, 0.40));
    expect(classifyEvaluatorSignal(e)).toBe('confirmed');
  });

  it('returns confirmed for negative delta with strong signal', () => {
    // delta=-0.40, CI=[-0.60,-0.20], ciHalfWidth=0.20, |delta|=0.40 > 0.20
    const e = makeCompared('eval', -0.40, true, makeStatistical(10, -0.60, -0.20));
    expect(classifyEvaluatorSignal(e)).toBe('confirmed');
  });

  it('returns inconclusive when |delta| is within ciHalfWidth', () => {
    // delta=0.10, ciHalfWidth=0.20
    const e = makeCompared('eval', 0.10, true, makeStatistical(10, 0.00, 0.40));
    expect(classifyEvaluatorSignal(e)).toBe('inconclusive');
  });
});

// ── formatRegressionFailureMessage ───────────────────────────────────────────

describe('formatRegressionFailureMessage', () => {
  it('returns null when no evaluators have exceeded === true', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', 0.1, false, makeStatistical(3, -0.2, 0.4)),
    ]);
    expect(formatRegressionFailureMessage(r)).toBeNull();
  });

  it('returns null when all exceeded evaluators are fallback-only (no statistical)', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', 0.3, true),
    ]);
    expect(formatRegressionFailureMessage(r)).toBeNull();
  });

  it('returns null when multiple exceeded evaluators all lack statistical data', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', 0.3, true),
      makeCompared('token-usage', 0.5, true),
    ]);
    expect(formatRegressionFailureMessage(r)).toBeNull();
  });

  it('all inconclusive — includes evaluator block, per-evaluator n, and run-more-trials command', () => {
    const r = makeResult('multipage-catalog', [
      makeCompared('jtbd-completion', -0.10, true, makeStatistical(3, -0.67, 0.47)),
      makeCompared('token-usage', 1_673_295, true, makeStatistical(3, -500_000, 3_830_000)),
    ]);
    const msg = formatRegressionFailureMessage(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain('"multipage-catalog"');
    expect(msg).toContain('n=3');
    expect(msg).toContain('jtbd-completion');
    expect(msg).toContain('[inconclusive]');
    expect(msg).not.toContain('[confirmed]');
    expect(msg).toContain('pnpm run eval --scenario multipage-catalog --trials 5');
    expect(msg).not.toContain('Investigate');
  });

  it('all confirmed — includes evaluator block, per-evaluator n, and investigate closing', () => {
    const r = makeResult('cleaning-biz-ambiguity', [
      makeCompared('jtbd-completion', -0.40, true, makeStatistical(10, -0.60, -0.20)),
    ]);
    const msg = formatRegressionFailureMessage(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain('"cleaning-biz-ambiguity"');
    expect(msg).toContain('n=10');
    expect(msg).toContain('[confirmed]');
    expect(msg).toContain('Investigate the change before running more trials.');
    expect(msg).not.toContain('pnpm run eval');
  });

  it('mixed — includes both tags and run-more-trials command (not all-confirmed message)', () => {
    const r = makeResult('my-scenario', [
      // confirmed: |delta|=0.40 > ciHalfWidth=0.20
      makeCompared('jtbd-completion', -0.40, true, makeStatistical(5, -0.60, -0.20)),
      // inconclusive: |delta|=0.05 < ciHalfWidth=0.25
      makeCompared('token-usage', 0.05, true, makeStatistical(5, -0.20, 0.30)),
    ]);
    const msg = formatRegressionFailureMessage(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain('[confirmed]');
    expect(msg).toContain('[inconclusive]');
    expect(msg).toContain('pnpm run eval --scenario my-scenario --trials 5');
    expect(msg).not.toContain('Investigate the change before running more trials.');
  });

  it('NaN delta — shows N/A and "investigation recommended" closing', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', NaN, true, makeStatistical(3, NaN, NaN)),
    ]);
    const msg = formatRegressionFailureMessage(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain('Δ=N/A');
    expect(msg).toContain('[inconclusive]');
    expect(msg).toContain('Investigation recommended');
    expect(msg).not.toContain('pnpm run eval');
  });

  it('formats delta and CI using compact number notation', () => {
    const r = makeResult('my-scenario', [
      makeCompared('token-usage', 1_673_295, true, makeStatistical(3, -500_000, 3_830_000)),
    ]);
    const msg = formatRegressionFailureMessage(r);
    expect(msg).toContain('Δ=+1.67M');
  });

  it('excludes fallback-only evaluators but produces a message for statistical ones', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', -0.40, true, makeStatistical(5, -0.60, -0.20)),
      makeCompared('fallback-eval', 0.30, true), // no statistical — excluded
    ]);
    const msg = formatRegressionFailureMessage(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain('jtbd-completion');
    expect(msg).not.toContain('fallback-eval');
  });

  it('produces exact evaluator block format with delta, CI, n, and signal tag', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', -0.40, true, makeStatistical(10, -0.60, -0.20)),
    ]);
    const msg = formatRegressionFailureMessage(r)!;
    const lines = msg.split('\n');
    // Extract the evaluator block (3 lines: name, data, tag)
    const nameIdx = lines.findIndex((l) => l.includes('jtbd-completion'));
    const block = lines.slice(nameIdx, nameIdx + 3).join('\n');
    expect(block).toBe(
      '  jtbd-completion:\n' +
      '    Δ=-0.40, CI=[-0.60, -0.20], n=10\n' +
      '    [confirmed]',
    );
  });

  it('displays per-evaluator n when trial counts differ', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', -0.40, true, makeStatistical(5, -0.60, -0.20)),
      makeCompared('token-usage', 1_500, true, makeStatistical(8, -200, 3_200)),
    ]);
    const msg = formatRegressionFailureMessage(r)!;
    const lines = msg.split('\n');
    const jtbdLine = lines.find((l) => l.includes('jtbd-completion') === false && l.includes('n=5'));
    const tokenLine = lines.find((l) => l.includes('n=8'));
    expect(jtbdLine).toBeDefined();
    expect(tokenLine).toBeDefined();
  });

  it('tag lines are indented under the evaluator name line', () => {
    const r = makeResult('my-scenario', [
      makeCompared('jtbd-completion', -0.40, true, makeStatistical(10, -0.60, -0.20)),
    ]);
    const msg = formatRegressionFailureMessage(r)!;
    const lines = msg.split('\n');
    const nameLineIdx = lines.findIndex((l) => l.includes('jtbd-completion'));
    const tagLineIdx = lines.findIndex((l) => l.includes('[confirmed]'));
    expect(tagLineIdx).toBeGreaterThan(nameLineIdx);
    // tag line is more indented than the evaluator name line
    const nameLine = lines[nameLineIdx];
    const tagLine = lines[tagLineIdx];
    const nameIndent = nameLine.length - nameLine.trimStart().length;
    const tagIndent = tagLine.length - tagLine.trimStart().length;
    expect(tagIndent).toBeGreaterThan(nameIndent);
  });
});

// ── formatMarginFloorWarning ────────────────────────────────────────────────

describe('formatMarginFloorWarning', () => {
  function makePassResult(
    scenarioName: string,
    evaluators: RegressionResult['evaluators'],
  ): RegressionResult {
    return { scenarioName, gate: 'pass', stabilityLevel: 'low', evaluators };
  }

  function makeFlooredStatistical(
    baselineSD: number,
    margin: number,
  ): StatisticalMetadata {
    return {
      method: 'permutation-exact',
      margin,
      baselineSD,
      k: 2,
      n: { baseline: 5, current: 5 },
      confidenceInterval: { lower: -0.01, upper: 0.03 },
      nonInferiorityProven: true,
      marginFloored: true,
    };
  }

  it('returns null when gate is fail', () => {
    const r: RegressionResult = {
      scenarioName: 'test',
      gate: 'fail',
      stabilityLevel: 'low',
      evaluators: [
        makeCompared('tool-failure-rate', 0.02, true, makeFlooredStatistical(0, 0.05)),
      ],
    };
    expect(formatMarginFloorWarning(r)).toBeNull();
  });

  it('returns null when no evaluators have marginFloored', () => {
    const r = makePassResult('test', [
      makeCompared('jtbd-completion', 0.0, false, makeStatistical(5, -0.1, 0.1)),
    ]);
    expect(formatMarginFloorWarning(r)).toBeNull();
  });

  it('returns null when marginFloored evaluator has exceeded=true', () => {
    const stat = makeFlooredStatistical(0, 0.05);
    stat.nonInferiorityProven = false;
    const r = makePassResult('test', [
      makeCompared('tool-failure-rate', 0.02, true, stat),
    ]);
    expect(formatMarginFloorWarning(r)).toBeNull();
  });

  it('returns warning when gate passes and evaluator has marginFloored=true', () => {
    const r = makePassResult('cleaning-biz-ambiguity', [
      makeCompared('tool-failure-rate', 0.02, false, makeFlooredStatistical(0, 0.05)),
    ]);
    const msg = formatMarginFloorWarning(r);
    expect(msg).not.toBeNull();
    expect(msg).toContain('Pass (margin-floored)');
    expect(msg).toContain('"cleaning-biz-ambiguity"');
    expect(msg).toContain('tool-failure-rate');
    expect(msg).toContain('baseline SD=0.0000');
    expect(msg).toContain('margin floored to 0.050');
    expect(msg).toContain('Consider graduating with more trials');
  });

  it('includes multiple floored evaluators', () => {
    const r = makePassResult('test', [
      makeCompared('tool-failure-rate', 0.01, false, makeFlooredStatistical(0, 0.05)),
      makeCompared('agent-steps', 0.03, false, makeFlooredStatistical(0.001, 0.05)),
    ]);
    const msg = formatMarginFloorWarning(r)!;
    expect(msg).toContain('tool-failure-rate');
    expect(msg).toContain('agent-steps');
  });

  it('works with gate=warning (not just pass)', () => {
    const r: RegressionResult = {
      scenarioName: 'test',
      gate: 'warning',
      stabilityLevel: 'low',
      evaluators: [
        makeCompared('tool-failure-rate', 0.02, false, makeFlooredStatistical(0, 0.05)),
      ],
    };
    const msg = formatMarginFloorWarning(r);
    expect(msg).not.toBeNull();
  });
});
