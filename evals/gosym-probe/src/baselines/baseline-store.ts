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
import { extractAllTrialScores } from './trial-scores.js';
import { toCompactTimestamp } from '../util/timestamp.js';

export interface BaselineSaveOptions {
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
  /** Short git SHA of the commit that produced this baseline. */
  gitSha?: string | null;
  /** Git branch name at the time this baseline was saved. */
  gitBranch?: string | null;
  /**
   * Per-evaluator trial scores for statistical regression gating.
   * Used by saveFromStored() when per-trial data is loaded separately
   * from disk (the StoredAggregated format does not carry per-trial scores).
   * Keyed by evaluator name; scores must be pre-filtered (no
   * evaluatorFailed or unknown-verdict entries).
   */
  trialScoresMap?: Record<string, number[]>;
}

export class BaselineStore {
  constructor(private readonly dir: string = 'baselines') {}

  async save(
    runId: string,
    result: ScenarioResult,
    options?: BaselineSaveOptions,
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

    const trialScoresByEvaluator = extractAllTrialScores(result.trials);

    const baseline: BaselineScores = {
      scenarioName: result.scenarioName,
      runId,
      createdAt: new Date().toISOString(),
      stabilityLevel: result.stabilityLevel,
      stabilityTrials: result.trials.length,
      ...(options?.gitSha !== undefined && { gitSha: options.gitSha }),
      ...(options?.gitBranch !== undefined && { gitBranch: options.gitBranch }),
      scores: Object.fromEntries(
        Object.entries(result.aggregated).map(([name, agg]) => {
          const trialScores = trialScoresByEvaluator.get(name);
          return [
            name,
            {
              ...(agg.passAt1 !== undefined && {
                passAt1: agg.passAt1,
              }),
              ...(agg.passAtK !== undefined && {
                passAtK: agg.passAtK,
              }),
              ...(agg.passHatK !== undefined && {
                passHatK: agg.passHatK,
              }),
              passingTrials: agg.passingTrials,
              totalTrials: agg.totalTrials,
              ...(scoreNamesSet.has(name) &&
                agg.aggregateScore != null && {
                  aggregateScore: agg.aggregateScore,
                }),
              ...(agg.evalVersion !== undefined && {
                evalVersion: agg.evalVersion,
              }),
              ...(agg.lowerIsBetter !== undefined && {
                lowerIsBetter: agg.lowerIsBetter,
              }),
              ...(trialScores !== undefined &&
                trialScores.length > 0 && { trialScores }),
            },
          ];
        }),
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
   * carry `regressionMode`. Throws if evaluators with `aggregateScore`
   * are detected but `scoreEvaluatorNames` is empty or omitted.
   */
  async saveFromStored(
    runId: string,
    stored: StoredAggregated,
    stabilityLevel?: StabilityLevel,
    options?: BaselineSaveOptions,
  ): Promise<void> {
    const scenarioDir = join(this.dir, stored.scenarioName);
    await mkdir(scenarioDir, { recursive: true });

    const firstEval = Object.values(stored.evaluators)[0];
    const stabilityTrials = firstEval?.totalTrials;

    const scoreNames = options?.scoreEvaluatorNames ?? [];
    const scoreNamesSet = new Set(scoreNames);

    const evalsWithAggregate = Object.entries(stored.evaluators)
      .filter(([, ev]) => ev.aggregateScore != null)
      .map(([name]) => name);

    const missingNames = evalsWithAggregate.filter(
      (name) => !scoreNamesSet.has(name),
    );

    if (missingNames.length > 0) {
      throw new Error(
        `saveFromStored: scenario "${stored.scenarioName}" has evaluators `
        + `with aggregateScore (${missingNames.join(', ')}) not listed in `
        + `scoreEvaluatorNames. Pass all score-mode evaluator names to `
        + `preserve aggregateScore and regressionThresholds.`,
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
      ...(stabilityLevel !== undefined && { stabilityLevel }),
      ...(stabilityTrials !== undefined && { stabilityTrials }),
      ...(options?.gitSha !== undefined && { gitSha: options.gitSha }),
      ...(options?.gitBranch !== undefined && { gitBranch: options.gitBranch }),
      scores: Object.fromEntries(
        Object.entries(stored.evaluators).map(([name, ev]) => {
          const trialScores = options?.trialScoresMap?.[name];
          return [
            name,
            {
              ...(ev.passAt1 !== undefined && {
                passAt1: ev.passAt1,
              }),
              ...(ev.passAtK !== undefined && {
                passAtK: ev.passAtK,
              }),
              ...(ev.passHatK !== undefined && {
                passHatK: ev.passHatK,
              }),
              passingTrials: ev.passingTrials,
              totalTrials: ev.totalTrials,
              ...(scoreNamesSet.has(name) &&
                ev.aggregateScore != null && {
                  aggregateScore: ev.aggregateScore,
                }),
              ...(ev.evalVersion !== undefined && {
                evalVersion: ev.evalVersion,
              }),
              ...(ev.lowerIsBetter !== undefined && {
                lowerIsBetter: ev.lowerIsBetter,
              }),
              ...(trialScores !== undefined &&
                trialScores.length > 0 && { trialScores }),
            },
          ];
        }),
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
  async load(scenarioName: string): Promise<{ scores: BaselineScores; filePath: string } | null> {
    return this.loadFile(scenarioName, (jsonFiles) => {
      if (jsonFiles.length === 0) return undefined;
      return [...jsonFiles].sort().reverse()[0];
    });
  }

  /**
   * Loads a baseline by exact runId. Scans the scenario directory for a
   * file ending with `_${runId}.json` and returns it, or null if not found.
   */
  async loadByRunId(
    scenarioName: string,
    runId: string,
  ): Promise<{ scores: BaselineScores; filePath: string } | null> {
    return this.loadFile(scenarioName, (jsonFiles) => {
      return jsonFiles.find((f) => f.endsWith(`_${runId}.json`));
    });
  }

  private async loadFile(
    scenarioName: string,
    selectFile: (jsonFiles: string[]) => string | undefined,
  ): Promise<{ scores: BaselineScores; filePath: string } | null> {
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
    const selected = selectFile(jsonFiles);
    if (!selected) return null;

    const filePath = join(scenarioDir, selected);
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
      return { scores: JSON.parse(raw) as BaselineScores, filePath };
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
    const loadedOrProvided = existingBaseline !== undefined
      ? existingBaseline
      : (await this.load(scenarioName))?.scores ?? null;
    const existingThresholds = loadedOrProvided?.regressionThresholds ?? {};
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
