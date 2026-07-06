import { classifyDesignKit, type DesignKitAttribute, type DesignKitTone } from '@/lib/design-kit-metadata'

// Same CDN origin the agents service resolves via BRAND_KIT_BASE_URL
// (agents/src/services/design-system/catalog.ts → resolveDesignSystemBaseUrl).
// Update both in tandem if the catalog origin ever moves.
export const DESIGN_KIT_BASE_URL = 'https://blobby.wsimg.com/brand-kits'

export interface RawDesignKit {
  slug: string
  thumbnail: string
  displayName?: string
  whenToUse?: string
  tags?: string[]
  questions?: string[]
  tarball?: string
  tarballHash?: string
  design?: {
    palette?: {
      background?: string
    }
  }
}

export interface RawDesignKitCatalog {
  version: number
  generatedAt?: string
  kits: RawDesignKit[]
}

export interface DesignKit {
  slug: string
  displayName: string
  whenToUse: string
  tags: string[]
  thumbnailUrl: string
  tone: DesignKitTone
  attributes: DesignKitAttribute[]
}

export function friendlyFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function normalizeCatalog(raw: RawDesignKitCatalog): DesignKit[] {
  return (raw.kits ?? []).map((kit) => {
    const { tone, attributes } = classifyDesignKit({ slug: kit.slug, tags: kit.tags, design: kit.design })
    return {
      slug: kit.slug,
      displayName: kit.displayName ?? friendlyFromSlug(kit.slug),
      whenToUse: kit.whenToUse ?? '',
      tags: kit.tags ?? [],
      thumbnailUrl: `${DESIGN_KIT_BASE_URL}/${kit.thumbnail}`,
      tone,
      attributes,
    }
  })
}
