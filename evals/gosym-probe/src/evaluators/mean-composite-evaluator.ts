import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { EvalResult, Evaluator } from './evaluator.js';
import { clamp01 } from './shared.js';
import { scoreToVerdict } from './eval-utils.js';
import { CompositeEvaluatorBase, safeEvaluate, type CompositeBreakdownEntry } from './composite-utils.js';

export type ScoreModeEvaluator = Evaluator & { comparisonMode: 'score' };

export interface MeanCompositeOptions {
  name: string;
  subEvaluators: ScoreModeEvaluator[];
  evalVersion?: string;
}

export class MeanCompositeEvaluator extends CompositeEvaluatorBase implements Evaluator {
  readonly name: string;
  readonly comparisonMode = 'score' as const;
  readonly evalVersion: string;

  protected readonly subEvaluators: ScoreModeEvaluator[];

  constructor(options: MeanCompositeOptions) {
    super(options.subEvaluators);
    for (const sub of options.subEvaluators) {
      const mode: string | undefined = (sub as unknown as Evaluator).comparisonMode;
      if (mode === 'passRate') {
        throw new Error(
          `MeanCompositeEvaluator: sub-evaluator "${sub.name}" has comparisonMode 'passRate'; only 'score' subs are allowed`,
        );
      }
    }
    this.name = options.name;
    this.subEvaluators = options.subEvaluators;
    this.evalVersion =
      options.evalVersion ?? this.deriveEvalVersion(options.subEvaluators);
  }

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const results: EvalResult[] = await Promise.all(
      this.subEvaluators.map((ev) => safeEvaluate(ev, transcript, scenario, snapshot)),
    );

    const breakdown: CompositeBreakdownEntry[] = results.map((r) => ({
      evaluator: r.evaluator,
      score: r.score,
      verdict: r.verdict,
      reason: r.reason,
      evaluatorFailed: r.evaluatorFailed,
      scoreable: r.verdict !== 'incomplete' && Number.isFinite(r.score) && !r.evaluatorFailed,
    }));

    const scoreable: CompositeBreakdownEntry[] = breakdown.filter((e) => e.scoreable);
    const totalCount: number = breakdown.length;
    const scoredCount: number = scoreable.length;
    const anySubFailed: boolean = breakdown.some((e) => e.evaluatorFailed);

    if (scoredCount === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No sub-evaluator produced a scoreable result',
        details: { _composite: 'mean', breakdown, scoredCount, totalCount },
        evalVersion: this.evalVersion,
        evaluatorFailed: anySubFailed || undefined,
      };
    }

    const mean: number = clamp01(
      scoreable.reduce((sum, e) => sum + e.score, 0) / scoredCount,
    );
    const verdict: EvalResult['verdict'] = scoreToVerdict(mean);
    const reason: string = `Mean score ${mean.toFixed(2)} from ${scoredCount}/${totalCount} scoreable subs`;

    return {
      evaluator: this.name,
      score: mean,
      verdict,
      reason,
      details: { _composite: 'mean', breakdown, scoredCount, totalCount },
      evalVersion: this.evalVersion,
      evaluatorFailed: anySubFailed || undefined,
    };
  }

  private deriveEvalVersion(subs: Evaluator[]): string {
    const parts: string[] = subs.map((ev) => `${ev.name}@${ev.evalVersion ?? '0'}`).sort();
    return parts.join(':') || 'derived';
  }
}
