/**
 * Pure casing/eyebrow heuristics for the AIROBUILD-2976 #2 "all-caps eyebrows
 * that scream AI" eval. The in-page `getComputedStyle` walk (capture-time)
 * collects raw per-text-node casing signals; this Node-side module classifies
 * the gratuitous all-caps eyebrow/label pattern so the logic is unit-testable
 * without a browser (mirrors `contrast.ts`).
 *
 * "Gratuitous all-caps eyebrow" = a small, short, label-like text node rendered
 * ALL-CAPS (via `text-transform: uppercase` or literal multi-word caps source).
 * Large display headings are excluded (a deliberate all-caps hero is not the
 * eyebrow tell), as are single-token acronyms (FAQ, API). The kit scenario pins
 * a kit whose spec is lowercase (Aether), so every such node is a violation; the
 * control scenario measures the non-kit baseline.
 */

export interface RawCasingNode {
  selector: string;
  className: string;
  /** Source text content (trimmed; may be truncated for diagnostics). */
  text: string;
  /** Computed `text-transform` (e.g. 'uppercase', 'none'). */
  textTransform: string;
  /** Computed letter-spacing in px; null when 'normal'/unparseable. */
  letterSpacingPx: number | null;
  fontPx: number;
  bold: boolean;
}

export type CasingTokenGuess = 'eyebrow' | 'label' | 'other';

export interface CasingViolation {
  selector: string;
  className: string;
  text: string;
  textTransform: string;
  /** letter-spacing normalized to em (relative to fontPx); null when unknown. */
  letterSpacingEm: number | null;
  fontPx: number;
  tokenGuess: CasingTokenGuess;
  wideTracking: boolean;
}

/**
 * Result of a capture-time casing audit: the violations plus the total number of
 * visible text nodes scanned, so a score of 0 is interpretable ("0 of N flagged"
 * vs "nothing was scanned / the audit never ran").
 */
export interface CasingAuditResult {
  textNodesScanned: number;
  violations: CasingViolation[];
}

const EYEBROW_CLASS = /eyebrow|kicker|overline/i;
const LABEL_CLASS = /label|badge|chip|pill/i;
/** letter-spacing at/above this many em reads as the wide "tracked" eyebrow tell. */
const WIDE_TRACKING_EM = 0.05;
/** Small enough to be an eyebrow/kicker/label rather than a heading or body. */
const SMALL_FONT_PX = 18;
/** WCAG large-text threshold; a deliberate all-caps display headline is not an eyebrow. */
const HEADLINE_FONT_PX = 24;
const SHORT_WORDS = 5;
const SHORT_CHARS = 40;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** True when the source text is itself all-caps letters (not just punctuation/digits). */
function isLiteralAllCaps(text: string): boolean {
  return /[A-Za-z]/.test(text) && text === text.toUpperCase() && text !== text.toLowerCase();
}

function letterSpacingEm(letterSpacingPx: number | null, fontPx: number): number | null {
  if (letterSpacingPx === null || !(fontPx > 0)) return null;
  return letterSpacingPx / fontPx;
}

export function classifyCasing(node: RawCasingNode): CasingViolation | null {
  const words: number = wordCount(node.text);
  const renderedUppercase: boolean =
    node.textTransform === 'uppercase' || (isLiteralAllCaps(node.text) && words >= 2);
  if (!renderedUppercase) return null;
  if (node.fontPx >= HEADLINE_FONT_PX) return null;

  const eyebrowClass: boolean = EYEBROW_CLASS.test(node.className);
  const labelClass: boolean = LABEL_CLASS.test(node.className);
  const isLabelLike: boolean =
    eyebrowClass || labelClass || (node.fontPx <= SMALL_FONT_PX && words <= SHORT_WORDS && node.text.length <= SHORT_CHARS);
  if (!isLabelLike) return null;

  const em: number | null = letterSpacingEm(node.letterSpacingPx, node.fontPx);
  const wideTracking: boolean = em !== null && em >= WIDE_TRACKING_EM;
  const tokenGuess: CasingTokenGuess = eyebrowClass || wideTracking ? 'eyebrow' : 'label';

  return {
    selector: node.selector,
    className: node.className,
    text: node.text,
    textTransform: node.textTransform,
    letterSpacingEm: em,
    fontPx: node.fontPx,
    tokenGuess,
    wideTracking,
  };
}

export function computeCasingViolations(rawNodes: RawCasingNode[]): CasingAuditResult {
  const violations: CasingViolation[] = [];
  for (const node of rawNodes) {
    const v: CasingViolation | null = classifyCasing(node);
    if (v) violations.push(v);
  }
  return { textNodesScanned: rawNodes.length, violations };
}
