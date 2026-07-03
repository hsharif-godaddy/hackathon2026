import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BinaryCompositeEvaluator } from '../binary-composite-evaluator.js';
import type { Evaluator, EvalResult } from '../evaluator.js';
import type { AgentClient } from '../../clients/agent-client.js';
import { makeTranscript, makeScenario } from './evaluator-test-helpers.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makePassRateEvaluator(
  name: string,
  result: Partial<EvalResult>,
  hooks: {
    hookClient?: (client: AgentClient, trialIndex: number) => void;
    afterSimulation?: (trialIndex: number) => void;
    unhookTrial?: (trialIndex: number) => void;
  } = {},
): Evaluator & { comparisonMode: 'passRate' } {
  return {
    name,
    comparisonMode: 'passRate' as const,
    evaluate: vi.fn().mockResolvedValue({
      evaluator: name,
      score: 1,
      verdict: 'pass',
      reason: 'default',
      ...result,
    }),
    hookClient: hooks.hookClient,
    afterSimulation: hooks.afterSimulation,
    unhookTrial: hooks.unhookTrial,
  };
}

const transcript = makeTranscript([]);
const scenario = makeScenario();

// ── Gate semantics ────────────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — gate semantics', () => {
  it('returns pass when all subs pass', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('b', { verdict: 'pass', score: 1 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
  });

  it('returns fail when any sub fails', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('b', { verdict: 'fail', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('fail');
  });

  it('returns incomplete when all subs return incomplete', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'incomplete', score: 0 }),
      makePassRateEvaluator('b', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('returns fail when 1 fail and 1 incomplete (fail overrides incomplete)', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'fail', score: 0 }),
      makePassRateEvaluator('b', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('fail');
  });
});

// ── Score computation ─────────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — score computation', () => {
  it('score = 2/3 for 2 pass + 1 fail', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('b', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('c', { verdict: 'fail', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBeCloseTo(2 / 3);
  });

  it('score = 1.0 for 2 pass + 1 incomplete (incomplete excluded from denominator)', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('b', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('c', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBe(1);
    expect(result.verdict).toBe('pass');
  });
});

// ── hardFailures list ─────────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — hardFailures', () => {
  it('lists failed sub evaluator names in hardFailures', async () => {
    const subs = [
      makePassRateEvaluator('inv-check-1', { verdict: 'fail', score: 0 }),
      makePassRateEvaluator('inv-check-2', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('inv-check-3', { verdict: 'fail', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    const hardFailures = result.details?.['hardFailures'] as string[];
    expect(hardFailures).toContain('inv-check-1');
    expect(hardFailures).toContain('inv-check-3');
    expect(hardFailures).not.toContain('inv-check-2');
  });

  it('includes fail subs in hardFailures', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'fail', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    const hardFailures = result.details?.['hardFailures'] as string[];
    expect(hardFailures).toContain('a');
  });

  it('hardFailures is empty when all pass', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'pass', score: 1 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    const hardFailures = result.details?.['hardFailures'] as string[];
    expect(hardFailures).toHaveLength(0);
  });
});

// ── Construction guard ────────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — construction guard', () => {
  it('throws at construction when a sub has comparisonMode score (cast past types)', () => {
    const scoreSub = {
      name: 'score-sub',
      comparisonMode: 'score' as const,
      evaluate: vi.fn(),
    } as unknown as Evaluator & { comparisonMode: 'passRate' };

    expect(() => {
      new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: [scoreSub] });
    }).toThrow();
  });

  it('accepts sub with comparisonMode passRate', () => {
    const sub = makePassRateEvaluator('a', { verdict: 'pass', score: 1 });
    expect(() => {
      new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: [sub] });
    }).not.toThrow();
  });

  it('accepts sub with comparisonMode undefined (passRate default)', () => {
    const sub: Evaluator & { comparisonMode: 'passRate' } = {
      name: 'a',
      comparisonMode: 'passRate',
      evaluate: vi.fn().mockResolvedValue({ evaluator: 'a', score: 1, verdict: 'pass', reason: '' }),
    };
    const subWithUndef = { ...sub, comparisonMode: undefined } as unknown as Evaluator & { comparisonMode: 'passRate' };
    expect(() => {
      new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: [subWithUndef] });
    }).not.toThrow();
  });
});

// ── 'directional' sub verdict ─────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — directional sub verdict', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("treats 'directional' sub verdict as incomplete", async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'directional' as EvalResult['verdict'], score: 0.5 }),
      makePassRateEvaluator('b', { verdict: 'pass', score: 1 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('pass');
    expect(result.details?.['scoredCount']).toBe(1);
  });

  it("emits console.warn when sub returns 'directional'", async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'directional' as EvalResult['verdict'], score: 0.5 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    await ev.evaluate(transcript, scenario);
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — lifecycle hooks', () => {
  it('forwards hookClient to all subs', () => {
    const mockClient = {} as AgentClient;
    const hookA = vi.fn();
    const hookB = vi.fn();
    const subs = [
      makePassRateEvaluator('a', {}, { hookClient: hookA }),
      makePassRateEvaluator('b', {}, { hookClient: hookB }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    ev.hookClient!(mockClient, 0);
    expect(hookA).toHaveBeenCalledWith(mockClient, 0);
    expect(hookB).toHaveBeenCalledWith(mockClient, 0);
  });

  it('forwards afterSimulation to all subs', () => {
    const afterA = vi.fn();
    const afterB = vi.fn();
    const subs = [
      makePassRateEvaluator('a', {}, { afterSimulation: afterA }),
      makePassRateEvaluator('b', {}, { afterSimulation: afterB }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    ev.afterSimulation!(3);
    expect(afterA).toHaveBeenCalledWith(3);
    expect(afterB).toHaveBeenCalledWith(3);
  });

  it('forwards unhookTrial to all subs', () => {
    const unhookA = vi.fn();
    const unhookB = vi.fn();
    const subs = [
      makePassRateEvaluator('a', {}, { unhookTrial: unhookA }),
      makePassRateEvaluator('b', {}, { unhookTrial: unhookB }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    ev.unhookTrial!(1);
    expect(unhookA).toHaveBeenCalledWith(1);
    expect(unhookB).toHaveBeenCalledWith(1);
  });
});

// ── details._composite ────────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — details', () => {
  it('sets _composite to binary', async () => {
    const subs = [makePassRateEvaluator('a', { verdict: 'pass', score: 1 })];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.details?.['_composite']).toBe('binary');
  });

  it('sets scoredCount and totalCount', async () => {
    const subs = [
      makePassRateEvaluator('a', { verdict: 'pass', score: 1 }),
      makePassRateEvaluator('b', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.details?.['scoredCount']).toBe(1);
    expect(result.details?.['totalCount']).toBe(2);
  });
});

// ── comparisonMode fixed ──────────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — comparisonMode', () => {
  it('has comparisonMode passRate fixed', () => {
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: [] });
    expect(ev.comparisonMode).toBe('passRate');
  });
});

// ── safeEvaluate: sub throws ──────────────────────────────────────────────────

describe('BinaryCompositeEvaluator — sub error isolation', () => {
  it('treats a throwing sub as fail (counted in denominator, flips gate to fail)', async () => {
    const throwingSub: Evaluator & { comparisonMode: 'passRate' } = {
      name: 'bad-sub',
      comparisonMode: 'passRate' as const,
      evaluate: vi.fn().mockRejectedValue(new Error('exploded')),
    };
    const goodSub = makePassRateEvaluator('good-sub', { verdict: 'pass', score: 1 });
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: [throwingSub, goodSub] });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('fail');
    expect(result.evaluatorFailed).toBe(true);
    expect(result.details?.['scoredCount']).toBe(2);
    expect(result.details?.['totalCount']).toBe(2);
    const hardFailures = result.details?.['hardFailures'] as string[];
    expect(hardFailures).toContain('bad-sub');
  });

  it('sets evaluatorFailed on composite when a sub throws', async () => {
    const throwingSub: Evaluator & { comparisonMode: 'passRate' } = {
      name: 'bad-sub',
      comparisonMode: 'passRate' as const,
      evaluate: vi.fn().mockRejectedValue(new Error('crash')),
    };
    const ev = new BinaryCompositeEvaluator({ name: 'test-binary', subEvaluators: [throwingSub] });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.evaluatorFailed).toBe(true);
    expect(result.verdict).toBe('fail');
  });
});
