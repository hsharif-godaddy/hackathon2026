import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { fetchDesignSystemCatalog, resolveDesignSystemAssetUrl } from '../../services/design-system/catalog.js'
import type { DesignSystemCatalogEntry } from '../../services/design-system/types.js'
import { errorFields, logger } from '../../logging/index.js'

/** A single "vibe" option rendered as a preview card by the design-kit selector panel. */
export interface SuggestedDesignKit {
  slug: string
  displayName: string
  thumbnailUrl: string | null
  tags: string[]
  palette: {
    primary?: string
    background?: string
    foreground?: string
    accent?: string
    muted?: string
  }
  displayFont: string | null
}

/** Resolve a catalog entry by id/slug/displayName, case-insensitively (matches installDesignKitForApp). */
function resolveKit(kits: DesignSystemCatalogEntry[], slug: string): DesignSystemCatalogEntry | undefined {
  const needle: string = slug.trim().toLowerCase()
  return (
    kits.find((k: DesignSystemCatalogEntry) => k.id.toLowerCase() === needle) ??
    kits.find((k: DesignSystemCatalogEntry) => k.slug.toLowerCase() === needle) ??
    kits.find((k: DesignSystemCatalogEntry) => k.displayName.toLowerCase() === needle)
  )
}

function toSuggestion(entry: DesignSystemCatalogEntry): SuggestedDesignKit {
  const thumb: string | undefined = entry.thumbnail ?? entry.images?.thumbnail
  const palette: NonNullable<DesignSystemCatalogEntry['design']>['palette'] = entry.design?.palette
  return {
    slug: entry.slug,
    displayName: entry.displayName,
    thumbnailUrl: thumb ? resolveDesignSystemAssetUrl(thumb) : null,
    tags: entry.tags,
    palette: {
      primary: palette?.primary,
      background: palette?.background,
      foreground: palette?.foreground,
      accent: palette?.accent,
      muted: palette?.muted,
    },
    displayFont: entry.design?.typography?.display?.family ?? null,
  }
}

export const suggestDesignKitsAITool: Tool = createTool(
  'Present design-kit "vibe" options to the user as preview cards. Pass the slugs of your top catalog matches, best first — the first 3 are shown. The user picks one or skips (you then auto-pick your top match). After they choose, call installDesignSystem with the chosen slug. The card renders each kit\'s thumbnail and name — do NOT describe the kits in text; STOP after calling this and let the user choose.',
  z.object({
    slugs: z
      .array(z.string().min(1))
      .min(1)
      .max(5)
      .describe('Catalog slugs/ids/displayNames of your top matches, best first; the first 3 are shown to the user.'),
  }),
  async (input) => {
    // Failures THROW (→ tool-error) rather than returning a value. suggestDesignKits is a
    // stopAfterTools tool whose stop condition is hasSuccessfulToolCall — which only fires on
    // a tool-RESULT. A `{ success:false }` value would still stop the turn, and since the row
    // is hidden + the prompt says "no text" + the picker needs kits>0, that leaves a blank,
    // stalled turn. Throwing keeps the loop alive so the agent can retry with valid slugs or
    // proceed without a kit (AIROBUILD-2854).
    let catalog: Awaited<ReturnType<typeof fetchDesignSystemCatalog>>
    try {
      catalog = await fetchDesignSystemCatalog()
    } catch (err) {
      logger.error('tool.suggest_design_kits.catalog_unavailable', { ...errorFields(err) })
      throw new Error('Design system catalog is currently unavailable. Proceed without a kit (standard styling).')
    }

    const seen = new Set<string>()
    const kits: SuggestedDesignKit[] = []
    for (const slug of input.slugs) {
      const entry: DesignSystemCatalogEntry | undefined = resolveKit(catalog.kits, slug)
      if (!entry) {
        logger.warn('tool.suggest_design_kits.slug_not_found', { slug })
        continue
      }
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      kits.push(toSuggestion(entry))
    }
    if (kits.length === 0) {
      throw new Error(
        `None of the requested design kits matched the catalog (${input.slugs.join(', ')}). ` +
          'Re-check the slugs against listDesignSystems and try again, or proceed without a kit.'
      )
    }
    return { success: true, message: `Presenting ${kits.length} design-kit options.`, kits }
  },
)
