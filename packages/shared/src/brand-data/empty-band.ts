/**
 * Pure empty-band heuristics for the AIROBUILD-2976 #4 "empty divider + full-bleed
 * split with no content between" eval. The in-page DOM walk (capture-time) collects
 * raw per-band signals (tag, full-bleed, height, whether the band wraps rendered
 * text or foreground media, whether it carries an `<hr>` divider); this Node-side
 * module classifies the hollow-band pattern so the logic is unit-testable without a
 * browser (mirrors `casing.ts` / `contrast.ts`).
 *
 * "Empty band" = a section / full-bleed / divider band tall enough to read as its
 * own section that wraps NEITHER rendered text NOR foreground media (img/video/svg/
 * picture/canvas). A background gradient or background-image alone does NOT count as
 * content — that is exactly the hollow full-bleed-band tell. A thin `<hr>` between
 * two populated sections is not a band (its height is below the threshold) and is
 * never flagged.
 */

export interface RawBandNode {
  selector: string;
  className: string;
  /** Lowercased tag name of the band element (e.g. 'section', 'div', 'hr'). */
  tag: string;
  /** True when the element spans (approximately) the full viewport width. */
  fullBleed: boolean;
  /** Rendered height in px. */
  heightPx: number;
  /** True when a visible descendant carries non-whitespace text. */
  hasText: boolean;
  /** True when the band wraps foreground media (img/video/picture/svg/canvas) with a non-zero box. */
  hasMedia: boolean;
  /** True when the band is, or contains, an `<hr>` divider. */
  hasHr: boolean;
}

export type EmptyBandKind = 'full-bleed-band' | 'empty-section' | 'divider';

export interface EmptyBandViolation {
  selector: string;
  className: string;
  tag: string;
  heightPx: number;
  fullBleed: boolean;
  hasHr: boolean;
  kind: EmptyBandKind;
}

/**
 * Result of a capture-time empty-band audit: the violations plus the total number
 * of band-like elements scanned, so a score of 0 is interpretable ("0 of N flagged"
 * vs "nothing was scanned / the audit never ran").
 */
export interface EmptyBandAuditResult {
  bandsScanned: number;
  violations: EmptyBandViolation[];
}

/**
 * Min rendered height for a content-less element to read as a hollow *band/section*
 * rather than ordinary vertical spacing or a hairline divider. Below this we don't
 * flag — that excludes a normal `<hr>` rule and spacer utilities.
 */
const MIN_BAND_HEIGHT_PX = 64;

export function classifyBand(node: RawBandNode): EmptyBandViolation | null {
  const bandLike: boolean = node.tag === 'section' || node.fullBleed || node.hasHr;
  if (!bandLike) return null;
  if (node.heightPx < MIN_BAND_HEIGHT_PX) return null;
  if (node.hasText || node.hasMedia) return null;

  const kind: EmptyBandKind =
    node.hasHr && !node.fullBleed
      ? 'divider'
      : node.fullBleed
        ? 'full-bleed-band'
        : 'empty-section';

  return {
    selector: node.selector,
    className: node.className,
    tag: node.tag,
    heightPx: node.heightPx,
    fullBleed: node.fullBleed,
    hasHr: node.hasHr,
    kind,
  };
}

export function computeEmptyBands(rawBands: RawBandNode[]): EmptyBandAuditResult {
  const violations: EmptyBandViolation[] = [];
  for (const node of rawBands) {
    const v: EmptyBandViolation | null = classifyBand(node);
    if (v) violations.push(v);
  }
  return { bandsScanned: rawBands.length, violations };
}
