import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioResult, AggregatedResult } from
  '../runner/types.js';
import type { EvalResult } from '../evaluators/evaluator.js';
import type { RegressionEvalResult } from '../baselines/types.js';
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
  if (!entry || Number.isNaN(entry.delta)) {
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
        reasonLines.push(`- T${i + 1}: ${reason}`);
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
            reason: r.reason,
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

// ── MdReporter class ─────────────────────────────────────────

export class MdReporter {
  constructor(private readonly resultsDir: string = 'results') {}

  async write(runId: string, results: ScenarioResult[]): Promise<string> {
    await mkdir(this.resultsDir, { recursive: true });

    const filePath = join(this.resultsDir, `${runId}.md`);
    const content = this.render(runId, results);
    await writeFile(filePath, content);
    return filePath;
  }

  public render(runId: string, results: ScenarioResult[]): string {
    const regression = results.filter((r) => r.category === 'regression');
    const capability = results.filter((r) => r.category === 'capability');
    const unknowns = collectUnknowns(results);

    const sections: string[] = [
      `# Eval Run: ${runId}`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      this.renderRunDetails(results),
      '',
      '---',
      '',
      this.renderCategory(
        'Regression Scenarios',
        '> Results in this section gate the PR.',
        regression,
      ),
      '',
      this.renderCategory(
        'Capability Scenarios',
        '> Results in this section are informational only.',
        capability,
      ),
    ];

    if (unknowns.length > 0) {
      sections.push('', renderUnknowns(unknowns));
    }

    return sections.join('\n');
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

  // ── Category rendering ───────────────────────────────────

  private renderCategory(
    heading: string,
    note: string,
    results: ScenarioResult[],
  ): string {
    const lines = [`## ${heading}`, '', note, ''];

    if (results.length === 0) {
      lines.push('*(none)*');
      return lines.join('\n');
    }

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
      + ` | **Avg Duration:** ${formatDuration(timing.avgTrialDurationMs)}`
      + ` | **Avg Turns:** ${Math.round(timing.avgTurnsPerTrial)}`;
    if (toolFailureCount > 0) {
      summaryLine += ` | **Tool Failures:** ${toolFailureCount}`;
    }
    if (runtimeErrorCount > 0) {
      summaryLine += ` | **Errors:** ${runtimeErrorCount}`;
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
      'Evaluator', 'pass@k', 'pass^k', 'Mean', 'Range',
    ];
    if (hasBaseline) cols.push('vs. baseline');
    cols.push(...trialHeaders);

    const header = `| ${cols.join(' | ')} |`;
    const separator = `|${cols
      .map(c => '-'.repeat(c.length + 2))
      .join('|')}|`;

    // Build O(1) lookup: trial index -> evaluator -> result
    const evalIndex =
      new Map<number, Map<string, EvalResult>>();
    result.trials.forEach((trial, i) => {
      const evalMap = new Map<string, EvalResult>();
      for (const r of trial.evalResults) {
        evalMap.set(r.evaluator, r);
      }
      evalIndex.set(i, evalMap);
    });

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
    const passAtK = agg.passAtK ? 'pass' : 'fail';
    const passToTheK = agg.passToTheK ? 'pass' : 'fail';

    const scores: number[] = [];
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(evaluator);
      if (r && Number.isFinite(r.score)) scores.push(r.score);
    }
    const stats = scores.length > 0 ? computeScoreStats(scores) : null;
    const mean = stats ? stats.mean.toFixed(2) : '\u2014';
    const range = stats
      ? `${stats.min.toFixed(2)}-${stats.max.toFixed(2)}`
      : '\u2014';

    const cells: string[] = [
      evaluator.replace(/\|/g, '\\|'), passAtK, passToTheK, mean, range,
    ];
    if (baselineCellValue !== undefined) cells.push(baselineCellValue);
    for (let i = 0; i < trialCount; i++) {
      const r = evalIndex.get(i)?.get(evaluator);
      cells.push(r ? verdictWithScore(r) : '\u2014');
    }

    return `| ${cells.join(' | ')} |`;
  }
}
