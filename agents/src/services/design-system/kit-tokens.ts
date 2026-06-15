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

  // radius: { base, subtle } — base governs surfaces, subtle is the button radius.
  if (a.radius && typeof a.radius === 'object') {
    const r = a.radius as Record<string, unknown>
    if (typeof r.base === 'number') tokens.radiusBase = r.base
    if (typeof r.subtle === 'number') tokens.radiusButton = r.subtle
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
