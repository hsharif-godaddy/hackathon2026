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

  it('has comparisonMode "score"', () => {
    const evaluator = new LLMCostEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.comparisonMode).toBe('score');
  });

  it('has lowerIsBetter true', () => {
    const evaluator = new LLMCostEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.lowerIsBetter).toBe(true);
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
      });

      evaluator.hookClient(makeMockClient(), 0);
      evaluator.unhookTrial(0);

      // After unhook baseline is gone — evaluate must return unknown
      gocode.setUsage({ promptTokens: 5000, completionTokens: 1000 });
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.verdict).toBe('incomplete');
    });

    it('clears afterSnapshot alongside baseline', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });
      evaluator.afterSimulation(0);
      evaluator.unhookTrial(0);

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('incomplete');
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

  describe('evaluate() - error paths', () => {
    it('returns verdict unknown and score 0 when hookClient was never called', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.10 }));
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('incomplete');
      expect(result.score).toBe(0);
    });

    it('returns verdict unknown when evaluate() is called twice for the same trial', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('incomplete');
    });

    it('returns verdict unknown with score 0 when collector returns null', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('incomplete');
      expect(result.score).toBe(0);
      expect(result.reason).toContain('collector returned null');
    });
  });

  describe('evaluate() - observed scoring', () => {
    it('score equals aabData.totalCost', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.25 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('directional');
      expect(result.score).toBeCloseTo(0.25);
    });

    it('score is 0 for zero aab cost', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('directional');
      expect(result.score).toBe(0);
    });

    it('reason includes aab and probe cost values', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.15 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.reason).toContain('0.15');
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
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.details?.aab).toMatchObject({ totalCost: 0.12 });
      expect(result.details?.total).toMatchObject({ costUsd: expect.any(Number) });
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

    it('reports zero AAB cost when aab cost is zero', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0 }),
      );
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
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
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
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
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-haiku-4-5',
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

    it('sums AAB cost and probe cost into total in details', async () => {
      // AAB totalCost=0.10, probe=0 (no delta) → total=0.10
      const collector = makeMockCollector(
        makeTrialTokenData({ totalCost: 0.10 }),
      );
      const gocode = makeMockGocodeClient({ promptTokens: 100, completionTokens: 50 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
      });

      // Hook at baseline = {100, 50}; no change before evaluate → probe delta = 0
      evaluator.hookClient(makeMockClient(), 0);

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const total = result.details?.total as Record<string, unknown>;
      expect(total.costUsd).toBeCloseTo(0.10);
    });
  });

  describe('evaluate() - unknown probe model', () => {
    it('reports probe cost as 0 when probeModel is not in pricing table', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 10000, completionTokens: 2000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect((result.details?.probe as Record<string, unknown>)?.cost).toBe(0);
    });

    it('still emits observed verdict when probe model is unknown', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0.05 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 10000, completionTokens: 2000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('directional');
      expect(result.score).toBeCloseTo(0.05); // aab cost flows through
    });

    it('includes a warning in reason when probe model is unknown', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 5000, completionTokens: 1000 });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.reason).toContain('unknown-model-xyz');
    });

    it('reports probe cost as 0 when probeModel is omitted', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
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

  describe('multi-trial isolation', () => {
    it('score equals aabData.totalCost for each trial independently', async () => {
      const collector: TokenUsageCollector = {
        hook: vi.fn(),
        collect: vi.fn().mockImplementation(function (trialIndex: number) { return makeTrialTokenData({
            totalCost: trialIndex === 0 ? 0.10 : 0.20,
          }); },
        ),
        unhook: vi.fn(),
      } as unknown as TokenUsageCollector;

      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 1000, completionTokens: 0 });
      evaluator.afterSimulation(0);
      evaluator.hookClient(makeMockClient(), 1);
      gocode.setUsage({ promptTokens: 2000, completionTokens: 0 });
      evaluator.afterSimulation(1);

      const result0 = await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result1 = await evaluator.evaluate(makeTranscript(1), makeScenario());

      expect(result0.score).toBeCloseTo(0.10); // aab totalCost for trial 0
      expect(result1.score).toBeCloseTo(0.20); // aab totalCost for trial 1
      expect(result0.verdict).toBe('directional');
      expect(result1.verdict).toBe('directional');
    });

    it('details total costUsd is correct per trial', async () => {
      const collector: TokenUsageCollector = {
        hook: vi.fn(),
        collect: vi.fn().mockImplementation(function (trialIndex: number) { return makeTrialTokenData({
            totalCost: trialIndex === 0 ? 0.10 : 0.20,
          }); },
        ),
        unhook: vi.fn(),
      } as unknown as TokenUsageCollector;

      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
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
      const collector = makeMockCollector(makeTrialTokenData({ totalCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new LLMCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
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
