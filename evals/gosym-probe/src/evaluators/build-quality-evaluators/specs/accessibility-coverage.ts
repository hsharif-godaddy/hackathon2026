import { escapeRegExp } from '../../shared.js';
import type { StructuralEvalSpec, StructuralScoreResult } from '../dom-eval-types.js';
import { safeRatio } from '../dom-eval-types.js';

interface SubScore {
  score: number;
  canScore: boolean;
}

const IMG_RE = /<img\b([^>]*)>/gi;
const NON_EMPTY_ALT_RE = /\balt\s*=\s*["']([^"']+)["']/i;

function imageAltCoverage(html: string): SubScore {
  const imgs = [...html.matchAll(IMG_RE)];
  if (imgs.length === 0) return { score: 1, canScore: false };
  const withAlt = imgs.filter((m) => NON_EMPTY_ALT_RE.test(m[1])).length;
  return { score: safeRatio(withAlt, imgs.length), canScore: true };
}

const INPUT_RE = /<(input|textarea|select)\b([^>]*)>/gi;
const ARIA_LABEL_RE = /\baria-label\s*=\s*["']([^"']+)["']/i;
const ARIA_LABELLEDBY_RE = /\baria-labelledby\s*=/i;
const ID_RE = /\bid\s*=\s*["']([^"']+)["']/i;
const TYPE_RE = /\btype\s*=\s*["']([^"']*)["']/i;
const NON_LABELABLE = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

function formLabelCoverage(html: string): SubScore {
  const allInputs = [...html.matchAll(INPUT_RE)];

  const inputs = allInputs.filter((m) => {
    if (m[1] !== 'input') return true;
    const typeMatch = TYPE_RE.exec(m[2]);
    if (!typeMatch) return true;
    return !NON_LABELABLE.has(typeMatch[1].toLowerCase());
  });

  if (inputs.length === 0) return { score: 1, canScore: false };

  const withLabel = inputs.filter((m) => {
    const attrs = m[2];
    if (ARIA_LABEL_RE.test(attrs)) return true;
    if (ARIA_LABELLEDBY_RE.test(attrs)) return true;
    const idMatch = ID_RE.exec(attrs);
    if (idMatch) {
      const id = idMatch[1];
      const forAttrRe = new RegExp(`<label\\b[^>]*\\bfor\\s*=\\s*["']${escapeRegExp(id)}["']`, 'i');
      return forAttrRe.test(html);
    }
    return false;
  }).length;

  return { score: safeRatio(withLabel, inputs.length), canScore: true };
}

const INTERACTIVE_RE = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function interactiveAccessibleNames(html: string): SubScore {
  const matches = [...html.matchAll(INTERACTIVE_RE)];
  if (matches.length === 0) return { score: 1, canScore: false };

  const withName = matches.filter(([, , attrs, content]) => {
    if (ARIA_LABEL_RE.test(attrs)) return true;
    // Text content between tags is a valid accessible name
    return content.replace(/<[^>]+>/g, '').trim().length > 0;
  }).length;

  return { score: safeRatio(withName, matches.length), canScore: true };
}

export const accessibilityCoverageSpec: StructuralEvalSpec = {
  name: 'accessibility-coverage',
  dimension: 'accessibility-coverage',
  description: 'Weighted: image alt (0.4) + form label (0.4) + interactive accessible name (0.2)',
  evalVersion: '1.0',

  score(bodyHtml: string): StructuralScoreResult {
    const imgSub = imageAltCoverage(bodyHtml);
    const formSub = formLabelCoverage(bodyHtml);
    const interactiveSub = interactiveAccessibleNames(bodyHtml);

    const weights: Array<[SubScore, number]> = [
      [imgSub, 0.4],
      [formSub, 0.4],
      [interactiveSub, 0.2],
    ];

    const active = weights.filter(([sub]) => sub.canScore);

    if (active.length === 0) {
      return {
        score: 0,
        canScore: false,
        reason: 'No images, form inputs, or interactive elements found',
        details: {
          imageAlt: null,
          formLabel: null,
          interactiveName: null,
        },
      };
    }

    // Re-normalise weights for only the active sub-dimensions
    const totalWeight = active.reduce((sum, [, w]) => sum + w, 0);
    const score = active.reduce(
      (sum, [sub, w]) => sum + sub.score * (w / totalWeight),
      0,
    );

    return {
      score,
      canScore: true,
      reason: `Accessibility weighted score across ${active.length} active sub-dimension(s)`,
      details: {
        imageAlt: imgSub.canScore ? imgSub.score : null,
        formLabel: formSub.canScore ? formSub.score : null,
        interactiveName: interactiveSub.canScore ? interactiveSub.score : null,
      },
    };
  },
};
