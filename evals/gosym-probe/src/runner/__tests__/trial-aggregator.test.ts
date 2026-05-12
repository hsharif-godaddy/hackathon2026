import { describe, it, expect } from 'vitest';
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

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals: [],
    evaluators: [],
    trials: 3,
    category: 'regression',
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
      score:
        verdict === 'pass' ? 1.0
        : verdict === 'partial' ? 0.5
        : 0.0,
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
    },
    evalResults,
  };
}

describe('TrialAggregator', () => {
  const agg = new TrialAggregator();

  describe('pass@k (passAtK)', () => {
    it('is true when at least one trial passes', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeTrial(1, { eval: 'pass' }),
        makeTrial(2, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passAtK).toBe(true);
    });

    it('is false when no trials pass', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeTrial(1, { eval: 'partial' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passAtK).toBe(false);
    });

    it('returns empty aggregated map for zero trials', () => {
      const result = agg.aggregate(makeScenario(), []);
      expect(result.aggregated).toEqual({});
    });
  });

  describe('pass^k (passToTheK)', () => {
    it('is true when all trials pass', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'pass' }),
        makeTrial(2, { eval: 'pass' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passToTheK).toBe(true);
    });

    it('is false when any trial fails', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'pass' }),
        makeTrial(2, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passToTheK).toBe(false);
    });

    it('treats partial as non-pass', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'partial' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passToTheK).toBe(false);
    });
  });

  describe('unknown verdicts', () => {
    it('counts unknown as failure', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'unknown' }),
        makeTrial(2, { eval: 'unknown' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      const e = result.aggregated['eval'];
      expect(e.passAtK).toBe(true);
      expect(e.passToTheK).toBe(false);
      expect(e.totalTrials).toBe(3);
    });

    it('passAtK is false when all trials fail or are unknown', () => {
      const trials = [
        makeTrial(0, { eval: 'fail' }),
        makeTrial(1, { eval: 'unknown' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passAtK).toBe(false);
    });

    it('passAtK is false when all trials are unknown', () => {
      const trials = [
        makeTrial(0, { eval: 'unknown' }),
        makeTrial(1, { eval: 'unknown' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passAtK).toBe(false);
    });

    it('totalTrials counts all verdicts including unknown', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
        makeTrial(2, { eval: 'unknown' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].totalTrials).toBe(3);
    });
  });

  describe('passingTrials count', () => {
    it('counts only pass verdicts, not partial', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'partial' }),
        makeTrial(2, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].passingTrials).toBe(1);
    });
  });

  describe('multiple evaluators', () => {
    it('aggregates each evaluator independently', () => {
      const trials = [
        makeTrial(0, { eval1: 'pass', eval2: 'fail' }),
        makeTrial(1, { eval1: 'pass', eval2: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval1'].passAtK).toBe(true);
      expect(result.aggregated['eval2'].passAtK).toBe(false);
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
    it('preserves scenario name and category', () => {
      const scenario = makeScenario({
        name: 'my-scenario',
        category: 'capability',
      });
      const result = agg.aggregate(scenario, [
        makeTrial(0, { eval: 'pass' }),
      ]);
      expect(result.scenarioName).toBe('my-scenario');
      expect(result.category).toBe('capability');
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
      // trial i passes eval j iff (i + j) % 3 === 0 (deterministic)
      const trials = Array.from({ length: 100 }, (_, i) => {
        const verdicts: Record<string, EvalResult['verdict']> = {};
        for (const name of evalNames) {
          const j = Number(name.split('-')[1]);
          verdicts[name] = (i + j) % 3 === 0 ? 'pass' : 'fail';
        }
        return makeTrial(i, verdicts);
      });

      const result = agg.aggregate(makeScenario(), trials);

      for (const name of evalNames) {
        const j = Number(name.split('-')[1]);
        let expectedPassing = 0;
        for (let i = 0; i < 100; i++) {
          if ((i + j) % 3 === 0) expectedPassing++;
        }
        const e = result.aggregated[name];
        expect(e.totalTrials).toBe(100);
        expect(e.passingTrials).toBe(expectedPassing);
        expect(e.passAtK).toBe(expectedPassing > 0);
        expect(e.passToTheK).toBe(expectedPassing === 100);
      }
    });
  });

  describe('medianScore', () => {
    const scoreEvaluator = {
      name: 'eval',
      regressionMode: 'score' as const,
      evaluate: async () => ({
        evaluator: 'eval',
        score: 0,
        verdict: 'observed' as const,
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
          verdict: 'observed' as const,
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
        },
        evalResults,
      };
    }

    it('computes median for odd trial count', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.1 }),
        makeTrialWithScore(1, { eval: 0.5 }),
        makeTrialWithScore(2, { eval: 0.3 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.1, 0.3, 0.5] -> median = 0.3
      expect(result.aggregated['eval'].medianScore).toBe(0.3);
    });

    it('computes median for even trial count', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0.1 }),
        makeTrialWithScore(1, { eval: 0.4 }),
        makeTrialWithScore(2, { eval: 0.2 }),
        makeTrialWithScore(3, { eval: 0.3 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Sorted: [0.1, 0.2, 0.3, 0.4] -> median = (0.2 + 0.3) / 2 = 0.25
      expect(result.aggregated['eval'].medianScore).toBe(0.25);
    });

    it('returns 0 when all scores are zero', () => {
      const trials = [
        makeTrialWithScore(0, { eval: 0 }),
        makeTrialWithScore(1, { eval: 0 }),
        makeTrialWithScore(2, { eval: 0 }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      expect(result.aggregated['eval'].medianScore).toBe(0);
    });

    it('returns the score directly for a single trial', () => {
      const trials = [makeTrialWithScore(0, { eval: 0.707 })];
      const result = agg.aggregate(scoreScenario(), trials);
      expect(result.aggregated['eval'].medianScore).toBe(0.707);
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
      // Sorted: [0.1, 0.3, 0.5, 0.7, 0.9] -> median = 0.5
      expect(result.aggregated['eval'].medianScore).toBe(0.5);
    });

    it('omits medianScore for pass-rate evaluators', () => {
      const trials = [
        makeTrial(0, { eval: 'pass' }),
        makeTrial(1, { eval: 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(result.aggregated['eval'].medianScore).toBeUndefined();
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
        },
        evalResults,
      };
    }

    it('excludes unknown-verdict trials from medianScore', () => {
      const trials = [
        makeTrialWithScoreAndVerdict(0, {
          eval: { score: 0, verdict: 'unknown' },
        }),
        makeTrialWithScoreAndVerdict(1, {
          eval: { score: 0.8, verdict: 'observed' },
        }),
        makeTrialWithScoreAndVerdict(2, {
          eval: { score: 0, verdict: 'unknown' },
        }),
        makeTrialWithScoreAndVerdict(3, {
          eval: { score: 0.6, verdict: 'observed' },
        }),
        makeTrialWithScoreAndVerdict(4, {
          eval: { score: 0, verdict: 'unknown' },
        }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      // Only observed scores [0.8, 0.6], median = (0.6 + 0.8) / 2 = 0.7
      expect(result.aggregated['eval'].medianScore).toBe(0.7);
    });

    it('omits medianScore when all trials are unknown', () => {
      const trials = [
        makeTrialWithScoreAndVerdict(0, {
          eval: { score: 0, verdict: 'unknown' },
        }),
        makeTrialWithScoreAndVerdict(1, {
          eval: { score: 0, verdict: 'unknown' },
        }),
      ];
      const result = agg.aggregate(scoreScenario(), trials);
      expect(result.aggregated['eval'].medianScore).toBeUndefined();
    });
  });

  describe('lowerIsBetter propagation', () => {
    const lowerIsBetterEval = {
      name: 'token-usage',
      regressionMode: 'score' as const,
      lowerIsBetter: true,
      evaluate: async () => ({
        evaluator: 'token-usage',
        score: 5000,
        verdict: 'observed' as const,
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
          },
          evalResults: [
            {
              evaluator: 'token-usage',
              score: 5000,
              verdict: 'observed' as const,
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
          },
          evalResults: [
            {
              evaluator: 'explicit-false',
              score: 0.8,
              verdict: 'observed' as const,
              reason: '',
            },
          ],
        },
      ];
      const result = agg.aggregate(scenario, trials);
      expect(result.aggregated['explicit-false'].lowerIsBetter).toBe(false);
    });
  });

  describe('score-mode: passAtK and passToTheK omitted', () => {
    const scoreModeEval = {
      name: 'score-eval',
      regressionMode: 'score' as const,
      evaluate: async () => ({
        evaluator: 'score-eval',
        score: 0,
        verdict: 'observed' as const,
        reason: '',
      }),
    } satisfies Evaluator;

    function makeScoreModeScenario(): Scenario {
      return makeScenario({ evaluators: [scoreModeEval] });
    }

    it('omits passAtK and passToTheK for score-mode evaluator', () => {
      const trials: TrialResult[] = [
        {
          trialIndex: 0,
          transcript: {
            scenarioName: 'test-scenario',
            trialIndex: 0,
            turns: [],
            snapshots: [],
            errors: [],
          },
          evalResults: [{
            evaluator: 'score-eval',
            score: 0.5,
            verdict: 'observed' as const,
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
          },
          evalResults: [{
            evaluator: 'score-eval',
            score: 0.7,
            verdict: 'observed' as const,
            reason: '',
          }],
        },
      ];
      const result = agg.aggregate(makeScoreModeScenario(), trials);
      expect(result.aggregated['score-eval'].passAtK).toBeUndefined();
      expect(result.aggregated['score-eval'].passToTheK).toBeUndefined();
    });

    it('keeps passAtK and passToTheK as boolean for pass-rate evaluator', () => {
      const trials = [
        makeTrial(0, { 'pr-eval': 'pass' }),
        makeTrial(1, { 'pr-eval': 'fail' }),
      ];
      const result = agg.aggregate(makeScenario(), trials);
      expect(typeof result.aggregated['pr-eval'].passAtK).toBe('boolean');
      expect(typeof result.aggregated['pr-eval'].passToTheK).toBe('boolean');
    });

    it('treats regressionMode absent as pass-rate (boolean fields present)', () => {
      const noModeEval = {
        name: 'no-mode',
        evaluate: async () => ({
          evaluator: 'no-mode',
          score: 1.0,
          verdict: 'pass' as const,
          reason: '',
        }),
      } satisfies Evaluator;
      const scenario = makeScenario({ evaluators: [noModeEval] });
      const trials = [makeTrial(0, { 'no-mode': 'pass' })];
      const result = agg.aggregate(scenario, trials);
      expect(typeof result.aggregated['no-mode'].passAtK).toBe('boolean');
      expect(typeof result.aggregated['no-mode'].passToTheK).toBe('boolean');
    });

    it('mixed: score-mode omits passAtK/passToTheK, pass-rate retains them', () => {
      const passRateEval = {
        name: 'pass-rate-eval',
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
          },
          evalResults: [
            {
              evaluator: 'score-eval',
              score: 0.5,
              verdict: 'observed' as const,
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
          },
          evalResults: [
            {
              evaluator: 'score-eval',
              score: 0.3,
              verdict: 'observed' as const,
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
      expect(result.aggregated['score-eval'].passAtK).toBeUndefined();
      expect(result.aggregated['score-eval'].passToTheK).toBeUndefined();
      expect(result.aggregated['pass-rate-eval'].passAtK).toBe(true);
      expect(result.aggregated['pass-rate-eval'].passToTheK).toBe(false);
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

    it('defaults to medium when stabilityLevel is absent', () => {
      const result = agg.aggregate(makeScenario(), []);
      expect(result.stabilityLevel).toBe('medium');
    });
  });
});
