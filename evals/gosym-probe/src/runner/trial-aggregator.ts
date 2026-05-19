import type { EvalResult } from '../evaluators/evaluator.js';
import { DEFAULT_STABILITY_LEVEL } from '../scenarios/types.js';
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
  failed: boolean[];
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
            failed: [],
            versions: new Set<string>(),
            versionedResults: 0,
          };
        data.verdicts.push(r.verdict);
        data.scores.push(r.score);
        data.failed.push(r.evaluatorFailed === true);
        if (r.evalVersion) {
          data.versions.add(r.evalVersion);
          data.versionedResults++;
        }
        evalDataMap.set(r.evaluator, data);
      }
    }

    const aggregated: Record<string, AggregatedResult> = {};
    for (const [name, { verdicts, scores, failed, versions, versionedResults }] of evalDataMap) {
      const failedCount = failed.filter(Boolean).length;
      const passingTrials = verdicts.filter((v, i) => v === 'pass' && !failed[i]).length;
      const totalTrials = verdicts.length - failedCount;
      const mode = modeMap.get(name);
      const filteredMedian = mode === 'score'
        ? median(scores.filter((_, i) => verdicts[i] !== 'unknown' && !failed[i]))
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
        ...(failedCount > 0 && { failedTrials: failedCount }),
        ...(filteredMedian != null && { medianScore: filteredMedian }),
        ...(mode !== undefined && { regressionMode: mode }),
        ...(versions.size === 1 &&
          versionedResults === verdicts.length && { evalVersion: [...versions][0] }),
        ...(mode === 'score' && lowerIsBetter !== undefined && { lowerIsBetter }),
      };
    }

    return {
      scenarioName: scenario.name,
      stabilityLevel: scenario.stabilityLevel ?? DEFAULT_STABILITY_LEVEL,
      trials,
      aggregated,
    };
  }
}
