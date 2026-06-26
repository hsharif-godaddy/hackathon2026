import { describe, expect, it } from 'vitest'

import {
  extractLogosFromToolResult,
  getLogoDisplayUrl,
  getLogoSolidDisplayUrl,
  type LogoSessionLogo,
  mapLogoSessionToLogoData,
} from '../logo-utils'

describe('mapLogoSessionToLogoData', () => {
  it('maps a square-only logo to flat LogoData fields', () => {
    const session: LogoSessionLogo = {
      id: 'logo-1',
      urls: {
        square: {
          transparent: 'https://cdn/sq-t.png',
          solid: 'https://cdn/sq-s.png',
          mockup: 'https://cdn/sq-m.png',
          landscapeMockup: 'https://cdn/sq-lm.png',
        },
      },
    }

    const logo = mapLogoSessionToLogoData(session)

    expect(logo.id).toBe('logo-1')
    expect(logo.transparentUrl).toBe('https://cdn/sq-t.png')
    expect(logo.solidUrl).toBe('https://cdn/sq-s.png')
    expect(logo.mockupUrl).toBe('https://cdn/sq-m.png')
    expect(logo.landscapeMockupUrl).toBe('https://cdn/sq-lm.png')
    expect(logo.horizontalTransparentUrl).toBeUndefined()
    expect(logo.verticalTransparentUrl).toBeUndefined()
  })

  it('maps all three orientations to their prefixed fields', () => {
    const session: LogoSessionLogo = {
      id: 'logo-2',
      urls: {
        square: { transparent: 'https://cdn/sq-t.png', solid: 'https://cdn/sq-s.png' },
        horizontal: { transparent: 'https://cdn/h-t.png', solid: 'https://cdn/h-s.png', mockup: 'https://cdn/h-m.png' },
        vertical: { transparent: 'https://cdn/v-t.png', solid: 'https://cdn/v-s.png' },
      },
    }

    const logo = mapLogoSessionToLogoData(session)

    expect(logo.transparentUrl).toBe('https://cdn/sq-t.png')
    expect(logo.horizontalTransparentUrl).toBe('https://cdn/h-t.png')
    expect(logo.horizontalSolidUrl).toBe('https://cdn/h-s.png')
    expect(logo.horizontalMockupUrl).toBe('https://cdn/h-m.png')
    expect(logo.verticalTransparentUrl).toBe('https://cdn/v-t.png')
    expect(logo.verticalSolidUrl).toBe('https://cdn/v-s.png')
  })

  it('leaves fields undefined for missing orientations and missing variants', () => {
    const session: LogoSessionLogo = {
      id: 'logo-3',
      urls: { horizontal: { transparent: 'https://cdn/h-t.png' } },
    }

    const logo = mapLogoSessionToLogoData(session)

    expect(logo.transparentUrl).toBeUndefined()
    expect(logo.horizontalTransparentUrl).toBe('https://cdn/h-t.png')
    expect(logo.horizontalSolidUrl).toBeUndefined()
    expect(logo.verticalTransparentUrl).toBeUndefined()
  })

  it('handles a logo with no urls at all', () => {
    const logo = mapLogoSessionToLogoData({ id: 'logo-4' })
    expect(logo.id).toBe('logo-4')
    expect(logo.transparentUrl).toBeUndefined()
  })

  it('resolves through the existing display helpers (transparent-first vs solid-first)', () => {
    // Horizontal-only logo: helpers must fall through square to the horizontal fields.
    const logo = mapLogoSessionToLogoData({
      id: 'logo-5',
      urls: { horizontal: { transparent: 'https://cdn/h-t.png', solid: 'https://cdn/h-s.png' } },
    })

    // getLogoDisplayUrl is transparent-first.
    expect(getLogoDisplayUrl(logo)).toBe('https://cdn/h-t.png')
    // getLogoSolidDisplayUrl is solid-first.
    expect(getLogoSolidDisplayUrl(logo)).toBe('https://cdn/h-s.png')
  })
})

describe('extractLogosFromToolResult', () => {
  it('maps the new single nested logo shape (#4513)', () => {
    const result = {
      structuredContent: { logo: { id: 'logo-1', urls: { square: { transparent: 'https://cdn/sq-t.png', solid: 'https://cdn/sq-s.png' } } } },
    }
    const logos = extractLogosFromToolResult(result)
    expect(logos).toHaveLength(1)
    expect(logos[0]!.id).toBe('logo-1')
    expect(logos[0]!.transparentUrl).toBe('https://cdn/sq-t.png')
    expect(logos[0]!.solidUrl).toBe('https://cdn/sq-s.png')
  })

  it('returns the legacy flat structuredContent.logos array as-is', () => {
    const result = { structuredContent: { logos: [{ id: 'a', transparentUrl: 'https://cdn/a.png' }, { id: 'b' }] } }
    const logos = extractLogosFromToolResult(result)
    expect(logos).toHaveLength(2)
    expect(logos[0]!.id).toBe('a')
    expect(logos[1]!.id).toBe('b')
  })

  it('prefers the new single logo over a legacy array when both are present', () => {
    const result = {
      structuredContent: {
        logo: { id: 'new', urls: { square: { transparent: 'https://cdn/new.png' } } },
        logos: [{ id: 'old', transparentUrl: 'https://cdn/old.png' }],
      },
    }
    const logos = extractLogosFromToolResult(result)
    expect(logos).toHaveLength(1)
    expect(logos[0]!.id).toBe('new')
  })

  it('falls back to a direct logos array', () => {
    const logos = extractLogosFromToolResult({ logos: [{ id: 'd', transparentUrl: 'https://cdn/d.png' }] })
    expect(logos).toHaveLength(1)
    expect(logos[0]!.id).toBe('d')
  })

  it('maps MCP content resource items to id/url', () => {
    const result = {
      content: [
        { type: 'resource', resource: { uri: 'https://cdn/r1.png' } },
        { type: 'text', text: 'ignored' },
        { type: 'resource', resource: { uri: 'https://cdn/r2.png' } },
      ],
    }
    const logos = extractLogosFromToolResult(result)
    expect(logos).toHaveLength(2)
    expect(logos[0]).toEqual({ id: 'logo-1', url: 'https://cdn/r1.png' })
    expect(logos[1]).toEqual({ id: 'logo-2', url: 'https://cdn/r2.png' })
  })

  it('returns [] for empty, null, or non-object input', () => {
    expect(extractLogosFromToolResult(null)).toEqual([])
    expect(extractLogosFromToolResult(undefined)).toEqual([])
    expect(extractLogosFromToolResult('a string')).toEqual([])
    expect(extractLogosFromToolResult({})).toEqual([])
    expect(extractLogosFromToolResult({ structuredContent: {} })).toEqual([])
  })
})
