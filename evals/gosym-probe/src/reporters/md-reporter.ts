import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioResult, AggregatedResult, TrialResult } from
  '../runner/types.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type { CompositeBreakdownEntry } from '../evaluators/composite-evaluator.js';
import type { RegressionEvalResult } from '../baselines/types.js';
import type { StabilityLevel } from '../scenarios/types.js';
import { STABILITY_TRIALS } from '../scenarios/types.js';
import {
  trialDurationMs,
  formatDuration,
  computeTimingStats,
} from '../util/timing.js';
import { computeScoreStats } from '../util/score-stats.js';
import { summarizeToolCalls } from '../store/tool-call-summarizer.js';

interface UnknownVerdict {
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
  if (agg.passAtK === undefined || agg.totalTrials === 0) return '\u2014';
  const passing = agg.baselinePassingTrials ?? agg.passingTrials;
  return `${passing}/${agg.totalTrials} (${formatPercent(passing, agg.totalTrials)})`;
}

function verdictWithScore(r: EvalResult): string {
  const verdict = r.verdict === 'unknown'
    ? '\u26a0\ufe0f unknown'
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
  return entry.exceeded
    ? `\u26a0\ufe0f ${formatted}`
    : formatted;
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
      if (r && r.verdict !== 'pass' && r.verdict !== 'unknown' && r.verdict !== 'observed') {
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

function renderCompositeBreakdown(
  evalNames: string[],
  evalIndex: Map<number, Map<string, EvalResult>>,
  trialCount: number,
): string | null {
  const blocks: string[] = [];

  for (const name of evalNames) {
    const trialBreakdowns: Array<CompositeBreakdownEntry[] | undefined> = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(name);
      const bd = r?.details?.['breakdown'];
      if (r?.details?.['_composite'] === true && Array.isArray(bd)) {
        trialBreakdowns.push(bd as CompositeBreakdownEntry[]);
      } else {
        trialBreakdowns.push(undefined);
      }
    }

    if (!trialBreakdowns.some((b) => b !== undefined)) continue;

    const subEvalNames: string[] = [];
    const seen = new Set<string>();
    for (const b of trialBreakdowns) {
      if (!b) continue;
      for (const entry of b) {
        if (!seen.has(entry.evaluator)) {
          seen.add(entry.evaluator);
          subEvalNames.push(entry.evaluator);
        }
      }
    }

    const trialHeaders = Array.from(
      { length: trialCount },
      (_, i) => `T${i + 1}`,
    );
    const cols = ['Sub-Evaluator', ...trialHeaders];
    const header = `| ${cols.join(' | ')} |`;
    const separator = `|${cols
      .map((c) => '-'.repeat(c.length + 2))
      .join('|')}|`;

    const rows = subEvalNames.map((subName) => {
      const cells: string[] = [subName];
      for (let i = 0; i < trialCount; i++) {
        const b = trialBreakdowns[i];
        const entry = b?.find((e) => e.evaluator === subName);
        if (!entry) {
          cells.push('\u2014');
        } else if (entry.scoreable) {
          cells.push(entry.score.toFixed(2));
        } else {
          cells.push('unknown');
        }
      }
      return `| ${cells.join(' | ')} |`;
    });

    blocks.push(
      '<details>',
      `<summary>${name} breakdown</summary>`,
      '',
      header,
      separator,
      ...rows,
      '',
      '</details>',
    );
  }

  if (blocks.length === 0) return null;
  return blocks.join('\n');
}

function collectUnknowns(
  results: ScenarioResult[],
): UnknownVerdict[] {
  const unknowns: UnknownVerdict[] = [];

  for (const result of results) {
    for (const trial of result.trials) {
      for (const r of trial.evalResults) {
        if (r.verdict === 'unknown') {
          unknowns.push({
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

  return unknowns;
}

function renderUnknowns(
  unknowns: UnknownVerdict[],
): string {
  const lines = [
    '## \u26a0\ufe0f Unknown Verdicts \u2014 Require Human Review',
    '',
    '| Scenario | Evaluator | Trial | Reason |',
    '|----------|-----------|-------|--------|',
    ...unknowns.map((u) => {
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

function compactVerdict(
  result: EvalResult | undefined,
): string {
  if (!result) return '\u2014';
  if (result.verdict === 'unknown') return '\u26a0\ufe0f unknown';
  return result.verdict;
}

function passIcon(value: boolean | undefined): string {
  if (value === undefined) return '\u2014';
  return value ? '✓' : '✗';
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
  const cols = ['Scenario', 'Evaluator', 'pass@k', 'pass^k', 'Pass Rate', ...trialHeaders];
  const lines = [
    `| ${cols.join(' | ')} |`,
    `|${cols.map((col) => '-'.repeat(col.length + 2)).join('|')}|`,
  ];

  for (const result of results) {
    const evalIndex = buildEvalIndex(result);
    for (const [name, agg] of Object.entries(result.aggregated)) {
      // passAtK is defined for pass-rate evaluators and enriched score-mode evaluators
      const rate = formatPassRate(agg);
      const cells = [
        escapePipeForMarkdown(result.scenarioName),
        escapePipeForMarkdown(name),
        passIcon(agg.passAtK),
        passIcon(agg.passToTheK),
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

// ── MdReporter class ─────────────────────────────────────────

export interface RenderOptions {
  wallClockMs?: number;
  runMode?: 'eval' | 'graduation';
  skipBaseline?: boolean;
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
    const unknowns = collectUnknowns(results);

    const headerLine = options?.wallClockMs
      ? `**Generated:** ${new Date().toISOString()} | **Wall Clock:** ${formatDuration(options.wallClockMs)}`
      : `**Generated:** ${new Date().toISOString()}`;

    const modeLine = renderModeLine(results, options);

    const sections: string[] = [
      `# Eval Run: ${runId}`,
      headerLine,
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

    if (unknowns.length > 0) {
      sections.push('', renderUnknowns(unknowns));
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
      { pass: number; partial: number; fail: number; unknown: number }
    >();

    for (const result of results) {
      for (const trial of result.trials) {
        for (const evalResult of trial.evalResults) {
          if (evalResult.verdict === 'observed') continue;
          if (!counts.has(evalResult.evaluator)) {
            counts.set(evalResult.evaluator, {
              pass: 0,
              partial: 0,
              fail: 0,
              unknown: 0,
            });
          }
          switch (evalResult.verdict) {
            case 'pass':
              counts.get(evalResult.evaluator)!.pass++;
              break;
            case 'partial':
              counts.get(evalResult.evaluator)!.partial++;
              break;
            case 'fail':
              counts.get(evalResult.evaluator)!.fail++;
              break;
            case 'unknown':
              counts.get(evalResult.evaluator)!.unknown++;
              break;
          }
        }
      }
    }

    const lines = [
      '| Evaluator | pass | partial | fail | unknown | pass rate |',
      '|----------|------|---------|------|---------|-----------|',
    ];

    for (const [evaluator, count] of [...counts.entries()].sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      const total =
        count.pass + count.partial + count.fail + count.unknown;
      lines.push(
        `| ${escapePipeForMarkdown(evaluator)}`
        + ` | ${count.pass}`
        + ` | ${count.partial}`
        + ` | ${count.fail}`
        + ` | ${count.unknown}`
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

    const lines: string[] = [
      `### ${result.scenarioName}`,
      '',
      summaryLine,
      '',
      '#### Scores',
      '',
    ];

    const trialHeaders = Array.from(
      { length: k },
      (_, i) => `T${i + 1}`,
    );
    const hasBaseline =
      result.regressionStatus !== undefined;

    const cols: string[] = [
      'Evaluator', 'pass@k', 'pass^k', 'Pass Rate', 'Mean', 'Range',
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

    const breakdown = renderCompositeBreakdown(evalNames, evalIndex, k);
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
    const passAtK = agg.passAtK === undefined
      ? '\u2014'
      : agg.baselinePassingTrials !== undefined
        ? `${agg.passAtK ? 'pass' : 'fail'} (${agg.baselinePassingTrials}/${agg.totalTrials})`
        : agg.passAtK ? 'pass' : 'fail';
    const passToTheK = agg.passToTheK === undefined
      ? '\u2014'
      : agg.passToTheK ? 'pass' : 'fail';

    const passRate = formatPassRate(agg);

    const scores: number[] = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(evaluator);
      if (r && Number.isFinite(r.score) && r.verdict !== 'unknown') scores.push(r.score);
    }
    const stats = scores.length > 0 ? computeScoreStats(scores) : null;
    const mean = stats ? stats.mean.toFixed(2) : '\u2014';
    const range = stats
      ? `${stats.min.toFixed(2)}-${stats.max.toFixed(2)}`
      : '\u2014';

    const cells: string[] = [
      evaluator.replace(/\|/g, '\\|'), passAtK, passToTheK, passRate, mean, range,
    ];
    if (baselineCellValue !== undefined) cells.push(baselineCellValue);
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(evaluator);
      cells.push(r ? verdictWithScore(r) : '\u2014');
    }

    return `| ${cells.join(' | ')} |`;
  }
}
