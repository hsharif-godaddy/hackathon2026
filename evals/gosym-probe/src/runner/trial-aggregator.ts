import type { EvalResult } from '../evaluators/evaluator.js';
import type { Scenario } from '../scenarios/types.js';
import type {
  TrialResult,
  ScenarioResult,
  AggregatedResult,
} from './types.js';
import { median } from '../util/median.js';

type EvalData = {
  verdicts: EvalResult['verdict'][];
  scores: number[];
};

export class TrialAggregator {
  aggregate(scenario: Scenario, trials: TrialResult[]): ScenarioResult {
    const modeMap = new Map<string, 'passRate' | 'score'>(
      scenario.evaluators.map((e) => [
        e.name,
        e.regressionMode ?? 'passRate',
      ]),
    );

    // Single pass: collect verdicts and scores per evaluator
    const evalDataMap = new Map<string, EvalData>();
    for (const trial of trials) {
      for (const r of trial.evalResults) {
        const data = evalDataMap.get(r.evaluator)
          ?? { verdicts: [], scores: [] };
        data.verdicts.push(r.verdict);
        data.scores.push(r.score);
        evalDataMap.set(r.evaluator, data);
      }
    }

    const aggregated: Record<string, AggregatedResult> = {};
    for (const [name, { verdicts, scores }] of evalDataMap) {
      const passingTrials = verdicts.filter((v) => v === 'pass').length;
      const totalTrials = verdicts.length;
      const mode = modeMap.get(name);
      const filteredMedian = mode === 'score'
        ? median(scores.filter((_, i) => verdicts[i] !== 'unknown'))
        : null;

      aggregated[name] = {
        passAtK: passingTrials > 0,
        passToTheK: totalTrials > 0 && passingTrials === totalTrials,
        passingTrials,
        totalTrials,
        ...(filteredMedian != null && { medianScore: filteredMedian }),
        ...(mode !== undefined && { regressionMode: mode }),
      };
    }

    return {
      scenarioName: scenario.name,
      category: scenario.category,
      stabilityLevel: scenario.stabilityLevel ?? 'medium',
      trials,
      aggregated,
    };
  }
}
