import type { ChecklistItemOutcome, PassRateSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { safeRatio } from '../dom-eval-types.js';

const ANCHOR_TAG_RE = /<a\b([^>]*)>/gi;
const HREF_RE = /\bhref\s*=\s*["']([^"']*)["']/i;

type LinkClass = 'valid' | 'anchor' | 'invalid';

function classifyHref(href: string | undefined): LinkClass {
  if (href === undefined) return 'invalid';
  const trimmed = href.trim();
  if (trimmed === '') return 'invalid';
  if (trimmed.startsWith('#')) return 'anchor';
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  ) return 'valid';
  // eslint-disable-next-line no-script-url
  if (trimmed.toLowerCase().startsWith('javascript:')) return 'invalid';
  // mailto:, tel:, relative paths without leading / — treat as valid
  return 'valid';
}

export const linkQualitySpec: PassRateSpec = {
  name: 'link-quality',
  dimension: 'link-quality',
  description: 'Ratio of valid/anchor links to total anchor elements',
  evalVersion: '1.0',
  comparisonMode: 'passRate',

  score(bodyHtml: string): StructuralScoreResult {
    const anchors = [...bodyHtml.matchAll(ANCHOR_TAG_RE)];

    if (anchors.length === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No anchor elements found',
        details: { totalLinks: 0, valid: 0, anchor: 0, invalid: 0 },
      };
    }

    let valid = 0;
    let anchor = 0;
    let invalid = 0;

    for (const [, attrs] of anchors) {
      const hrefMatch = HREF_RE.exec(attrs);
      const classification = classifyHref(hrefMatch?.[1]);
      if (classification === 'valid') valid++;
      else if (classification === 'anchor') anchor++;
      else invalid++;
    }

    const score = safeRatio(valid + anchor, anchors.length);

    return {
      score,
      canScore: true,
      reason: `${valid + anchor} usable link(s) out of ${anchors.length} total`,
      details: { totalLinks: anchors.length, valid, anchor, invalid },
    };
  },

  toChecklistItems(bodyHtml: string): ChecklistItemOutcome[] {
    const anchors = [...bodyHtml.matchAll(ANCHOR_TAG_RE)];
    if (anchors.length === 0) {
      return [{ id: 'broken-links', type: 'invariance', status: 'incomplete', reason: 'No anchor elements found' }];
    }
    let invalid = 0;
    for (const [, attrs] of anchors) {
      const hrefMatch = HREF_RE.exec(attrs);
      if (classifyHref(hrefMatch?.[1]) === 'invalid') invalid++;
    }
    return [{
      id: 'broken-links',
      type: 'invariance',
      status: invalid === 0 ? 'pass' : 'fail',
      reason: invalid === 0
        ? `All ${anchors.length} link(s) are valid`
        : `${invalid} invalid link(s) out of ${anchors.length} total`,
    }];
  },
};
