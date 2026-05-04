import type { IssueSeverity } from '../../types.js';

export interface PatternRule {
  id: string;
  category: string;
  severity: IssueSeverity;
  /** Base confidence 0-100 for a pattern-based match. */
  confidence: number;
  pattern: RegExp;
  /** Compute the recommendation string, optionally using regex capture groups. */
  getRecommendation: (match: RegExpMatchArray) => string;
  /** Optional per-match id suffix (e.g. the missing module name) for dedupe + grouping. */
  getIdSuffix?: (match: RegExpMatchArray) => string;
}
