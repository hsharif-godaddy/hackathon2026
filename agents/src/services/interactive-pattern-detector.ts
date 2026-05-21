/**
 * Heuristic detector for interactive patterns in scraped page HTML.
 *
 * The PagePromptAgent only sees sanitized text + a screenshot, so structural
 * patterns like carousels and accordions are routinely flattened in the
 * generated prompt. This module surfaces them as explicit signals so the
 * prompt template (and the LLM behind it) can preserve them in the rebuild.
 *
 * Detection is intentionally regex-based and conservative — false negatives
 * are preferred to false positives. A pattern is reported only when a known
 * library marker or aria role is present.
 */

export type InteractivePatternType =
  | 'carousel'
  | 'accordion'
  | 'tabs'
  | 'video-hero'
  | 'lightbox'
  | 'modal';

export interface InteractivePattern {
  type: InteractivePatternType;
  /** First matching token from the HTML — useful for the LLM to ground in source. */
  evidence: string;
  /** How many distinct matches were seen. */
  occurrences: number;
}

interface PatternRule {
  type: InteractivePatternType;
  /** All regexes are tested; the first match's captured/raw token becomes evidence. */
  patterns: RegExp[];
}

const RULES: PatternRule[] = [
  {
    type: 'carousel',
    patterns: [
      // Generic JS carousel libraries
      /\bclass="[^"]*\b(swiper(?:-container|-wrapper)?|slick-(?:slider|carousel|track)|owl-carousel|glide__|splide__|flickity|keen-slider|tns-(?:slider|inner)|carousel|slider)\b[^"]*"/gi,
      /\bdata-(?:swiper|slick|glide|splide|carousel|slider)\b[^=>\s]*/gi,
      // Web-component element tags
      /<(swiper-container|swiper-slide|wow-slideshow|wix-slideshow)\b/gi,
      // Wix Pro Gallery / slideshow / strip-slideshow (most Wix sites use these for hero carousels)
      /\bclass="[^"]*\bwixui-(?:pro-gallery|gallery|slideshow|strip-slideshow)\b[^"]*"/gi,
      // Squarespace / Webflow / Shopify slideshow blocks
      /\bclass="[^"]*\b(sqs-gallery|sqs-slideshow|w-slider|shopify-section-slideshow|slideshow-component)\b[^"]*"/gi,
    ],
  },
  {
    type: 'accordion',
    patterns: [
      /\bclass="[^"]*\b(accordion|collapsible)\b[^"]*"/gi,
      /<details(?:\s[^>]*)?>/gi,
    ],
  },
  {
    type: 'tabs',
    patterns: [
      /\brole="(?:tab|tablist|tabpanel)"/gi,
      /\bclass="[^"]*\b(nav-tabs|tab-pane|tabs__|tab-content)\b[^"]*"/gi,
    ],
  },
  {
    type: 'video-hero',
    patterns: [
      /\bclass="[^"]*\b(hero[-_]?video|bg-video|video-bg|video-hero)\b[^"]*"/gi,
      /<video(?:\s[^>]*)?\bautoplay\b[^>]*>/gi,
    ],
  },
  {
    type: 'lightbox',
    patterns: [
      /\bclass="[^"]*\b(lightbox|fancybox|glightbox)\b[^"]*"/gi,
      /\bdata-(?:fslightbox|fancybox|lightbox)\b/gi,
    ],
  },
  {
    type: 'modal',
    patterns: [
      /\brole="dialog"/gi,
      /\bclass="[^"]*\bmodal(?:[-_]\w+)?\b[^"]*"/gi,
    ],
  },
];

const MIN_OCCURRENCES: Partial<Record<InteractivePatternType, number>> = {
  modal: 1,
  // Many sites have a single nav-collapse "accordion-ish" block; require ≥2 to count.
  accordion: 2,
};

// Truncate so the evidence we surface to PagePromptAgent (and persist on disk
// per detected pattern) stays compact. Wix/Webflow class attributes can run
// hundreds of characters; the LLM only needs the matched marker as a hint.
const EVIDENCE_MAX_LENGTH = 80;

export function detectInteractivePatterns(html: string | undefined): InteractivePattern[] {
  if (!html) return [];

  const found: InteractivePattern[] = [];

  for (const rule of RULES) {
    let firstEvidence: string | null = null;
    let total = 0;
    for (const pattern of rule.patterns) {
      const matches = html.match(pattern);
      if (!matches) continue;
      total += matches.length;
      if (firstEvidence === null && matches[0]) {
        firstEvidence = matches[0].slice(0, EVIDENCE_MAX_LENGTH);
      }
    }

    const threshold = MIN_OCCURRENCES[rule.type] ?? 1;
    if (firstEvidence && total >= threshold) {
      found.push({ type: rule.type, evidence: firstEvidence, occurrences: total });
    }
  }

  return found;
}
