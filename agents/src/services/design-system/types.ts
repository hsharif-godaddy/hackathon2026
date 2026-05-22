import { z } from 'zod'

export const DesignSystemCatalogEntrySchema = z.object({
  slug: z.string().min(1),
  whenToUse: z.string().min(1),
  tags: z.array(z.string()),
  questions: z.array(z.string()),
  tarball: z.string().min(1),
  tarballHash: z.string().regex(/^sha256-[a-f0-9]{12,64}$/i),
})

export const DesignSystemCatalogSchema = z.object({
  version: z.number().int(),
  generatedAt: z.string(),
  kits: z.array(DesignSystemCatalogEntrySchema),
})

export type DesignSystemCatalogEntry = z.infer<typeof DesignSystemCatalogEntrySchema>
export type DesignSystemCatalog = z.infer<typeof DesignSystemCatalogSchema>
