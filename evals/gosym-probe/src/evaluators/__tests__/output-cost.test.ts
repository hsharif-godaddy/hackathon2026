import { describe, it, expect } from 'vitest';
import { OutputCostEvaluator } from '../output-cost.js';
import {
  makeScenario,
  makeTranscript,
  makeTrialTokenData,
  makeMockGocodeClient,
  makeMockCollector,
  makeMockClient,
} from './token-eval-test-helpers.js';

describe('OutputCostEvaluator', () => {
  it('has name "output-cost"', () => {
    const evaluator = new OutputCostEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.name).toBe('output-cost');
  });

  it('has comparisonMode "score" and lowerIsBetter true', () => {
    const evaluator = new OutputCostEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.comparisonMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });

  describe('hookClient / unhookTrial', () => {
    it('delegates hook to collector', () => {
      const collector = makeMockCollector();
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });
      const client = makeMockClient();

      evaluator.hookClient(client, 3);

      expect(collector.hook).toHaveBeenCalledWith(client, 3);
    });

    it('delegates unhook to collector', () => {
      const collector = makeMockCollector();
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.unhookTrial(1);

      expect(collector.unhook).toHaveBeenCalledWith(1);
    });

    it('returns unknown after the baseline is cleared by unhook', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      evaluator.unhookTrial(0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('incomplete');
    });
  });

  describe('evaluate() - error paths', () => {
    it('returns unknown / score 0 when hookClient was never called', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ outputCost: 0.02 }));
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('incomplete');
      expect(result.score).toBe(0);
    });

    it('returns unknown / score 0 when collector returns null', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new OutputCostEvaluator({
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
    it('score equals aabData.outputCost, not totalCost', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ outputCost: 0.02, totalCost: 2.5 }),
      );
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('directional');
      // Isolates output cost from the cached-input-dominated total.
      expect(result.score).toBeCloseTo(0.02);
    });

    it('reason includes the aab output cost value', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ outputCost: 0.0150 }));
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.reason).toContain('0.015');
      expect(result.reason).toContain('output cost');
    });
  });

  describe('evaluate() - probe output cost', () => {
    it('computes probe output cost from completion delta and output pricing only', async () => {
      // sonnet output = $0.015/1K. completion delta = 2000 → 2*0.015 = 0.03.
      // prompt delta is ignored entirely (output-cost only).
      const collector = makeMockCollector(makeTrialTokenData({ outputCost: 0 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 100000, completionTokens: 2000 });
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const probe = result.details?.probe as Record<string, unknown>;
      expect(probe.outputCost).toBeCloseTo(0.03);
    });

    it('folds aab + probe output cost into total', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ outputCost: 0.02 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'claude-sonnet-4-6',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ completionTokens: 1000 }); // 1*0.015 = 0.015
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const total = result.details?.total as Record<string, unknown>;
      expect(total.outputCostUsd).toBeCloseTo(0.035);
    });
  });

  describe('evaluate() - unknown probe model', () => {
    it('reports probe output cost 0 but still emits observed with aab score', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ outputCost: 0.05 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: gocode,
        probeModel: 'unknown-model-xyz',
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ completionTokens: 2000 });
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('directional');
      expect(result.score).toBeCloseTo(0.05);
      expect((result.details?.probe as Record<string, unknown>).outputCost).toBe(0);
      expect(result.reason).toContain('unknown-model-xyz');
    });
  });

  describe('evaluate() - details shape', () => {
    it('aab bucket contains output-centric cost fields', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({
          outputCost: 0.02,
          inputCost: 0.03,
          totalCost: 0.05,
          currency: 'USD',
          lastModelName: 'claude-sonnet-4-6',
        }),
      );
      const evaluator = new OutputCostEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const aab = result.details?.aab as Record<string, unknown>;
      expect(aab).toMatchObject({
        outputCost: 0.02,
        inputCost: 0.03,
        totalCost: 0.05,
        currency: 'USD',
        lastModelName: 'claude-sonnet-4-6',
      });
    });
  });
});
