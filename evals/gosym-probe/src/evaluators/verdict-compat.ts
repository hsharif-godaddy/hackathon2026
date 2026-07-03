import type { EvalResult } from './evaluator.js';

/**
 * Legacy verdict tokens that may appear in data-at-rest (older run
 * directories re-read on --resume) or free-text LLM output, mapped to
 * the current EvalResult verdict vocabulary. This is a backward-compat
 * boundary only: live judges emit the narrowed JudgeVerdictSchema set
 * ('pass' | 'fail' | 'incomplete') and never go through here.
 */
export const LEGACY_VERDICT_MAP: ReadonlyMap<string, EvalResult['verdict']> = new Map([
  ['partial', 'fail'],
  ['unknown', 'incomplete'],
  ['observed', 'directional'],
]);

export const VALID_VERDICTS: ReadonlySet<EvalResult['verdict']> = new Set<EvalResult['verdict']>([
  'pass',
  'fail',
  'incomplete',
  'directional',
]);

/**
 * Map a raw verdict string to a valid EvalResult verdict. Applies the
 * legacy compat map first, passes through already-valid values, and
 * falls back to 'incomplete' for anything unrecognized.
 */
export function mapLegacyVerdict(raw: string): EvalResult['verdict'] {
  const mapped: EvalResult['verdict'] | undefined = LEGACY_VERDICT_MAP.get(raw);
  if (mapped !== undefined) return mapped;
  if (VALID_VERDICTS.has(raw as EvalResult['verdict'])) return raw as EvalResult['verdict'];
  return 'incomplete';
}
