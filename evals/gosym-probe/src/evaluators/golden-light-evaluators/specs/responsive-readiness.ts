import { clamp01 } from '../../shared.js';
import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';

const VIEWPORT_META_RE = /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i;
const RESPONSIVE_CLASS_RE = /class=["'][^"']*\b(?:sm|md|lg|xl|2xl):/;
const FLEX_GRID_RE = /class=["'][^"']*\b(?:flex|grid)\b/;

export const responsiveReadinessSpec: StructuralEvalSpec = {
  name: 'responsive-readiness',
  dimension: 'responsive-readiness',
  description: 'Additive: viewport meta (0.3) + responsive classes (0.4) + flex/grid (0.3)',
  evalVersion: '1.0',
  needsFullDocument: true,

  score(bodyHtml: string): StructuralScoreResult {
    const hasViewport = VIEWPORT_META_RE.test(bodyHtml);
    const hasResponsiveClasses = RESPONSIVE_CLASS_RE.test(bodyHtml);
    const hasFlexGrid = FLEX_GRID_RE.test(bodyHtml);

    const score = clamp01(
      (hasViewport ? 0.3 : 0) +
      (hasResponsiveClasses ? 0.4 : 0) +
      (hasFlexGrid ? 0.3 : 0),
    );

    return {
      score,
      canScore: true,
      reason: [
        hasViewport && 'viewport meta',
        hasResponsiveClasses && 'responsive breakpoint classes',
        hasFlexGrid && 'flex/grid layout',
      ]
        .filter(Boolean)
        .join(', ') || 'No responsive signals detected',
      details: { hasViewport, hasResponsiveClasses, hasFlexGrid },
    };
  },
};
