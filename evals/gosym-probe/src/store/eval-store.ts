import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
import type { Config } from '../../config/environments/types.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type { Scenario } from '../scenarios/types.js';
import type { ScenarioResult, TrialResult } from '../runner/types.js';
import {
  MdReporter,
  renderTrialEvalResultsMarkdown,
} from '../reporters/md-reporter.js';
import type { RenderOptions } from '../reporters/md-reporter.js';
import { toCompactTimestamp } from '../util/timestamp.js';
import { sanitizeConfig } from '../util/sanitize.js';
import type {
  RunMetadata,
  StoredScenarioConfig,
  StoredTranscript,
  StoredSnapshotMeta,
  EvaluatorSummary,
  StoredAggregated,
  RunIndex,
  StoredToolCallSummary,
  StoredArtifactManifest,
} from './types.js';
import { summarizeToolCalls } from './tool-call-summarizer.js';
import {
  extractArtifacts,
  buildArtifactManifest,
} from './artifact-extractor.js';
import { renderConversation } from
  '../util/conversation-renderer.js';
import { computeTimingStats } from '../util/timing.js';
import { computeScoreStats } from '../util/score-stats.js';

async function removeLockDir(
  lockDir: string,
  label: string,
): Promise<void> {
  try {
    await rm(lockDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;

    console.error('Failed to release gosym-probe lock.', { label, lockDir }, err);
    throw err;
  }
}

export interface RunOptions {
  trialsOverride?: number;
  concurrencyOverride?: number;
  maxTurnsOverride?: number;
  kind?: 'eval' | 'graduation';
  dirName?: string;
}

export class EvalStore {
  constructor(
    private readonly runsDir: string = 'runs',
    private readonly maxRuns: number = 10,
  ) {}

  private normalizeRunOptions(
    optionsOrTrials: RunOptions | number | undefined,
    concurrencyOverride?: number,
    maxTurnsOverride?: number,
    kind?: 'eval' | 'graduation',
  ): RunOptions {
    if (
      typeof optionsOrTrials === 'object' &&
      optionsOrTrials !== null
    ) {
      return optionsOrTrials;
    }

    return {
      ...(optionsOrTrials !== undefined && {
        trialsOverride: optionsOrTrials,
      }),
      ...(concurrencyOverride !== undefined && {
        concurrencyOverride,
      }),
      ...(maxTurnsOverride !== undefined && {
        maxTurnsOverride,
      }),
      ...(kind !== undefined && { kind }),
    };
  }

  async save(
    runId: string,
    results: ScenarioResult[],
    scenarios: Scenario[],
    config: Config,
    optionsOrTrials?: RunOptions | number,
    concurrencyOverride?: number,
    maxTurnsOverride?: number,
    kind?: 'eval' | 'graduation',
  ): Promise<string> {
    const options = this.normalizeRunOptions(
      optionsOrTrials,
      concurrencyOverride,
      maxTurnsOverride,
      kind,
    );
    const resolvedDirName = options.dirName ?? await this.initRun(
      runId, scenarios, config, options,
    );
    for (const result of results) {
      for (const trial of result.trials) {
        await this.writeTrial(resolvedDirName, result.scenarioName, trial);
      }
    }
    // renderOptions intentionally omitted: save() callers (interactive CLI,
    // graduation runner) do not track wall-clock timing for the full run.
    return this.finalizeRun(resolvedDirName, runId, results, options.kind);
  }

  async initRun(
    runId: string,
    scenarios: Scenario[],
    config: Config,
    optionsOrTrials?: RunOptions | number,
    concurrencyOverride?: number,
    maxTurnsOverride?: number,
    kind?: 'eval' | 'graduation',
  ): Promise<string> {
    const options = this.normalizeRunOptions(
      optionsOrTrials,
      concurrencyOverride,
      maxTurnsOverride,
      kind,
    );
    const gitSha = await this.getGitSha();
    const timestamp = new Date().toISOString();
    const resolvedDirName =
      options.dirName ?? `${toCompactTimestamp(timestamp)}_${runId}`;
    const runDir = this.runDir(resolvedDirName);

    await mkdir(runDir, { recursive: true });
    await this.writeMetadata(
      runDir,
      runId,
      timestamp,
      gitSha,
      scenarios.map((s) => s.name),
      config,
      options.trialsOverride,
      options.concurrencyOverride,
      options.maxTurnsOverride,
      options.kind,
    );

    for (const scenario of scenarios) {
      const scenDir = this.scenarioDir(resolvedDirName, scenario.name);
      await mkdir(scenDir, { recursive: true });
      await writeFile(
        join(scenDir, 'scenario-config.json'),
        JSON.stringify(
          this.serializeScenarioConfig(scenario),
          null,
          2,
        ),
      );
    }

    return resolvedDirName;
  }

  async finalizeRun(
    dirName: string,
    runId: string,
    results: ScenarioResult[],
    kind?: 'eval' | 'graduation',
    renderOptions?: RenderOptions,
  ): Promise<string> {
    const runDir = this.runDir(dirName);

    for (const result of results) {
      const scenDir = this.scenarioDir(dirName, result.scenarioName);
      await writeFile(
        join(scenDir, 'aggregated.json'),
        JSON.stringify(this.computeAggregated(result), null, 2),
      );
    }

    const reporter = new MdReporter();
    const resolvedRenderOptions: RenderOptions = {
      ...renderOptions,
      runMode: renderOptions?.runMode ?? (kind === 'graduation' ? 'graduation' : 'eval'),
    };
    const summaryContent = reporter.render(runId, results, resolvedRenderOptions);
    await writeFile(join(runDir, 'summary.md'), summaryContent);

    const timestamp = new Date().toISOString();
    await this.updateRunIndex(runId, timestamp, dirName, kind);

    return runDir;
  }

  async acquireRunLock(dirName: string): Promise<() => Promise<void>> {
    return this.acquireLock(
      join(this.runDir(dirName), '.run.lock'),
      `run ${dirName}`,
    );
  }

  /**
   * Removes run directories that exceed `maxRuns` and any orphan
   * directories not tracked in the run index.
   *
   * @remarks
   * The orphan sweep runs after the index truncation, so it races
   * with any concurrent writer that has created a run directory but
   * not yet committed its index entry. In practice this is safe
   * because `prune()` is called from the CLI after all eval work
   * completes.
   */
  async prune(): Promise<string[]> {
    const indexPath = join(this.runsDir, '.run-index.json');
    let index: RunIndex;
    try {
      const raw = await readFile(indexPath, 'utf-8');
      index = JSON.parse(raw) as RunIndex;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const {
      pruned,
      removedDirs,
      index: updatedIndex,
    } = await this.removeExcessRuns(index, indexPath);

    const indexedDirs = new Set(updatedIndex.runs.map((r) => r.dir));
    await this.cleanOrphanDirs(indexedDirs, removedDirs);

    return pruned;
  }

  private async removeExcessRuns(
    index: RunIndex,
    indexPath: string,
  ): Promise<{
    pruned: string[];
    removedDirs: Set<string>;
    index: RunIndex;
  }> {
    const pruned: string[] = [];
    const removedDirs = new Set<string>();

    if (this.maxRuns > 0 && index.runs.length > this.maxRuns) {
      const toRemove = index.runs.slice(this.maxRuns);
      for (const run of toRemove) {
        await rm(
          this.runDir(run.dir),
          { recursive: true, force: true },
        );
        removedDirs.add(run.dir);
        pruned.push(run.runId);
      }
      const updated: RunIndex = {
        runs: index.runs.slice(0, this.maxRuns),
      };
      const tmpPath = `${indexPath}.${process.pid}.tmp`;
      await writeFile(tmpPath, JSON.stringify(updated, null, 2));
      await rename(tmpPath, indexPath);
      return { pruned, removedDirs, index: updated };
    }

    if (this.maxRuns === 0) {
      for (const run of index.runs) {
        await rm(
          this.runDir(run.dir),
          { recursive: true, force: true },
        );
        removedDirs.add(run.dir);
        pruned.push(run.runId);
      }
      const updated: RunIndex = { runs: [] };
      const tmpPath = `${indexPath}.${process.pid}.tmp`;
      await writeFile(tmpPath, JSON.stringify(updated, null, 2));
      await rename(tmpPath, indexPath);
      return { pruned, removedDirs, index: updated };
    }

    return { pruned, removedDirs, index };
  }

  private async cleanOrphanDirs(
    indexedDirs: Set<string>,
    removedDirs: Set<string>,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.runsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      if (indexedDirs.has(entry) || removedDirs.has(entry)) continue;
      await rm(
        this.runDir(entry),
        { recursive: true, force: true },
      );
    }
  }

  async listRuns(): Promise<RunIndex['runs']> {
    const indexPath = join(this.runsDir, '.run-index.json');
    try {
      const raw = await readFile(indexPath, 'utf-8');
      return (JSON.parse(raw) as RunIndex).runs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async loadRunMetadata(runId: string): Promise<RunMetadata | null> {
    const dir = await this.findRunDir(runId);
    if (!dir) return null;
    return this.loadJsonFile<RunMetadata>(
      join(dir, 'run-metadata.json'),
    );
  }

  async resolveRunDirName(runRef: string): Promise<string | null> {
    const indexed = (await this.listRuns()).find(
      (run) => run.runId === runRef || run.dir === runRef,
    );
    if (indexed) return indexed.dir;

    const directMetadata = await this.loadJsonFile<RunMetadata>(
      join(this.runDir(runRef), 'run-metadata.json'),
    );
    if (directMetadata) return runRef;

    let entries: string[];
    try {
      entries = await readdir(this.runsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const metadata = await this.loadJsonFile<RunMetadata>(
        join(this.runDir(entry), 'run-metadata.json'),
      );
      if (metadata?.runId === runRef) return entry;
    }

    return null;
  }

  async loadRunMetadataByDirName(
    dirName: string,
  ): Promise<RunMetadata | null> {
    return this.loadJsonFile<RunMetadata>(
      join(this.runDir(dirName), 'run-metadata.json'),
    );
  }

  async listCompletedTrialIndices(
    dirName: string,
    scenarioName: string,
  ): Promise<number[]> {
    const trialsDir = join(
      this.scenarioDir(dirName, scenarioName),
      'trials',
    );
    let entries: string[];
    try {
      entries = await readdir(trialsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }

    const indices: number[] = [];
    for (const entry of entries) {
      const index = Number.parseInt(entry, 10);
      if (!Number.isInteger(index) || String(index) !== entry) continue;

      const transcript = await this.loadJsonFile<StoredTranscript>(
        join(trialsDir, entry, 'transcript.json'),
      );
      const evalResults = await this.loadJsonFile<EvalResult[]>(
        join(trialsDir, entry, 'eval-results.json'),
      );
      if (transcript && evalResults) indices.push(index);
    }

    return indices.sort((a, b) => a - b);
  }

  async loadTrialResultByDirName(
    dirName: string,
    scenarioName: string,
    trialIndex: number,
  ): Promise<TrialResult | null> {
    const trialDir = this.trialDirFrom(
      this.runDir(dirName),
      scenarioName,
      trialIndex,
    );
    const transcript = await this.loadJsonFile<StoredTranscript>(
      join(trialDir, 'transcript.json'),
    );
    const evalResults = await this.loadJsonFile<EvalResult[]>(
      join(trialDir, 'eval-results.json'),
    );
    if (!transcript || !evalResults) return null;

    return {
      trialIndex,
      evalResults,
      transcript: {
        scenarioName: transcript.scenarioName,
        trialIndex: transcript.trialIndex,
        turns: transcript.turns,
        snapshots: [],
        errors: transcript.errors,
      },
    };
  }

  async loadTranscript(
    runId: string,
    scenarioName: string,
    trialIndex: number,
  ): Promise<StoredTranscript | null> {
    const dir = await this.findRunDir(runId);
    if (!dir) return null;
    return this.loadJsonFile<StoredTranscript>(
      join(
        this.trialDirFrom(dir, scenarioName, trialIndex),
        'transcript.json',
      ),
    );
  }

  async loadEvalResults(
    runId: string,
    scenarioName: string,
    trialIndex: number,
  ): Promise<EvalResult[] | null> {
    const dir = await this.findRunDir(runId);
    if (!dir) return null;
    return this.loadJsonFile<EvalResult[]>(
      join(
        this.trialDirFrom(dir, scenarioName, trialIndex),
        'eval-results.json',
      ),
    );
  }

  async loadAggregated(
    runId: string,
    scenarioName: string,
  ): Promise<StoredAggregated | null> {
    const dir = await this.findRunDir(runId);
    if (!dir) return null;
    return this.loadJsonFile<StoredAggregated>(
      join(
        this.scenarioDirFrom(dir, scenarioName),
        'aggregated.json',
      ),
    );
  }

  async loadToolCallSummary(
    runId: string,
    scenarioName: string,
    trialIndex: number,
  ): Promise<StoredToolCallSummary | null> {
    const dir = await this.findRunDir(runId);
    if (!dir) return null;
    return this.loadJsonFile<StoredToolCallSummary>(
      join(
        this.trialDirFrom(dir, scenarioName, trialIndex),
        'tool_calls.json',
      ),
    );
  }

  async loadArtifactManifest(
    runId: string,
    scenarioName: string,
    trialIndex: number,
  ): Promise<StoredArtifactManifest | null> {
    const dir = await this.findRunDir(runId);
    if (!dir) return null;
    return this.loadJsonFile<StoredArtifactManifest>(
      join(
        this.trialDirFrom(dir, scenarioName, trialIndex),
        'artifacts',
        'artifacts.json',
      ),
    );
  }

  // ── Path helpers ────────────────────────────────────────────────────────

  private runDir(dirName: string): string {
    return join(this.runsDir, dirName);
  }

  /**
   * Resolves a runId to its full directory path by looking up the
   * run-index. Returns null when the runId is not in the index.
   */
  private async findRunDir(runId: string): Promise<string | null> {
    const runs = await this.listRuns();
    const entry = runs.find((r) => r.runId === runId);
    return entry ? this.runDir(entry.dir) : null;
  }

  private scenarioDir(dirName: string, name: string): string {
    return join(this.runDir(dirName), 'scenarios', name);
  }

  private scenarioDirFrom(runDir: string, name: string): string {
    return join(runDir, 'scenarios', name);
  }

  private trialDirFrom(
    runDir: string,
    name: string,
    idx: number,
  ): string {
    return join(
      this.scenarioDirFrom(runDir, name),
      'trials',
      String(idx),
    );
  }

  // ── Write helpers ────────────────────────────────────────────────────────

  private async writeMetadata(
    runDir: string,
    runId: string,
    timestamp: string,
    gitSha: string | null,
    scenarioNames: string[],
    config: Config,
    trialsOverride: number | undefined,
    concurrencyOverride: number | undefined,
    maxTurnsOverride: number | undefined,
    kind?: 'eval' | 'graduation',
  ): Promise<void> {
    const metadata: RunMetadata = {
      runId,
      timestamp,
      gitSha,
      scenarios: scenarioNames,
      config: sanitizeConfig(config),
      ...(trialsOverride !== undefined && { trialsOverride }),
      ...(concurrencyOverride !== undefined && {
        concurrencyOverride,
      }),
      ...(maxTurnsOverride !== undefined && {
        maxTurnsOverride,
      }),
      ...(kind !== undefined && { kind }),
    };
    await writeFile(
      join(runDir, 'run-metadata.json'),
      JSON.stringify(metadata, null, 2),
    );
  }

  async writeTrial(
    dirName: string,
    scenarioName: string,
    trial: TrialResult,
  ): Promise<void> {
    const runDir = this.runDir(dirName);
    const trialDir = this.trialDirFrom(
      runDir,
      scenarioName,
      trial.trialIndex,
    );
    try {
      await this.writeTrialFiles(trialDir, trial);
    } catch (err) {
      console.error('writeTrial: write failed', { trialDir }, err);
      throw err;
    }
  }

  /**
   * Creates the trial directory ahead of trial completion so
   * pre-teardown hooks can write artifacts directly to the final
   * location. Returns the absolute path.
   */
  async ensureTrialDir(
    dirName: string,
    scenarioName: string,
    trialIndex: number,
  ): Promise<string> {
    const trialDir = this.trialDirFrom(
      this.runDir(dirName),
      scenarioName,
      trialIndex,
    );
    await mkdir(trialDir, { recursive: true });
    return trialDir;
  }

  private async writeTrialFiles(
    trialDir: string,
    trial: TrialResult,
  ): Promise<void> {
    // Compute pure render before any I/O so a render failure
    // occurs before any files have been written.
    const conversationJson = renderConversation(
      trial.transcript.turns,
      trial.transcript.scenarioName,
      trial.transcript.trialIndex,
    );
    const evalResultsMd = renderTrialEvalResultsMarkdown(trial);

    const snapshotsDir = join(trialDir, 'snapshots');
    await mkdir(snapshotsDir, { recursive: true });

    const transcript: StoredTranscript = {
      scenarioName: trial.transcript.scenarioName,
      trialIndex: trial.transcript.trialIndex,
      turns: trial.transcript.turns,
      snapshotCount: trial.transcript.snapshots.length,
      errors: trial.transcript.errors,
    };
    await writeFile(
      join(trialDir, 'transcript.json'),
      JSON.stringify(transcript, null, 2),
    );

    await writeFile(
      join(trialDir, 'eval-results.json'),
      JSON.stringify(trial.evalResults, null, 2),
    );
    await writeFile(
      join(trialDir, 'eval-results.md'),
      evalResultsMd,
    );

    const toolCallSummary = summarizeToolCalls(
      trial.transcript.turns,
    );
    await writeFile(
      join(trialDir, 'tool_calls.json'),
      JSON.stringify(toolCallSummary, null, 2),
    );

    await writeFile(
      join(trialDir, 'conversation.json'),
      JSON.stringify(conversationJson, null, 2),
    );

    const artifacts = extractArtifacts(trial.transcript.turns);
    if (artifacts.length > 0) {
      const artifactsDir = join(trialDir, 'artifacts');
      await mkdir(artifactsDir, { recursive: true });
      for (const artifact of artifacts) {
        await writeFile(
          join(artifactsDir, artifact.filename),
          artifact.content,
        );
      }
      await writeFile(
        join(artifactsDir, 'artifacts.json'),
        JSON.stringify(buildArtifactManifest(artifacts), null, 2),
      );
    }

    // Snapshot PNG + HTML are written directly to disk by SiteCapture
    // before this method runs; here we only persist the in-memory
    // metadata (URL, timestamp, console logs) sourced from the
    // transcript.
    for (let i = 0; i < trial.transcript.snapshots.length; i++) {
      const snap = trial.transcript.snapshots[i];
      const meta: StoredSnapshotMeta = {
        index: i,
        url: snap.url,
        timestamp: snap.timestamp,
      };
      if ('screenshot' in snap && Buffer.isBuffer(snap.screenshot)) {
        await writeFile(join(snapshotsDir, `${i}.png`), snap.screenshot);
      }
      if ('html' in snap && typeof snap.html === 'string') {
        await writeFile(join(snapshotsDir, `${i}.html`), snap.html);
      }
      await writeFile(
        join(snapshotsDir, `${i}.meta.json`),
        JSON.stringify(meta, null, 2),
      );
      await writeFile(
        join(snapshotsDir, `${i}.console-logs.json`),
        JSON.stringify(snap.consoleLogs, null, 2),
      );
    }

    const capturedSite = (
      trial.transcript as TrialResult['transcript'] & {
        capturedSite?: unknown;
      }
    ).capturedSite;
    if (capturedSite) {
      await writeFile(
        join(snapshotsDir, 'capture.json'),
        JSON.stringify(capturedSite, null, 2),
      );
    }
  }

  /**
   * Prepends a new entry to the run index using an advisory lock plus
   * atomic tmp-then-rename write.
   */
  private async updateRunIndex(
    runId: string,
    timestamp: string,
    dir: string,
    kind?: 'eval' | 'graduation',
  ): Promise<void> {
    const release = await this.acquireLock(
      join(this.runsDir, '.run-index.lock'),
      'run index',
    );
    try {
      await this.updateRunIndexLocked(runId, timestamp, dir, kind);
    } finally {
      await release();
    }
  }

  private async updateRunIndexLocked(
    runId: string,
    timestamp: string,
    dir: string,
    kind?: 'eval' | 'graduation',
  ): Promise<void> {
    const indexPath = join(this.runsDir, '.run-index.json');
    let existing: RunIndex = { runs: [] };
    try {
      const raw = await readFile(indexPath, 'utf-8');
      existing = JSON.parse(raw) as RunIndex;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    const entry = {
      runId,
      timestamp,
      dir,
      ...(kind !== undefined && { kind }),
    };
    const updated: RunIndex = {
      runs: [entry, ...existing.runs],
    };
    const tmpPath = `${indexPath}.${process.pid}.tmp`;
    await writeFile(tmpPath, JSON.stringify(updated, null, 2));
    await rename(tmpPath, indexPath);
  }

  private async acquireLock(
    lockDir: string,
    label: string,
  ): Promise<() => Promise<void>> {
    try {
      await mkdir(lockDir, { recursive: false });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          `Cannot acquire ${label} lock at ${lockDir}; another gosym-probe ` +
          `process may be writing this run.`,
        );
      }
      throw err;
    }

    try {
      await writeFile(
        join(lockDir, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }, null, 2),
      );
    } catch (err) {
      try {
        await removeLockDir(lockDir, label);
      } catch {
        // removeLockDir logs the cleanup failure; preserve the owner write error.
      }
      throw err;
    }

    return async function release() {
      await removeLockDir(lockDir, label);
    };
  }

  // ── Serialization helpers ─────────────────────────────────────────────────

  private serializeScenarioConfig(
    scenario: Scenario,
  ): StoredScenarioConfig {
    const {
      systemPrompt: _omit,
      ...personaWithoutPrompt
    } = scenario.persona;
    return {
      name: scenario.name,
      trials: scenario.trials,
      persona: personaWithoutPrompt,
      goals: scenario.goals,
      evaluators: scenario.evaluators.map((e) => e.name),
      ...(scenario.expectedTools !== undefined && {
        expectedTools: scenario.expectedTools,
      }),
    };
  }

  // ── Aggregation helpers ──────────────────────────────────────────────────

  private computeAggregated(
    result: ScenarioResult,
  ): StoredAggregated {
    const byEval = new Map<
      string,
      { scores: number[]; verdicts: Record<string, number> }
    >();
    for (const trial of result.trials) {
      for (const r of trial.evalResults) {
        let entry = byEval.get(r.evaluator);
        if (!entry) {
          entry = { scores: [], verdicts: {} };
          byEval.set(r.evaluator, entry);
        }
        entry.scores.push(r.score);
        entry.verdicts[r.verdict] =
          (entry.verdicts[r.verdict] ?? 0) + 1;
      }
    }

    const evaluators: Record<string, EvaluatorSummary> = {};
    for (const [evalName, agg] of Object.entries(result.aggregated)) {
      const { scores, verdicts } = byEval.get(evalName) ??
        { scores: [], verdicts: {} };
      evaluators[evalName] = {
        ...(agg.passAtK !== undefined && {
          passAtK: agg.passAtK,
        }),
        ...(agg.passToTheK !== undefined && {
          passToTheK: agg.passToTheK,
        }),
        passingTrials: agg.passingTrials,
        totalTrials: agg.totalTrials,
        scores: computeScoreStats(scores),
        verdicts,
        ...(agg.medianScore != null && { medianScore: agg.medianScore }),
        ...(agg.evalVersion !== undefined && { evalVersion: agg.evalVersion }),
        ...(agg.lowerIsBetter !== undefined && {
          lowerIsBetter: agg.lowerIsBetter,
        }),
      };
    }

    return {
      scenarioName: result.scenarioName,
      evaluators,
      timing: computeTimingStats(result.trials),
      ...(result.regressionStatus !== undefined && {
        regressionStatus: result.regressionStatus,
      }),
    };
  }

  private async loadJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async getGitSha(): Promise<string | null> {
    try {
      const { stdout } = await execFile(
        'git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' },
      );
      return stdout.trim();
    } catch {
      return null;
    }
  }
}
