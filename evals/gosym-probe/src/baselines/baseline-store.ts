import {
  readFile,
  readdir,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioResult } from '../runner/types.js';
import type { StabilityLevel } from '../scenarios/types.js';
import type { StoredAggregated } from '../store/types.js';
import type { BaselineScores } from './types.js';
import { toCompactTimestamp } from '../util/timestamp.js';

export interface ThresholdOptions {
  /** Names of evaluators with regressionMode === 'score'. */
  scoreEvaluatorNames?: string[];
  /** Config default; used when no existing threshold is stored. */
  defaultThreshold?: number;
  /**
   * Pre-loaded baseline to avoid a redundant filesystem read inside
   * buildThresholds(). Pass `null` to indicate no existing baseline
   * (skips I/O). When omitted (`undefined`), buildThresholds() loads
   * from disk as before.
   */
  existingBaseline?: BaselineScores | null;
}

export class BaselineStore {
  constructor(private readonly dir: string = 'baselines') {}

  async save(
    runId: string,
    result: ScenarioResult,
    options?: ThresholdOptions,
  ): Promise<void> {
    const scenarioDir = join(this.dir, result.scenarioName);
    await mkdir(scenarioDir, { recursive: true });

    const scoreNames =
      options?.scoreEvaluatorNames
      ?? Object.entries(result.aggregated)
        .filter(
          ([, agg]) => agg.regressionMode === 'score',
        )
        .map(([name]) => name);
    const scoreNamesSet = new Set(scoreNames);

    const regressionThresholds = await this.buildThresholds(
      result.scenarioName,
      scoreNames,
      options?.defaultThreshold,
      options?.existingBaseline,
    );

    const baseline: BaselineScores = {
      scenarioName: result.scenarioName,
      runId,
      createdAt: new Date().toISOString(),
      category: result.category,
      stabilityLevel: result.stabilityLevel,
      stabilityTrials: result.trials.length,
      scores: Object.fromEntries(
        Object.entries(result.aggregated).map(([name, agg]) => [
          name,
          {
            passAtK: agg.passAtK,
            passToTheK: agg.passToTheK,
            passingTrials: agg.passingTrials,
            totalTrials: agg.totalTrials,
            ...(scoreNamesSet.has(name) &&
              agg.medianScore != null && {
                medianScore: agg.medianScore,
              }),
          },
        ]),
      ),
      ...(regressionThresholds !== undefined && { regressionThresholds }),
    };

    const fileName = this.versionedFileName(runId);
    await writeFile(
      join(scenarioDir, fileName),
      JSON.stringify(baseline, null, 2),
    );
  }

  /**
   * Saves a baseline constructed from a stored eval run's aggregated
   * data. Used by the save-baseline CLI script to promote a prior run
   * without re-running the simulation.
   *
   * Callers MUST provide `options.scoreEvaluatorNames` when score-mode
   * evaluators exist. Unlike {@link save}, this method cannot infer
   * score-mode evaluators because {@link StoredAggregated} does not
   * carry `regressionMode`. Throws if evaluators with `medianScore`
   * are detected but `scoreEvaluatorNames` is empty or omitted.
   */
  async saveFromStored(
    runId: string,
    stored: StoredAggregated,
    stabilityLevel?: StabilityLevel,
    options?: ThresholdOptions,
  ): Promise<void> {
    const scenarioDir = join(this.dir, stored.scenarioName);
    await mkdir(scenarioDir, { recursive: true });

    const firstEval = Object.values(stored.evaluators)[0];
    const stabilityTrials = firstEval?.totalTrials;

    const scoreNames = options?.scoreEvaluatorNames ?? [];
    const scoreNamesSet = new Set(scoreNames);

    const evalsWithMedian = Object.entries(stored.evaluators)
      .filter(([, ev]) => ev.medianScore != null)
      .map(([name]) => name);

    const missingNames = evalsWithMedian.filter(
      (name) => !scoreNamesSet.has(name),
    );

    if (missingNames.length > 0) {
      throw new Error(
        `saveFromStored: scenario "${stored.scenarioName}" has evaluators `
        + `with medianScore (${missingNames.join(', ')}) not listed in `
        + `scoreEvaluatorNames. Pass all score-mode evaluator names to `
        + `preserve medianScore and regressionThresholds.`,
      );
    }

    const regressionThresholds = await this.buildThresholds(
      stored.scenarioName,
      scoreNames,
      options?.defaultThreshold,
      options?.existingBaseline,
    );

    const baseline: BaselineScores = {
      scenarioName: stored.scenarioName,
      runId,
      createdAt: new Date().toISOString(),
      category: stored.category,
      ...(stabilityLevel !== undefined && { stabilityLevel }),
      ...(stabilityTrials !== undefined && { stabilityTrials }),
      scores: Object.fromEntries(
        Object.entries(stored.evaluators).map(([name, ev]) => [
          name,
          {
            passAtK: ev.passAtK,
            passToTheK: ev.passToTheK,
            passingTrials: ev.passingTrials,
            totalTrials: ev.totalTrials,
            ...(scoreNamesSet.has(name) &&
              ev.medianScore != null && {
                medianScore: ev.medianScore,
              }),
          },
        ]),
      ),
      ...(regressionThresholds !== undefined && { regressionThresholds }),
    };

    const fileName = this.versionedFileName(runId);
    await writeFile(
      join(scenarioDir, fileName),
      JSON.stringify(baseline, null, 2),
    );
  }

  /**
   * Loads the most recent baseline for a scenario by sorting the
   * versioned files descending (lexicographic on the timestamp prefix)
   * and reading the first entry.
   */
  async load(scenarioName: string): Promise<BaselineScores | null> {
    const scenarioDir = join(this.dir, scenarioName);
    let files: string[];
    try {
      files = await readdir(scenarioDir) as string[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }

    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    if (jsonFiles.length === 0) return null;

    const latest = [...jsonFiles].sort().reverse()[0];
    const filePath = join(scenarioDir, latest);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
    try {
      return JSON.parse(raw) as BaselineScores;
    } catch (err) {
      throw new Error(
        `Failed to parse baseline ${filePath}: ${(err as Error).message}`,
      );
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Builds the regressionThresholds map for score-mode evaluators.
   * Preserves any manually tuned values from the existing baseline;
   * falls back to defaultThreshold for evaluators not yet stored.
   * When `existingBaseline` is provided (including `null`), skips
   * the filesystem read. Returns undefined when there are no
   * score-mode evaluators or no default threshold is configured.
   */
  private async buildThresholds(
    scenarioName: string,
    scoreNames: string[],
    defaultThreshold: number | undefined,
    existingBaseline?: BaselineScores | null,
  ): Promise<Record<string, number> | undefined> {
    if (scoreNames.length === 0 || defaultThreshold === undefined) {
      return undefined;
    }
    const existing = existingBaseline !== undefined
      ? existingBaseline
      : await this.load(scenarioName);
    const existingThresholds = existing?.regressionThresholds ?? {};
    const thresholds: Record<string, number> = {};
    for (const name of scoreNames) {
      thresholds[name] =
        existingThresholds[name] ?? defaultThreshold;
    }
    return thresholds;
  }

  private versionedFileName(runId: string): string {
    const compact = toCompactTimestamp(new Date().toISOString());
    return `${compact}_${runId}.json`;
  }
}
