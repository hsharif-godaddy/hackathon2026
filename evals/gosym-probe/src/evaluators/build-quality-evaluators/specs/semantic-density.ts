import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { safeRatio } from '../dom-eval-types.js';

const SEMANTIC_RE = /<(nav|main|section|article|header|footer|aside|figure)\b/gi;

/**
 * Non-empty divs: opening <div> tags that are not immediately empty.
 * Empty divs (<div></div> or <div   ></div>) are excluded because they
 * add no semantic or structural meaning.
 */
const EMPTY_DIV_RE = /<div[^>]*>\s*<\/div>/gi;
const SELF_CLOSING_DIV_RE = /<div[^>]*\/>/gi;
const DIV_OPEN_RE = /<div\b/gi;

function countSemanticElements(html: string): number {
  return (html.match(SEMANTIC_RE) ?? []).length;
}

function countGenericContainers(html: string): number {
  const totalDivs = (html.match(DIV_OPEN_RE) ?? []).length;
  const emptyDivs = (html.match(EMPTY_DIV_RE) ?? []).length;
  const selfClosingDivs = (html.match(SELF_CLOSING_DIV_RE) ?? []).length;
  return Math.max(0, totalDivs - emptyDivs - selfClosingDivs);
}

export const semanticDensitySpec: StructuralEvalSpec = {
  name: 'semantic-density',
  dimension: 'semantic-density',
  description: 'Ratio of semantic HTML5 elements to generic div containers',
  evalVersion: '1.0',

  score(bodyHtml: string): StructuralScoreResult {
    const semantic = countSemanticElements(bodyHtml);
    const generic = countGenericContainers(bodyHtml);
    const total = semantic + generic;

    if (total === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No block-level elements found',
        details: { semantic, generic, total },
      };
    }

    const score = safeRatio(semantic, total);

    return {
      score,
      canScore: true,
      reason: `${semantic} semantic element(s) out of ${total} block containers`,
      details: { semantic, generic, total },
    };
  },
};
