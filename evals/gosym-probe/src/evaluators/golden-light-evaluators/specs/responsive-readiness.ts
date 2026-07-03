import type { ChecklistItemOutcome, PassRateSpec, StructuralScoreResult } from '../dom-eval-types.js';

const VIEWPORT_META_RE = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;

export const responsiveReadinessSpec: PassRateSpec = {
  name: 'responsive-readiness',
  dimension: 'responsive-readiness',
  description: 'Checks for viewport meta tag (INV)',
  evalVersion: '2.0',
  comparisonMode: 'passRate',
  needsFullDocument: true,

  score(bodyHtml: string): StructuralScoreResult {
    const hasViewport = VIEWPORT_META_RE.test(bodyHtml);
    return {
      score: hasViewport ? 1.0 : 0,
      canScore: true,
      reason: hasViewport ? 'Viewport meta tag present' : 'No viewport meta tag found',
      details: { hasViewport },
    };
  },

  toChecklistItems(bodyHtml: string): ChecklistItemOutcome[] {
    const hasViewport = VIEWPORT_META_RE.test(bodyHtml);
    return [{
      id: 'viewport-meta',
      type: 'invariance',
      status: hasViewport ? 'pass' : 'fail',
      reason: hasViewport ? 'Viewport meta tag present' : 'No viewport meta tag found',
    }];
  },
};
