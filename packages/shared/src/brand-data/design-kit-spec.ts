import type { BrandKitTokens } from './types.js'

/**
 * Deterministic, per-kit design spec: the declared "ground truth" a design
 * kit provides, assembled from sources that already exist (the catalog's
 * `DesignKitDesign` block + the `BrandKitTokens` parsed from `anchor.json`).
 * Downstream kit-conformance checks read this to decide whether generated markup
 * honours the kit (semantic color tokens, kit radius, kit casing, …).
 *
 * Every field is optional: an absent field means "no signal for this dimension",
 * and the corresponding check must **no-op** rather than guess. This module never
 * fabricates a value the source didn't supply.
 *
 * Lives in `@airo/shared/brand-data` (next to `BrandKitTokens`) so agents, the
 * kit-assembly path, and the offline evals import one copy. It is a pure
 * function of structural inputs and imports nothing from `agents/` — the
 * agents-side caller runs `extractKitTokens(anchor)` and reads the catalog
 * `design` block, then passes the pieces in (dependency-direction-safe).
 */

/** A single font choice, structurally matching the catalog typography entries. */
export interface KitFont {
  family: string
  weights?: string[]
}

/** Typography, structurally matching `DesignKitDesign.typography`. */
export interface KitTypographyInput {
  display?: KitFont
  body?: KitFont
  mono?: KitFont
}

/**
 * Per-role hex palette, structurally matching the catalog's
 * `DesignKitDesign.palette`. Kept as a local structural type on purpose —
 * `@airo/shared` must not import the catalog (agents) types.
 */
export interface KitPaletteInput {
  background?: string
  foreground?: string
  primary?: string
  secondary?: string
  accent?: string
  muted?: string
  mutedForeground?: string
  border?: string
  /** Kit-specific extra CSS tokens (name -> hex). A token sharing a role name
   *  overrides that role's value (the kit's explicit token wins). */
  tokens?: Record<string, string>
}

/** Structural inputs for {@link assembleDesignKitSpec}. */
export interface AssembleDesignKitSpecInput {
  kitId: string
  /** From the catalog `DesignKitDesign.palette`. */
  palette?: KitPaletteInput
  /** From the catalog `DesignKitDesign.typography`. */
  typography?: KitTypographyInput
  /** Already extracted by the agents caller via `extractKitTokens(anchor)`. */
  tokens?: BrandKitTokens
}

export interface DesignKitSpec {
  kitId: string
  /** Flattened name -> hex map (palette roles + the `tokens` extras). */
  palette?: Record<string, string>
  typography?: KitTypographyInput
  radiusBase?: number
  radiusButton?: number
  flat?: boolean
  /**
   * True when the kit sets buttons/labels UPPERCASE. Note the source
   * (`BrandKitTokens.uppercase`) only carries a positive uppercase signal today
   * (~2/28 kits); a "lowercase" intent is not yet representable, so it stays
   * absent until the extractor learns it. Absent => casing check no-ops.
   */
  uppercase?: boolean
  tracking?: string
  /** Allowed semantic color-token names (the keys of {@link palette}). */
  colorTokens?: string[]
  // Deferred dimensions — no source populates these yet. Left unset so the
  // corresponding checks no-op; never guessed.
  spacingScale?: string[]
  logoVariantRule?: string
}

const PALETTE_ROLES = [
  'background',
  'foreground',
  'primary',
  'secondary',
  'accent',
  'muted',
  'mutedForeground',
  'border',
] as const

/** Flatten palette roles + the `tokens` extras into a name->hex map, skipping
 *  absent values. Returns `undefined` when nothing usable is present. */
function flattenPalette(palette: KitPaletteInput | undefined): Record<string, string> | undefined {
  if (!palette) return undefined
  const out: Record<string, string> = {}
  for (const role of PALETTE_ROLES) {
    const value = palette[role]
    if (typeof value === 'string') out[role] = value
  }
  if (palette.tokens) {
    for (const [name, value] of Object.entries(palette.tokens)) {
      if (typeof value === 'string') out[name] = value
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Copy the font entries that actually carry a family. Returns `undefined` when
 *  none do. */
function pickTypography(typography: KitTypographyInput | undefined): KitTypographyInput | undefined {
  if (!typography) return undefined
  const out: KitTypographyInput = {}
  for (const slot of ['display', 'body', 'mono'] as const) {
    const font = typography[slot]
    if (font && typeof font.family === 'string' && font.family.length > 0) {
      out[slot] = font.weights ? { family: font.family, weights: [...font.weights] } : { family: font.family }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Compose the already-extracted structural pieces into a {@link DesignKitSpec}.
 * Pure: does not mutate its inputs, and only emits fields the sources supplied.
 */
export function assembleDesignKitSpec(input: AssembleDesignKitSpecInput): DesignKitSpec {
  const spec: DesignKitSpec = { kitId: input.kitId }

  const palette = flattenPalette(input.palette)
  if (palette) {
    spec.palette = palette
    spec.colorTokens = Object.keys(palette)
  }

  const typography = pickTypography(input.typography)
  if (typography) spec.typography = typography

  const tokens = input.tokens
  if (tokens) {
    if (tokens.radiusBase !== undefined) spec.radiusBase = tokens.radiusBase
    if (tokens.radiusButton !== undefined) spec.radiusButton = tokens.radiusButton
    if (tokens.flat !== undefined) spec.flat = tokens.flat
    if (tokens.uppercase !== undefined) spec.uppercase = tokens.uppercase
    if (tokens.tracking !== undefined) spec.tracking = tokens.tracking
  }

  return spec
}
