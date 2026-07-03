/**
 * Regenerates `summary.md` for a stored run WITHOUT re-running the eval.
 *
 * Reconstructs `ScenarioResult[]` from the on-disk run directory, then invokes
 * `NarrativeSummaryReporter` exactly as `EvalStore.writeSummary` would. Used to
 * verify the Phase 5 rework against the real golden-light run: deterministic
 * verdict header, cited evidence, and byte-identical header+provenance across
 * two regenerations.
 *
 * BEST-EFFORT / NOT AUTHORITATIVE. This is a developer verification tool, not a
 * supported regeneration path. Its on-disk reconstruction (`toAggregated`,
 * `loadScenario`, `reconstructResults`) is a hand-rolled parallel of
 * `EvalStore`'s serialization and will drift from it: `stabilityLevel` is
 * approximated, transcript `snapshots` are dropped, and a missing/corrupt file
 * skips that scenario (logged, not fatal). Treat the output as a smoke check of
 * the reporter, not a faithful replay of the original run.
 *
 * Usage:
 *   tsx scripts/regenerate-summary.ts <run-dir> [--write]
 *
 * <run-dir> is an absolute path to a run directory (containing
 * run-metadata.json + scenarios/). Without --write the regenerated summary is
 * printed to stdout and NOT persisted.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config/index.js';
import { GocodeClient } from '../src/clients/gocode-client.js';
import type { IGocodeClient } from '../src/clients/gocode-client.js';
import { NarrativeSummaryReporter } from '../src/reporters/narrative-summary.js';
import type { NarrativeRenderOptions } from '../src/reporters/narrative-summary.js';
import { renderVerdictHeader } from '../src/reporters/verdict.js';
import type { VerdictHeaderContext } from '../src/reporters/verdict.js';
import type {
  ScenarioResult,
  TrialResult,
  AggregatedResult,
  StabilityLevel,
} from '../src/runner/types.js';
import type { EvalResult } from '../src/evaluators/evaluator.js';
import type { StoredTranscript, StoredAggregated, EvaluatorSummary, RunMetadata } from '../src/store/types.js';

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[regenerate] Failed to read/parse ${path}: ${(err as Error).message}`);
    }
    return null;
  }
}

function toAggregated(summary: EvaluatorSummary): AggregatedResult {
  const comparisonMode: 'passRate' | 'score' =
    summary.aggregateScore !== undefined ? 'score' : 'passRate';
  return {
    passingTrials: summary.passingTrials,
    totalTrials: summary.totalTrials,
    comparisonMode,
    ...(summary.passAt1 !== undefined && { passAt1: summary.passAt1 }),
    ...(summary.passAtK !== undefined && { passAtK: summary.passAtK }),
    ...(summary.passHatK !== undefined && { passHatK: summary.passHatK }),
    ...(summary.aggregateScore !== undefined && { aggregateScore: summary.aggregateScore }),
    ...(summary.lowerIsBetter !== undefined && { lowerIsBetter: summary.lowerIsBetter }),
    ...(summary.evalVersion !== undefined && { evalVersion: summary.evalVersion }),
  };
}

async function loadTrial(trialDir: string, trialIndex: number): Promise<TrialResult | null> {
  const transcript: StoredTranscript | null = await loadJson<StoredTranscript>(
    join(trialDir, 'transcript.json'),
  );
  const evalResults: EvalResult[] | null = await loadJson<EvalResult[]>(
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
      captureErrors: transcript.captureErrors ?? [],
    },
  };
}

async function loadScenario(runDir: string, scenarioName: string): Promise<ScenarioResult | null> {
  const scenDir: string = join(runDir, 'scenarios', scenarioName);
  const stored: StoredAggregated | null = await loadJson<StoredAggregated>(
    join(scenDir, 'aggregated.json'),
  );
  if (!stored) return null;

  const trialsDir: string = join(scenDir, 'trials');
  const entries: string[] = await readdir(trialsDir).catch(() => []);
  const indices: number[] = entries
    .map((e) => Number.parseInt(e, 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);

  const trials: TrialResult[] = [];
  for (const index of indices) {
    const trial: TrialResult | null = await loadTrial(join(trialsDir, String(index)), index);
    if (trial) trials.push(trial);
  }

  const aggregated: Record<string, AggregatedResult> = {};
  for (const [name, summary] of Object.entries(stored.evaluators)) {
    aggregated[name] = toAggregated(summary);
  }

  const stabilityLevel: StabilityLevel = (trials[0]?.transcript ? 'high' : 'low') as StabilityLevel;
  return {
    scenarioName,
    stabilityLevel,
    trials,
    aggregated,
    ...(stored.regressionStatus ? { regressionStatus: stored.regressionStatus } : {}),
  };
}

async function reconstructResults(runDir: string, metadata: RunMetadata): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenarioName of metadata.scenarios) {
    const result: ScenarioResult | null = await loadScenario(runDir, scenarioName);
    if (result) results.push(result);
  }
  return results;
}

function buildGocodeClient(): IGocodeClient | null {
  try {
    const config = loadConfig();
    if (!config.gocode.baseUrl) return null;
    return new GocodeClient(config.gocode);
  } catch (err) {
    console.warn(`[regenerate] No GoCode client available: ${(err as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  const runDir: string | undefined = process.argv[2];
  const write: boolean = process.argv.includes('--write');
  if (!runDir) {
    console.error('Usage: tsx scripts/regenerate-summary.ts <run-dir> [--write]');
    process.exitCode = 1;
    return;
  }

  const metadata: RunMetadata | null = await loadJson<RunMetadata>(join(runDir, 'run-metadata.json'));
  if (!metadata) {
    console.error(`[regenerate] No run-metadata.json under ${runDir}`);
    process.exitCode = 1;
    return;
  }

  const results: ScenarioResult[] = await reconstructResults(runDir, metadata);
  console.log(`[regenerate] Reconstructed ${results.length} scenario(s) from ${runDir}`);

  const summaryModel: string | undefined = loadConfig().gocode.summaryAnalysisModel;
  const runMode: 'eval' | 'graduation' = metadata.kind === 'graduation' ? 'graduation' : 'eval';
  const options: NarrativeRenderOptions = {
    runMode,
    gitSha: metadata.gitSha,
    gitBranch: metadata.gitBranch ?? null,
    generatedAt: metadata.timestamp,
    summaryAnalysisModel: summaryModel,
  };

  const context: VerdictHeaderContext = {
    runId: metadata.runId,
    gitSha: metadata.gitSha,
    gitBranch: metadata.gitBranch ?? null,
    generatedAt: metadata.timestamp,
  };
  const headerA: string = renderVerdictHeader(results, runMode, context);
  const headerB: string = renderVerdictHeader(results, runMode, context);
  console.log(
    `[regenerate] Deterministic header byte-identical across two renders: ${headerA === headerB}`,
  );
  console.log(`[regenerate] Verdict header:\n${headerA}\n`);

  const gocode: IGocodeClient | null = buildGocodeClient();
  if (!gocode) {
    console.log('[regenerate] No GoCode client; emitting header-only summary.');
    if (write) await writeFile(join(runDir, 'summary.md'), headerA);
    return;
  }

  const reporter: NarrativeSummaryReporter = new NarrativeSummaryReporter(gocode);
  const summary: string = await reporter.render(metadata.runId, results, options);
  console.log(`[regenerate] Full summary length: ${summary.length} chars`);
  if (write) {
    await writeFile(join(runDir, 'summary.md'), summary);
    console.log(`[regenerate] Wrote ${join(runDir, 'summary.md')}`);
  } else {
    console.log('\n──────── summary.md ────────\n');
    console.log(summary);
  }
}

void main();
