import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { IGocodeClient, Message } from '../clients/gocode-client.js';
import type { ScenarioResult } from '../runner/types.js';
import type { BaselineScores } from '../baselines/types.js';
import { renderVerdictHeader } from './verdict.js';
import type { VerdictHeaderContext } from './verdict.js';
import {
  buildScenarioEvidence,
  selectTrialsNeedingInvestigation,
  DEFAULT_EVIDENCE_CAPS,
} from './evidence.js';
import type { EvidenceCaps, ScenarioEvidence } from './evidence.js';
import {
  collectGitContext,
  renderGitContextMarkdown,
  DEFAULT_GIT_CONTEXT_CAPS,
} from './git-context.js';
import type { GitContext, GitContextCaps, GitExec } from './git-context.js';
import { formatPass1, formatEstimatorVector } from '../util/pass-at-k.js';

const execFile = promisify(execFileCb);

const LLM_TIMEOUT_MS = 60_000;

/**
 * Bumped whenever SYSTEM_PROMPT or the user-payload structure changes, so a
 * regenerated summary records which prompt produced its narrative.
 */
export const PROMPT_VERSION = '3';

export interface NarrativeRenderOptions {
  wallClockMs?: number;
  /** Required: frames the narrative tone (eval run vs. graduation stability check). */
  runMode: 'eval' | 'graduation';
  /** Short git SHA of the current commit; null when not in a git repo. */
  gitSha: string | null;
  /** Git branch name at evaluation time; null when detached HEAD. */
  gitBranch: string | null;
  /**
   * Strong reasoning model for the narrative call. When set, the reporter
   * routes the call through `gocode.withModel(<this>)`; when unset, it reuses
   * the injected client. Threaded from `config.gocode.summaryAnalysisModel`
   * (the reporter never reads `process.env`).
   */
  summaryAnalysisModel?: string;
  /**
   * ISO timestamp recorded in provenance. Threaded from the run's
   * `run-metadata.json` so the verdict header is byte-identical across
   * regenerations; falls back to the current time only when unset.
   */
  generatedAt?: string;
  /** Evidence caps; defaults to {@link DEFAULT_EVIDENCE_CAPS}. */
  evidenceCaps?: EvidenceCaps;
  /** Git-context caps; defaults to {@link DEFAULT_GIT_CONTEXT_CAPS}. */
  gitContextCaps?: GitContextCaps;
}

const SYSTEM_PROMPT = `You are an AI-eval investigator writing the deep-dive section of a run report for \
a software engineering team. A deterministic PASS/WARNING/FAIL verdict has ALREADY been decided by code \
and printed above your output. Do NOT restate, re-derive, or contradict that verdict, and do NOT use the \
words "pass", "warning", "fail", or "verdict" to label the overall run — your job is to explain the \
evidence behind it, not to re-judge it.

Every behavioral claim you make MUST be traceable to the evidence. Cite each scenario's trial path \
ONCE per subsection (e.g. \`scenarios/<name>/trials/<i>/\`), then refer to further trials by index \
("trial 12", "trials 10-19") in prose — do NOT repeat the full path on every reference. Cite an \
evaluator by name and any code correlation by commit SHA. Do not assert tool-call counts, errors, or \
scores that are not present in the evidence below; if the evidence does not support a claim, do not \
make it.

A deterministic per-scenario overview table and TL;DR are ALREADY rendered above your output; do NOT \
reproduce a scenario overview, a results table, or per-evaluator pass-rate counts. Your job is the \
qualitative deep-dive only.

Structure your response as Markdown with exactly these sections:

## Regressing Behaviors
For each non-passing scenario, describe the failure mode using the cited trial evidence (tool calls, \
errors, evaluator reasons). Cite the scenario's trial path once, then reference trials by index.

## Likely Correlated Code Changes
(Include only when git context is provided.) Attribute behaviors to specific commits, citing the commit SHA. State explicitly when no correlation is evident.

## Recommended Actions
Concrete next steps (investigate a specific trial, re-run, inspect a commit, etc.).

Be precise and concise. Interpret the evidence — do not restate raw numbers. Output clean Markdown only.`;

export class NarrativeSummaryReporter {
  constructor(private readonly gocode: IGocodeClient) {}

  /**
   * Renders `summary.md`: a deterministic, code-owned verdict header followed
   * by provenance and — only when at least one trial needs investigation — an
   * LLM narrative over the full cited evidence. The header is always present,
   * even on LLM failure/empty, because the verdict is code-owned not LLM-owned.
   * Never throws.
   */
  async render(
    runId: string,
    results: ScenarioResult[],
    options: NarrativeRenderOptions,
  ): Promise<string> {
    const context: VerdictHeaderContext = buildHeaderContext(runId, options);

    const investigate: boolean = results.some(
      (r) => selectTrialsNeedingInvestigation(r).length > 0,
    );

    if (!investigate) {
      const header: string = renderVerdictHeader(results, options.runMode, context);
      return `${header}\n\n_No trials required investigation; the narrative deep-dive is skipped._`;
    }

    const userContent: string = await this.buildInvestigationPayload(runId, results, options);
    const header: string = renderVerdictHeader(results, options.runMode, context, {
      model: options.summaryAnalysisModel ?? this.gocode.getModel(),
      promptVersion: PROMPT_VERSION,
      payloadSha: sha256(userContent),
    });

    const narrative: string | null = await this.callNarrative(userContent, options);
    if (narrative === null) {
      return `${header}\n\n${buildFallbackNote('LLM narrative unavailable')}`;
    }
    return `${header}\n\n${narrative}`;
  }

  private async buildInvestigationPayload(
    runId: string,
    results: ScenarioResult[],
    options: NarrativeRenderOptions,
  ): Promise<string> {
    const contextPayload: string = buildContextPayload(runId, results, options);
    const caps: EvidenceCaps = options.evidenceCaps ?? DEFAULT_EVIDENCE_CAPS;
    const evidenceSections: string[] = results
      .filter((r) => selectTrialsNeedingInvestigation(r).length > 0)
      .map((r) => renderScenarioEvidence(buildScenarioEvidence(r, caps)));

    const gitSection: string | null = await this.getGitContext(results, options);

    return [contextPayload, ...evidenceSections, gitSection]
      .filter((section): section is string => section !== null)
      .join('\n\n');
  }

  private async callNarrative(
    userContent: string,
    options: NarrativeRenderOptions,
  ): Promise<string | null> {
    const messages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];

    const client: IGocodeClient = options.summaryAnalysisModel
      ? this.gocode.withModel(options.summaryAnalysisModel)
      : this.gocode;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let narrative: string;
    try {
      narrative = await client.complete(messages, {
        signal: controller.signal,
        temperature: 0,
      });
    } catch (err) {
      console.warn(
        '[NarrativeSummaryReporter] Failed to generate narrative summary',
        { error: (err as Error).message, stack: (err as Error).stack },
      );
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!narrative || narrative.trim().length === 0) {
      console.warn('[NarrativeSummaryReporter] LLM returned empty response');
      return null;
    }
    return narrative;
  }

  private async getGitContext(
    results: ScenarioResult[],
    options: NarrativeRenderOptions,
  ): Promise<string | null> {
    if (!options.gitSha) return null;

    const baselineSha: string | null = await this.extractBaselineSha(results);
    if (!baselineSha) return null;

    const exec: GitExec = (args) =>
      execFile('git', [...args], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).then(
        (r) => r.stdout.trim(),
      );

    const caps: GitContextCaps = options.gitContextCaps ?? DEFAULT_GIT_CONTEXT_CAPS;
    const context: GitContext | null = await collectGitContext(
      baselineSha,
      options.gitSha,
      exec,
      caps,
    );
    if (context === null) return null;
    return renderGitContextMarkdown(context);
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

function buildHeaderContext(
  runId: string,
  options: NarrativeRenderOptions,
): VerdictHeaderContext {
  return {
    runId,
    gitSha: options.gitSha,
    gitBranch: options.gitBranch,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
}

function renderScenarioEvidence(evidence: ScenarioEvidence): string {
  const lines: string[] = [`## Evidence: ${evidence.scenarioName}`];
  for (const trial of evidence.trials) {
    lines.push('');
    lines.push(trial.markdown);
  }
  if (evidence.droppedTrialCount > 0) {
    lines.push('');
    lines.push(
      `_(${evidence.droppedTrialCount} additional investigable trial(s) omitted by the per-scenario cap.)_`,
    );
  }
  return lines.join('\n');
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
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
        lines.push(`  Pass@1: ${formatPass1(agg.passAt1, 'N/A')}`);
      } else {
        lines.push(`  Pass@1: ${formatPass1(agg.passAt1, 'N/A')}`);
        lines.push(
          `  Pass@k: ${formatEstimatorVector(agg.passAtK, 'N/A')}`
          + ` | Pass^k: ${formatEstimatorVector(agg.passHatK, 'N/A')}`,
        );
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

/**
 * Note appended below the deterministic verdict header when the LLM narrative
 * could not be produced. The authoritative verdict is already rendered above,
 * so this only explains the missing deep-dive — it never replaces the header.
 */
function buildFallbackNote(reason: string): string {
  return [
    '## Narrative Deep-Dive Unavailable',
    '',
    `Narrative generation failed: ${reason}.`,
    'The verdict above is code-derived and authoritative; see `aggregate-report.md` for full tabular results.',
  ].join('\n');
}
