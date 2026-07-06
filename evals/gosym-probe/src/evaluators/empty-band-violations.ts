import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { EmptyBandViolation, EmptyBandKind } from '@airo/shared/brand-data';
import type { EvalResult, Evaluator } from './evaluator.js';

const EVAL_VERSION = '1.0.0';

/**
 * Scores a build by its content-less divider / full-bleed "split" band count from
 * the capture-time empty-band audit (`DOMSnapshot.emptyBandAudit`, AIROBUILD-2976
 * #4 — "empty divider + full-bleed split with no content between"). The headline
 * `score` is the number of band-like elements (a `<section>`, a full-bleed block,
 * or an `<hr>` band) tall enough to read as their own section that wrap NEITHER
 * rendered text NOR foreground media — the hollow-gap pattern Ann flagged.
 * `bandsScanned` makes a 0 interpretable ("0 of N"). Lower is better.
 */
export class EmptyBandViolationsEvaluator implements Evaluator {
  readonly name = 'empty-band-violations';
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
        reason: 'No DOM snapshot captured; empty-band audit could not run.',
      };
    }

    const audit = snapshot.emptyBandAudit;
    if (!audit) {
      return {
        evaluator: this.name,
        evalVersion: EVAL_VERSION,
        score: 0,
        verdict: 'incomplete',
        reason: 'DOM snapshot captured but the empty-band audit did not run (no emptyBandAudit field).',
      };
    }

    const violations: EmptyBandViolation[] = audit.violations;
    const bandsScanned: number = audit.bandsScanned;
    const score: number = violations.length;

    const reason: string =
      score === 0
        ? `No empty divider / full-bleed bands across ${bandsScanned} band(s) scanned.`
        : `${score} content-less band(s) across ${bandsScanned} band(s) scanned.`;

    return {
      evaluator: this.name,
      evalVersion: EVAL_VERSION,
      score,
      verdict: 'directional',
      reason,
      details: {
        bandsScanned,
        totalViolations: score,
        byKind: countByKind(violations),
        samples: violations.slice(0, 10),
      },
    };
  }
}

function countByKind(violations: EmptyBandViolation[]): Record<EmptyBandKind, number> {
  const counts: Record<EmptyBandKind, number> = { 'full-bleed-band': 0, 'empty-section': 0, divider: 0 };
  for (const v of violations) counts[v.kind] += 1;
  return counts;
}
