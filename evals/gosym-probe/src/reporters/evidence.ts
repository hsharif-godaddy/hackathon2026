import type { ScenarioResult, TrialResult } from '../runner/types.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type { ToolCallSummary } from '../store/types.js';
import { summarizeToolCalls } from '../store/tool-call-summarizer.js';

/**
 * Verdicts that mark a trial as worth investigating. Passing trials and
 * score-mode `directional` measurements are excluded — a trial only earns
 * full-evidence treatment when it fails or could not be judged.
 */
const INVESTIGABLE_VERDICTS: ReadonlySet<EvalResult['verdict']> = new Set([
  'fail',
  'incomplete',
]);

const TRUNCATION_MARKER = '\n... [truncated]';

export interface EvidenceCaps {
  /** Upper bound on trials emitted per scenario; excess trials are dropped and logged. */
  maxInvestigatedTrialsPerScenario: number;
  /** Upper bound on the rendered markdown length per trial; excess is truncated and logged. */
  maxEvidenceCharsPerTrial: number;
}

export const DEFAULT_EVIDENCE_CAPS: EvidenceCaps = {
  maxInvestigatedTrialsPerScenario: 6,
  maxEvidenceCharsPerTrial: 4_000,
};

export interface EvaluatorVerdictEvidence {
  evaluator: string;
  verdict: EvalResult['verdict'];
  reason: string;
}

export interface TrialEvidence {
  trialIndex: number;
  /** Relative path to the trial's on-disk artifacts, mirroring EvalStore's layout. */
  artifactPath: string;
  toolCalls: ToolCallSummary;
  errors: readonly string[];
  captureErrors: readonly string[];
  evaluatorVerdicts: readonly EvaluatorVerdictEvidence[];
  /** Prompt-ready markdown, capped at `maxEvidenceCharsPerTrial`. */
  markdown: string;
  /** Characters removed by the char cap; 0 when the markdown fit untruncated. */
  droppedChars: number;
}

export interface ScenarioEvidence {
  scenarioName: string;
  trials: TrialEvidence[];
  /** Investigable trials omitted by the per-scenario trial cap. */
  droppedTrialCount: number;
}

/**
 * Selects the trials in a scenario that warrant a cited deep-dive: any trial
 * with a non-passing evaluator verdict, or with recorded agent/capture errors.
 * Pure; preserves the original trial order.
 */
export function selectTrialsNeedingInvestigation(
  result: ScenarioResult,
): TrialResult[] {
  return result.trials.filter((trial) => trialNeedsInvestigation(trial));
}

function trialNeedsInvestigation(trial: TrialResult): boolean {
  if (trial.transcript.errors.length > 0) return true;
  if (trial.transcript.captureErrors.length > 0) return true;
  return trial.evalResults.some((e) => INVESTIGABLE_VERDICTS.has(e.verdict));
}

/**
 * Builds the structured, on-disk-path-cited evidence payload for a single
 * trial. The markdown is capped at `maxChars`; when truncated, the cut length
 * is recorded in `droppedChars` and logged (no silent caps).
 */
export function buildTrialEvidence(
  result: ScenarioResult,
  trial: TrialResult,
  maxChars: number,
): TrialEvidence {
  const artifactPath: string = `scenarios/${result.scenarioName}/trials/${trial.trialIndex}/`;
  const toolCalls: ToolCallSummary = summarizeToolCalls(trial.transcript.turns);
  const errors: readonly string[] = trial.transcript.errors;
  const captureErrors: readonly string[] = trial.transcript.captureErrors;
  const evaluatorVerdicts: EvaluatorVerdictEvidence[] = trial.evalResults.map((e) => ({
    evaluator: e.evaluator,
    verdict: e.verdict,
    reason: e.reason,
  }));

  const fullMarkdown: string = renderTrialMarkdown(
    artifactPath,
    toolCalls,
    errors,
    captureErrors,
    evaluatorVerdicts,
  );
  const { markdown, droppedChars } = capMarkdown(fullMarkdown, maxChars);

  if (droppedChars > 0) {
    console.warn('[evidence] Trial evidence truncated by char cap', {
      artifactPath,
      droppedChars,
      maxChars,
    });
  }

  return {
    trialIndex: trial.trialIndex,
    artifactPath,
    toolCalls,
    errors,
    captureErrors,
    evaluatorVerdicts,
    markdown,
    droppedChars,
  };
}

/**
 * Builds evidence for every investigable trial in a scenario, bounded by the
 * supplied caps. Trials dropped by the per-scenario cap are counted in
 * `droppedTrialCount` and logged.
 */
export function buildScenarioEvidence(
  result: ScenarioResult,
  caps: EvidenceCaps,
): ScenarioEvidence {
  const selected: TrialResult[] = selectTrialsNeedingInvestigation(result);
  const kept: TrialResult[] = selected.slice(0, caps.maxInvestigatedTrialsPerScenario);
  const droppedTrialCount: number = selected.length - kept.length;

  if (droppedTrialCount > 0) {
    console.warn('[evidence] Investigated trials dropped by per-scenario cap', {
      scenarioName: result.scenarioName,
      droppedTrialCount,
      maxInvestigatedTrialsPerScenario: caps.maxInvestigatedTrialsPerScenario,
    });
  }

  const trials: TrialEvidence[] = kept.map((trial) =>
    buildTrialEvidence(result, trial, caps.maxEvidenceCharsPerTrial),
  );

  return { scenarioName: result.scenarioName, trials, droppedTrialCount };
}

function capMarkdown(
  full: string,
  maxChars: number,
): { markdown: string; droppedChars: number } {
  if (full.length <= maxChars) return { markdown: full, droppedChars: 0 };

  const keep: number = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  const markdown: string = full.slice(0, keep) + TRUNCATION_MARKER;
  return { markdown, droppedChars: full.length - keep };
}

function renderTrialMarkdown(
  artifactPath: string,
  toolCalls: ToolCallSummary,
  errors: readonly string[],
  captureErrors: readonly string[],
  evaluatorVerdicts: readonly EvaluatorVerdictEvidence[],
): string {
  const lines: string[] = [];
  lines.push(`#### Trial artifacts: ${artifactPath}`);

  lines.push(
    `- Tool calls: ${toolCalls.totalCount} total, ${toolCalls.failedCount} failed, ` +
      `${toolCalls.uniqueCount} unique`,
  );
  if (toolCalls.uniqueTools.length > 0) {
    lines.push(`  - Tools used: ${toolCalls.uniqueTools.join(', ')}`);
  }

  if (evaluatorVerdicts.length > 0) {
    lines.push('- Evaluator verdicts:');
    for (const e of evaluatorVerdicts) {
      lines.push(`  - ${e.evaluator}: [${e.verdict}] ${e.reason}`);
    }
  }

  if (errors.length > 0) {
    lines.push('- Agent errors:');
    for (const err of errors) lines.push(`  - ${err}`);
  }

  if (captureErrors.length > 0) {
    lines.push('- Capture errors:');
    for (const err of captureErrors) lines.push(`  - ${err}`);
  }

  return lines.join('\n');
}
