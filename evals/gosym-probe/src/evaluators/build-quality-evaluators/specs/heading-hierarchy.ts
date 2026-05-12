import { clamp01 } from '../../shared.js';
import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';

const HEADING_RE = /<h([1-6])\b/gi;

function extractHeadingLevels(html: string): number[] {
  return [...html.matchAll(HEADING_RE)].map((m) => parseInt(m[1], 10));
}

/** A violation is a downward skip: the next level is more than 1 step deeper than the previous. */
function countViolations(levels: number[]): number {
  let violations = 0;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) violations++;
  }
  return violations;
}

export const headingHierarchySpec: StructuralEvalSpec = {
  name: 'heading-hierarchy',
  dimension: 'heading-hierarchy',
  description: 'Measures correct heading nesting — penalises level skips (h1→h3, h2→h5, etc.)',
  evalVersion: '1.0',

  score(bodyHtml: string): StructuralScoreResult {
    const sequence = extractHeadingLevels(bodyHtml);

    if (sequence.length === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No headings found',
        details: { totalHeadings: 0, violations: 0, sequence: [] },
      };
    }

    const violations = countViolations(sequence);
    const score = clamp01(1 - violations / sequence.length);

    return {
      score,
      canScore: true,
      reason: violations === 0
        ? 'No heading level violations'
        : `${violations} heading level skip(s) out of ${sequence.length} headings`,
      details: { totalHeadings: sequence.length, violations, sequence },
    };
  },
};
