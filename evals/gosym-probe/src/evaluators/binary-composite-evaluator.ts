import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { EvalResult, Evaluator } from './evaluator.js';
import { CompositeEvaluatorBase, safeEvaluate, type CompositeBreakdownEntry } from './composite-utils.js';
import type { ChecklistItemOutcome } from './checklist-verdict.js';

export type PassRateEvaluator = Evaluator & { comparisonMode: 'passRate' };

export interface BinaryCompositeOptions {
  name: string;
  subEvaluators: PassRateEvaluator[];
  evalVersion?: string;
}

export class BinaryCompositeEvaluator extends CompositeEvaluatorBase implements Evaluator {
  readonly name: string;
  readonly comparisonMode = 'passRate' as const;
  readonly evalVersion: string | undefined;

  protected readonly subEvaluators: PassRateEvaluator[];

  constructor(options: BinaryCompositeOptions) {
    super(options.subEvaluators);
    for (const sub of options.subEvaluators) {
      const mode = (sub as unknown as Evaluator).comparisonMode;
      if (mode === 'score') {
        throw new Error(
          `BinaryCompositeEvaluator: sub-evaluator "${sub.name}" has comparisonMode 'score'; only 'passRate' subs are allowed`,
        );
      }
    }
    this.name = options.name;
    this.subEvaluators = options.subEvaluators;
    this.evalVersion = options.evalVersion;
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
      scoreable: this.isScorable(r.verdict),
      evaluatorFailed: r.evaluatorFailed,
    }));

    let passed = 0;
    let failed = 0;
    const hardFailureNames: string[] = [];

    for (const entry of breakdown) {
      switch (entry.verdict) {
        case 'pass':
          passed++;
          break;
        case 'fail':
          failed++;
          hardFailureNames.push(entry.evaluator);
          break;
        case 'directional':
          console.warn(
            `[BinaryCompositeEvaluator] sub "${entry.evaluator}" returned verdict 'directional'; treating as incomplete`,
          );
          break;
        case 'incomplete':
          break;
      }
    }

    const allItems: ChecklistItemOutcome[] = results.flatMap((r) =>
      Array.isArray(r.details?.['items']) ? (r.details['items'] as ChecklistItemOutcome[]) : [],
    );

    const scoredCount: number = passed + failed;
    const totalCount: number = breakdown.length;
    const anySubFailed: boolean = breakdown.some((e) => e.evaluatorFailed);

    if (scoredCount === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No sub-evaluator produced a pass or fail verdict',
        details: {
          _composite: 'binary',
          breakdown,
          scoredCount,
          totalCount,
          hardFailures: [],
          ...(allItems.length > 0 && { items: allItems }),
        },
        evalVersion: this.evalVersion,
        evaluatorFailed: anySubFailed || undefined,
      };
    }

    const score: number = passed / scoredCount;
    const verdict: EvalResult['verdict'] = failed > 0 ? 'fail' : 'pass';
    const reason: string =
      failed > 0
        ? `${failed} sub-evaluator(s) failed: ${hardFailureNames.join(', ')}`
        : `All ${passed} sub-evaluator(s) passed`;

    return {
      evaluator: this.name,
      score,
      verdict,
      reason,
      details: {
        _composite: 'binary',
        breakdown,
        scoredCount,
        totalCount,
        hardFailures: hardFailureNames,
        ...(allItems.length > 0 && { items: allItems }),
      },
      evalVersion: this.evalVersion,
      evaluatorFailed: anySubFailed || undefined,
    };
  }

  private isScorable(verdict: EvalResult['verdict']): boolean {
    return verdict === 'pass' || verdict === 'fail';
  }
}
