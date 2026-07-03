import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { ContrastViolation, TokenGuess } from '../clients/site-capture/contrast.js';
import type { EvalResult, Evaluator } from './evaluator.js';

const EVAL_VERSION = '1.0.0';

/**
 * Scores a build by its WCAG AA contrast failures from the capture-time audit
 * (`DOMSnapshot.contrastAudit`, AIROBUILD-2976). The headline `score` is the
 * count of text nodes that fail WCAG AA against their actual (determinate)
 * background — "low contrast all over the place" (Joshua's pattern), robust to
 * however the agent names its classes. `indeterminate-bg` (text over
 * images/gradients) is excluded as a caveat, not a failure. Token attribution
 * (`byToken`, `attributable`) stays in `details` as diagnostic colour — the agent
 * often applies the kit's low-emphasis grey via semantic class names (e.g.
 * `meridian-subtitle`), so className attribution under-counts and must NOT gate
 * the score. `textNodesScanned` makes a 0 interpretable ("0 of N failed").
 * Lower is better.
 */
export class ContrastViolationsEvaluator implements Evaluator {
  readonly name = 'contrast-violations';
  readonly evalVersion = EVAL_VERSION;
  readonly comparisonMode = 'score' as const;
  readonly lowerIsBetter = true;

  async evaluate(_transcript: Transcript, _scenario: Scenario, snapshot?: DOMSnapshot): Promise<EvalResult> {
    if (!snapshot) {
      return {
        evaluator: this.name,
        evalVersion: EVAL_VERSION,
        score: 0,
        verdict: 'incomplete',
        reason: 'No DOM snapshot captured; contrast audit could not run.',
      };
    }

    const audit = snapshot.contrastAudit;
    if (!audit) {
      return {
        evaluator: this.name,
        evalVersion: EVAL_VERSION,
        score: 0,
        verdict: 'incomplete',
        reason: 'DOM snapshot captured but the contrast audit did not run (no contrastAudit field).',
      };
    }

    const violations: ContrastViolation[] = audit.violations;
    const textNodesScanned: number = audit.textNodesScanned;
    const determinate: ContrastViolation[] = violations.filter((v) => v.tokenGuess !== 'indeterminate-bg');
    const attributable: ContrastViolation[] = determinate.filter(
      (v) => v.tokenGuess === 'muted' || v.tokenGuess === 'tertiary',
    );
    const indeterminateBg: number = violations.length - determinate.length;
    const worstRatio: number | null = determinate.length
      ? Math.min(...determinate.map((v) => v.ratio))
      : null;
    const score: number = determinate.length;

    const reason: string =
      score === 0
        ? `No WCAG AA contrast failures across ${textNodesScanned} text node(s) scanned (${indeterminateBg} text-over-image case(s) excluded).`
        : `${score} WCAG AA contrast failure(s) across ${textNodesScanned} text node(s); worst ratio ${worstRatio?.toFixed(2)}:1 (${attributable.length} attributable to muted/tertiary, ${indeterminateBg} text-over-image excluded).`;

    return {
      evaluator: this.name,
      evalVersion: EVAL_VERSION,
      score,
      verdict: 'directional',
      reason,
      details: {
        attributable: attributable.length,
        textNodesScanned,
        totalAaViolations: determinate.length,
        indeterminateBg,
        worstRatio,
        byToken: countByToken(determinate),
        // The worst determinate AA failures (by ratio), regardless of token
        // attribution — the actual low-contrast nodes to inspect.
        samples: [...determinate].sort((a, b) => a.ratio - b.ratio).slice(0, 10),
      },
    };
  }
}

function countByToken(violations: ContrastViolation[]): Record<TokenGuess, number> {
  const counts: Record<TokenGuess, number> = { muted: 0, tertiary: 0, other: 0, 'indeterminate-bg': 0 };
  for (const v of violations) counts[v.tokenGuess] += 1;
  return counts;
}
