import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import { matchItem, resolveSnapshots } from './expected-artifact-match.js';
import type { ChecklistItemOutcome } from './checklist-verdict.js';

/**
 * Score-mode evaluator for a scenario's DIRECTIONAL signals — the
 * "nice to have" expectations that are a matter of degree, not a hard
 * gate.
 *
 * Unlike the binary checklist (capability / invariance), a directional
 * miss must not hard-fail or emit a 'partial' that silently deflates
 * pass@k. Instead this reports the FRACTION of directional items met per
 * trial as a `directional` score in [0, 1], and runs in `comparisonMode:
 * 'score'` (higher is better) so the run-vs-baseline comparison is gated
 * statistically (TOST / Wilson CI) rather than by a per-trial threshold
 * that pretends the signal is binary.
 *
 * Items whose matcher can't be evaluated (missing capture) are excluded
 * from the denominator so absent data never counts as a directional miss.
 * When no directional item is evaluable the verdict is 'incomplete'.
 */
export class DirectionalSignalEvaluator implements Evaluator {
  readonly name = 'directional-signal';
  readonly comparisonMode = 'score' as const;
  /** Higher fraction-met is better; a drop vs baseline is the regression. */
  readonly lowerIsBetter = false;

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const spec = scenario.expectedArtifact;
    const items = spec?.directionalItems ?? [];

    if (items.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No directional items defined',
        ...(spec && { evalVersion: spec.evalVersion }),
      };
    }

    const snapshots = resolveSnapshots(transcript, snapshot);
    const outcomes: ChecklistItemOutcome[] = items.map((item) =>
      matchItem(item, transcript, snapshots),
    );

    const evaluated = outcomes.filter((o) => o.status !== 'incomplete');
    const incompleteCount = outcomes.length - evaluated.length;

    if (evaluated.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No directional item could be evaluated (insufficient data)',
        ...(spec && { evalVersion: spec.evalVersion }),
        details: { items: outcomes, incompleteCount },
      };
    }

    const met = evaluated.filter((o) => o.status === 'pass').length;
    const fractionMet = met / evaluated.length;

    return {
      evaluator: this.name,
      score: fractionMet,
      verdict: 'directional',
      reason: `${met}/${evaluated.length} directional signal(s) met`,
      ...(spec && { evalVersion: spec.evalVersion }),
      details: {
        items: outcomes,
        metCount: met,
        evaluatedCount: evaluated.length,
        incompleteCount,
        fractionMet,
      },
    };
  }
}
