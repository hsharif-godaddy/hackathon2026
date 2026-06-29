import type { ChecklistItem } from '../types.js';

/**
 * Shared "the build did not hit a module-not-found error" invariance item.
 * Centralized so the tricky negative-lookahead regex lives in one place
 * (was copy-pasted verbatim across three expectation fixtures).
 *
 * A matcher returning true = the item PASSES. This invariance passes when
 * the bad phrase is ABSENT: the regex matches the whole transcript only if
 * "module not found" / "cannot find module" never appears (negative
 * lookahead). Present → no match → item fails (hard, it's an invariance).
 *
 * Note: the source is the full transcript, which includes assistant
 * narration, so an agent writing the literal spaced phrase in prose would
 * trip it. Realistic narration tends to use the hyphenated form
 * ("module-not-found"), which this pattern does not match.
 */
export const noModuleNotFoundItem: ChecklistItem = {
  id: 'no-module-not-found',
  description: 'the build did not hit a module-not-found error',
  type: 'invariance',
  textMatcher: {
    source: 'transcript',
    pattern: /^(?:(?!module not found|cannot find module).)*$/is,
  },
};
