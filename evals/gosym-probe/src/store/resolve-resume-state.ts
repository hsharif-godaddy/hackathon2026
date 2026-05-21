import type { EvalStore } from './eval-store.js';
import type { TrialResult } from '../runner/types.js';
import type { Scenario } from '../scenarios/types.js';

export interface ResumeStateInput {
  store: EvalStore;
  runRef: string;
  scenarios: Scenario[];
  /** Called per scenario to determine how many trials to resume.
   *  Receives the scenario and the metadata's trialsOverride (if any). */
  getTrialCount: (scenario: Scenario, metadataTrialsOverride?: number) => number;
  expectedKind?: 'graduation' | 'eval';
}

export interface ResumeState {
  dirName: string;
  runId: string;
  existingTrialsByScenario: Map<string, TrialResult[]>;
  trialIndicesByScenario: Map<string, number[]>;
  releaseLock: () => Promise<void>;
}

/**
 * Resolves resume state for a previously started run. Validates the run
 * exists, matches the expected kind and scenario set, acquires a lock,
 * and loads completed trial data.
 *
 * Returns either a typed ResumeState on success or an error string
 * describing why resume failed (caller should log and exit).
 *
 * On validation failure, no lock is held. On success, caller is
 * responsible for releasing `releaseLock` (e.g. via try/finally).
 */
export async function resolveResumeState(
  input: ResumeStateInput,
): Promise<ResumeState | string> {
  const { store, runRef, scenarios, getTrialCount, expectedKind } = input;

  const dirName = await store.resolveRunDirName(runRef);
  if (!dirName) {
    return `run not found for --resume "${runRef}".`;
  }

  const metadata = await store.loadRunMetadataByDirName(dirName);
  if (!metadata) {
    return (
      `run metadata missing for --resume "${runRef}"` +
      ` in "${dirName}". Cannot resume an incomplete run directory.`
    );
  }

  if (expectedKind && metadata.kind !== expectedKind) {
    const actual = metadata.kind ?? 'eval';
    return (
      `run "${runRef}" is not a ${expectedKind} run` +
      ` (kind: ${actual}). Use --resume with a ${expectedKind} run ID.`
    );
  }

  const mismatch = scenarioSetMismatch(metadata.scenarios, scenarios);
  if (mismatch) {
    return `cannot resume "${runRef}". ${mismatch}`;
  }

  const releaseLock = await store.acquireRunLock(dirName);
  const existingTrialsByScenario = new Map<string, TrialResult[]>();
  const trialIndicesByScenario = new Map<string, number[]>();

  try {
    for (const scenario of scenarios) {
      const trialCount = getTrialCount(scenario, metadata.trialsOverride);
      const completed = await store.listCompletedTrialIndices(dirName, scenario.name);
      const existing: TrialResult[] = [];
      for (const trialIndex of completed.filter((i) => i < trialCount)) {
        const trial = await store.loadTrialResultByDirName(
          dirName,
          scenario.name,
          trialIndex,
        );
        if (trial) existing.push(trial);
      }
      existingTrialsByScenario.set(scenario.name, existing);
      const completedSet = new Set(completed);
      trialIndicesByScenario.set(
        scenario.name,
        Array.from({ length: trialCount }, (_, i) => i).filter(
          (i) => !completedSet.has(i),
        ),
      );
    }
  } catch (err) {
    try { await releaseLock(); } catch { /* release best-effort */ }
    throw err;
  }

  return {
    dirName,
    runId: metadata.runId,
    existingTrialsByScenario,
    trialIndicesByScenario,
    releaseLock,
  };
}

function scenarioSetMismatch(
  savedScenarioNames: string[],
  scenarios: Scenario[],
): string | null {
  const currentScenarioNames = scenarios.map((scenario) => scenario.name);
  const saved = new Set(savedScenarioNames);
  const current = new Set(currentScenarioNames);
  const missing = savedScenarioNames.filter((name) => !current.has(name));
  const extra = currentScenarioNames.filter((name) => !saved.has(name));

  if (missing.length === 0 && extra.length === 0) return null;

  return [
    'Current scenario set does not match the resumed run.',
    missing.length > 0
      ? `Missing from current run: ${missing.join(', ')}.`
      : '',
    extra.length > 0
      ? `Extra in current run: ${extra.join(', ')}.`
      : '',
  ].filter(Boolean).join(' ');
}
