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

  it('has regressionMode "score"', () => {
    const evaluator = new TokenUsageEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.regressionMode).toBe('score');
  });

  it('has lowerIsBetter true', () => {
    const evaluator = new TokenUsageEvaluator({
      collector: makeMockCollector(),
      gocodeClient: makeMockGocodeClient(),
    });
    expect(evaluator.lowerIsBetter).toBe(true);
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

  describe('evaluate() - error paths', () => {
    it('returns verdict unknown and score 0 when hookClient was never called', async () => {
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

    it('returns verdict unknown when evaluate() is called twice for the same trial', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('unknown');
    });

    it('returns verdict unknown with score 0 when collector returns null', async () => {
      const collector = makeMockCollector(null);
      const evaluator = new TokenUsageEvaluator({
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
    it('score equals aabData.totalTokens', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 7000 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('observed');
      expect(result.score).toBe(7000);
    });

    it('score is 0 for zero aab tokens', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 0 }),
      );
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: makeMockGocodeClient(),
      });

      evaluator.hookClient(makeMockClient(), 0);
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.verdict).toBe('observed');
      expect(result.score).toBe(0);
    });

    it('reason includes aab and probe token counts', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 5000 }),
      );
      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ totalTokens: 300, promptTokens: 250, completionTokens: 50, calls: 2 });
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.reason).toContain('5000');
      expect(result.reason).toContain('300');
    });
  });

  describe('evaluate() - zero AAB tokens', () => {
    it('reports probe-only tokens when AAB reports zero', async () => {
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 0, inputTokens: 0, outputTokens: 0 }),
      );
      const gocode = makeMockGocodeClient({ totalTokens: 100 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
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
    it('sums AAB and probe tokens into total in details', async () => {
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
        promptTokens: 300,    // 800 - 500
        completionTokens: 200, // 200 - 0
        totalTokens: 1000,    // 1500 - 500
        calls: 5,             // 5 - 0
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

  describe('multi-trial isolation', () => {
    it('score equals aabData.totalTokens for each trial independently', async () => {
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
      });

      evaluator.hookClient(makeMockClient(), 0); // baseline trial 0 = 0
      gocode.setUsage({ totalTokens: 500 });
      evaluator.afterSimulation(0);             // snapshot trial 0 end = 500
      evaluator.hookClient(makeMockClient(), 1); // baseline trial 1 = 500
      gocode.setUsage({ totalTokens: 1500 });
      evaluator.afterSimulation(1);             // snapshot trial 1 end = 1500

      const result0 = await evaluator.evaluate(makeTranscript(0), makeScenario());
      const result1 = await evaluator.evaluate(makeTranscript(1), makeScenario());

      expect(result0.score).toBe(1000); // aab totalTokens for trial 0
      expect(result1.score).toBe(2000); // aab totalTokens for trial 1
      expect(result0.verdict).toBe('observed');
      expect(result1.verdict).toBe('observed');
    });

    it('details total tokens are correct per trial', async () => {
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
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ totalTokens: 500 });
      evaluator.afterSimulation(0);
      evaluator.hookClient(makeMockClient(), 1);
      gocode.setUsage({ totalTokens: 1500 });
      evaluator.afterSimulation(1);

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
      const collector = makeMockCollector(
        makeTrialTokenData({ totalTokens: 0 }),
      );
      const gocode = makeMockGocodeClient({ totalTokens: 0 });
      const evaluator = new TokenUsageEvaluator({
        collector,
        gocodeClient: gocode,
      });

      evaluator.hookClient(makeMockClient(), 0);
      gocode.setUsage({ totalTokens: 800, promptTokens: 600, completionTokens: 200, calls: 4 });

      // No afterSimulation call — should fall back to live accumulator
      const result = await evaluator.evaluate(makeTranscript(0), makeScenario());

      expect(result.details?.probe).toMatchObject({ totalTokens: 800 });
    });
  });
});
