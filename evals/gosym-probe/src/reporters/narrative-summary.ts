import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import type { IGocodeClient, Message } from '../clients/gocode-client.js';
import type { ScenarioResult } from '../runner/types.js';
import type {
  BaselineScores,
  ComparedRegressionEvalResult,
} from '../baselines/types.js';

const execFile = promisify(execFileCb);

const GIT_OUTPUT_MAX_CHARS = 4000;
const LLM_TIMEOUT_MS = 60_000;

export interface NarrativeRenderOptions {
  wallClockMs?: number;
  /** Required: frames the narrative tone (eval run vs. graduation stability check). */
  runMode: 'eval' | 'graduation';
  /** Short git SHA of the current commit; null when not in a git repo. */
  gitSha: string | null;
  /** Git branch name at evaluation time; null when detached HEAD. */
  gitBranch: string | null;
}

const SYSTEM_PROMPT = `You are an expert AI evaluation analyst. \
Produce a concise human-readable narrative summary of an AI eval run for a software engineering team.

Structure your response as Markdown with these sections:

## TL;DR
2-3 sentences describing the overall outcome.

## Scenario Overview
Brief status (pass / warning / fail) for each scenario and which evaluators drove the result.

## Regression Analysis
For any regressions or warnings: what changed, statistical confidence (TOST CI bounds, sample sizes), severity.

## Code Changes
(Include only when git context is provided.) Correlate regressions or improvements to specific commits or files.

## Recommended Actions
Concrete next steps (investigate, re-run, merge, etc.).

Be precise and concise. Interpret data — do not restate raw numbers. Output clean Markdown only.`;

export class NarrativeSummaryReporter {
  constructor(private readonly gocode: IGocodeClient) {}

  /**
   * Generates an LLM-authored narrative summary of eval results.
   * Returns markdown string on success, or a fallback stub on failure.
   * Never throws.
   */
  async render(
    runId: string,
    results: ScenarioResult[],
    options: NarrativeRenderOptions,
  ): Promise<string> {
    const contextPayload = buildContextPayload(runId, results, options);
    const gitSection = await this.getGitContext(results, options.gitSha);

    const userContent = gitSection
      ? `${contextPayload}\n\n${gitSection}`
      : contextPayload;

    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let narrative: string;
    try {
      narrative = await this.gocode.complete(messages, { signal: controller.signal });
    } catch (err) {
      console.warn(
        '[NarrativeSummaryReporter] Failed to generate narrative summary',
        { error: (err as Error).message, stack: (err as Error).stack },
      );
      return buildFallbackStub((err as Error).message);
    } finally {
      clearTimeout(timer);
    }

    if (!narrative || narrative.trim().length === 0) {
      return buildFallbackStub('LLM returned empty response');
    }
    return narrative;
  }

  private async getGitContext(
    results: ScenarioResult[],
    currentSha: string | null,
  ): Promise<string | null> {
    if (!currentSha) return null;

    const baselineSha = await this.extractBaselineSha(results);
    if (!baselineSha) return null;

    const range = `${baselineSha}..${currentSha}`;

    const [logOut, diffOut] = await Promise.all([
      execFile('git', ['log', '--oneline', range], { encoding: 'utf-8' })
        .then((r) => r.stdout.trim())
        .catch(() => ''),
      execFile('git', ['diff', '--stat', range], { encoding: 'utf-8' })
        .then((r) => r.stdout.trim())
        .catch(() => ''),
    ]);

    if (!logOut && !diffOut) return null;

    const combined = [logOut, diffOut].filter(Boolean).join('\n\n');
    const capped =
      combined.length > GIT_OUTPUT_MAX_CHARS
        ? combined.slice(0, GIT_OUTPUT_MAX_CHARS) + '\n... [truncated]'
        : combined;

    return `## Git Changes (${baselineSha}..${currentSha.slice(0, 7)})\n\`\`\`\n${capped}\n\`\`\``;
  }

  /**
   * Reads baseline JSON files from ScenarioResult.baselineFilePath and returns
   * the first available baseline git SHA. Uses the first non-null SHA found to
   * define the lower bound of the git range shown in the narrative.
   */
  private async extractBaselineSha(results: ScenarioResult[]): Promise<string | null> {
    for (const result of results) {
      if (!result.baselineFilePath) continue;
      try {
        const content = await readFile(result.baselineFilePath, 'utf-8');
        const baseline = JSON.parse(content) as BaselineScores;
        if (baseline.gitSha) return baseline.gitSha;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          console.warn(
            '[NarrativeSummaryReporter] Failed to read baseline file',
            { path: result.baselineFilePath, error: (err as Error).message },
          );
        }
      }
    }
    return null;
  }
}

/**
 * Serializes ScenarioResult[] into a structured text payload for the LLM prompt.
 * Pure and synchronous.
 */
export function buildContextPayload(
  runId: string,
  results: ScenarioResult[],
  options: NarrativeRenderOptions,
): string {
  const lines: string[] = [];

  lines.push(`# Eval Run: ${runId}`);
  lines.push(`Mode: ${options.runMode}`);
  if (options.wallClockMs !== undefined) {
    lines.push(`Duration: ${(options.wallClockMs / 1000).toFixed(1)}s`);
  }
  if (options.gitBranch) lines.push(`Branch: ${options.gitBranch}`);
  if (options.gitSha) lines.push(`Commit: ${options.gitSha}`);
  lines.push(`Scenarios: ${results.length}`);
  lines.push('');

  for (const result of results) {
    lines.push(`## Scenario: ${result.scenarioName}`);
    lines.push(`Stability: ${result.stabilityLevel}`);

    const dropped = result.droppedTrials ?? 0;
    const totalTrials = result.trials.length + dropped;
    lines.push(
      `Trials: ${totalTrials}${dropped > 0 ? ` (${dropped} dropped)` : ''}`,
    );

    if (result.regressionStatus) {
      lines.push(`Regression gate: ${result.regressionStatus.gate}`);
    } else {
      lines.push('Regression gate: (no baseline comparison)');
    }
    lines.push('');

    for (const [evalName, agg] of Object.entries(result.aggregated)) {
      lines.push(`### Evaluator: ${evalName}`);

      if (agg.regressionMode === 'score') {
        const raw = agg.aggregateScore;
        const score =
          typeof raw === 'number' && Number.isFinite(raw)
            ? raw.toFixed(3)
            : 'N/A';
        const direction = agg.lowerIsBetter ? ' (lower is better)' : '';
        lines.push(`  Score (aggregate): ${score}${direction}`);
      } else {
        const passAtK = agg.passAtK !== undefined ? String(agg.passAtK) : 'N/A';
        const passToK = agg.passToTheK !== undefined ? String(agg.passToTheK) : 'N/A';
        lines.push(`  Pass@k: ${passAtK} | Pass^k: ${passToK}`);
      }
      lines.push(`  Passing trials: ${agg.passingTrials}/${agg.totalTrials}`);
      if (agg.failedTrials) {
        lines.push(`  Failed trials: ${agg.failedTrials}`);
      }

      if (result.regressionStatus) {
        const regEval = result.regressionStatus.evaluators.find(
          (e) => e.evaluator === evalName,
        );
        if (regEval?.type === 'compared') {
          const curr = Number.isFinite(regEval.currentScore)
            ? regEval.currentScore.toFixed(3)
            : 'N/A';
          const base = Number.isFinite(regEval.baselineScore)
            ? regEval.baselineScore.toFixed(3)
            : 'N/A';
          const delta = Number.isFinite(regEval.delta)
            ? regEval.delta.toFixed(3)
            : 'N/A';
          lines.push(
            `  Regression: current=${curr} baseline=${base} delta=${delta} exceeded=${regEval.exceeded}`,
          );

          if (regEval.statistical) {
            const s = regEval.statistical;
            const ciLower = Number.isFinite(s.confidenceInterval.lower)
              ? s.confidenceInterval.lower.toFixed(4)
              : 'N/A';
            const ciUpper = Number.isFinite(s.confidenceInterval.upper)
              ? s.confidenceInterval.upper.toFixed(4)
              : 'N/A';
            const margin = Number.isFinite(s.margin) ? s.margin.toFixed(4) : 'N/A';
            lines.push(
              `  TOST: method=${s.method} n=${s.n.baseline}/${s.n.current} ` +
                `margin=${margin} ` +
                `CI=[${ciLower}, ${ciUpper}] ` +
                `non-inferior=${s.nonInferiorityProven}`,
            );
          }
        } else if (regEval?.type === 'skipped') {
          lines.push(`  Regression: skipped (${regEval.skipReason})`);
        }
      }

      // Evaluator reasons from trial results
      const reasons = result.trials.flatMap((t) =>
        t.evalResults
          .filter((e) => e.evaluator === evalName && e.reason)
          .map((e) => `Trial ${t.trialIndex}: [${e.verdict}] ${e.reason}`),
      );
      if (reasons.length > 0) {
        lines.push('  Reasons:');
        for (const r of reasons) {
          lines.push(`    - ${r}`);
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildFallbackStub(reason: string): string {
  return [
    '# Narrative Summary Unavailable',
    '',
    `Narrative generation failed: ${reason}`,
    '',
    'See `aggregate-report.md` for the full tabular results.',
  ].join('\n');
}
