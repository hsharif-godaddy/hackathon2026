import type { AgentClient } from '../clients/agent-client.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { scoreToVerdict } from './eval-utils.js';
import type { EvalResult, Evaluator } from './evaluator.js';
import { clamp01 } from './shared.js';

export interface CompositeBreakdownEntry {
  evaluator: string;
  score: number;
  verdict: EvalResult['verdict'];
  reason: string;
  /** false when verdict is 'unknown' or score is NaN/Infinity */
  scoreable: boolean;
}

export interface CompositeEvaluatorOptions {
  name: string;
  subEvaluators: Evaluator[];
  regressionMode?: 'passRate' | 'score';
  evalVersion?: string;
}

function isScoreable(result: EvalResult): boolean {
  return result.verdict !== 'unknown' && Number.isFinite(result.score);
}

async function safeEvaluate(
  evaluator: Evaluator,
  transcript: Transcript,
  scenario: Scenario,
  snapshot: DOMSnapshot | undefined,
): Promise<EvalResult> {
  try {
    return await evaluator.evaluate(transcript, scenario, snapshot);
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : String(err);
    console.error('[CompositeEvaluator] sub-evaluator error:', evaluator.name, err);
    return {
      evaluator: evaluator.name,
      score: 0,
      verdict: 'unknown',
      reason: `Sub-evaluator threw: ${reason}`,
    };
  }
}

export class CompositeEvaluator implements Evaluator {
  readonly name: string;
  readonly regressionMode: 'passRate' | 'score';
  readonly evalVersion?: string;

  private readonly subEvaluators: Evaluator[];

  constructor(options: CompositeEvaluatorOptions) {
    this.name = options.name;
    this.subEvaluators = options.subEvaluators;
    this.regressionMode = options.regressionMode ?? 'score';
    this.evalVersion = options.evalVersion ?? this.deriveVersion();
  }

  private deriveVersion(): string | undefined {
    const versions = this.subEvaluators
      .map((ev) => `${ev.name}:${ev.evalVersion ?? '0'}`)
      .sort();
    if (versions.length === 0) return undefined;
    return versions.join('+');
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const results = await Promise.all(
      this.subEvaluators.map((ev) =>
        safeEvaluate(ev, transcript, scenario, snapshot),
      ),
    );

    const breakdown: CompositeBreakdownEntry[] = results.map((r) => ({
      evaluator: r.evaluator,
      score: r.score,
      verdict: r.verdict,
      reason: r.reason,
      scoreable: isScoreable(r),
    }));

    const scoreable = results.filter(isScoreable);
    const totalCount = results.length;
    const scoredCount = scoreable.length;

    if (scoredCount === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: `Composite of 0/${totalCount} sub-evaluators (all unknown or errored)`,
        details: {
          _composite: true,
          breakdown,
          scoredCount,
          totalCount,
        },
        ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
      };
    }

    const mean = scoreable.reduce((sum, r) => sum + r.score, 0) / scoredCount;
    const score = clamp01(mean);

    return {
      evaluator: this.name,
      score,
      verdict: scoreToVerdict(score),
      reason: `Composite of ${scoredCount}/${totalCount} sub-evaluators`,
      details: {
        _composite: true,
        breakdown,
        scoredCount,
        totalCount,
      },
      ...(this.evalVersion !== undefined && { evalVersion: this.evalVersion }),
    };
  }

  hookClient(client: AgentClient, trialIndex: number): void {
    for (const ev of this.subEvaluators) {
      ev.hookClient?.(client, trialIndex);
    }
  }

  afterSimulation(trialIndex: number): void {
    for (const ev of this.subEvaluators) {
      ev.afterSimulation?.(trialIndex);
    }
  }

  unhookTrial(trialIndex: number): void {
    for (const ev of this.subEvaluators) {
      ev.unhookTrial?.(trialIndex);
    }
  }
}
