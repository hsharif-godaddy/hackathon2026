import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { safeRatio } from '../dom-eval-types.js';

/**
 * Matches any opening HTML element tag.
 * Excludes doctype, comments, and closing tags.
 */
const ELEMENT_RE = /<([a-z][a-z0-9-]*)(\s[^>]*)?\s*\/?>/gi;

/** Matches a style attribute value on an element tag. */
const STYLE_ATTR_RE = /\bstyle\s*=\s*["']([^"']*)["']/i;

/**
 * Returns true when every CSS declaration in the style value is
 * a framework-generated variable (--tw-* or var(--font-*)).
 * A mix of framework and authored declarations returns false.
 */
function isFrameworkOnlyStyle(styleValue: string): boolean {
  const declarations = styleValue
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.length > 0);

  if (declarations.length === 0) return true;

  return declarations.every((decl) => {
    const property = decl.split(':')[0]?.trim() ?? '';
    return (
      property.startsWith('--tw-') ||
      decl.includes('var(--font-')
    );
  });
}

export const inlineStyleRatioSpec: StructuralEvalSpec = {
  name: 'inline-style-ratio',
  dimension: 'inline-style-ratio',
  description: 'Fraction of elements without authored inline styles (framework vars excluded)',
  evalVersion: '1.0',

  score(bodyHtml: string): StructuralScoreResult {
    const elements = [...bodyHtml.matchAll(ELEMENT_RE)];
    const totalElements = elements.length;

    if (totalElements === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No elements found',
        details: { totalElements: 0, withAuthoredStyle: 0 },
      };
    }

    const withAuthoredStyle = elements.filter((m) => {
      const attrs = m[2] ?? '';
      const styleMatch = attrs.match(STYLE_ATTR_RE);
      if (!styleMatch) return false;
      return !isFrameworkOnlyStyle(styleMatch[1]);
    }).length;

    const withoutAuthoredStyle = totalElements - withAuthoredStyle;
    const score = safeRatio(withoutAuthoredStyle, totalElements);

    return {
      score,
      canScore: true,
      reason: `${withAuthoredStyle} element(s) with authored inline styles out of ${totalElements}`,
      details: { totalElements, withAuthoredStyle },
    };
  },
};
