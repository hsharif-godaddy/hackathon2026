import { describe, it, expect } from 'vitest';
import { OutputTokenUsageEvaluator } from '../output-token-usage.js';
import {
  makeScenario,
  makeTranscript,
  makeTrialTokenData,
  makeMockGocodeClient,
  makeMockCollector,
  makeMockClient,
} from './token-eval-test-helpers.js';

describe('OutputTokenUsageEvaluator', () => {
  it('has name "output-token-usage"', () => {
    const evaluator = new OutputTokenUsageEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.name).toBe('output-token-usage');
  });

  it('has regressionMode "score" and lowerIsBetter true', () => {
    const evaluator = new OutputTokenUsageEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.regressionMode).toBe('score');
    expect(evaluator.lowerIsBetter).toBe(true);
  });

  describe('hookClient / unhookTrial', () => {
    it('delegates hook to collector', () => {
      const collector = makeMockCollector();
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });
      const client = makeMockClient();

      evaluator.hookClient(client, 2);

      expect(collector.hook).toHaveBeenCalledWith(client, 2);
    });

    it('delegates unhook to collector', () => {
      const collector = makeMockCollector();
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.unhookTrial(1);

      expect(collector.unhook).toHaveBeenCalledWith(1);
    });

    it('returns unknown after the baseline is cleared by unhook', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      evaluator.unhookTrial(0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
    });
  });

  describe('evaluate() - error paths', () => {
    it('returns unknown / score 0 when hookClient was never called', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ outputTokens: 500 }));
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('returns unknown / score 0 when collector returns null', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
      expect(result.reason).toContain('collector returned null');
    });
  });

  describe('evaluate() - observed scoring', () => {
    it('score equals aabData.outputTokens, not totalTokens', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ outputTokens: 13000, totalTokens: 1160000 }),
      );
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('observed');
      // The whole point: score isolates output, ignoring the ~1.16M total.
      expect(result.score).toBe(13000);
    });

    it('adds probe completion tokens into the total bucket only', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ outputTokens: 13000 }));
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ promptTokens: 9999, completionTokens: 2000 });
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      // score stays AAB-only; total folds in probe completion (not prompt) tokens.
      expect(result.score).toBe(13000);
      const total = result.details?.total as Record<string, unknown>;
      expect(total.outputTokens).toBe(15000);
    });
  });

  describe('evaluate() - details shape', () => {
    it('returns { aab, probe, total } with output-centric fields', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ outputTokens: 500, inputTokens: 1000, totalTokens: 1500 }),
      );
      const evaluator = new OutputTokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      const aab = result.details?.aab as Record<string, unknown>;
      expect(aab).toMatchObject({ outputTokens: 500, inputTokens: 1000, totalTokens: 1500 });
      expect(result.details?.probe).toHaveProperty('completionTokens');
      expect(result.details?.total).toHaveProperty('outputTokens');
    });
  });

  describe('multi-trial isolation', () => {
    it('scores each trial on its own AAB output tokens', async () => {
      let next = 0;
      const collector = makeMockCollector();
      // collect() returns a different value per call to simulate per-trial data
      (collector.collect as unknown as { mockImplementation: (f: () => unknown) => void })
        .mockImplementation(() =>
          makeTrialTokenData({ outputTokens: next === 0 ? 100 : 200 }),
        );
      const gocode = makeMockGocodeClient({ promptTokens: 0, completionTokens: 0 });
      const evaluator = new OutputTokenUsageEvaluator({ collector, gocodeClient: gocode });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ completionTokens: 10 });
      evaluator.afterSimulation(0);
      next = 1;
      evaluator.hookClient(makeMockClient(), 1);
      gocode.setUsage({ completionTokens: 30 });
      evaluator.afterSimulation(1);

      next = 0;
      const r0 = await evaluator.evaluate(makeTranscript(0), makeScenario());
      next = 1;
      const r1 = await evaluator.evaluate(makeTranscript(1), makeScenario());

      expect(r0.score).toBe(100);
      expect(r1.score).toBe(200);
    });
  });
});
