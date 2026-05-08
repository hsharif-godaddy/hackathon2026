import { toFiniteNumber } from '../util/to-finite-number.js';
import type { EvalResult } from './evaluator.js';

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'pass', 'partial', 'fail', 'unknown', 'observed',
]);

/**
 * Normalizes an EvalResult at the pipeline entry point so
 * all downstream consumers (reporters, store, aggregators)
 * can trust the data shape without per-site guards.
 *
 * - Coerces NaN/Infinity to 0. For pass/fail verdicts, also
 *   clamps to [0, 1]. Observed-verdict scores are left
 *   unbounded (raw measurements like token counts or USD).
 * - Flattens multiline reasons to a single line.
 * - Defaults null/non-string reasons to empty string.
 * - Falls back to 'unknown' for invalid verdicts.
 * - Falls back to 'unknown' for missing evaluator names.
 */
export function normalizeEvalResult(
  raw: EvalResult,
  logger: { warn: (...args: unknown[]) => void } = console,
): EvalResult {
  const finiteScore = toFiniteNumber(raw.score, 0);
  // Observed-verdict evaluators emit raw numeric measurements (e.g. token
  // counts, cost in USD) that legitimately exceed [0, 1]. Skip the clamp but
  // still coerce NaN / Infinity to 0 via toFiniteNumber above.
  const score = raw.verdict === 'observed'
    ? finiteScore
    : Math.min(1, Math.max(0, finiteScore));

  const rawReason: unknown = raw.reason;
  const reason = typeof rawReason === 'string'
    ? rawReason.replace(/[\r\n]+/g, ' ').trim()
    : '';

  const verdictIsValid = VALID_VERDICTS.has(raw.verdict);
  if (!verdictIsValid) {
    logger.warn(
      'normalizeEvalResult: invalid verdict coerced to unknown',
      { received: raw.verdict, evaluator: raw.evaluator },
    );
  }
  const verdict: EvalResult['verdict'] = verdictIsValid
    ? raw.verdict
    : 'unknown';

  const evaluatorIsValid =
    typeof raw.evaluator === 'string' && raw.evaluator !== '';
  if (!evaluatorIsValid) {
    logger.warn(
      'normalizeEvalResult: blank evaluator name coerced to unknown',
      { received: raw.evaluator },
    );
  }
  const evaluator = evaluatorIsValid ? raw.evaluator : 'unknown';

  return {
    evaluator,
    score,
    verdict,
    reason,
    ...(raw.details !== undefined && { details: raw.details }),
  };
}
