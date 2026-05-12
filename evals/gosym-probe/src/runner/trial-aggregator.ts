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
  versions: Set<string>;
  versionedResults: number;
};

export class TrialAggregator {
  aggregate(scenario: Scenario, trials: TrialResult[]): ScenarioResult {
    const modeMap = new Map<string, 'passRate' | 'score'>(
      scenario.evaluators.map((e) => [
        e.name,
        e.regressionMode ?? 'passRate',
      ]),
    );

    const lowerIsBetterMap = new Map<string, boolean>(
      scenario.evaluators
        .filter((e): e is typeof e & { lowerIsBetter: boolean } =>
          e.lowerIsBetter !== undefined)
        .map((e) => [e.name, e.lowerIsBetter]),
    );

    // Single pass: collect verdicts and scores per evaluator
    const evalDataMap = new Map<string, EvalData>();
    for (const trial of trials) {
      for (const r of trial.evalResults) {
        const data = evalDataMap.get(r.evaluator)
          ?? {
            verdicts: [],
            scores: [],
            versions: new Set<string>(),
            versionedResults: 0,
          };
        data.verdicts.push(r.verdict);
        data.scores.push(r.score);
        if (r.evalVersion) {
          data.versions.add(r.evalVersion);
          data.versionedResults++;
        }
        evalDataMap.set(r.evaluator, data);
      }
    }

    const aggregated: Record<string, AggregatedResult> = {};
    for (const [name, { verdicts, scores, versions, versionedResults }] of evalDataMap) {
      const passingTrials = verdicts.filter((v) => v === 'pass').length;
      const totalTrials = verdicts.length;
      const mode = modeMap.get(name);
      const filteredMedian = mode === 'score'
        ? median(scores.filter((_, i) => verdicts[i] !== 'unknown'))
        : null;
      const lowerIsBetter = lowerIsBetterMap.get(name);

      if (versions.size > 1) {
        console.warn(
          '[TrialAggregator] evaluator reported multiple evalVersions across trials, omitting from aggregation:',
          { evaluator: name, count: versions.size, totalTrials, versions: [...versions] },
        );
      }

      aggregated[name] = {
        ...(mode !== 'score' && {
          passAtK: passingTrials > 0,
          passToTheK: totalTrials > 0 && passingTrials === totalTrials,
        }),
        passingTrials,
        totalTrials,
        ...(filteredMedian != null && { medianScore: filteredMedian }),
        ...(mode !== undefined && { regressionMode: mode }),
        ...(versions.size === 1 &&
          versionedResults === totalTrials && { evalVersion: [...versions][0] }),
        ...(mode === 'score' && lowerIsBetter !== undefined && { lowerIsBetter }),
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
