import { describe, it, expect, vi } from 'vitest';
import { TokenUsageEvaluator } from '../token-usage.js';
import type { TokenUsageCollector } from '../token-usage-collector.js';
import {
  makeScenario,
  makeTranscript,
  makeTrialTokenData,
  makeMockGocodeClient,
  makeMockCollector,
  makeMockClient,
} from './token-eval-test-helpers.js';

describe('TokenUsageEvaluator', () => {
  it('has name "token-usage"', () => {
    const evaluator = new TokenUsageEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.name).toBe('token-usage');
  });

  it('is not deterministic', () => {
    const evaluator = new TokenUsageEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.deterministic).toBe(false);
  });

  describe('hookClient', () => {
    it('delegates to collector.hook', () => {
      const collector = makeMockCollector();
      const gocode = makeMockGocodeClient();
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
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
      const evaluator = new TokenUsageEvaluator({
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
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.unhookTrial(1);

      expect(collector.unhook).toHaveBeenCalledWith(1);
    });

    it('clears the baseline snapshot for the trial', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ totalTokens: 100 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      evaluator.unhookTrial(0);

      // After unhook baseline is gone — evaluate must return unknown
      gocode.setUsage({ totalTokens: 200 });
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.verdict).toBe('unknown');
    });

    it('clears afterSnapshot alongside baseline', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ totalTokens: 500 });
      evaluator.afterSimulation(0);
      evaluator.unhookTrial(0);

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
    });
  });

  describe('afterSimulation', () => {
    it('snapshots probe usage at end of trial', () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ totalTokens: 500 });
      evaluator.afterSimulation(0);

      // getAccumulatedUsage called once at hookClient, once at afterSimulation
      expect(gocode.getAccumulatedUsage).toHaveBeenCalledTimes(2);
    });
  });

  describe('evaluate() - no budget set', () => {
    it('returns verdict unknown and score 0 when no maxTokens', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('includes token counts in reason even without budget', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 2000 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.reason).toContain('2000');
    });
  });

  describe('evaluate() - no AAB data', () => {
    it('reports probe-only tokens when collector returns null', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ totalTokens: 100 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 200000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({
        promptTokens: 300,
        completionTokens: 100,
        totalTokens: 400,
        calls: 2,
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.details?.aab).toMatchObject({
        totalTokens: 0,
      });
      expect(result.details?.probe).toMatchObject({
        totalTokens: 300, // 400 - 100 baseline
      });
      expect(result.details?.total).toMatchObject({
        tokens: 300,
      });
    });
  });

  describe('evaluate() - with AAB data', () => {
    it('sums AAB and probe tokens into total', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({
          inputTokens: 5000,
          outputTokens: 2000,
          totalTokens: 7000,
        }),
      );
      // Baseline at hook time: promptTokens=500, totalTokens=500
      const gocode = makeMockGocodeClient({
        promptTokens: 500,
        completionTokens: 0,
        totalTokens: 500,
        calls: 0,
      });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      // After hook, advance state
      gocode.setUsage({
        promptTokens: 800,
        completionTokens: 200,
        totalTokens: 1500,
        calls: 5,
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.details?.aab).toMatchObject({
        inputTokens: 5000,
        outputTokens: 2000,
        totalTokens: 7000,
      });
      expect(result.details?.probe).toMatchObject({
        promptTokens: 300,   // 800 - 500
        completionTokens: 200, // 200 - 0
        totalTokens: 1000,   // 1500 - 500
        calls: 5,            // 5 - 0
      });
      expect(result.details?.total).toMatchObject({
        tokens: 8000, // 7000 + 1000
      });
    });

    it('exposes AAB cached token fields in details', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({
          cachedInputTokensRead: 200,
          cachedInputTokensWrite: 80,
        }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.details?.aab).toMatchObject({
        cachedInputTokensRead: 200,
        cachedInputTokensWrite: 80,
      });
    });
  });

  describe('evaluate() - budget scoring', () => {
    it('produces score 0.4 for 60000 tokens with maxTokens=100000', async () => {
      // AAB=40000, probe=20000, total=60000
      // score = max(0, 1 - 60000/100000) = 0.4
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 40000 }),
      );
      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({
        promptTokens: 15000,
        completionTokens: 5000,
        totalTokens: 20000,
        calls: 10,
      });

      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.score).toBeCloseTo(0.4);
      expect(result.verdict).toBe('partial');
    });

    it('returns pass when total tokens are well within budget', async () => {
      // total=10000, maxTokens=100000 → score=0.9 → pass
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 10000 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.score).toBeCloseTo(0.9);
      expect(result.verdict).toBe('pass');
    });

    it('returns fail when total tokens far exceed budget', async () => {
      // total=95000, maxTokens=100000 → score=0.05 → fail
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 95000 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.score).toBeCloseTo(0.05);
      expect(result.verdict).toBe('fail');
    });

    it('returns fail and non-NaN score when maxTokens is NaN', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalTokens: 1000 }));
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: NaN,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('fail');
      expect(Number.isNaN(result.score)).toBe(false);
    });

    it('returns fail when maxTokens is Infinity', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalTokens: 1000 }));
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: Infinity,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('fail');
    });

    it('returns fail when maxTokens is negative', async () => {
      const collector = makeMockCollector(makeTrialTokenData({ totalTokens: 100 }));
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: -1,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('fail');
    });

    it('returns score 0 and verdict fail when maxTokens is 0', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 0 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: 0,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
      expect(Number.isNaN(result.score)).toBe(false);
    });

    it('clamps score to 0 when tokens exceed maxTokens', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 150000 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.score).toBe(0);
      expect(result.verdict).toBe('fail');
    });
  });

  describe('evaluate() - details shape', () => {
    it('returns { aab, probe, total } structure', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      expect(result.details).toHaveProperty('aab');
      expect(result.details).toHaveProperty('probe');
      expect(result.details).toHaveProperty('total');
    });

    it('aab bucket contains all token fields', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      const aab = result.details?.aab as Record<string, unknown>;
      expect(aab).toHaveProperty('inputTokens');
      expect(aab).toHaveProperty('outputTokens');
      expect(aab).toHaveProperty('totalTokens');
      expect(aab).toHaveProperty('cachedInputTokensRead');
      expect(aab).toHaveProperty('cachedInputTokensWrite');
    });

    it('probe bucket contains promptTokens, completionTokens, totalTokens, calls', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      const probe = result.details?.probe as Record<string, unknown>;
      expect(probe).toHaveProperty('promptTokens');
      expect(probe).toHaveProperty('completionTokens');
      expect(probe).toHaveProperty('totalTokens');
      expect(probe).toHaveProperty('calls');
    });

    it('total bucket contains tokens', async () => {
      const collector = makeMockCollector(makeTrialTokenData());
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(
        makeTranscript(0),
        makeScenario(),
      );

      const total = result.details?.total as Record<string, unknown>;
      expect(total).toHaveProperty('tokens');
    });
  });

  describe('evaluate() - baseline guard', () => {
    it('returns unknown when hookClient was never called', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: 100000,
      });

      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('returns unknown when evaluate() is called twice for the same trial', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
        maxTokens: 100000,
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
            totalTokens: trialIndex === 0 ? 1000 : 2000,
          }),
        ),
        unhook: vi.fn(),
      } as unknown as TokenUsageCollector;

      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0); // baseline trial 0 = 0
      gocode.setUsage({ totalTokens: 500 });
      evaluator.afterSimulation(0);             // snapshot trial 0 end = 500
      evaluator.hookClient(makeMockClient(), 1); // baseline trial 1 = 500
      gocode.setUsage({ totalTokens: 1500 });
      evaluator.afterSimulation(1);             // snapshot trial 1 end = 1500

      const result0 = await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result1 = await evaluator.evaluate(makeTranscript(1), makeScenario());

      // trial 0: aab=1000, probe=500-0=500, total=1500
      expect(result0.details?.total).toMatchObject({ tokens: 1500 });
      // trial 1: aab=2000, probe=1500-500=1000, total=3000
      expect(result1.details?.total).toMatchObject({ tokens: 3000 });
    });
  });

  describe('afterSimulation - backward compat', () => {
    it('evaluate falls back to live accumulator when afterSimulation was never called', async () => {
      const collector = makeMockCollector(null);
      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
        maxTokens: 100000,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ totalTokens: 800, promptTokens: 600, completionTokens: 200, calls: 4 });

      // No afterSimulation call — should fall back to live accumulator
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.details?.probe).toMatchObject({ totalTokens: 800 });
    });
  });
});
