import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeanCompositeEvaluator, type ScoreModeEvaluator } from '../mean-composite-evaluator.js';
import type { Evaluator, EvalResult } from '../evaluator.js';
import type { AgentClient } from '../../clients/agent-client.js';
import { makeTranscript, makeScenario } from './evaluator-test-helpers.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeSubEvaluator(
  name: string,
  result: Partial<EvalResult>,
  hooks: {
    hookClient?: (client: AgentClient, trialIndex: number) => void;
    afterSimulation?: (trialIndex: number) => void;
    unhookTrial?: (trialIndex: number) => void;
  } = {},
): ScoreModeEvaluator {
  return {
    name,
    comparisonMode: 'score',
    evaluate: vi.fn().mockResolvedValue({
      evaluator: name,
      score: 0,
      verdict: 'incomplete',
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

// ── Boundary tests ────────────────────────────────────────────────────────────

describe('MeanCompositeEvaluator — boundary', () => {
  it('returns incomplete when no sub-evaluators provided', async () => {
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: [] });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
    expect(result.details?.['_composite']).toBe('mean');
    expect(result.details?.['scoredCount']).toBe(0);
    expect(result.details?.['totalCount']).toBe(0);
  });

  it('returns incomplete when all subs return incomplete', async () => {
    const subs = [
      makeSubEvaluator('a', { verdict: 'incomplete', score: 0 }),
      makeSubEvaluator('b', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
    expect(result.details?.['scoredCount']).toBe(0);
    expect(result.details?.['totalCount']).toBe(2);
  });

  it('returns sub score directly when only one scoreable sub', async () => {
    const subs = [makeSubEvaluator('a', { verdict: 'pass', score: 0.9 })];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBeCloseTo(0.9);
    expect(result.verdict).toBe('pass');
    expect(result.details?.['scoredCount']).toBe(1);
    expect(result.details?.['totalCount']).toBe(1);
  });
});

// ── Numeric guard tests ───────────────────────────────────────────────────────

describe('MeanCompositeEvaluator — numeric guards', () => {
  it('filters out sub with score NaN', async () => {
    const subs = [
      makeSubEvaluator('a', { verdict: 'pass', score: NaN }),
      makeSubEvaluator('b', { verdict: 'pass', score: 0.8 }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBeCloseTo(0.8);
    expect(result.details?.['scoredCount']).toBe(1);
    expect(result.details?.['totalCount']).toBe(2);
  });

  it('filters out sub with score Infinity', async () => {
    const subs = [
      makeSubEvaluator('a', { verdict: 'pass', score: Infinity }),
      makeSubEvaluator('b', { verdict: 'pass', score: 0.6 }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBeCloseTo(0.6);
    expect(result.details?.['scoredCount']).toBe(1);
  });

  it('clamps -0 to 0 producing fail verdict', async () => {
    const subs = [makeSubEvaluator('a', { verdict: 'fail', score: -0 })];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBe(0);
    expect(result.verdict).toBe('fail');
  });
});

// ── Verdict mapping tests ─────────────────────────────────────────────────────

describe('MeanCompositeEvaluator — verdict mapping', () => {
  it('score 0.9 → pass', async () => {
    const subs = [makeSubEvaluator('a', { verdict: 'pass', score: 0.9 })];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('pass');
  });

  it('score 0.5 → fail', async () => {
    const subs = [makeSubEvaluator('a', { verdict: 'fail', score: 0.5 })];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('fail');
  });

  it('score 0.2 → fail', async () => {
    const subs = [makeSubEvaluator('a', { verdict: 'fail', score: 0.2 })];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.verdict).toBe('fail');
  });
});

// ── Mixed scoreable + incomplete ──────────────────────────────────────────────

describe('MeanCompositeEvaluator — mixed scoreable and incomplete', () => {
  it('computes mean of only scoreable subs, excludes incompletes', async () => {
    const subs = [
      makeSubEvaluator('a', { verdict: 'pass', score: 0.8 }),
      makeSubEvaluator('b', { verdict: 'pass', score: 0.6 }),
      makeSubEvaluator('c', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBeCloseTo(0.7);
    expect(result.details?.['scoredCount']).toBe(2);
    expect(result.details?.['totalCount']).toBe(3);
  });

  it('includes breakdown for all subs with scoreable flag', async () => {
    const subs = [
      makeSubEvaluator('a', { verdict: 'pass', score: 0.9 }),
      makeSubEvaluator('b', { verdict: 'incomplete', score: 0 }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    const result = await ev.evaluate(transcript, scenario);
    const breakdown = result.details?.['breakdown'] as Array<{ evaluator: string; scoreable: boolean }>;
    expect(breakdown).toHaveLength(2);
    expect(breakdown.find((e) => e.evaluator === 'a')?.scoreable).toBe(true);
    expect(breakdown.find((e) => e.evaluator === 'b')?.scoreable).toBe(false);
  });
});

// ── Lifecycle hooks ───────────────────────────────────────────────────────────

describe('MeanCompositeEvaluator — lifecycle hooks', () => {
  it('forwards hookClient to all subs', () => {
    const mockClient = {} as AgentClient;
    const hookA = vi.fn();
    const hookB = vi.fn();
    const subs = [
      makeSubEvaluator('a', {}, { hookClient: hookA }),
      makeSubEvaluator('b', {}, { hookClient: hookB }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    ev.hookClient!(mockClient, 0);
    expect(hookA).toHaveBeenCalledWith(mockClient, 0);
    expect(hookB).toHaveBeenCalledWith(mockClient, 0);
  });

  it('forwards afterSimulation to all subs', () => {
    const afterA = vi.fn();
    const afterB = vi.fn();
    const subs = [
      makeSubEvaluator('a', {}, { afterSimulation: afterA }),
      makeSubEvaluator('b', {}, { afterSimulation: afterB }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    ev.afterSimulation!(5);
    expect(afterA).toHaveBeenCalledWith(5);
    expect(afterB).toHaveBeenCalledWith(5);
  });

  it('forwards unhookTrial to all subs', () => {
    const unhookA = vi.fn();
    const unhookB = vi.fn();
    const subs = [
      makeSubEvaluator('a', {}, { unhookTrial: unhookA }),
      makeSubEvaluator('b', {}, { unhookTrial: unhookB }),
    ];
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: subs });
    ev.unhookTrial!(2);
    expect(unhookA).toHaveBeenCalledWith(2);
    expect(unhookB).toHaveBeenCalledWith(2);
  });

  it('calls each lifecycle hook exactly once per sub', () => {
    const mockClient = {} as AgentClient;
    const hookA = vi.fn();
    const sub = makeSubEvaluator('a', {}, { hookClient: hookA });
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: [sub] });
    ev.hookClient!(mockClient, 0);
    expect(hookA).toHaveBeenCalledTimes(1);
  });
});

// ── evalVersion derivation ────────────────────────────────────────────────────

describe('MeanCompositeEvaluator — evalVersion', () => {
  it('uses explicit evalVersion when provided', async () => {
    const subs = [makeSubEvaluator('a', { verdict: 'pass', score: 0.8 })];
    const ev = new MeanCompositeEvaluator({
      name: 'test-mean',
      subEvaluators: subs,
      evalVersion: '3.0',
    });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.evalVersion).toBe('3.0');
  });

  it('derives evalVersion from sub names and versions when not provided', async () => {
    const subA: ScoreModeEvaluator = {
      name: 'sub-a',
      evalVersion: '1.0',
      comparisonMode: 'score',
      evaluate: vi.fn().mockResolvedValue({ evaluator: 'sub-a', score: 0.8, verdict: 'pass', reason: '' }),
    };
    const subB: ScoreModeEvaluator = {
      name: 'sub-b',
      evalVersion: '2.0',
      comparisonMode: 'score',
      evaluate: vi.fn().mockResolvedValue({ evaluator: 'sub-b', score: 0.6, verdict: 'fail', reason: '' }),
    };
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: [subA, subB] });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.evalVersion).toBeDefined();
    expect(typeof result.evalVersion).toBe('string');
  });
});

// ── comparisonMode fixed ──────────────────────────────────────────────────────

describe('MeanCompositeEvaluator — comparisonMode', () => {
  it('has comparisonMode score fixed', () => {
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: [] });
    expect(ev.comparisonMode).toBe('score');
  });
});

// ── safeEvaluate: sub throws ──────────────────────────────────────────────────

describe('MeanCompositeEvaluator — sub error isolation', () => {
  it('treats a throwing sub as unknown (excluded from mean)', async () => {
    const throwingSub: ScoreModeEvaluator = {
      name: 'bad-sub',
      comparisonMode: 'score',
      evaluate: vi.fn().mockRejectedValue(new Error('exploded')),
    };
    const goodSub = makeSubEvaluator('good-sub', { verdict: 'pass', score: 0.8 });
    const ev = new MeanCompositeEvaluator({ name: 'test-mean', subEvaluators: [throwingSub, goodSub] });
    const result = await ev.evaluate(transcript, scenario);
    expect(result.score).toBeCloseTo(0.8);
    expect(result.details?.['scoredCount']).toBe(1);
    expect(result.details?.['totalCount']).toBe(2);
  });
});
