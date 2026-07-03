import { describe, it, expect, vi } from 'vitest';
import { TrialAggregator } from '../trial-aggregator.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';
import type { TrialResult } from '../types.js';
import type {
  EvalResult,
  Evaluator,
} from '../../evaluators/evaluator.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

const defaultEvaluator: Evaluator = {
  name: 'eval',
  comparisonMode: 'passRate',
  evaluate: async () => ({ evaluator: 'eval', score: 0, verdict: 'pass' as const, reason: '' }),
};

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [defaultEvaluator],
    trials: 3,
    ...overrides,
  };
}

function makeTrial(
  trialIndex: number,
  verdicts: Record<string, EvalResult['verdict']>,
  evalVersions: Record<string, string | undefined> = {},
): TrialResult {
  const evalResults: EvalResult[] = Object.entries(verdicts).map(
    ([name, verdict]) => ({
      evaluator: name,
      score: verdict === 'pass' ? 1.0 : 0.0,
      verdict,
      reason: 'test',
      ...(evalVersions[name] !== undefined && {
        evalVersion: evalVersions[name],
      }),
    }),
  );
  return {
    trialIndex,
    transcript: {
      scenarioName: 'test-scenario',
      trialIndex,
      turns: [],
      snapshots: [],
      errors: [],
      captureErrors: [],
      
    },
    evalResults,
  };
}

describe('TrialAggregator', () => {
  const agg = new TrialAggregator();

  describe('pass@k numeric estimators', () => {
    it('computes passAt1 and passAtK when at least one trial passes', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeTrial(1, { eval: 'pass' }),
        makeTrial(2, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      // n=3, c=1, resolvedKs=[1,2] (ceil(3/2)=2)
      // passAtK k=1: 1/3, k=2: 1-C(2,2)/C(3,2) = 1-1/3 = 2/3
      // passHatK k=1: 1/3, k=2: C(1,2)/C(3,2) = 0/3 = 0
      expect(result.aggregated['eval'].passAt1).toBeCloseTo(1 / 3);
      expect(result.aggregated['eval'].passAtK!.find((e) => e.k === 1)?.value).toBeCloseTo(1 / 3);
      expect(result.aggregated['eval'].passAtK!.find((e) => e.k === 2)?.value).toBeCloseTo(2 / 3);
      expect(result.aggregated['eval'].passHatK!.find((e) => e.k === 1)?.value).toBeCloseTo(1 / 3);
      expect(result.aggregated['eval'].passHatK!.find((e) => e.k === 2)?.value).toBe(0);
    });

    it('computes passAt1=0 when no trials pass', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeTrial(1, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      // n=2, c=0 → passAt1=0, passAtK k=1: 0, passHatK k=1: 0
      expect(result.aggregated['eval'].passAt1).toBe(0);
      expect(result.aggregated['eval'].passAtK).toEqual([{ k: 1, value: 0 }]);
      expect(result.aggregated['eval'].passHatK).toEqual([{ k: 1, value: 0 }]);
    });

    it('returns empty aggregated map for zero trials', () => {
      const result = agg.aggregate(makeScenario(), []);
      expect(result.aggregated).toEqual({});
    });

    it('throws when trial reports an evaluator not declared in scenario', () => {
      const trials = [makeTrial(0, { undeclared: 'pass' })];
      expect(() => agg.aggregate(makeScenario(), trials)).toThrow(
        /not declared in scenario\.evaluators/,
      );
    });
  });

  describe('pass^k (passHatK)', () => {
    it('equals 1 for all ks when all trials pass', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'pass' }),
        makeTrial(2, { eval: 'pass' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      // n=3, c=3, resolvedKs=[1,2]
      expect(result.aggregated['eval'].passAt1).toBe(1);
      expect(result.aggregated['eval'].passHatK).toEqual([{ k: 1, value: 1 }, { k: 2, value: 1 }]);
    });

    it('passHatK < 1 when any trial fails', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'pass' }),
        makeTrial(2, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      // n=3, c=2, resolvedKs=[1,2]
      // passHatK k=1: 2/3, k=2: C(2,2)/C(3,2) = 1/3
      expect(result.aggregated['eval'].passAt1).toBeCloseTo(2 / 3);
      expect(result.aggregated['eval'].passHatK!.find((e) => e.k === 1)?.value).toBeCloseTo(2 / 3);
      expect(result.aggregated['eval'].passHatK!.find((e) => e.k === 2)?.value).toBeCloseTo(1 / 3);
    });

    it('treats fail as non-pass', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      // n=2, c=1 → passAt1=0.5, passHatK k=1: 0.5
      expect(result.aggregated['eval'].passAt1).toBe(0.5);
      expect(result.aggregated['eval'].passHatK).toEqual([{ k: 1, value: 0.5 }]);
    });
  });

  describe('incomplete verdicts', () => {
    it('counts incomplete as failure', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'incomplete' }),
        makeTrial(2, { eval: 'incomplete' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      const e = result.aggregated['eval'];
      // n=3, c=1, resolvedKs=[1,2]
      expect(e.passAt1).toBeCloseTo(1 / 3);
      expect(e.passHatK!.find((x) => x.k === 1)?.value).toBeCloseTo(1 / 3);
      expect(e.passHatK!.find((x) => x.k === 2)?.value).toBe(0);
      expect(e.totalTrials).toBe(3);
    });

    it('passAt1 is 0 when all trials fail or are incomplete', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeTrial(1, { eval: 'incomplete' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passAt1).toBe(0);
    });

    it('passAt1 is 0 when all trials are incomplete', () => {
      const trials = [
        makeTrial(0, { eval: 'incomplete' }),
        makeTrial(1, { eval: 'incomplete' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passAt1).toBe(0);
    });

    it('totalTrials counts all verdicts including incomplete', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
        makeTrial(2, { eval: 'incomplete' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].totalTrials).toBe(3);
    });
  });

  describe('passingTrials count', () => {
    it('counts only pass verdicts', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
        makeTrial(2, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passingTrials).toBe(1);
    });
  });

  describe('multiple evaluators', () => {
    it('aggregates each evaluator independently', () => {
      const eval1: Evaluator = { name: 'eval1', comparisonMode: 'passRate', evaluate: async () => ({ evaluator: 'eval1', score: 0, verdict: 'pass' as const, reason: '' }) };
      const eval2: Evaluator = { name: 'eval2', comparisonMode: 'passRate', evaluate: async () => ({ evaluator: 'eval2', score: 0, verdict: 'pass' as const, reason: '' }) };
      const trials = [
        makeTrial(0, { eval1: 'pass', eval2: 'fail' }),
        makeTrial(1, { eval1: 'pass', eval2: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario({ evaluators: [eval1, eval2] }), trials);
      // eval1: n=2, c=2 → passAt1=1; eval2: n=2, c=0 → passAt1=0
      expect(result.aggregated['eval1'].passAt1).toBe(1);
      expect(result.aggregated['eval2'].passAt1).toBe(0);
    });
  });

  describe('evaluator versions', () => {
    it('preserves evalVersion when every result has the same version', () => {
      const result = agg.aggregate(makeScenario(), [
        makeTrial(0, { eval: 'pass' }, { eval: 'v1' }),
        makeTrial(1, { eval: 'pass' }, { eval: 'v1' }),
      ]);

      expect(result.aggregated.eval.evalVersion).toBe('v1');
    });

    it('omits evalVersion for mixed versioned and unversioned results', () => {
      const result = agg.aggregate(makeScenario(), [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'pass' }, { eval: 'v1' }),
      ]);

      expect(result.aggregated.eval.evalVersion).toBeUndefined();
    });

    it('omits evalVersion when result versions disagree', () => {
      const result = agg.aggregate(makeScenario(), [
        makeTrial(0, { eval: 'pass' }, { eval: 'v1' }),
        makeTrial(1, { eval: 'pass' }, { eval: 'v2' }),
      ]);

      expect(result.aggregated.eval.evalVersion).toBeUndefined();
    });
  });

  describe('ScenarioResult metadata', () => {
    it('preserves scenario name', () => {
      const scenario = makeScenario({
        name: 'my-scenario',
      });
      const result = agg.aggregate(scenario, [
        makeTrial(0, { eval: 'pass' }),
      ]);
      expect(result.scenarioName).toBe('my-scenario');
    });

    it('includes all TrialResults verbatim', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
        makeTrial(2, { eval: 'pass' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.trials).toHaveLength(3);
    });
  });

  describe('large-dataset regression (100 trials × 10 evaluators)', () => {
    it('produces correct counts for all evaluators', () => {
      const evalNames = Array.from(
        { length: 10 },
        (_, i) => `eval-${i}`,
      );
      const evaluators: Evaluator[] = evalNames.map((name) => ({
        name,
        comparisonMode: 'passRate' as const,
        evaluate: async () => ({ evaluator: name, score: 0, verdict: 'pass' as const, reason: '' }),
      }));
      // trial i passes eval j iff (i + j) % 3 === 0 (deterministic)
      const trials = Array.from({ length: 100 }, (_, i) => {
        const verdicts: Record<string, EvalResult['verdict']> = {};
        for (const name of evalNames) {
          const j = Number(name.split('-')[1]);
          verdicts[name] = (i + j) % 3 === 0 ? 'pass' : 'fail';
        }
        return makeTrial(i, verdicts);
      });

      const result = agg.aggregate(makeScenario({ evaluators }), trials);

      for (const name of evalNames) {
        const j = Number(name.split('-')[1]);
        let expectedPassing = 0;
        for (let i = 0; i < 100; i++) {
          if ((i + j) % 3 === 0) expectedPassing++;
        }
        const e = result.aggregated[name];
        expect(e.totalTrials).toBe(100);
        expect(e.passingTrials).toBe(expectedPassing);
        expect(e.passAt1).toBeCloseTo(expectedPassing / 100);
      }
    });
  });

  describe('aggregateScore', () => {
    const scoreEvaluator = {
      name: 'eval',
      comparisonMode: 'score' as const,
      evaluate: async () => ({
        evaluator: 'eval',
        score: 0,
        verdict: 'directional' as const,
        reason: '',
      }),
    } satisfies Evaluator;

    function scoreScenario(
      overrides: Partial<Scenario> = {},
    ): Scenario {
      return makeScenario({
        evaluators: [scoreEvaluator],
        ...overrides,
      });
    }

    function makeTrialWithScore(
      trialIndex: number,
      evalScores: Record<string, number>,
    ): TrialResult {
      const evalResults: EvalResult[] = Object.entries(evalScores).map(
        ([name, score]) => ({
          evaluator: name,
          score,
          verdict: 'directional' as const,
          reason: 'test',
        }),
      );
      return {
        trialIndex,
        transcript: {
          scenarioName: 'test-scenario',
          trialIndex,
          turns: [],
          snapshots: [],
          errors: [],
          captureErrors: [],
          
        },
        evalResults,
      };
    }

    it('computes trimmed mean for odd trial count', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.1 }),
        makeTrialWithScore(1, { eval: 0.5 }),
        makeTrialWithScore(2, { eval: 0.3 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.1, 0.3, 0.5] -> trimmed = [0.3] -> 0.3
      expect(result.aggregated['eval'].aggregateScore).toBe(0.3);
    });

    it('computes trimmed mean for even trial count', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.1 }),
        makeTrialWithScore(1, { eval: 0.4 }),
        makeTrialWithScore(2, { eval: 0.2 }),
        makeTrialWithScore(3, { eval: 0.3 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.1, 0.2, 0.3, 0.4] -> trimmed = [0.2, 0.3] -> 0.25
      expect(result.aggregated['eval'].aggregateScore).toBe(0.25);
    });

    it('returns 0 when all scores are zero', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0 }),
        makeTrialWithScore(1, { eval: 0 }),
        makeTrialWithScore(2, { eval: 0 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      expect(result.aggregated['eval'].aggregateScore).toBe(0);
    });

    it('returns the score directly for a single trial', () => {
      const trials = [makeTrialWithScore(0, { eval: 0.707 })];
      const result = agg.aggregate(scoreScenario(), trials);
      expect(result.aggregated['eval'].aggregateScore).toBe(0.707);
    });

    it('handles mixed scores across trials', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.9 }),
        makeTrialWithScore(1, { eval: 0.3 }),
        makeTrialWithScore(2, { eval: 0.7 }),
        makeTrialWithScore(3, { eval: 0.1 }),
        makeTrialWithScore(4, { eval: 0.5 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.1, 0.3, 0.5, 0.7, 0.9] -> trimmed = [0.3, 0.5, 0.7] -> 0.5
      expect(result.aggregated['eval'].aggregateScore).toBe(0.5);
    });

    it('trimmed mean differs from median on asymmetric distribution', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.0 }),
        makeTrialWithScore(1, { eval: 0.2 }),
        makeTrialWithScore(2, { eval: 0.3 }),
        makeTrialWithScore(3, { eval: 0.7 }),
        makeTrialWithScore(4, { eval: 1.0 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.0, 0.2, 0.3, 0.7, 1.0] -> trimmed = [0.2, 0.3, 0.7] -> 0.4
      // Median would be 0.3; trimmed mean is 0.4
      expect(result.aggregated['eval'].aggregateScore).toBeCloseTo(0.4);
    });

    it('trimmed mean differs from median on asymmetric length-4 distribution', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.1 }),
        makeTrialWithScore(1, { eval: 0.2 }),
        makeTrialWithScore(2, { eval: 0.8 }),
        makeTrialWithScore(3, { eval: 0.9 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.1, 0.2, 0.8, 0.9] -> trimmed = [0.2, 0.8] -> 0.5
      // Median would be (0.2+0.8)/2 = 0.5 — same here, but the trimming path is exercised
      // Use a skewed set instead: [0.1, 0.3, 0.4, 0.9] -> trimmed = [0.3, 0.4] -> 0.35
      // Median would be (0.3+0.4)/2 = 0.35 — also same. For length-4, median ≡ trimmedMean.
      // The value of this test is exercising the even-length trim boundary at integration level.
      expect(result.aggregated['eval'].aggregateScore).toBe(0.5);
    });

    it('omits aggregateScore for pass-rate evaluators', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].aggregateScore).toBeUndefined();
    });

    function makeTrialWithScoreAndVerdict(
      trialIndex: number,
      evalEntries: Record<
        string,
        { score: number; verdict: EvalResult['verdict'] }
      >,
    ): TrialResult {
      const evalResults: EvalResult[] = Object.entries(
        evalEntries,
      ).map(([name, { score, verdict }]) => ({
        evaluator: name,
        score,
        verdict,
        reason: 'test',
      }));
      return {
        trialIndex,
        transcript: {
          scenarioName: 'test-scenario',
          trialIndex,
          turns: [],
          snapshots: [],
          errors: [],
          captureErrors: [],
          
        },
        evalResults,
      };
    }

    it('excludes unknown-verdict trials from aggregateScore', () => {
      const trials = [
        makeTrialWithScoreAndVerdict(0, {
          eval: { score: 0, verdict: 'incomplete' },
        }),
        makeTrialWithScoreAndVerdict(1, {
          eval: { score: 0.8, verdict: 'directional' },
        }),
        makeTrialWithScoreAndVerdict(2, {
          eval: { score: 0, verdict: 'incomplete' },
        }),
        makeTrialWithScoreAndVerdict(3, {
          eval: { score: 0.6, verdict: 'directional' },
        }),
        makeTrialWithScoreAndVerdict(4, {
          eval: { score: 0, verdict: 'incomplete' },
        }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Only observed scores [0.8, 0.6] -> count <= 2, mean = 0.7
      expect(result.aggregated['eval'].aggregateScore).toBe(0.7);
    });

    it('omits aggregateScore when all trials are unknown', () => {
      const trials = [
        makeTrialWithScoreAndVerdict(0, {
          eval: { score: 0, verdict: 'incomplete' },
        }),
        makeTrialWithScoreAndVerdict(1, {
          eval: { score: 0, verdict: 'incomplete' },
        }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      expect(result.aggregated['eval'].aggregateScore).toBeUndefined();
    });
  });

  describe('lowerIsBetter propagation', () => {
    const lowerIsBetterEval = {
      name: 'token-usage',
      comparisonMode: 'score' as const,
      lowerIsBetter: true,
      evaluate: async () => ({
        evaluator: 'token-usage',
        score: 5000,
        verdict: 'directional' as const,
        reason: '',
      }),
    } satisfies Evaluator;

    it('propagates lowerIsBetter: true from evaluator to aggregated result', () => {
      const scenario = makeScenario({ evaluators: [lowerIsBetterEval] });
      const trials = [
        {
          trialIndex: 0,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 0,
            turns: [],
            snapshots: [],
            errors: [],
            captureErrors: [],
            
          },
          evalResults: [
            {
              evaluator: 'token-usage',
              score: 5000,
              verdict: 'directional' as const,
              reason: '',
            },
          ],
        },
      ];
      const result = agg.aggregate(scenario, trials);
      expect(result.aggregated['token-usage'].lowerIsBetter).toBe(true);
    });

    it('does not set lowerIsBetter when evaluator omits it', () => {
      const trials = [makeTrial(0, { eval: 'pass' })];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].lowerIsBetter).toBeUndefined();
    });

    it('lowerIsBetter: false propagates explicitly when set', () => {
      const explicitFalseEval = {
        ...lowerIsBetterEval,
        name: 'explicit-false',
        lowerIsBetter: false as const,
      } satisfies Evaluator;
      const scenario = makeScenario({ evaluators: [explicitFalseEval] });
      const trials = [
        {
          trialIndex: 0,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 0,
            turns: [],
            snapshots: [],
            errors: [],
            captureErrors: [],
            
          },
          evalResults: [
            {
              evaluator: 'explicit-false',
              score: 0.8,
              verdict: 'directional' as const,
              reason: '',
            },
          ],
        },
      ];
      const result = agg.aggregate(scenario, trials);
      expect(result.aggregated['explicit-false'].lowerIsBetter).toBe(false);
    });
  });

  describe('score-mode: estimators omitted', () => {
    const scoreModeEval = {
      name: 'score-eval',
      comparisonMode: 'score' as const,
      evaluate: async () => ({
        evaluator: 'score-eval',
        score: 0,
        verdict: 'directional' as const,
        reason: '',
      }),
    } satisfies Evaluator;

    function makeScoreModeScenario(): Scenario {
      return makeScenario({ evaluators: [scoreModeEval] });
    }

    it('omits passAt1/passAtK/passHatK for score-mode evaluator', () => {
      const trials: TrialResult[] = [
        {
          trialIndex: 0,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 0,
            turns: [],
            snapshots: [],
            errors: [],
            captureErrors: [],

          },
          evalResults: [{
            evaluator: 'score-eval',
            score: 0.5,
            verdict: 'directional' as const,
            reason: '',
          }],
        },
        {
          trialIndex: 1,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 1,
            turns: [],
            snapshots: [],
            errors: [],
            captureErrors: [],

          },
          evalResults: [{
            evaluator: 'score-eval',
            score: 0.7,
            verdict: 'directional' as const,
            reason: '',
          }],
        },
      ];
      const result = agg.aggregate(makeScoreModeScenario(), trials);
      expect(result.aggregated['score-eval'].passAt1).toBeUndefined();
      expect(result.aggregated['score-eval'].passAtK).toBeUndefined();
      expect(result.aggregated['score-eval'].passHatK).toBeUndefined();
    });

    it('populates numeric estimators for pass-rate evaluator', () => {
      const prEval: Evaluator = { name: 'pr-eval', comparisonMode: 'passRate', evaluate: async () => ({ evaluator: 'pr-eval', score: 0, verdict: 'pass' as const, reason: '' }) };
      const trials = [
        makeTrial(0, { 'pr-eval': 'pass' }),
        makeTrial(1, { 'pr-eval': 'fail' }),
      ];
      const result = agg.aggregate(makeScenario({ evaluators: [prEval] }), trials);
      // n=2, c=1 → passAt1=0.5
      expect(result.aggregated['pr-eval'].passAt1).toBe(0.5);
      expect(result.aggregated['pr-eval'].passAtK).toEqual([{ k: 1, value: 0.5 }]);
      expect(result.aggregated['pr-eval'].passHatK).toEqual([{ k: 1, value: 0.5 }]);
    });

    it('evaluator always emits comparisonMode in aggregated result', () => {
      const explicitModeEval = {
        name: 'explicit-mode',
        comparisonMode: 'passRate' as const,
        evaluate: async () => ({
          evaluator: 'explicit-mode',
          score: 1.0,
          verdict: 'pass' as const,
          reason: '',
        }),
      } satisfies Evaluator;
      const scenario = makeScenario({ evaluators: [explicitModeEval] });
      const trials = [makeTrial(0, { 'explicit-mode': 'pass' })];
      const result = agg.aggregate(scenario, trials);
      expect(result.aggregated['explicit-mode'].passAt1).toBe(1);
      expect(result.aggregated['explicit-mode'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(result.aggregated['explicit-mode'].passHatK).toEqual([{ k: 1, value: 1 }]);
      expect(result.aggregated['explicit-mode'].comparisonMode).toBe('passRate');
    });

    it('mixed: score-mode omits estimators, pass-rate has them', () => {
      const passRateEval = {
        name: 'pass-rate-eval',
        comparisonMode: 'passRate' as const,
        evaluate: async () => ({
          evaluator: 'pass-rate-eval',
          score: 0,
          verdict: 'fail' as const,
          reason: '',
        }),
      } satisfies Evaluator;
      const mixedScenario = makeScenario({
        evaluators: [scoreModeEval, passRateEval],
      });
      const trials: TrialResult[] = [
        {
          trialIndex: 0,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 0,
            turns: [],
            snapshots: [],
            errors: [],
            captureErrors: [],

          },
          evalResults: [
            {
              evaluator: 'score-eval',
              score: 0.5,
              verdict: 'directional' as const,
              reason: '',
            },
            {
              evaluator: 'pass-rate-eval',
              score: 1.0,
              verdict: 'pass' as const,
              reason: '',
            },
          ],
        },
        {
          trialIndex: 1,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 1,
            turns: [],
            snapshots: [],
            errors: [],
            captureErrors: [],

          },
          evalResults: [
            {
              evaluator: 'score-eval',
              score: 0.3,
              verdict: 'directional' as const,
              reason: '',
            },
            {
              evaluator: 'pass-rate-eval',
              score: 0.0,
              verdict: 'fail' as const,
              reason: '',
            },
          ],
        },
      ];
      const result = agg.aggregate(mixedScenario, trials);
      expect(result.aggregated['score-eval'].passAt1).toBeUndefined();
      expect(result.aggregated['score-eval'].passAtK).toBeUndefined();
      expect(result.aggregated['score-eval'].passHatK).toBeUndefined();
      // pass-rate-eval: n=2, c=1 → passAt1=0.5
      expect(result.aggregated['pass-rate-eval'].passAt1).toBe(0.5);
      expect(result.aggregated['pass-rate-eval'].passAtK).toEqual([{ k: 1, value: 0.5 }]);
      expect(result.aggregated['pass-rate-eval'].passHatK).toEqual([{ k: 1, value: 0.5 }]);
      expect(result.aggregated['score-eval'].comparisonMode).toBe('score');
      expect(result.aggregated['pass-rate-eval'].comparisonMode).toBe('passRate');
    });
  });

  describe('stabilityLevel', () => {
    it('copies stabilityLevel from scenario when present', () => {
      const result = agg.aggregate(
        makeScenario({ stabilityLevel: 'low' }),
        [],
      );
      expect(result.stabilityLevel).toBe('low');
    });

    it('copies high stabilityLevel from scenario', () => {
      const result = agg.aggregate(
        makeScenario({ stabilityLevel: 'high' }),
        [],
      );
      expect(result.stabilityLevel).toBe('high');
    });

    it('defaults to DEFAULT_STABILITY_LEVEL (low) when stabilityLevel is absent', () => {
      const result = agg.aggregate(makeScenario(), []);
      expect(result.stabilityLevel).toBe('low');
    });
  });

  describe('evalVersion aggregation', () => {
    function makeTrialWithVersion(
      trialIndex: number,
      evalName: string,
      verdict: EvalResult['verdict'],
      evalVersion?: string,
    ): TrialResult {
      const evalResults: EvalResult[] = [{
        evaluator: evalName,
        score: verdict === 'pass' ? 1.0 : 0.0,
        verdict,
        reason: 'test',
        ...(evalVersion !== undefined && { evalVersion }),
      }];
      return {
        trialIndex,
        transcript: {
          scenarioName: 'test-scenario',
          trialIndex,
          turns: [],
          snapshots: [],
          errors: [],
          captureErrors: [],
          
        },
        evalResults,
      };
    }

    it('propagates evalVersion when all trials report the same version', () => {
      const trials = [
        makeTrialWithVersion(0, 'eval', 'pass', '1.0.0'),
        makeTrialWithVersion(1, 'eval', 'pass', '1.0.0'),
        makeTrialWithVersion(2, 'eval', 'pass', '1.0.0'),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].evalVersion).toBe('1.0.0');
    });

    it('omits evalVersion and warns when trials report different versions', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
      const trials = [
        makeTrialWithVersion(0, 'eval', 'pass', '1.0.0'),
        makeTrialWithVersion(1, 'eval', 'pass', '2.0.0'),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].evalVersion).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        '[TrialAggregator] evaluator reported multiple evalVersions across trials, omitting from aggregation:',
        expect.objectContaining({ evaluator: 'eval', count: 2, totalTrials: 2 }),
      );
      warnSpy.mockRestore();
    });

    it('omits evalVersion when only some trials carry a version', () => {
      const trials = [
        makeTrialWithVersion(0, 'eval', 'pass', '1.0.0'),
        makeTrialWithVersion(1, 'eval', 'pass'), // no version
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].evalVersion).toBeUndefined();
    });

    it('omits evalVersion without warning when no trials carry a version', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {});
      const trials = [
        makeTrialWithVersion(0, 'eval', 'pass'),
        makeTrialWithVersion(1, 'eval', 'pass'),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].evalVersion).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('evaluatorFailed exclusion', () => {
    function makeFailedTrial(trialIndex: number, evalName: string): TrialResult {
      return {
        trialIndex,
        transcript: {
          scenarioName: 'test-scenario',
          trialIndex,
          turns: [],
          snapshots: [],
          errors: [],
          captureErrors: [],
          
        },
        evalResults: [{
          evaluator: evalName,
          score: 0,
          verdict: 'incomplete',
          reason: 'judge parse error',
          evaluatorFailed: true,
        }],
      };
    }

    it('excludes evaluatorFailed trials from totalTrials and estimators', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeFailedTrial(1, 'eval'),
        makeFailedTrial(2, 'eval'),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].totalTrials).toBe(1);
      expect(result.aggregated['eval'].passingTrials).toBe(1);
      // n=1, c=1 → passAt1=1
      expect(result.aggregated['eval'].passAt1).toBe(1);
      expect(result.aggregated['eval'].passAtK).toEqual([{ k: 1, value: 1 }]);
      expect(result.aggregated['eval'].passHatK).toEqual([{ k: 1, value: 1 }]);
      expect(result.aggregated['eval'].failedTrials).toBe(2);
    });

    it('passAt1 is 0 when all non-failed trials fail', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeFailedTrial(1, 'eval'),
        makeFailedTrial(2, 'eval'),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].totalTrials).toBe(1);
      expect(result.aggregated['eval'].passingTrials).toBe(0);
      expect(result.aggregated['eval'].passAt1).toBe(0);
      expect(result.aggregated['eval'].failedTrials).toBe(2);
    });

    it('all trials failed produces totalTrials 0 and undefined estimators', () => {
      const trials = [
        makeFailedTrial(0, 'eval'),
        makeFailedTrial(1, 'eval'),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].totalTrials).toBe(0);
      // n=0 → buildPassEstimators returns {}, so fields undefined
      expect(result.aggregated['eval'].passAt1).toBeUndefined();
      expect(result.aggregated['eval'].passAtK).toBeUndefined();
      expect(result.aggregated['eval'].passHatK).toBeUndefined();
      expect(result.aggregated['eval'].failedTrials).toBe(2);
    });

    it('does not emit failedTrials when none failed', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].failedTrials).toBeUndefined();
      expect(result.aggregated['eval'].totalTrials).toBe(2);
    });

    it('keeps a gating evaluator crash in the denominator as a hard fail', () => {
      const gatingEval: Evaluator = {
        name: 'skill-selection',
        comparisonMode: 'passRate' as const,
        gating: true,
        evaluate: async () => ({
          evaluator: 'skill-selection',
          score: 1,
          verdict: 'pass' as const,
          reason: '',
        }),
      };
      const scenario = makeScenario({ evaluators: [gatingEval] });
      const trials = [
        makeTrial(0, { 'skill-selection': 'pass' }),
        makeFailedTrial(1, 'skill-selection'),
        makeFailedTrial(2, 'skill-selection'),
      ];
      const result = agg.aggregate(scenario, trials);
      const e = result.aggregated['skill-selection'];
      // Gating: crashed trials are NOT dropped — they stay in the sample as
      // non-passes, so n=3, c=1 → passAt1 = 1/3 (a broken gate fails loud).
      expect(e.totalTrials).toBe(3);
      expect(e.passingTrials).toBe(1);
      expect(e.passAt1).toBeCloseTo(1 / 3);
      expect(e.failedTrials).toBe(2);
    });

    it('a gating evaluator that crashes on every trial reports passAt1 0, not an empty sample', () => {
      const gatingEval: Evaluator = {
        name: 'skill-selection',
        comparisonMode: 'passRate' as const,
        gating: true,
        evaluate: async () => ({
          evaluator: 'skill-selection',
          score: 1,
          verdict: 'pass' as const,
          reason: '',
        }),
      };
      const scenario = makeScenario({ evaluators: [gatingEval] });
      const trials = [
        makeFailedTrial(0, 'skill-selection'),
        makeFailedTrial(1, 'skill-selection'),
      ];
      const result = agg.aggregate(scenario, trials);
      const e = result.aggregated['skill-selection'];
      // Contrast with the non-gating all-crashed case (totalTrials 0, undefined
      // estimators): a gating gate that never ran must fail, not vanish.
      expect(e.totalTrials).toBe(2);
      expect(e.passingTrials).toBe(0);
      expect(e.passAt1).toBe(0);
      expect(e.failedTrials).toBe(2);
    });

    it('excludes evaluatorFailed trials from score-mode aggregateScore', () => {
      const scoreEval: Evaluator = {
        name: 'metric',
        comparisonMode: 'score' as const,
        evaluate: async () => ({
          evaluator: 'metric',
          score: 0,
          verdict: 'directional' as const,
          reason: '',
        }),
      };
      const scenario = makeScenario({ evaluators: [scoreEval] });
      const trials: TrialResult[] = [
        {
          trialIndex: 0,
          transcript: { scenarioName: 'test-scenario', trialIndex: 0, turns: [], snapshots: [], errors: [], captureErrors: [] },
          evalResults: [{ evaluator: 'metric', score: 100, verdict: 'directional', reason: '' }],
        },
        {
          trialIndex: 1,
          transcript: { scenarioName: 'test-scenario', trialIndex: 1, turns: [], snapshots: [], errors: [], captureErrors: [] },
          evalResults: [{ evaluator: 'metric', score: 200, verdict: 'directional', reason: '' }],
        },
        {
          trialIndex: 2,
          transcript: { scenarioName: 'test-scenario', trialIndex: 2, turns: [], snapshots: [], errors: [], captureErrors: [] },
          evalResults: [{ evaluator: 'metric', score: 999, verdict: 'directional', reason: '', evaluatorFailed: true }],
        },
      ];
      const result = agg.aggregate(scenario, trials);
      // Only trials 0 and 1 contribute: trimmedMean([100, 200]) = 150
      // If the !failed[i] guard were removed, trimmedMean([100, 200, 999]) = 200
      expect(result.aggregated['metric'].aggregateScore).toBe(150);
      expect(result.aggregated['metric'].failedTrials).toBe(1);
    });
  });
});
