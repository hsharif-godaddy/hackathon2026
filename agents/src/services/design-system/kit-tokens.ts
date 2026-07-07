import type { BrandKitTokens } from '@airo/shared/brand-data'

/**
 * Parse a kit's `anchor.json` into a compact set of element "shape" tokens that
 * the wizard's step-3 Elements preview can render (radius / flatness / button
 * casing), so the preview reflects the actual chosen kit while the user's live
 * palette + fonts fill the content.
 *
 * Defensive by design — `anchor.json` schemas vary across kits and most specs
 * live in prose, so we only surface the values we can read confidently and
 * return `undefined` when nothing usable is found.
 */
export function extractKitTokens(anchor: unknown): BrandKitTokens | undefined {
  if (!anchor || typeof anchor !== 'object') return undefined
  const a = anchor as Record<string, unknown>
  const tokens: BrandKitTokens = {}

  // radius: { base, pill, button?, ... } — base governs surfaces. The button
  // radius is encoded inconsistently across real anchors (AIROBUILD-2976). Order
  // of preference:
  //   1. `radius.button` — a schema-enforced numeric px (the Mosaic contract; not
  //      shipping yet, but read first so coverage jumps to ~100% once backfilled).
  //   2. best-effort structured `components.buttonPrimary.shape` (resolved against
  //      the radius scale), else prose in the button node under keys
  //      `buttonPrimary`|`button`|`buttons` (see readButtonRadius: px > pill >
  //      sharp > rounded).
  //   3. legacy numeric `radius.subtle` (older/synthetic anchors only).
  // A further `buttons.primary` prose fallback runs later (below) only when none
  // of the above set radiusButton. When no source exists at all, radiusButton is
  // left undefined so the app keeps the template default rather than guessing.
  if (a.radius && typeof a.radius === 'object') {
    const r = a.radius as Record<string, unknown>
    if (typeof r.base === 'number') tokens.radiusBase = r.base
    if (typeof r.button === 'number') {
      tokens.radiusButton = r.button
    } else {
      const fromButton: number | undefined = readButtonRadius(a, r)
      if (fromButton !== undefined) tokens.radiusButton = fromButton
      else if (typeof r.subtle === 'number') tokens.radiusButton = r.subtle
    }
  }

  // shadow.rest === "none" → the kit is flat by default.
  if (a.shadow && typeof a.shadow === 'object') {
    const rest = (a.shadow as Record<string, unknown>).rest
    if (typeof rest === 'string') tokens.flat = /^\s*none\b/i.test(rest)
  }

  // buttons.primary is prose (e.g. "…2px radius. DM Sans 700, UPPERCASE, 0.12em
  // tracking…") — best-effort extraction of casing + tracking + a px radius.
  const buttons = a.buttons
  const primary = buttons && typeof buttons === 'object' ? (buttons as Record<string, unknown>).primary : undefined
  if (typeof primary === 'string') {
    if (/uppercase/i.test(primary)) tokens.uppercase = true
    const track = primary.match(/([\d.]+)\s*em\b/)
    if (track) tokens.tracking = `${track[1]}em`
    if (tokens.radiusButton === undefined) {
      const px = primary.match(/(\d+)\s*px\s*radius/i)
      if (px) tokens.radiusButton = Number(px[1])
    }
  }

  return Object.keys(tokens).length > 0 ? tokens : undefined
}

/** The kit's primary-button spec node, under any of the observed component keys. */
function readButtonNode(a: Record<string, unknown>): unknown {
  const components: unknown = a.components
  if (!components || typeof components !== 'object') return undefined
  const c = components as Record<string, unknown>
  // Anchors name this inconsistently: `buttonPrimary` (Aether), `button` (Pulse),
  // `buttons` (Terra). Some kits carry no button node at all (Obsidian/Aura).
  return c.buttonPrimary ?? c.button ?? c.buttons
}

/**
 * Resolve a kit's button radius from its (inconsistently-shaped) anchor, in
 * precedence order: a structured `components.buttonPrimary.shape`, then prose in
 * the button spec ("pill-shaped", "9999px radius", "sharp", ...). Returns
 * undefined when neither is present so the caller falls through rather than guess.
 */
function readButtonRadius(a: Record<string, unknown>, r: Record<string, unknown>): number | undefined {
  const node: unknown = readButtonNode(a)
  if (node && typeof node === 'object') {
    const shape: unknown = (node as Record<string, unknown>).shape
    if (typeof shape === 'string') {
      const fromShape: number | undefined = resolveButtonRadius(r, shape)
      if (fromShape !== undefined) return fromShape
    }
  }
  const prose: string = typeof node === 'string' ? node : node && typeof node === 'object' ? JSON.stringify(node) : ''
  return radiusFromButtonProse(prose, r)
}

/** Best-effort px radius from a button spec's prose (px > pill > sharp > rounded). */
function radiusFromButtonProse(prose: string, r: Record<string, unknown>): number | undefined {
  if (!prose) return undefined
  const s: string = prose.toLowerCase()
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const px: RegExpMatchArray | null = s.match(/(\d{1,4})\s*px\s*radius/) ?? s.match(/radius[:\s]+(\d{1,4})\s*px/)
  if (px) return Number(px[1])
  if (/\bpill\b|pill-shaped|fully[ -]rounded|\b9999\b/.test(s)) return num(r.pill) ?? 9999
  if (/\bsharp\b|\bsquare\b|no radius/.test(s)) return 0
  if (/\brounded\b/.test(s)) return num(r.base)
  return undefined
}

/**
 * Resolve a button SHAPE name to a px radius against the kit's radius scale:
 * `pill` → the scale's pill value (fully rounded); `sharp`/`square` → 0;
 * `rounded` → the base radius; `subtle`/`small` → the small radius. Unknown
 * shapes return undefined so the caller can fall back rather than guess.
 */
function resolveButtonRadius(r: Record<string, unknown>, shape: string): number | undefined {
  const s: string = shape.trim().toLowerCase()
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  if (s === 'pill' || s === 'round' || s === 'fully-rounded') return num(r.pill) ?? 9999
  if (s === 'sharp' || s === 'square' || s === 'none') return 0
  if (s === 'rounded' || s === 'soft') return num(r.base)
  if (s === 'subtle' || s === 'small') return num(r.sm)
  return undefined
}
