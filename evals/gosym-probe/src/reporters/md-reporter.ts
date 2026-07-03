import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioResult, AggregatedResult, TrialResult } from
  '../runner/types.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type { ChecklistItemOutcome } from '../evaluators/checklist-verdict.js';
import type {
  RegressionEvalResult,
  RegressionResult,
  ComparedRegressionEvalResult,
} from '../baselines/types.js';
import type { StabilityLevel } from '../scenarios/types.js';
import { STABILITY_TRIALS } from '../scenarios/types.js';
import {
  trialDurationMs,
  formatDuration,
  computeTimingStats,
} from '../util/timing.js';
import { computeScoreStats } from '../util/score-stats.js';
import { formatPass1, formatEstimatorVector } from '../util/pass-at-k.js';
import { summarizeToolCalls } from '../store/tool-call-summarizer.js';
import {
  findSignalDisagreements,
  type SignalDisagreement,
} from '../baselines/signal-disagreement.js';
import {
  computeGraderStability,
  type GraderStability,
} from '../baselines/grader-stability.js';

interface IncompleteVerdict {
  scenario: string;
  evaluator: string;
  trialLabel: string;
  reason: string;
}

// ── Module-level pure functions ───────────────────────────────

function escapePipeForMarkdown(
  reason: string | null | undefined,
): string {
  if (!reason) return '';
  return reason.replace(/[\r\n]+/g, ' ').replace(/\|/g, ' ').trim();
}

function truncateCell(
  value: string | null | undefined,
  maxLength = 200,
): string {
  const text = escapePipeForMarkdown(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatPassRate(agg: AggregatedResult): string {
  if (agg.passAt1 === undefined && agg.baselinePassingTrials === undefined) return '\u2014';
  if (agg.totalTrials === 0) return '\u2014';
  const passing = agg.baselinePassingTrials ?? agg.passingTrials;
  return `${passing}/${agg.totalTrials} (${formatPercent(passing, agg.totalTrials)})`;
}

function verdictWithScore(r: EvalResult): string {
  const verdict = r.verdict === 'incomplete'
    ? '\u26a0\ufe0f incomplete'
    : r.verdict;
  const score = Number.isFinite(r.score)
    ? r.score.toFixed(2)
    : '\u2014';
  return `${verdict} (${score})`;
}

function baselineCell(
  evalResults: RegressionEvalResult[],
  evaluator: string,
): string {
  const entry = evalResults.find(
    (e) => e.evaluator === evaluator,
  );
  if (!entry || entry.type === 'skipped') {
    return '\u2014';
  }
  const sign = entry.delta >= 0 ? '+' : '';
  const formatted = `${sign}${entry.delta.toFixed(2)}`;
  const base = entry.exceeded
    ? `\u26a0\ufe0f ${formatted}`
    : formatted;

  if (entry.statistical) {
    const { nonInferiorityProven, confidenceInterval: ci, margin } = entry.statistical;
    const tostMark = nonInferiorityProven ? '\u2713' : '\u2717';
    const ciStr = `CI ${ci.lower.toFixed(2)}..${ci.upper.toFixed(2)}`;
    const marginStr = `\u00b1${margin.toFixed(2)}`;
    return `${base} [TOST ${tostMark}, ${ciStr}, ${marginStr}]`;
  }

  return base;
}

// Formats a pre-divided rate fraction (0..1) as a percentage. Distinct from
// formatPercent (which takes a numerator/denominator and returns '0%'/'NaN%'):
// here the input is already a fraction and a non-finite value means "no data",
// which renders as an em-dash rather than a bogus number.
function formatRateFraction(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${Math.round(fraction * 100)}%`;
}

function gateIcon(gate: RegressionResult['gate']): string {
  if (gate === 'fail') return '✗ fail';
  if (gate === 'warning') return '⚠️ warning';
  return '✓ pass';
}

/**
 * Renders the main-vs-our-change pass-rate comparison (squad task 1d): one row
 * per gated scenario × pass-rate evaluator, putting the baseline ("main") and
 * current ("our-change") pass rates side by side with their delta and the
 * scenario's gate. This is the merge-back evidence format — a reviewer reads it
 * to judge whether an our-change run beats main. Reuses the comparison the
 * regression gate already computes (ComparedRegressionEvalResult), so it adds a
 * view, not a second computation.
 *
 * Only **pass-rate-mode** evaluators appear here: for them
 * `currentScore`/`baselineScore` are genuine pass rates (passingTrials /
 * totalTrials), so a percentage and a percentage-point delta are meaningful.
 * Score-mode evaluators (token cost, latency, agent steps, …) carry an
 * aggregate score in those same fields — rendering them as "%" would be a
 * category error — so they're excluded and counted in a footnote rather than
 * silently dropped. Their regression status still shows in the per-scenario
 * gated tables above.
 *
 * "main" = the saved baseline a run was gated against (typically captured on
 * the main branch); "our-change" = the current run. Scenarios with no baseline
 * are omitted (nothing to compare).
 */
function renderPassRateComparison(results: ScenarioResult[]): string {
  const gated = results.filter((r) => r.regressionStatus !== undefined);
  const rows: string[] = [];
  let scoreModeExcluded = 0;
  let noBaselineExcluded = 0;
  for (const result of gated) {
    const status = result.regressionStatus!;
    for (const evalResult of status.evaluators) {
      if (evalResult.type !== 'compared') continue;
      // currentScore/baselineScore are a pass rate only in pass-rate mode;
      // skip score-mode evaluators rather than mislabel their aggregate score.
      if (result.aggregated[evalResult.evaluator]?.comparisonMode === 'score') {
        scoreModeExcluded += 1;
        continue;
      }
      const e = evalResult as ComparedRegressionEvalResult;
      // A non-finite baselineScore means the main baseline carried NO data for
      // this evaluator (e.g. a newly-added evaluator the baseline predates).
      // There is no comparison to show — rendering it would print a green
      // "— | 80% | — | ✓ pass" row that reads as merge-back evidence while
      // carrying zero signal. Exclude it (footnoted), never show it as a pass.
      if (!Number.isFinite(e.baselineScore)) {
        noBaselineExcluded += 1;
        continue;
      }
      const sign: string = e.delta >= 0 ? '+' : '';
      const deltaStr = Number.isFinite(e.delta)
        ? `${sign}${(e.delta * 100).toFixed(0)}pp`
        : '—';
      const flagged = e.exceeded ? `⚠️ ${deltaStr}` : deltaStr;
      rows.push(
        `| ${result.scenarioName} | ${e.evaluator} | `
        + `${formatRateFraction(e.baselineScore)} | `
        + `${formatRateFraction(e.currentScore)} | ${flagged} | `
        + `${gateIcon(status.gate)} |`,
      );
    }
  }

  const footnote: string[] = [];
  if (scoreModeExcluded > 0) {
    footnote.push(
      '',
      `_${scoreModeExcluded} score-mode evaluator result(s) (e.g. token `
      + 'cost, latency) are omitted here — they carry an aggregate score, not '
      + 'a pass rate. See the per-scenario gated tables above for their '
      + 'regression status._',
    );
  }
  if (noBaselineExcluded > 0) {
    footnote.push(
      '',
      `_${noBaselineExcluded} evaluator(s) are omitted — the main baseline `
      + 'has no data for them (e.g. an evaluator added after the baseline was '
      + 'captured), so there is nothing to compare. Re-capture the main '
      + 'baseline to include them._',
    );
  }

  const header = [
    '## Pass-Rate Comparison: main vs our-change',
    '',
    '> Per-scenario, per-evaluator pass rates side by side. **main** = the '
    + 'baseline this run was gated against; **our-change** = this run. '
    + 'Delta is our-change − main in percentage points; ⚠️ on the Δ cell marks '
    + 'the per-evaluator regression the gate flagged. The **Gate** column is the '
    + 'scenario-level verdict (repeated on each of its rows), not a per-evaluator '
    + 'one — a passing evaluator can sit under a failing scenario gate. This is '
    + 'the merge-back evidence format.',
    '',
  ];

  if (rows.length === 0) {
    let why: string;
    if (noBaselineExcluded > 0 && scoreModeExcluded === 0) {
      why = 'the main baseline has no data for these evaluators (e.g. they '
        + 'were added after it was captured) — re-capture the main baseline to '
        + 'compare them';
    } else if (scoreModeExcluded > 0 && noBaselineExcluded === 0) {
      why = 'baselined scenarios had only score-mode evaluators (token cost, '
        + 'latency, …), which report an aggregate score rather than a pass '
        + 'rate — see the gated tables above';
    } else if (scoreModeExcluded > 0 || noBaselineExcluded > 0) {
      why = 'every comparable evaluator was excluded (score-mode and/or '
        + 'missing main-baseline data) — see the gated tables above';
    } else {
      why = 'no baselined scenarios in this run — capture a main baseline '
        + '(`save-baseline`) and re-run against it to populate this table';
    }
    // Append the same footnotes the non-empty path builds so the exact
    // excluded counts (score-mode / missing-baseline) aren't lost when every
    // comparable evaluator was excluded.
    return [...header, `_No pass-rate rows to compare: ${why}._`, ...footnote].join('\n');
  }

  return [
    ...header,
    '| Scenario | Evaluator | main | our-change | Δ | Gate |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    ...footnote,
  ].join('\n');
}

function renderEvaluatorReasoning(
  evalNames: string[],
  evalIndex: Map<number, Map<string, EvalResult>>,
  trialCount: number,
): string | null {
  const blocks: string[] = [];

  for (const name of evalNames) {
    const reasonLines: string[] = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(name);
      if (r && r.verdict !== 'pass' && r.verdict !== 'incomplete' && r.verdict !== 'directional') {
        const reason = escapePipeForMarkdown(r.reason) || '(no reason given)';
        const comparison = r.baselineComparison
          ? ` [${escapePipeForMarkdown(r.baselineComparison)}]`
          : '';
        reasonLines.push(`- T${i + 1}: ${reason}${comparison}`);
      }
    }
    if (reasonLines.length > 0) {
      blocks.push(
        `**${name}**`,
        ...reasonLines,
        '',
      );
    }
  }

  if (blocks.length === 0) return null;

  return [
    '<details>',
    '<summary>Evaluator Reasoning</summary>',
    '',
    ...blocks,
    '</details>',
  ].join('\n');
}

function renderChecklistItemsBreakdown(
  evalNames: string[],
  evalIndex: Map<number, Map<string, EvalResult>>,
  trialCount: number,
): string | null {
  const blocks: string[] = [];

  for (const name of evalNames) {
    const trialItems: Array<ChecklistItemOutcome[] | undefined> = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(name);
      const items = r?.details?.['items'];
      trialItems.push(Array.isArray(items) ? (items as ChecklistItemOutcome[]) : undefined);
    }

    if (!trialItems.some((items) => items !== undefined)) continue;

    const checkIds: string[] = [];
    const seen = new Set<string>();
    for (const items of trialItems) {
      if (!items) continue;
      for (const item of items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          checkIds.push(item.id);
        }
      }
    }

    const trialHeaders = Array.from({ length: trialCount }, (_, i) => `T${i + 1}`);
    const cols = ['Check', 'Type', ...trialHeaders];
    const header = `| ${cols.join(' | ')} |`;
    const separator = `|${cols.map((c) => '-'.repeat(c.length + 2)).join('|')}|`;

    const rows = checkIds.map((id) => {
      const firstItem = trialItems.find((t) => t !== undefined)?.find((item) => item.id === id);
      const typePart = firstItem?.type ?? '\u2014';
      const cells: string[] = [id, typePart];
      for (let i = 0; i < trialCount; i++) {
        const item = trialItems[i]?.find((it) => it.id === id);
        if (!item) {
          cells.push('\u2014');
        } else {
          const icon = item.status === 'pass' ? '\u2713' : item.status === 'fail' ? '\u2717' : '?';
          cells.push(`${icon} ${item.status}`);
        }
      }
      return `| ${cells.join(' | ')} |`;
    });

    const hardFailureLines: string[] = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(name);
      const hf = r?.details?.['hardFailures'];
      if (Array.isArray(hf) && hf.length > 0) {
        hardFailureLines.push(`T${i + 1} hard failures: ${(hf as string[]).join(', ')}`);
      }
    }

    blocks.push(
      '<details>',
      `<summary>${name} checklist</summary>`,
      '',
      header,
      separator,
      ...rows,
      '',
      ...(hardFailureLines.length > 0 ? [...hardFailureLines, ''] : []),
      '</details>',
    );
  }

  if (blocks.length === 0) return null;
  return blocks.join('\n');
}

function collectIncompletes(
  results: ScenarioResult[],
): IncompleteVerdict[] {
  const incompletes: IncompleteVerdict[] = [];

  for (const result of results) {
    for (const trial of result.trials) {
      for (const r of trial.evalResults) {
        if (r.verdict === 'incomplete') {
          incompletes.push({
            scenario: result.scenarioName,
            evaluator: r.evaluator,
            trialLabel: `T${trial.trialIndex + 1}`,
            reason: r.evaluatorFailed === true
              ? `${r.reason} (evaluator crashed)`
              : r.reason,
          });
        }
      }
    }
  }

  return incompletes;
}

function renderIncompletes(
  incompletes: IncompleteVerdict[],
): string {
  const lines = [
    '## \u26a0\ufe0f Incomplete Verdicts \u2014 Require Human Review',
    '',
    '| Scenario | Evaluator | Trial | Reason |',
    '|----------|-----------|-------|--------|',
    ...incompletes.map((u) => {
      const reason =
        escapePipeForMarkdown(u.reason) || '(no reason given)';
      const scenario = u.scenario.replace(/\|/g, '\\|');
      const evaluator = u.evaluator.replace(/\|/g, '\\|');
      const trialLabel = u.trialLabel.replace(/\|/g, '\\|');
      return `| ${scenario} | ${evaluator} | ${trialLabel} | ${reason} |`;
    }),
  ];
  return lines.join('\n');
}

function totalTrialCount(results: ScenarioResult[]): number {
  return results.reduce((sum, r) => sum + r.trials.length, 0);
}

function renderGraderStability(stability: GraderStability): string {
  const lines = [
    '## \u{1f4cf} Grader Stability',
    '',
    '> Meta-metric: how consistent the GRADERS are across trials, '
    + 'separate from how the agent scored. Flip-rate = distinct verdicts '
    + '÷ trials (lower = steadier). Each trial is a different build, '
    + 'so some variation is the agent, not the grader — read with the '
    + 'per-trial table.',
    '',
    '| Evaluator | Trials | Distinct verdicts | Flip-rate | Verdicts seen |',
    '|-----------|--------|-------------------|-----------|---------------|',
    ...stability.perEvaluator.map((e) => {
      const seen = [...new Set(e.verdicts)].join(', ');
      return `| ${escapePipeForMarkdown(e.evaluator)} | ${e.trials}`
        + ` | ${e.distinctVerdicts} | ${e.flipRate.toFixed(2)}`
        + ` | ${escapePipeForMarkdown(seen)} |`;
    }),
    '',
    `*Static-vs-judge disagreement rate:* `
    + `${stability.disagreements}/${stability.comparableTrials} `
    + `(${(stability.disagreementRate * 100).toFixed(0)}%) of comparable trials.`,
  ];
  return lines.join('\n');
}

function renderSignalDisagreements(
  disagreements: SignalDisagreement[],
): string {
  const lines = [
    '## \u{1f50d} Signal Disagreements — Static vs Judge',
    '',
    '> The static evaluator and the narrow LLM-judge share one checklist.'
    + ' Where their verdicts diverge, investigate: a bad static test, a bad'
    + ' judgment, or a genuinely-different-but-valid solution.',
    '',
    '| Scenario | Trial | Static | Judge | Investigate |',
    '|----------|-------|--------|-------|-------------|',
    ...disagreements.map((d) => {
      const scenario = escapePipeForMarkdown(d.scenario);
      const investigate = escapePipeForMarkdown(d.investigate);
      return `| ${scenario} | ${d.trialLabel} | ${d.staticVerdict}`
        + ` | ${d.judgeVerdict} | ${investigate} |`;
    }),
  ];
  return lines.join('\n');
}

function compactVerdict(
  result: EvalResult | undefined,
): string {
  if (!result) return '\u2014';
  if (result.verdict === 'incomplete') return '\u26a0\ufe0f incomplete';
  return result.verdict;
}

function formatPercent(
  numerator: number,
  denominator: number,
): string {
  if (denominator === 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}


function renderTrialLinks(result: ScenarioResult): string {
  return result.trials
    .map((trial) =>
      `[T${trial.trialIndex + 1}](scenarios/`
      + `${result.scenarioName}/trials/`
      + `${trial.trialIndex}/eval-results.md)`)
    .join(', ');
}

function buildEvalIndex(
  result: ScenarioResult,
): Map<number, Map<string, EvalResult>> {
  const evalIndex = new Map<number, Map<string, EvalResult>>();
  result.trials.forEach((trial) => {
    const evalMap = new Map<string, EvalResult>();
    for (const r of trial.evalResults) {
      evalMap.set(r.evaluator, r);
    }
    evalIndex.set(trial.trialIndex, evalMap);
  });
  return evalIndex;
}

function renderGitLine(
  options: RenderOptions | undefined,
): string | null {
  const sha = options?.gitSha ?? null;
  const branch = options?.gitBranch ?? null;
  if (sha == null && branch == null) return null;

  const shortSha = sha != null ? `\`${sha.slice(0, 7)}\`` : null;
  const branchPart = branch != null ? `\`${branch}\`` : null;

  if (shortSha != null && branchPart != null) {
    return `**Git:** ${shortSha} on ${branchPart}`;
  }
  return `**Git:** ${shortSha ?? branchPart}`;
}

function renderModeLine(
  results: ScenarioResult[],
  options: RenderOptions | undefined,
): string {
  const mode = options?.runMode ?? 'eval';

  if (mode === 'graduation') {
    const counts = new Map<StabilityLevel, number>();
    for (const r of results) {
      counts.set(r.stabilityLevel, (counts.get(r.stabilityLevel) ?? 0) + 1);
    }
    const stabilityParts = [...counts.entries()].map(([level, n]) => {
      const trials = STABILITY_TRIALS[level];
      const trialLabel = trials !== undefined ? ` (${trials} trials)` : '';
      return n > 1 ? `${level}${trialLabel} × ${n}` : `${level}${trialLabel}`;
    });
    const stabilityStr = stabilityParts.length > 0
      ? ` | **Stability:** ${stabilityParts.join(', ')}`
      : '';
    return `**Mode:** graduation${stabilityStr}`;
  }

  if (options?.skipBaseline) {
    return `**Mode:** eval | **Baseline:** skipped`;
  }

  const compared = results.filter((r) => r.baselineFilePath !== undefined).length;

  if (compared === 0) {
    return `**Mode:** eval | **Baseline:** none`;
  }

  const without = results.length - compared;
  const summary = without > 0
    ? `${compared} compared, ${without} without`
    : `${compared} compared`;

  const lines = [`**Mode:** eval | **Baselines:** ${summary}`];
  for (const r of results) {
    lines.push(
      r.baselineFilePath
        ? `- ${r.scenarioName}: \`${r.baselineFilePath}\``
        : `- ${r.scenarioName}: *(none)*`,
    );
  }
  return lines.join('\n');
}

function renderCategoryMatrix(results: ScenarioResult[]): string[] {
  if (results.length === 0) return ['*(none)*'];

  const maxTrials = Math.max(
    ...results.map((result) => result.trials.length),
  );
  const trialHeaders = Array.from(
    { length: maxTrials },
    (_, i) => `T${i + 1}`,
  );
  const cols = ['Scenario', 'Evaluator', 'pass@1', 'pass@k', 'pass^k', 'Pass Rate', ...trialHeaders];
  const lines = [
    `| ${cols.join(' | ')} |`,
    `|${cols.map((col) => '-'.repeat(col.length + 2)).join('|')}|`,
  ];

  for (const result of results) {
    const evalIndex = buildEvalIndex(result);
    for (const [name, agg] of Object.entries(result.aggregated)) {
      // Estimators are defined for pass-rate evaluators and enriched score-mode evaluators
      const rate = formatPassRate(agg);
      const cells = [
        escapePipeForMarkdown(result.scenarioName),
        escapePipeForMarkdown(name),
        formatPass1(agg.passAt1, '\u2014', { n: agg.totalTrials, ci: agg.wilsonCI }),
        formatEstimatorVector(agg.passAtK, '\u2014'),
        formatEstimatorVector(agg.passHatK, '\u2014'),
        rate,
      ];
      for (let i = 0; i < maxTrials; i++) {
        cells.push(compactVerdict(evalIndex.get(i)?.get(name)));
      }
      lines.push(`| ${cells.join(' | ')} |`);
    }
  }

  return lines;
}

export function renderTrialEvalResultsMarkdown(
  trial: TrialResult,
): string {
  const lines = [
    '## Eval results',
    '',
    `- Scenario: \`${trial.transcript.scenarioName}\``,
    `- Trial: \`${trial.trialIndex}\``,
    '',
    '| Evaluator | Verdict | Score | Reason |',
    '|----------|---------|-------|--------|',
  ];

  for (const result of [...trial.evalResults].sort((a, b) =>
    a.evaluator.localeCompare(b.evaluator))) {
    const score = Number.isFinite(result.score)
      ? result.score.toFixed(2)
      : '\u2014';
    lines.push(
      `| ${escapePipeForMarkdown(result.evaluator)}`
      + ` | ${compactVerdict(result)}`
      + ` | ${score}`
      + ` | ${truncateCell(result.reason)} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function renderTostConfigLine(options: RenderOptions | undefined): string | null {
  const tc = options?.tostConfig;
  if (!tc) return null;
  return `**TOST:** alpha=${tc.alpha}, k=${tc.k}`;
}

function renderScenarioGateSummary(regressionStatus: RegressionResult): string[] {
  const gateIcon =
    regressionStatus.gate === 'pass' ? '\u2713' :
    regressionStatus.gate === 'warning' ? '\u26a0\ufe0f' : '\u2717';

  const lines: string[] = [
    `> **Regression gate:** ${gateIcon} ${regressionStatus.gate}`,
  ];

  const notable = regressionStatus.evaluators.filter(
    (e) => e.type === 'skipped' || (e.type === 'compared' && e.exceeded),
  );

  if (notable.length === 0) return lines;

  lines.push(
    '',
    '| Evaluator | Method | Result |',
    '|-----------|--------|--------|',
  );

  for (const e of notable) {
    const name = escapePipeForMarkdown(e.evaluator);
    if (e.type === 'skipped') {
      lines.push(`| ${name} | skipped | ${escapePipeForMarkdown(e.skipReason)} |`);
    } else {
      const method = e.statistical
        ? `TOST (${e.statistical.method})`
        : 'threshold fallback';
      const result = e.statistical ? 'regression detected' : 'exceeded';
      lines.push(`| ${name} | ${method} | ${result} |`);
    }
  }

  return lines;
}

function renderTostDiagnostics(regressionStatus: RegressionResult): string | null {
  const withStats = regressionStatus.evaluators.filter(
    (e): e is ComparedRegressionEvalResult =>
      e.type === 'compared' && e.statistical !== undefined,
  );

  if (withStats.length === 0) return null;

  const blocks: string[] = [];

  for (const e of withStats) {
    const stat = e.statistical!;
    const deltaStr = Number.isFinite(e.delta)
      ? (e.delta >= 0 ? `+${e.delta.toFixed(2)}` : e.delta.toFixed(2))
      : '\u2014';

    const underpowered =
      stat.power !== undefined &&
      !stat.nonInferiorityProven &&
      stat.power.achievedPower < stat.power.targetPower;

    blocks.push(
      `**${e.evaluator}** ${stat.method} | n: baseline=${stat.n.baseline}, current=${stat.n.current}`,
      `- Margin: \u00b1${stat.margin.toFixed(2)} (k=${stat.k}, SD=${stat.baselineSD.toFixed(2)})`,
      `- CI: ${stat.confidenceInterval.lower.toFixed(2)}..${stat.confidenceInterval.upper.toFixed(2)}`,
      `- Delta: ${deltaStr}`,
      `- Non-inferiority: ${stat.nonInferiorityProven ? 'proven' : 'not proven'}`,
    );
    if (stat.power !== undefined) {
      const p = stat.power;
      const mdeStr = Number.isFinite(p.mdeScore) ? p.mdeScore.toFixed(2) : '\u221e';
      blocks.push(
        `- Power: ${(p.achievedPower * 100).toFixed(0)}% `
        + `(Cohen's d=${p.cohensD.toFixed(2)}, MDE \u00b1${mdeStr}, `
        + `target ${(p.targetPower * 100).toFixed(0)}%)`
        + (underpowered ? ' \u2014 **underpowered**' : ''),
      );
    }
    blocks.push('');
  }

  return [
    '<details>',
    '<summary>TOST Diagnostics</summary>',
    '',
    ...blocks,
    '</details>',
  ].join('\n');
}

// ── MdReporter class ─────────────────────────────────────────

export interface RenderOptions {
  wallClockMs?: number;
  runMode?: 'eval' | 'graduation';
  skipBaseline?: boolean;
  gitSha?: string | null;
  gitBranch?: string | null;
  tostConfig?: { alpha: number; k: number };
  /** Strong reasoning model for the `summary.md` narrative; forwarded to `NarrativeSummaryReporter`. */
  summaryAnalysisModel?: string;
}

export class MdReporter {
  constructor(private readonly resultsDir: string = 'results') {}

  async write(runId: string, results: ScenarioResult[], options?: RenderOptions): Promise<string> {
    await mkdir(this.resultsDir, { recursive: true });

    const filePath = join(this.resultsDir, `${runId}.md`);
    const content = this.render(runId, results, options);
    await writeFile(filePath, content);
    return filePath;
  }

  public render(runId: string, results: ScenarioResult[], options?: RenderOptions): string {
    const gated = results.filter((r) => r.regressionStatus !== undefined);
    const informational = results.filter((r) => r.regressionStatus === undefined);
    const incompletes = collectIncompletes(results);
    const disagreements = findSignalDisagreements(results);
    const trialCount = totalTrialCount(results);

    const headerLine = options?.wallClockMs
      ? `**Generated:** ${new Date().toISOString()} | **Wall Clock:** ${formatDuration(options.wallClockMs)}`
      : `**Generated:** ${new Date().toISOString()}`;

    const gitLine = renderGitLine(options);
    const tostConfigLine = renderTostConfigLine(options);
    const modeLine = renderModeLine(results, options);

    const sections: string[] = [
      `# Eval Run: ${runId}`,
      headerLine,
      ...(gitLine != null ? [gitLine] : []),
      ...(tostConfigLine != null ? [tostConfigLine] : []),
      modeLine,
      '',
      '---',
      '',
      this.renderSuiteSummary(results),
      '',
      this.renderRunDetails(results),
      '',
      '---',
      '',
      this.renderSection(
        'Gated Scenarios',
        '> Results in this section gate the PR.',
        gated,
      ),
      '',
      this.renderSection(
        'Informational Scenarios',
        '> Results in this section are informational only.',
        informational,
      ),
    ];

    if (gated.length > 0) {
      sections.push('', renderPassRateComparison(results));
    }

    if (trialCount > 1) {
      sections.push('', renderGraderStability(computeGraderStability(results)));
    }

    if (disagreements.length > 0) {
      sections.push('', renderSignalDisagreements(disagreements));
    }

    if (incompletes.length > 0) {
      sections.push('', renderIncompletes(incompletes));
    }

    sections.push('', this.renderTrialLinksSection(results));

    return sections.join('\n');
  }

  private renderSuiteSummary(
    results: ScenarioResult[],
  ): string {
    const totalTrials = results.reduce(
      (sum, result) => sum + result.trials.length,
      0,
    );

    return [
      '## Suite Summary',
      '',
      `- Scenarios: **${results.length}**`,
      `- Trials: **${totalTrials}**`,
      '',
      '### Evaluator rollup (across scenarios)',
      '',
      ...this.renderEvaluatorRollupTable(results),
    ].join('\n');
  }

  private renderEvaluatorRollupTable(
    results: ScenarioResult[],
  ): string[] {
    const counts = new Map<
      string,
      { pass: number; fail: number; incomplete: number }
    >();

    for (const result of results) {
      for (const trial of result.trials) {
        for (const evalResult of trial.evalResults) {
          if (evalResult.verdict === 'directional') continue;
          if (!counts.has(evalResult.evaluator)) {
            counts.set(evalResult.evaluator, {
              pass: 0,
              fail: 0,
              incomplete: 0,
            });
          }
          switch (evalResult.verdict) {
            case 'pass':
              counts.get(evalResult.evaluator)!.pass++;
              break;
            case 'fail':
              counts.get(evalResult.evaluator)!.fail++;
              break;
            case 'incomplete':
              counts.get(evalResult.evaluator)!.incomplete++;
              break;
          }
        }
      }
    }

    const lines = [
      '| Evaluator | pass | fail | incomplete | pass rate |',
      '|----------|------|------|------------|-----------|',
    ];

    for (const [evaluator, count] of [...counts.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const total = count.pass + count.fail + count.incomplete;
      lines.push(
        `| ${escapePipeForMarkdown(evaluator)}`
        + ` | ${count.pass}`
        + ` | ${count.fail}`
        + ` | ${count.incomplete}`
        + ` | ${formatPercent(count.pass, total)} |`,
      );
    }

    return lines;
  }

  // ── Trial links ─────────────────────────────────────────

  private renderTrialLinksSection(
    results: ScenarioResult[],
  ): string {
    if (results.length === 0) return '';

    const lines = [
      '## Trial Links',
      '',
      '| Scenario | Trials |',
      '|----------|--------|',
    ];

    for (const result of results) {
      lines.push(
        `| ${escapePipeForMarkdown(result.scenarioName)}`
        + ` | ${renderTrialLinks(result)} |`,
      );
    }

    return lines.join('\n');
  }

  // ── Run details ──────────────────────────────────────────

  private renderRunDetails(
    results: ScenarioResult[],
  ): string {
    const scenarioCount = results.length;
    const totalTrials = results.reduce(
      (sum, r) => sum + r.trials.length,
      0,
    );
    const totalMs = this.computeTotalDurationMs(results);
    const duration = formatDuration(totalMs);

    return [
      '| Field | Value |',
      '|-------|-------|',
      `| Scenarios | ${scenarioCount} |`,
      `| Total Trials | ${totalTrials} |`,
      `| Total Duration | ${duration} |`,
    ].join('\n');
  }

  private computeTotalDurationMs(
    results: ScenarioResult[],
  ): number {
    let total = 0;
    for (const result of results) {
      for (const trial of result.trials) {
        total += trialDurationMs(trial.transcript.turns);
      }
    }
    return total;
  }

  // ── Section rendering ────────────────────────────────────

  private renderSection(
    heading: string,
    note: string,
    results: ScenarioResult[],
  ): string {
    const lines = [`## ${heading}`, '', note, ''];

    if (results.length === 0) {
      lines.push('*(none)*');
      return lines.join('\n');
    }

    lines.push(...renderCategoryMatrix(results), '');

    for (const result of results) {
      lines.push(...this.renderScenario(result));
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  // ── Per-scenario rendering ───────────────────────────────

  private renderScenario(
    result: ScenarioResult,
  ): string[] {
    const k = result.trials.length;
    const timing = computeTimingStats(result.trials);

    const toolFailureCount = result.trials.reduce(
      (sum, trial) =>
        sum + summarizeToolCalls(trial.transcript.turns).failedCount,
      0,
    );
    const runtimeErrorCount = result.trials.reduce(
      (sum, trial) => sum + trial.transcript.errors.length,
      0,
    );
    const captureErrorCount = result.trials.reduce(
      (sum, trial) => sum + (trial.transcript.captureErrors?.length ?? 0),
      0,
    );

    let summaryLine =
      `**Trials:** ${k}`
      + ` | **Duration:** ${formatDuration(timing.totalDurationMs)}`
      + ` | **Avg Duration:** ${formatDuration(timing.avgTrialDurationMs)}`
      + ` | **Avg Turns:** ${Math.round(timing.avgTurnsPerTrial)}`;
    if (toolFailureCount > 0) {
      summaryLine += ` | **Tool Errors:** ${toolFailureCount}`;
    }
    if (runtimeErrorCount > 0) {
      summaryLine += ` | **Runtime Errors:** ${runtimeErrorCount}`;
    }
    if (captureErrorCount > 0) {
      summaryLine += ` | **Capture Errors:** ${captureErrorCount}`;
    }

    const lines: string[] = [
      `### ${result.scenarioName}`,
      '',
      summaryLine,
      '',
    ];

    if (result.regressionStatus) {
      lines.push(...renderScenarioGateSummary(result.regressionStatus), '');
    }

    lines.push('#### Scores', '');

    const trialHeaders = Array.from(
      { length: k },
      (_, i) => `T${i + 1}`,
    );
    const hasBaseline =
      result.regressionStatus !== undefined;

    const cols: string[] = [
      'Evaluator', 'pass@1', 'pass@k', 'pass^k', 'Pass Rate', 'Mean', 'Range',
    ];
    if (hasBaseline) cols.push('vs. baseline');
    cols.push(...trialHeaders);

    const header = `| ${cols.join(' | ')} |`;
    const separator = `|${cols
      .map(c => '-'.repeat(c.length + 2))
      .join('|')}|`;

    const evalIndex = buildEvalIndex(result);

    const evalNames = Object.keys(result.aggregated);
    const rows = evalNames.map((name) =>
      this.renderRow(
        name,
        result.aggregated[name],
        k,
        evalIndex,
        hasBaseline
          ? baselineCell(
              result.regressionStatus!.evaluators,
              name,
            )
          : undefined,
      ),
    );

    lines.push(header, separator, ...rows);

    const reasoning = renderEvaluatorReasoning(
      evalNames,
      evalIndex,
      k,
    );
    if (reasoning) {
      lines.push('', reasoning);
    }

    if (result.regressionStatus) {
      const diagnostics = renderTostDiagnostics(result.regressionStatus);
      if (diagnostics) {
        lines.push('', diagnostics);
      }
    }

    const breakdown = renderChecklistItemsBreakdown(evalNames, evalIndex, k);
    if (breakdown) {
      lines.push('', breakdown);
    }

    return lines;
  }

  // ── Row rendering ────────────────────────────────────────

  private renderRow(
    evaluator: string,
    agg: AggregatedResult,
    trialCount: number,
    evalIndex: Map<number, Map<string, EvalResult>>,
    baselineCellValue?: string,
  ): string {
    const pass1 = formatPass1(agg.passAt1, '\u2014', { n: agg.totalTrials, ci: agg.wilsonCI });
    const passAtK = formatEstimatorVector(agg.passAtK, '\u2014');
    const passHatK = formatEstimatorVector(agg.passHatK, '\u2014');

    const passRate = formatPassRate(agg);

    const scores: number[] = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(evaluator);
      if (r && Number.isFinite(r.score) && r.verdict !== 'incomplete') scores.push(r.score);
    }
    const stats = scores.length > 0 ? computeScoreStats(scores) : null;
    const mean = stats ? stats.mean.toFixed(2) : '\u2014';
    const range = stats
      ? `${stats.min.toFixed(2)}-${stats.max.toFixed(2)}`
      : '\u2014';

    const cells: string[] = [
      evaluator.replace(/\|/g, '\\|'), pass1, passAtK, passHatK, passRate, mean, range,
    ];
    if (baselineCellValue !== undefined) cells.push(baselineCellValue);
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(evaluator);
      cells.push(r ? verdictWithScore(r) : '\u2014');
    }

    return `| ${cells.join(' | ')} |`;
  }
}
