import { describe, expect, it } from 'vitest'

import {
  classifyAttributes,
  classifyDesignKit,
  classifyTone,
  DESIGN_KIT_CLASSIFICATION_OVERRIDES,
  type DesignKitAttribute,
  filterDesignKits,
  formatAttributes,
} from './design-kit-metadata'
import { type DesignKit, normalizeCatalog, type RawDesignKitCatalog } from './design-kits'

describe('classifyTone', () => {
  it('prefers explicit dark tag', () => {
    expect(classifyTone({ tags: ['dark', 'minimal'] })).toBe('dark')
  })

  it('prefers explicit light tag', () => {
    expect(classifyTone({ tags: ['light', 'noir'] })).toBe('light')
  })

  it('classifies from background luminance', () => {
    expect(classifyTone({ design: { palette: { background: '#ffffff' } } })).toBe('light')
    expect(classifyTone({ design: { palette: { background: '#0f0f10' } } })).toBe('dark')
  })

  it('uses tone keywords when palette is absent', () => {
    expect(classifyTone({ tags: ['moody editorial'] })).toBe('dark')
    expect(classifyTone({ tags: ['bright airy'] })).toBe('light')
  })

  it('defaults to light when ambiguous', () => {
    expect(classifyTone({ tags: ['skincare'] })).toBe('light')
  })
})

describe('classifyAttributes', () => {
  it('assigns multiple attributes from tag keywords', () => {
    expect(classifyAttributes(['luxury', 'editorial', 'warm'])).toEqual(['elegant', 'warm', 'editorial'])
  })

  it('returns empty when no keywords match', () => {
    expect(classifyAttributes(['skincare'])).toEqual([])
  })
})

describe('classifyDesignKit', () => {
  it('combines tone and attributes', () => {
    expect(classifyDesignKit({
      tags: ['luxury', 'editorial', 'dark'],
      design: { palette: { background: '#111111' } },
    })).toEqual({
      tone: 'dark',
      attributes: ['elegant', 'editorial'],
    })
  })

  it('uses curated overrides by slug (case-insensitive)', () => {
    expect(classifyDesignKit({ slug: 'Aether', tags: ['dark', 'noir'] })).toEqual({
      tone: 'light',
      attributes: ['clean', 'professional'],
    })
    expect(classifyDesignKit({ slug: 'velocity', tags: ['bright', 'minimal'] })).toEqual({
      tone: 'dark',
      attributes: ['bold'],
    })
  })
})

describe('DESIGN_KIT_CLASSIFICATION_OVERRIDES', () => {
  it('covers every live catalog kit slug', () => {
    const catalogSlugs = [
      'Aether', 'Alder', 'Ascent', 'Aura', 'Bordeaux', 'Canopy', 'canvas', 'Estelle',
      'Fieldnote', 'Forge', 'Foundry', 'Haven', 'Interlude', 'Linden', 'Meridian',
      'Nexus', 'Nova', 'Obsidian', 'Outland', 'Poise', 'Pulse', 'Reverie', 'Tempo',
      'Terra', 'Vale', 'Velocity', 'Voltage', 'Zest',
    ]
    for (const slug of catalogSlugs) {
      expect(DESIGN_KIT_CLASSIFICATION_OVERRIDES[slug.toLowerCase()], slug).toBeDefined()
    }
    expect(Object.keys(DESIGN_KIT_CLASSIFICATION_OVERRIDES)).toHaveLength(catalogSlugs.length)
  })

  it('assigns expected metadata for representative kits', () => {
    expect(classifyDesignKit({ slug: 'Aura' })).toEqual({
      tone: 'light',
      attributes: ['elegant', 'warm', 'editorial', 'clean'] satisfies DesignKitAttribute[],
    })
    expect(classifyDesignKit({ slug: 'Linden' })).toEqual({
      tone: 'dark',
      attributes: ['editorial'] satisfies DesignKitAttribute[],
    })
    expect(formatAttributes(classifyDesignKit({ slug: 'Nova' }).attributes)).toBe('Bold · Warm · Clean')
  })
})

describe('filterDesignKits', () => {
  const kits: DesignKit[] = [
    {
      slug: 'golden-hour',
      displayName: 'Golden Hour',
      whenToUse: '',
      tags: [],
      thumbnailUrl: 'x',
      tone: 'light',
      attributes: ['elegant', 'warm'],
    },
    {
      slug: 'swiss-noir',
      displayName: 'Swiss Noir',
      whenToUse: '',
      tags: [],
      thumbnailUrl: 'y',
      tone: 'dark',
      attributes: ['clean'],
    },
  ]

  it('filters by tone', () => {
    expect(filterDesignKits(kits, 'dark').map((kit) => kit.slug)).toEqual(['swiss-noir'])
  })

  it('filters by attribute', () => {
    expect(filterDesignKits(kits, 'elegant').map((kit) => kit.slug)).toEqual(['golden-hour'])
  })

  it('returns all kits when filter is null', () => {
    expect(filterDesignKits(kits, null)).toEqual(kits)
  })
})

describe('formatAttributes', () => {
  it('title-cases and joins attributes', () => {
    expect(formatAttributes(['elegant', 'editorial'])).toBe('Elegant · Editorial')
  })
})

describe('normalizeCatalog metadata', () => {
  it('adds tone and attributes during normalization', () => {
    const raw: RawDesignKitCatalog = {
      version: 1,
      kits: [{
        slug: 'golden-hour',
        thumbnail: 'thumbnails/golden-hour.png',
        tags: ['luxury', 'editorial', 'warm'],
        design: { palette: { background: '#f5e6d3' } },
      }],
    }
    const [kit] = normalizeCatalog(raw)
    expect(kit.tone).toBe('light')
    expect(kit.attributes).toEqual(['elegant', 'warm', 'editorial'] satisfies DesignKitAttribute[])
  })

  it('prefers curated overrides for known catalog slugs', () => {
    const raw: RawDesignKitCatalog = {
      version: 1,
      kits: [{
        slug: 'Bordeaux',
        thumbnail: 'thumbnails/bordeaux.png',
        tags: ['bright', 'minimal', 'light'],
        design: { palette: { background: '#ffffff' } },
      }],
    }
    const [kit] = normalizeCatalog(raw)
    expect(kit.tone).toBe('dark')
    expect(kit.attributes).toEqual(['bold', 'elegant'] satisfies DesignKitAttribute[])
  })
})
