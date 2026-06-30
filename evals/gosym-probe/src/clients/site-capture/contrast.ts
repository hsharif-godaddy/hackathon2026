/**
 * Pure WCAG contrast math + low-emphasis-token attribution for the AIROBUILD-2976
 * contrast eval. The in-page `getComputedStyle` walk (capture-time) collects raw
 * per-text-node colors; this Node-side module computes ratios + classifies
 * violations so the logic is unit-testable without a browser.
 */

export type Rgb = [number, number, number];

export interface RawTextNode {
  selector: string;
  className: string;
  /** Effective (alpha-composited, opaque) foreground RGB, 0-255. */
  fg: Rgb;
  /** Effective background RGB, 0-255 (walk ancestors past transparent). */
  bg: Rgb;
  fontPx: number;
  bold: boolean;
  /** True when the effective background is a raster image (no parseable color). */
  bgIndeterminate: boolean;
  /**
   * Candidate background colors when the effective background is a CSS gradient
   * (its parsed color stops). Scored against the worst-case (lowest-contrast)
   * stop. Absent for solid backgrounds.
   */
  bgCandidates?: Rgb[];
}

export type TokenGuess = 'muted' | 'tertiary' | 'other' | 'indeterminate-bg';

export interface ContrastViolation {
  selector: string;
  className: string;
  fgColor: string;
  bgColor: string;
  ratio: number;
  fontPx: number;
  bold: boolean;
  isLargeText: boolean;
  requiredRatio: number;
  tokenGuess: TokenGuess;
}

/**
 * Result of a capture-time contrast audit: the violations plus the total number
 * of visible text nodes scanned, so a score of 0 is interpretable ("0 of N
 * failed" vs "nothing was scanned / the audit never ran").
 */
export interface ContrastAuditResult {
  textNodesScanned: number;
  violations: ContrastViolation[];
}

/** sRGB channel (0-255) → linear-light component. */
function linearize(channel: number): number {
  const c: number = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an RGB color (0 = black, 1 = white). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearize(rgb[0]) + 0.7152 * linearize(rgb[1]) + 0.0722 * linearize(rgb[2]);
}

/** WCAG contrast ratio between two colors (1..21), order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la: number = relativeLuminance(a);
  const lb: number = relativeLuminance(b);
  const lighter: number = Math.max(la, lb);
  const darker: number = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG "large text": >=24px, or >=18.66px (14pt) when bold. */
export function isLargeText(fontPx: number, bold: boolean): boolean {
  return fontPx >= 24 || (bold && fontPx >= 18.66);
}

/** Attribute a failing pair to a low-emphasis token from its class/var string. */
export function classifyToken(className: string): 'muted' | 'tertiary' | 'other' {
  if (/muted-foreground/.test(className)) return 'muted';
  if (/tertiary/.test(className)) return 'tertiary';
  return 'other';
}

function rgbString(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/**
 * Compute AA contrast violations from raw text nodes. Determinate nodes are
 * included only when they FAIL the AA threshold; a node over a CSS gradient is
 * scored against its worst-case (lowest-contrast) color stop. Only nodes over a
 * raster image stay `indeterminate-bg` — a coverage caveat the evaluator reports
 * separately, not a pass/fail.
 */
export function computeContrastViolations(nodes: RawTextNode[]): ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  for (const node of nodes) {
    const large: boolean = isLargeText(node.fontPx, node.bold);
    const requiredRatio: number = large ? 3 : 4.5;
    if (node.bgIndeterminate) {
      const ratio: number = contrastRatio(node.fg, node.bg);
      violations.push(buildViolation(node, node.bg, ratio, large, requiredRatio, 'indeterminate-bg'));
      continue;
    }
    // Score against the worst-case background: for a gradient, evaluate every
    // parsed color stop and keep the lowest contrast ratio.
    const candidates: Rgb[] = node.bgCandidates && node.bgCandidates.length > 0 ? node.bgCandidates : [node.bg];
    let worstBg: Rgb = candidates[0]!;
    let worstRatio: number = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const ratio: number = contrastRatio(node.fg, candidate);
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worstBg = candidate;
      }
    }
    if (worstRatio < requiredRatio) {
      violations.push(buildViolation(node, worstBg, worstRatio, large, requiredRatio, classifyToken(node.className)));
    }
  }
  return violations;
}

function buildViolation(
  node: RawTextNode,
  bg: Rgb,
  ratio: number,
  large: boolean,
  requiredRatio: number,
  tokenGuess: TokenGuess,
): ContrastViolation {
  return {
    selector: node.selector,
    className: node.className,
    fgColor: rgbString(node.fg),
    bgColor: rgbString(bg),
    ratio: Math.round(ratio * 100) / 100,
    fontPx: node.fontPx,
    bold: node.bold,
    isLargeText: large,
    requiredRatio,
    tokenGuess,
  };
}
