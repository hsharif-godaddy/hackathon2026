import type { SanitizedLogEntry } from '../../log-sanitizer.js';
import type { AppContext, Classifier, ClassifierResult, ClassifierSource, Issue } from '../types.js';
import type { PatternRule } from './patterns/index.js';

/**
 * Tier 1: regex-based classifier. Pure logic, no I/O.
 *
 * Matches sanitized log lines against a configurable list of PatternRules. Returns handled=true
 * when any rule matches so the orchestrator can skip downstream tiers.
 */
export class PatternClassifier implements Classifier {
  readonly source: ClassifierSource = 'pattern';

  constructor(private readonly patterns: readonly PatternRule[]) {}

  async classify(logs: SanitizedLogEntry[], _context: AppContext): Promise<ClassifierResult> {
    if (logs.length === 0) {
      return { issues: [], handled: false };
    }

    const seenIds = new Set<string>();
    const issues: Issue[] = [];

    for (const entry of logs) {
      for (const rule of this.patterns) {
        const match = entry.message.match(rule.pattern);
        if (!match) continue;

        const suffix = rule.getIdSuffix?.(match);
        const id = suffix ? `${rule.id}:${suffix}` : rule.id;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        issues.push({
          id,
          category: rule.category,
          severity: rule.severity,
          message: entry.message,
          recommendation: rule.getRecommendation(match),
          confidence: rule.confidence,
          source: this.source,
          relatedLogs: [formatLogLine(entry)],
        });
      }
    }

    return { issues, handled: issues.length > 0 };
  }
}

function formatLogLine(entry: SanitizedLogEntry): string {
  return `${entry.timestamp} ${entry.source} ${entry.message}`;
}
