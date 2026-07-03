import type { EvalResult } from '../evaluators/evaluator.js';
import type { ScenarioResult } from '../runner/types.js';

/** Default evaluator names for the static / narrow-judge pair. */
export const STATIC_EVALUATOR_NAME = 'expected-artifact-match';
export const JUDGE_EVALUATOR_NAME = 'narrow-artifact-judge';

export type DisagreementKind =
  | 'static-fail-judge-pass'
  | 'static-pass-judge-fail';

export interface SignalDisagreement {
  scenario: string;
  trialLabel: string;
  staticVerdict: EvalResult['verdict'];
  judgeVerdict: EvalResult['verdict'];
  kind: DisagreementKind;
  /** What a reviewer should investigate. */
  investigate: string;
}

const INVESTIGATE: Record<DisagreementKind, string> = {
  'static-fail-judge-pass':
    'static test too strict OR a valid-but-different solution the judge accepts',
  'static-pass-judge-fail':
    'static test too lax OR a judge hallucination',
};

/**
 * 'pass' is the only "good" verdict; 'fail' is "not-good". Only called
 * on verdicts that comparable() has already admitted.
 */
function isGood(verdict: EvalResult['verdict']): boolean {
  return verdict === 'pass';
}

/**
 * A verdict carries pass/fail signal (excludes 'incomplete'/'directional').
 * These non-comparable verdicts are filtered here so isGood() and classify()
 * only ever see pass/fail.
 */
export function comparable(verdict: EvalResult['verdict']): boolean {
  return verdict === 'pass' || verdict === 'fail';
}

function classify(
  staticVerdict: EvalResult['verdict'],
  judgeVerdict: EvalResult['verdict'],
): DisagreementKind | null {
  if (!comparable(staticVerdict) || !comparable(judgeVerdict)) return null;
  const staticGood = isGood(staticVerdict);
  const judgeGood = isGood(judgeVerdict);
  if (staticGood === judgeGood) return null;
  return staticGood ? 'static-pass-judge-fail' : 'static-fail-judge-pass';
}

/**
 * Find per-trial disagreements between the static expected-artifact-match
 * verdict and the narrow-artifact-judge verdict. A disagreement is the
 * core review signal: static and judge share the same checklist, so when
 * they diverge something is worth investigating (bad static test, bad
 * judgment, or a genuinely-different-but-valid solution). Agreements and
 * non-comparable verdicts (incomplete/directional/absent) produce no entry.
 */
export function findSignalDisagreements(
  results: ScenarioResult[],
  staticName: string = STATIC_EVALUATOR_NAME,
  judgeName: string = JUDGE_EVALUATOR_NAME,
): SignalDisagreement[] {
  const disagreements: SignalDisagreement[] = [];

  for (const result of results) {
    for (const trial of result.trials) {
      const staticResult = trial.evalResults.find(
        (r) => r.evaluator === staticName,
      );
      const judgeResult = trial.evalResults.find(
        (r) => r.evaluator === judgeName,
      );
      if (!staticResult || !judgeResult) continue;

      const kind = classify(staticResult.verdict, judgeResult.verdict);
      if (!kind) continue;

      disagreements.push({
        scenario: result.scenarioName,
        trialLabel: `T${trial.trialIndex + 1}`,
        staticVerdict: staticResult.verdict,
        judgeVerdict: judgeResult.verdict,
        kind,
        investigate: INVESTIGATE[kind],
      });
    }
  }

  return disagreements;
}
