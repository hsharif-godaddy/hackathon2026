import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Scenario } from '../scenarios/types.js';
import type { EvaluatorSummary, TimingStats } from '../store/types.js';

/**
 * ScenarioInfo is the JSON shape emitted by `--list`.
 * Must stay in sync with the Go ScenarioInfo struct in internal/probe/types.go.
 */
export interface ScenarioInfo {
  name: string;
  suite: string;
  trials: number;
  stabilityLevel: string;
  executionMode: string;
  evaluators: string[];
}

/**
 * BaselineEntry is one entry in the JSON array emitted by `--list-baselines`.
 * Must stay in sync with the Go BaselineEntry struct in internal/probe/types.go.
 */
export interface BaselineEntry {
  scenarioName: string;
  runId: string;
  createdAt: string;
}

/** Maps a Scenario to its ScenarioInfo wire shape. Pure — no I/O. */
export function scenarioToInfo(scenario: Scenario): ScenarioInfo {
  return {
    name: scenario.name,
    suite: scenario.suite ?? '',
    trials: scenario.trials,
    stabilityLevel: scenario.stabilityLevel ?? 'low',
    executionMode: 'standard',
    evaluators: scenario.evaluators.map((e) => e.name),
  };
}

/**
 * Scans a baselines directory and returns one BaselineEntry per scenario
 * that has at least one saved baseline file.
 *
 * Each subdirectory of `dir` is treated as a scenario name. The most recent
 * `.json` file (by lexicographic descending sort on the filename prefix) is
 * read to extract `runId` and `createdAt`.
 *
 * Returns [] when the directory does not exist (ENOENT).
 * Throws on unexpected filesystem errors (e.g. EACCES).
 * Silently skips subdirs with no json files or malformed JSON.
 */
export async function scanBaselinesDir(dir: string): Promise<BaselineEntry[]> {
  let scenarioDirs: string[];
  try {
    scenarioDirs = (await readdir(dir)) as string[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const entries: BaselineEntry[] = [];
  for (const scenarioName of scenarioDirs) {
    const scenarioDir = join(dir, scenarioName);
    let files: string[];
    try {
      files = (await readdir(scenarioDir)) as string[];
    } catch {
      continue;
    }

    const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse();
    if (jsonFiles.length === 0) continue;

    const filePath = join(scenarioDir, jsonFiles[0]);
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as { runId: string; createdAt: string };
      entries.push({ scenarioName, runId: parsed.runId, createdAt: parsed.createdAt });
    } catch {
      // Skip malformed or unreadable baseline files.
    }
  }

  return entries;
}

// ── Run list / run detail ─────────────────────────────────────────────────────

/**
 * RunListEntry is one entry in the JSON array emitted by `--list-runs`.
 * Must stay in sync with the Go RunIndexEntry struct in internal/probe/types.go.
 */
export interface RunListEntry {
  runId: string;
  timestamp: string;
  scenarios: string[];
  kind?: 'eval' | 'graduation';
}

/** Per-evaluator perf data in a RunDetailOutput scenario block. */
export interface EvalPerfEntry {
  passingTrials: number;
  totalTrials: number;
  passAtK?: boolean;
  medianScore?: number;
  lowerIsBetter?: boolean;
}

/** Per-scenario timing summary in a RunDetailOutput block. */
export interface RunDetailTiming {
  avgTrialDurationMs: number;
  avgTurnsPerTrial: number;
}

/** Per-scenario perf block in RunDetailOutput. */
export interface ScenarioPerfEntry {
  name: string;
  evaluators: Record<string, EvalPerfEntry>;
  timing: RunDetailTiming;
  regression?: string;
}

/**
 * RunDetailOutput is the JSON shape emitted by `--run-detail <id>`.
 * Must stay in sync with the Go RunDetail struct in internal/probe/types.go.
 */
export interface RunDetailOutput {
  runId: string;
  timestamp: string;
  scenarios: ScenarioPerfEntry[];
}

interface RunIndexFile {
  runs: Array<{
    runId: string;
    timestamp: string;
    dir: string;
    kind?: 'eval' | 'graduation';
  }>;
}

interface RunMetadataFile {
  runId: string;
  timestamp: string;
  scenarios: string[];
  kind?: 'eval' | 'graduation';
}

interface StoredAggregatedFile {
  scenarioName: string;
  evaluators: Record<string, EvaluatorSummary>;
  timing: TimingStats;
  regressionStatus?: { gate: string };
}

/**
 * Reads the run index and enriches each entry with scenario names from
 * run-metadata.json. Returns [] when the index does not exist (ENOENT).
 * Throws on unexpected filesystem errors. Silently defaults scenarios to []
 * when metadata is missing.
 */
export async function scanRunsDir(runsDir: string = 'runs'): Promise<RunListEntry[]> {
  const indexPath = join(runsDir, '.run-index.json');
  let index: RunIndexFile;
  try {
    const raw = await readFile(indexPath, 'utf-8');
    index = JSON.parse(raw) as RunIndexFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const results: RunListEntry[] = [];
  for (const entry of index.runs) {
    let scenarios: string[] = [];
    try {
      const metaPath = join(runsDir, entry.dir, 'run-metadata.json');
      const raw = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(raw) as RunMetadataFile;
      scenarios = meta.scenarios ?? [];
    } catch {
      // Missing or unreadable metadata — default to empty scenarios.
    }
    results.push({
      runId: entry.runId,
      timestamp: entry.timestamp,
      scenarios,
      ...(entry.kind !== undefined && { kind: entry.kind }),
    });
  }
  return results;
}

/**
 * Resolves a run by ID and loads per-scenario perf data from aggregated.json.
 * Returns null when the run ID is not found in the index or the index is missing.
 * Throws on unexpected filesystem errors. Silently defaults evaluators to {}
 * when aggregated.json is missing for a scenario.
 */
export async function loadRunDetail(
  runsDir: string = 'runs',
  runId: string,
): Promise<RunDetailOutput | null> {
  const indexPath = join(runsDir, '.run-index.json');
  let index: RunIndexFile;
  try {
    const raw = await readFile(indexPath, 'utf-8');
    index = JSON.parse(raw) as RunIndexFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  const entry = index.runs.find((r) => r.runId === runId);
  if (!entry) {
    return null;
  }

  const metaPath = join(runsDir, entry.dir, 'run-metadata.json');
  const metaRaw = await readFile(metaPath, 'utf-8');
  const meta = JSON.parse(metaRaw) as RunMetadataFile;

  const scenarioPerfEntries: ScenarioPerfEntry[] = [];
  for (const scenarioName of meta.scenarios) {
    const aggPath = join(runsDir, entry.dir, 'scenarios', scenarioName, 'aggregated.json');
    let evaluators: Record<string, EvalPerfEntry> = {};
    let timing: RunDetailTiming = { avgTrialDurationMs: 0, avgTurnsPerTrial: 0 };
    let regression: string | undefined;

    try {
      const aggRaw = await readFile(aggPath, 'utf-8');
      const agg = JSON.parse(aggRaw) as StoredAggregatedFile;

      evaluators = buildEvalPerfEntries(agg.evaluators);
      timing = {
        avgTrialDurationMs: agg.timing.avgTrialDurationMs,
        avgTurnsPerTrial: agg.timing.avgTurnsPerTrial,
      };
      if (agg.regressionStatus?.gate) {
        regression = agg.regressionStatus.gate;
      }
    } catch {
      // Missing or unreadable aggregated.json — leave defaults.
    }

    scenarioPerfEntries.push({
      name: scenarioName,
      evaluators,
      timing,
      ...(regression !== undefined && { regression }),
    });
  }

  return {
    runId: entry.runId,
    timestamp: entry.timestamp,
    scenarios: scenarioPerfEntries,
  };
}

function buildEvalPerfEntries(
  evaluators: Record<string, EvaluatorSummary>,
): Record<string, EvalPerfEntry> {
  const result: Record<string, EvalPerfEntry> = {};
  for (const [name, summary] of Object.entries(evaluators)) {
    result[name] = {
      passingTrials: summary.passingTrials,
      totalTrials: summary.totalTrials,
      ...(summary.passAtK !== undefined && { passAtK: summary.passAtK }),
      medianScore: summary.scores.median,
      ...(summary.lowerIsBetter !== undefined && { lowerIsBetter: summary.lowerIsBetter }),
    };
  }
  return result;
}
