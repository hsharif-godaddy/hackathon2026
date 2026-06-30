import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { CasingViolation, CasingTokenGuess } from '../clients/site-capture/casing.js';
import type { EvalResult, Evaluator } from './evaluator.js';

const EVAL_VERSION = '1.0.0';

/**
 * Scores a build by its gratuitous all-caps eyebrow/label count from the
 * capture-time casing audit (`DOMSnapshot.casingAudit`, AIROBUILD-2976 #2 —
 * "all-caps eyebrows that scream AI"). The headline `score` is the number of
 * small, short, label-like text nodes rendered ALL-CAPS — the pattern Joshua
 * flagged — robust to however the agent names its classes (the heuristic falls
 * back to size + length when no eyebrow/label class is present). The kit
 * scenario pins a lowercase-spec kit (Aether), so each such node is a violation
 * against the kit; the control scenario measures the non-kit baseline and guards
 * against a blanket regression in legitimate uppercase use. `textNodesScanned`
 * makes a 0 interpretable ("0 of N"). Lower is better.
 */
export class CasingViolationsEvaluator implements Evaluator {
  readonly name = 'casing-violations';
  readonly evalVersion = EVAL_VERSION;
  readonly regressionMode = 'score' as const;
  readonly lowerIsBetter = true;

  async evaluate(_transcript: Transcript, _scenario: Scenario, snapshot?: DOMSnapshot): Promise<EvalResult> {
    if (!snapshot) {
      return {
        evaluator: this.name,
        evalVersion: EVAL_VERSION,
        score: 0,
        verdict: 'unknown',
        reason: 'No DOM snapshot captured; casing audit could not run.',
      };
    }

    const audit = snapshot.casingAudit;
    if (!audit) {
      return {
        evaluator: this.name,
        evalVersion: EVAL_VERSION,
        score: 0,
        verdict: 'unknown',
        reason: 'DOM snapshot captured but the casing audit did not run (no casingAudit field).',
      };
    }

    const violations: CasingViolation[] = audit.violations;
    const textNodesScanned: number = audit.textNodesScanned;
    const score: number = violations.length;
    const wideTracking: number = violations.filter((v) => v.wideTracking).length;

    const reason: string =
      score === 0
        ? `No gratuitous all-caps eyebrows/labels across ${textNodesScanned} text node(s) scanned.`
        : `${score} all-caps eyebrow/label node(s) across ${textNodesScanned} text node(s) scanned (${wideTracking} wide-tracked).`;

    return {
      evaluator: this.name,
      evalVersion: EVAL_VERSION,
      score,
      verdict: 'observed',
      reason,
      details: {
        textNodesScanned,
        totalViolations: score,
        wideTracking,
        byToken: countByToken(violations),
        samples: violations.slice(0, 10),
      },
    };
  }
}

function countByToken(violations: CasingViolation[]): Record<CasingTokenGuess, number> {
  const counts: Record<CasingTokenGuess, number> = { eyebrow: 0, label: 0, other: 0 };
  for (const v of violations) counts[v.tokenGuess] += 1;
  return counts;
}
