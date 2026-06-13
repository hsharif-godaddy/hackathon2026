import { z } from 'zod'

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
