import type { AggregatedResult, ScenarioResult } from '../runner/types.js';
import type { RegressionResult } from '../baselines/types.js';
import { summarizeToolCalls } from '../store/tool-call-summarizer.js';
import {
  formatMarginFloorWarning,
  formatRegressionFailureMessage,
} from './regression-message.js';

export type Gate = 'pass' | 'warning' | 'fail';

export interface ScenarioVerdict {
  name: string;
  gate: Gate;
  reason: string;
  drivingEvaluators: string[];
}

export interface RunVerdict {
  overall: Gate;
  perScenario: ScenarioVerdict[];
}

export interface VerdictOptions {
  /** Frames the no-baseline label (eval run vs. graduation stability check). */
  runMode: 'eval' | 'graduation';
}

/**
 * Provenance recorded alongside the verdict so the header is reproducible by
 * construction. The LLM-specific fields (model/promptVersion/payloadSha) are
 * optional here and populated later when the narrative is generated; the
 * verdict header itself never depends on them.
 */
export interface VerdictProvenance {
  runId: string;
  gitSha: string | null;
  gitBranch: string | null;
  generatedAt: string;
  model?: string;
  promptVersion?: string;
  payloadSha?: string;
}

/** Deterministic provenance inputs for the verdict header, sans LLM fields. */
export interface VerdictHeaderContext {
  runId: string;
  gitSha: string | null;
  gitBranch: string | null;
  generatedAt: string;
}

/** Optional LLM provenance, populated only when a narrative is generated. */
export interface LlmProvenance {
  model: string;
  promptVersion: string;
  payloadSha: string;
}

const NO_BASELINE_LABEL = 'no baseline — graduation/informational';

/**
 * Derives a deterministic, code-owned verdict from regression gates. The gate
 * is taken verbatim from `regressionStatus.gate` (the authoritative value
 * enforced by the runner) and never re-derived. Scenarios without a baseline
 * fall back to a pass^k informational verdict.
 */
export function computeVerdict(
  results: ScenarioResult[],
  options: VerdictOptions,
): RunVerdict {
  const perScenario: ScenarioVerdict[] = results.map((result) =>
    result.regressionStatus
      ? gatedVerdict(result.scenarioName, result.regressionStatus)
      : noBaselineVerdict(result, options),
  );
  return { overall: overallGate(perScenario), perScenario };
}

function overallGate(perScenario: ScenarioVerdict[]): Gate {
  if (perScenario.some((s) => s.gate === 'fail')) return 'fail';
  if (perScenario.some((s) => s.gate === 'warning')) return 'warning';
  return 'pass';
}

function gatedVerdict(name: string, regression: RegressionResult): ScenarioVerdict {
  const drivingEvaluators: string[] = collectDrivingEvaluators(regression);
  return {
    name,
    gate: regression.gate,
    reason: gatedReason(regression),
    drivingEvaluators,
  };
}

function collectDrivingEvaluators(regression: RegressionResult): string[] {
  return regression.evaluators
    .filter(
      (e) =>
        (e.type === 'compared' && e.exceeded) ||
        (e.type === 'skipped' && e.skipReason === 'evaluator-version-mismatch'),
    )
    .map((e) => e.evaluator);
}

function gatedReason(regression: RegressionResult): string {
  if (regression.gate === 'fail') {
    const message: string | null = formatRegressionFailureMessage(regression);
    if (message) return message;
    return `Regression gate failed for "${regression.scenarioName}".`;
  }
  const floorWarning: string | null = formatMarginFloorWarning(regression);
  if (floorWarning) return floorWarning;
  if (regression.gate === 'warning') {
    return `Warning: fallback-threshold regression for "${regression.scenarioName}".`;
  }
  return `Pass: non-inferiority proven for "${regression.scenarioName}".`;
}

function noBaselineVerdict(
  result: ScenarioResult,
  options: VerdictOptions,
): ScenarioVerdict {
  const passRateEvaluators: [string, AggregatedResult][] = Object.entries(
    result.aggregated,
  ).filter(([, agg]) => agg.comparisonMode !== 'score');

  const totalMisses: string[] = passRateEvaluators
    .filter(([, agg]) => agg.totalTrials > 0 && agg.passingTrials === 0)
    .map(([name]) => name);

  if (options.runMode === 'eval' && totalMisses.length > 0) {
    return {
      name: result.scenarioName,
      gate: 'fail',
      reason: `${NO_BASELINE_LABEL} (${options.runMode}): zero passing trials for ${totalMisses.join(', ')}.`,
      drivingEvaluators: totalMisses,
    };
  }

  return {
    name: result.scenarioName,
    gate: 'warning',
    reason: `${NO_BASELINE_LABEL} (${options.runMode}): no baseline for regression comparison.`,
    drivingEvaluators: [],
  };
}

const GATE_LABEL: Record<Gate, string> = {
  pass: 'PASS',
  warning: 'WARNING',
  fail: 'FAIL',
};

/**
 * One-line, deterministic TL;DR placed directly under the RESULT line. Reports
 * only directly-counted facts (trials that made zero tool calls, and the count
 * of scenarios with a non-passing verdict) so it never overstates or interprets
 * beyond the evidence. Returns null when there is nothing notable to summarize
 * (all scenarios pass and every trial called at least one tool).
 */
export function renderHealthLine(
  results: ScenarioResult[],
  verdict: RunVerdict,
): string | null {
  const totalTrials: number = results.reduce((sum, r) => sum + r.trials.length, 0);
  if (totalTrials === 0) return null;

  const noToolCallTrials: number = results.reduce(
    (sum, r) =>
      sum +
      r.trials.filter((t) => summarizeToolCalls(t.transcript.turns).totalCount === 0).length,
    0,
  );
  const nonPassingScenarios: number = verdict.perScenario.filter((s) => s.gate !== 'pass').length;

  if (noToolCallTrials === 0 && nonPassingScenarios === 0) return null;

  const parts: string[] = [];
  if (noToolCallTrials > 0) {
    const pct: number = Math.round((noToolCallTrials / totalTrials) * 100);
    parts.push(`${noToolCallTrials} of ${totalTrials} trials (${pct}%) made zero tool calls`);
  }
  if (nonPassingScenarios > 0) {
    const noun: string = nonPassingScenarios === 1 ? 'scenario' : 'scenarios';
    parts.push(`${nonPassingScenarios} of ${results.length} ${noun} non-passing`);
  }
  return `> ${parts.join('. ')}.`;
}

/**
 * Pass rates for only the evaluators that drove the scenario's verdict, keeping
 * the overview scannable. The full per-evaluator breakdown lives in
 * `aggregate-report.md`. Falls back to '—' when nothing drove the verdict
 * (a passing scenario).
 */
function passRatesForDrivers(result: ScenarioResult, drivers: string[]): string {
  if (drivers.length === 0) return '—';
  const cells: string[] = drivers
    .map((name) => {
      const agg: AggregatedResult | undefined = result.aggregated[name];
      return agg ? `${name} ${bestPassRate(agg)}` : null;
    })
    .filter((cell): cell is string => cell !== null);
  return cells.length > 0 ? cells.join('; ') : '—';
}

function bestPassRate(agg: AggregatedResult): string {
  if (agg.comparisonMode === 'score') {
    return Number.isFinite(agg.aggregateScore)
      ? `score ${(agg.aggregateScore as number).toFixed(3)}`
      : 'score N/A';
  }
  if (agg.totalTrials === 0) return '—';
  const passing: number = agg.baselinePassingTrials ?? agg.passingTrials;
  const pct: number = Math.round((passing / agg.totalTrials) * 100);
  return `${passing}/${agg.totalTrials} (${pct}%)`;
}

/**
 * Renders a deterministic, scannable per-scenario table: verdict, the
 * evaluators that drove it, and each scenario's key pass rates. Pure and
 * code-owned (the LLM never formats these numbers, so it cannot embellish
 * them). Returns null when there are no scenarios.
 */
export function renderScenarioOverview(
  results: ScenarioResult[],
  verdict: RunVerdict,
): string | null {
  if (verdict.perScenario.length === 0) return null;

  const gateByName: Map<string, Gate> = new Map(
    verdict.perScenario.map((s) => [s.name, s.gate]),
  );
  const driversByName: Map<string, string[]> = new Map(
    verdict.perScenario.map((s) => [s.name, s.drivingEvaluators]),
  );

  const lines: string[] = ['## Scenario Overview', ''];
  lines.push('| Scenario | Verdict | Driving Evaluators | Key Pass Rates |');
  lines.push('| --- | --- | --- | --- |');

  for (const result of results) {
    const gate: Gate = gateByName.get(result.scenarioName) ?? 'pass';
    const drivers: string[] = driversByName.get(result.scenarioName) ?? [];
    const driverCell: string = drivers.length > 0 ? drivers.join(', ') : '—';
    const passRates: string = passRatesForDrivers(result, drivers);
    lines.push(
      `| ${result.scenarioName} | ${GATE_LABEL[gate]} | ${driverCell} | ${passRates} |`,
    );
  }

  return lines.join('\n');
}

/**
 * Renders the deterministic verdict header for `summary.md`. Pure: identical
 * inputs produce byte-identical output. Carries the authoritative pass/fail
 * above any LLM narrative, followed by a TL;DR health line and a scannable
 * per-scenario overview table, then the detailed per-scenario reason blocks.
 */
export function renderVerdictMarkdown(
  results: ScenarioResult[],
  verdict: RunVerdict,
  provenance: VerdictProvenance,
): string {
  const lines: string[] = [];
  lines.push(`**RESULT: ${GATE_LABEL[verdict.overall]}**`);

  const healthLine: string | null = renderHealthLine(results, verdict);
  if (healthLine) {
    lines.push('');
    lines.push(healthLine);
  }

  const overview: string | null = renderScenarioOverview(results, verdict);
  if (overview) {
    lines.push('');
    lines.push(overview);
  }
  lines.push('');

  for (const scenario of verdict.perScenario) {
    lines.push(`### ${scenario.name} — ${GATE_LABEL[scenario.gate]}`);
    if (scenario.drivingEvaluators.length > 0) {
      lines.push(`Driving evaluators: ${scenario.drivingEvaluators.join(', ')}`);
    }
    lines.push('```');
    lines.push(scenario.reason);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Provenance');
  lines.push(`- runId: ${provenance.runId}`);
  lines.push(`- gitSha: ${provenance.gitSha ?? 'n/a'}`);
  lines.push(`- gitBranch: ${provenance.gitBranch ?? 'n/a'}`);
  lines.push(`- generatedAt: ${provenance.generatedAt}`);
  if (provenance.model) lines.push(`- model: ${provenance.model}`);
  if (provenance.promptVersion) lines.push(`- promptVersion: ${provenance.promptVersion}`);
  if (provenance.payloadSha) lines.push(`- payloadSha: ${provenance.payloadSha}`);

  return lines.join('\n');
}

/**
 * Single entry point for the deterministic verdict header: computes the verdict
 * from results and renders it with provenance. All summary paths (narrative,
 * graduation, header-only fallback, and the regenerate-summary script) route
 * through here so the "compute + render" contract lives in exactly one place.
 * Pure: identical inputs produce byte-identical output.
 */
export function renderVerdictHeader(
  results: ScenarioResult[],
  runMode: VerdictOptions['runMode'],
  context: VerdictHeaderContext,
  llm?: LlmProvenance,
): string {
  const provenance: VerdictProvenance = { ...context, ...(llm ?? {}) };
  return renderVerdictMarkdown(results, computeVerdict(results, { runMode }), provenance);
}
