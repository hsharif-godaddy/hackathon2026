import { describe, expect, it } from 'vitest'

import { imageMatchesPage, normalisePath } from './imageMatchesPage'

function makeImageAsset(sourcePages: string[]): {
  url: string
  type: string
  sourcePages: string[]
} {
  return { url: 'https://cdn.example.com/img.jpg', type: 'image', sourcePages }
}

describe('normalisePath', () => {
  it('strips trailing slash', () => {
    expect(normalisePath('https://example.com/about/')).toBe('/about')
  })

  it('preserves path without trailing slash', () => {
    expect(normalisePath('https://example.com/about')).toBe('/about')
  })

  it('lowercases the pathname', () => {
    expect(normalisePath('https://example.com/About/Us')).toBe('/about/us')
  })

  it('returns "/" for bare root URL', () => {
    expect(normalisePath('https://example.com/')).toBe('/')
    expect(normalisePath('https://example.com')).toBe('/')
  })

  it('ignores query string', () => {
    expect(normalisePath('https://example.com/about?ref=home')).toBe('/about')
  })

  it('ignores hostname differences', () => {
    // normalisePath only returns the pathname portion; callers must compare two
    // normalised paths for equality rather than comparing full URLs.
    expect(normalisePath('https://www.example.com/about')).toBe('/about')
    expect(normalisePath('https://cdn.example.com/about')).toBe('/about')
  })
})

describe('imageMatchesPage', () => {
  it('matches when asset sourcePages contains the exact page URL', () => {
    const asset = makeImageAsset(['https://example.com/about'])
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(true)
  })

  it('matches when page URL has trailing slash but asset does not', () => {
    const asset = makeImageAsset(['https://example.com/about'])
    expect(imageMatchesPage(asset, 'https://example.com/about/')).toBe(true)
  })

  it('matches when asset URL has trailing slash but page does not', () => {
    const asset = makeImageAsset(['https://example.com/about/'])
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(true)
  })

  it('matches case-insensitively', () => {
    const asset = makeImageAsset(['https://example.com/About'])
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(true)
  })

  it('matches root path with trailing slash in asset', () => {
    const asset = makeImageAsset(['https://example.com/'])
    // Root "/" should match both bare domain and "/" path
    expect(imageMatchesPage(asset, 'https://example.com/')).toBe(true)
  })

  it('matches root path with empty path segment', () => {
    const asset = makeImageAsset(['https://example.com'])
    expect(imageMatchesPage(asset, 'https://example.com/')).toBe(true)
  })

  it('ignores query string in asset sourcePages', () => {
    const asset = makeImageAsset(['https://example.com/about?ref=menu'])
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(true)
  })

  it('ignores query string in page URL', () => {
    const asset = makeImageAsset(['https://example.com/about'])
    expect(imageMatchesPage(asset, 'https://example.com/about?ref=menu')).toBe(true)
  })

  it('ignores hostname / www differences (compares only pathnames)', () => {
    // www.example.com vs example.com — different hostnames but same path
    const asset = makeImageAsset(['https://www.example.com/about'])
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(true)
  })

  it('does not match /about against /services', () => {
    const asset = makeImageAsset(['https://example.com/about'])
    expect(imageMatchesPage(asset, 'https://example.com/services')).toBe(false)
  })

  it('does not match when asset type is not image', () => {
    const asset = { url: 'https://cdn.example.com/font.woff2', type: 'font', sourcePages: ['https://example.com/about'] }
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(false)
  })

  it('does not match when sourcePages is empty', () => {
    const asset = makeImageAsset([])
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(false)
  })

  it('does not match when sourcePages is undefined', () => {
    const asset = { url: 'https://cdn.example.com/img.jpg', type: 'image' }
    expect(imageMatchesPage(asset, 'https://example.com/about')).toBe(false)
  })
})
