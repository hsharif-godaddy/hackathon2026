import { describe, it, expect, vi } from 'vitest';
import { LLMCostEvaluator } from '../llm-cost.js';
import type { TokenUsageCollector } from '../token-usage-collector.js';
import {
  makeScenario,
  makeTranscript,
  makeTrialTokenData,
  makeMockGocodeClient,
  makeMockCollector,
  makeMockClient,
} from './token-eval-test-helpers.js';

describe('LLMCostEvaluator', () => {
  it('has name "llm-cost"', () => {
    const evaluator = new LLMCostEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.name).toBe('llm-cost');
  });

  it('is not deterministic', () => {
    const evaluator = new LLMCostEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.deterministic).toBe(false);
  });

  describe('hookClient', () => {
    it('delegates to collector.hook', () => {
      const collector = makeMockCollector();
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });
      const client = makeMockClient();

      evaluator.hookClient(client, 2);

      expect(collector.hook).toHaveBeenCalledWith(client, 2);
    });

    it('snapshots probe usage as baseline at hook time', () => {
      const collector = makeMockCollector();
      const gocode = makeMockGocodeClient({
        promptTokens: 50,
        completionTokens: 20,
        totalTokens: 70,
        calls: 3,
      });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
      });

      evaluator.hookClient(makeMockClient(), 0);
      expect(gocode.getAccumulatedUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe('unhookTrial', () => {
    it('delegates to collector.unhook', () => {
      const collector = makeMockCollector();
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.unhookTrial(1);

      expect(collector.unhook).toHaveBeenCalledWith(1);
    });

    it('clears the baseline snapshot for the trial', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 100 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      evaluator.unhookTrial(0);

      // After unhook baseline is gone — evaluate must return unknown
      gocode.setUsage({ promptTokens: 5000, completionTokens: 1000 });
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.verdict).toBe('unknown');
    });

    it('clears afterSnapshot alongside baseline', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });
      evaluator.afterSimulation(0);
      evaluator.unhookTrial(0);

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
    });
  });

  describe('afterSimulation', () => {
    it('snapshots probe usage at end of trial', () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });
      evaluator.afterSimulation(0);

      // getAccumulatedUsage called once at hookClient, once at afterSimulation
      expect(gocode.getAccumulatedUsage).toHaveBeenCalledTimes(2);
    });
  });

  describe('evaluate() - no budget set', () => {
    it('returns verdict unknown and score 0 when no maxCostUsd', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.10 }));
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('includes cost amounts in reason even without budget', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.25 }));
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.reason).toContain('0.25');
    });
  });

  describe('evaluate() - AAB cost', () => {
    it('uses pre-computed totalCost from socket event', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.12 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      // Probe delta is zero (no hook called), so total = AAB cost
      expect(result.details?.aab).toMatchObject({ totalCost: 0.12 });
      expect(result.details?.total).toMatchObject({ costUsd: 0.12 });
    });

    it('includes AAB cost fields in details', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({
          totalCost: 0.05,
          inputCost: 0.03,
          outputCost: 0.02,
          cachedInputCost: 0.001,
          savings: 0.005,
          currency: 'USD',
          lastModelName: 'claude-sonnet-4-6',
        }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.details?.aab).toMatchObject({
        totalCost: 0.05,
        inputCost: 0.03,
        outputCost: 0.02,
        cachedInputCost: 0.001,
        savings: 0.005,
        currency: 'USD',
        lastModelName: 'claude-sonnet-4-6',
      });
    });

    it('reports zero AAB cost when collector returns null', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.details?.aab).toMatchObject({ totalCost: 0 });
    });
  });

  describe('evaluate() - probe cost calculation', () => {
    it('computes probe cost from token delta and pricing table', async () => {
      // claude-sonnet-4-6: input=$0.003/1K, output=$0.015/1K
      // promptTokens delta=10000, completionTokens delta=2000
      // probe cost = (10000/1000 * 0.003) + (2000/1000 * 0.015) = 0.03 + 0.03 = 0.06
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({
        promptTokens: 10000,
        completionTokens: 2000,
        totalTokens: 12000,
        calls: 5,
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect((result.details?.probe as Record<string, unknown>)?.cost).toBeCloseTo(0.06);
    });

    it('includes probe token counts and model name in details', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-haiku-4-5',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({
        promptTokens: 5000,
        completionTokens: 1000,
        totalTokens: 6000,
        calls: 3,
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const probe = result.details?.probe as Record<string, unknown>;
      expect(probe).toMatchObject({
        promptTokens: 5000,
        completionTokens: 1000,
        model: 'claude-haiku-4-5',
      });
    });

    it('sums AAB cost and probe cost into total', async () => {
      // AAB totalCost=0.10, probe=0 (no delta) → total=0.10
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.10 }),
      );
      const gocode = makeMockGocodeClient({ promptTokens: 100, completionTokens: 50 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 1.0,
      });

      // Hook at baseline = {100, 50}; no change before evaluate → probe delta = 0
      evaluator.hookClient(makeMockClient(), 0);

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const total = result.details?.total as Record<string, unknown>;
      expect(total.costUsd).toBeCloseTo(0.10);
    });
  });

  describe('evaluate() - budget scoring', () => {
    it('produces score 0.6 for $0.20 with maxCostUsd=0.50', async () => {
      // AAB totalCost=0.20, probe delta=0 → total=0.20
      // score = max(0, 1 - 0.20/0.50) = 0.6
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.20 }),
      );
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 0.50,
      });

      // Baseline = current → probe delta = 0
      evaluator.hookClient(makeMockClient(), 0);

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.score).toBeCloseTo(0.6);
      expect(result.verdict).toBe('partial');
    });

    it('returns pass when cost is well within budget', async () => {
      // total=0.05, maxCostUsd=0.50 → score=0.9 → pass
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.05 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 0.50,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.score).toBeCloseTo(0.9);
      expect(result.verdict).toBe('pass');
    });

    it('returns fail when cost far exceeds budget', async () => {
      // total=0.48, maxCostUsd=0.50 → score=0.04 → fail
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.48 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 0.50,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.score).toBeCloseTo(0.04);
      expect(result.verdict).toBe('fail');
    });

    it('returns fail and non-NaN score when maxCostUsd is NaN', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.10 }));
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: NaN,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('fail');
      expect(Number.isNaN(result.score)).toBe(false);
    });

    it('returns fail when maxCostUsd is Infinity', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.10 }));
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: Infinity,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('fail');
    });

    it('returns fail when maxCostUsd is negative', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.05 }));
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: -0.50,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('fail');
    });

    it('returns score 0 and verdict fail when maxCostUsd is 0', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(Number.isNaN(result.score)).toBe(false);
    });

    it('clamps score to 0 when cost exceeds maxCostUsd', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 1.00 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 0.50,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });
  });

  describe('evaluate() - unknown probe model', () => {
    it('returns verdict unknown when probeModel is not in pricing table and maxCostUsd is set', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 10000, completionTokens: 2000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
      expect(result.reason).toContain('unknown-model-xyz');
    });

    it('reports probe cost as 0 when probeModel is not in pricing table', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 10000, completionTokens: 2000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect((result.details?.probe as Record<string, unknown>)?.cost).toBe(0);
    });

    it('includes a warning in reason when probe model is unknown', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 5000, completionTokens: 1000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.reason).toContain('unknown-model-xyz');
    });

    it('reports probe cost as 0 when probeModel is omitted', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 10000, completionTokens: 2000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect((result.details?.probe as Record<string, unknown>)?.cost).toBe(0);
    });
  });

  describe('evaluate() - details shape', () => {
    it('returns { aab, probe, total } structure', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.details).toHaveProperty('aab');
      expect(result.details).toHaveProperty('probe');
      expect(result.details).toHaveProperty('total');
    });

    it('aab bucket contains cost fields', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const aab = result.details?.aab as Record<string, unknown>;
      expect(aab).toHaveProperty('totalCost');
      expect(aab).toHaveProperty('inputCost');
      expect(aab).toHaveProperty('outputCost');
      expect(aab).toHaveProperty('cachedInputCost');
      expect(aab).toHaveProperty('savings');
      expect(aab).toHaveProperty('currency');
      expect(aab).toHaveProperty('lastModelName');
    });

    it('probe bucket contains cost, tokens, and model', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const probe = result.details?.probe as Record<string, unknown>;
      expect(probe).toHaveProperty('cost');
      expect(probe).toHaveProperty('promptTokens');
      expect(probe).toHaveProperty('completionTokens');
      expect(probe).toHaveProperty('model');
    });

    it('total bucket contains costUsd', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const total = result.details?.total as Record<string, unknown>;
      expect(total).toHaveProperty('costUsd');
    });
  });

  describe('evaluate() - baseline guard', () => {
    it('returns unknown when hookClient was never called', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 1.0,
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('returns unknown when evaluate() is called twice for the same trial', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
    });
  });

  describe('multi-trial isolation', () => {
    it('uses the correct afterSnapshot for each trial', async () => {
      const collector: TokenUsageCollector = {
        hook: vi.fn(),
        collect: vi.fn().mockImplementation((trialIndex: number) =>
          makeTrialTokenData({
            totalCost: trialIndex === 0 ? 0.10 : 0.20,
          }),
        ),
        unhook: vi.fn(),
      } as unknown as TokenUsageCollector;

      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);         // baseline = {promptTokens: 0}
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });
      evaluator.afterSimulation(0);                      // snapshot trial 0 end
      evaluator.hookClient(makeMockClient(), 1);         // baseline = {promptTokens: 1000}
      gocode.setUsage({ promptTokens: 2000, completionTokens: 0 });
      evaluator.afterSimulation(1);                      // snapshot trial 1 end

      const result0 = await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result1 = await evaluator.evaluate(makeTranscript(1), makeScenario());

      // trial 0: aab=0.10, probe delta=1000 prompt tokens = 1*0.003=0.003 → total≈0.103
      // trial 1: aab=0.20, probe delta=1000 prompt tokens = 1*0.003=0.003 → total≈0.203
      const total0 = (result0.details?.total as Record<string, unknown>)?.costUsd as number;
      const total1 = (result1.details?.total as Record<string, unknown>)?.costUsd as number;
      expect(total0).toBeCloseTo(0.103);
      expect(total1).toBeCloseTo(0.203);
    });
  });

  describe('afterSimulation - backward compat', () => {
    it('evaluate falls back to live accumulator when afterSimulation was never called', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
        maxCostUsd: 1.0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });

      // No afterSimulation call — should fall back to live accumulator
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      // probe delta = 1000 prompt tokens = 1*0.003 = 0.003
      const probe = result.details?.probe as Record<string, unknown>;
      expect(probe?.cost).toBeCloseTo(0.003);
    });
  });
});
