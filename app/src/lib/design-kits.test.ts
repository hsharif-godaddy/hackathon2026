import { describe, expect, it } from 'vitest'

import { DESIGN_KIT_BASE_URL, friendlyFromSlug, normalizeCatalog, type RawDesignKitCatalog } from './design-kits'

describe('friendlyFromSlug', () => {
  it('un-kebabs and title-cases', () => {
    expect(friendlyFromSlug('golden-hour')).toBe('Golden Hour')
    expect(friendlyFromSlug('swiss-gridding-noir')).toBe('Swiss Gridding Noir')
    expect(friendlyFromSlug('floating-minimalism')).toBe('Floating Minimalism')
  })
  it('handles a single token', () => {
    expect(friendlyFromSlug('minimal')).toBe('Minimal')
  })
})

describe('normalizeCatalog', () => {
  const raw: RawDesignKitCatalog = {
    version: 1,
    kits: [
      { slug: 'golden-hour', whenToUse: 'warm', tags: ['warm'], thumbnail: 'thumbnails/golden-hour-abc.png' },
      { slug: 'swiss-gridding-noir', thumbnail: 'thumbnails/swiss-def.png', displayName: 'Swiss Noir' },
    ],
  }

  it('resolves an absolute thumbnail URL', () => {
    expect(normalizeCatalog(raw)[0].thumbnailUrl).toBe(`${DESIGN_KIT_BASE_URL}/thumbnails/golden-hour-abc.png`)
  })
  it('derives displayName from slug when absent', () => {
    expect(normalizeCatalog(raw)[0].displayName).toBe('Golden Hour')
  })
  it('prefers raw.displayName when present', () => {
    expect(normalizeCatalog(raw)[1].displayName).toBe('Swiss Noir')
  })
  it('defaults missing optional fields', () => {
    expect(normalizeCatalog(raw)[1].whenToUse).toBe('')
    expect(normalizeCatalog(raw)[1].tags).toEqual([])
  })
  it('includes tone and attributes from classification', () => {
    const [first] = normalizeCatalog(raw)
    expect(first.tone).toBe('light')
    expect(first.attributes).toContain('warm')
  })
})
