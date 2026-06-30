import { z } from 'zod'

// Structured design tokens the catalog now surfaces at the top level of each kit
// (https://blobby.wsimg.com/brand-kits/catalog.json). These are the source of
// truth for deterministically applying a kit's colors/fonts in code — see
// apply-kit-design.ts — instead of asking the agent to translate the ui-kit
// markdown (which it ignores in favor of its own domain priors). All fields are
// optional + passthrough so a kit missing/extending the shape is never dropped.
export const DesignKitFontSchema = z.object({
  family: z.string().min(1),
  weights: z.array(z.string()).optional(),
}).passthrough()

export const DesignKitPaletteSchema = z.object({
  background: z.string().optional(),
  foreground: z.string().optional(),
  primary: z.string().optional(),
  secondary: z.string().optional(),
  accent: z.string().optional(),
  muted: z.string().optional(),
  mutedForeground: z.string().optional(),
  border: z.string().optional(),
  tokens: z.record(z.string(), z.string()).optional(),
}).passthrough()

export const DesignKitDesignSchema = z.object({
  palette: DesignKitPaletteSchema.optional(),
  typography: z.object({
    display: DesignKitFontSchema.optional(),
    body: DesignKitFontSchema.optional(),
    mono: DesignKitFontSchema.optional(),
  }).passthrough().optional(),
}).passthrough()

export const DesignSystemCatalogEntrySchema = z.object({
  // `slug` is deprecated in favor of `id` + `displayName`, but still present on
  // every kit and still the lookup key the install tool resolves against.
  slug: z.string().min(1),
  // `id` (per-catalog-entry UUID) is on every kit — required. The stable join key.
  // Required is safe because the catalog is parsed entry-by-entry (see
  // parseCatalog in catalog.ts): a kit missing `id`/`displayName` is dropped from
  // the catalog, not a parse failure that breaks every install.
  id: z.string().min(1),
  // `displayName` is the human-readable label that replaces `slug` — on every kit.
  displayName: z.string().min(1),
  // `kitId` (mosaic source brand-kit UUID) only exists for the named/anchored
  // kits — slug-style kits carry neither it nor an anchorId — so it stays
  // optional. Requiring it would drop every slug-style kit from the catalog.
  kitId: z.string().min(1).optional(),
  whenToUse: z.string().min(1),
  tags: z.array(z.string()),
  questions: z.array(z.string()),
  tarball: z.string().min(1),
  tarballHash: z.string().regex(/^sha256-[a-f0-9]{12,64}$/i),
  // Structured palette + fonts for deterministic apply. Optional: older catalog
  // entries (and slug-style kits) may not carry it; the install still succeeds,
  // it just falls back to the markdown-only flow with no deterministic apply.
  design: DesignKitDesignSchema.optional(),
  // Preview imagery the live catalog surfaces per kit, as paths relative to the
  // brand-kit base URL (e.g. `thumbnails/<id>/<hash>.webp`). The entry schema strips
  // unknown keys, so these must be declared to survive parsing — the vibe picker
  // (AIROBUILD-2854) renders them. Optional: older/slug-style kits may omit them.
  // Resolve to absolute URLs with `resolveDesignSystemAssetUrl` (catalog.ts).
  thumbnail: z.string().min(1).optional(),
  images: z.object({
    thumbnail: z.string().optional(),
    preview: z.string().optional(),
    original: z.string().optional(),
  }).passthrough().optional(),
})

// Type source only — parsing goes through parseCatalog() (catalog.ts), which
// validates entry-by-entry. Do NOT call .parse() on this: the whole-array
// validation is exactly the all-or-nothing failure mode parseCatalog avoids.
export const DesignSystemCatalogSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  kits: z.array(DesignSystemCatalogEntrySchema),
})

// Envelope only — `kits` stays unparsed here so `parseCatalog` (catalog.ts) can
// validate each kit independently and drop a malformed entry instead of failing
// the whole catalog (which would break every design-system install).
export const DesignSystemCatalogEnvelopeSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  kits: z.array(z.unknown()),
})

export type DesignSystemCatalogEntry = z.infer<typeof DesignSystemCatalogEntrySchema>
export type DesignSystemCatalog = z.infer<typeof DesignSystemCatalogSchema>
export type DesignKitDesign = z.infer<typeof DesignKitDesignSchema>
export type DesignKitPalette = z.infer<typeof DesignKitPaletteSchema>
export type DesignKitFont = z.infer<typeof DesignKitFontSchema>
