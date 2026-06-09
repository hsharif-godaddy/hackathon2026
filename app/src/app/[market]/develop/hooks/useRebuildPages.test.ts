import { describe, expect, it } from 'vitest'

import { HOMEPAGE_ALIAS_SLUGS, type PageInfo, unbuiltRebuildPages } from './useRebuildPages'

const page = (slug: string, isBuilt = false): PageInfo => ({
  slug,
  title: slug,
  url: `/${slug}`,
  isBuilt,
})

describe('unbuiltRebuildPages', () => {
  it('keeps unbuilt, non-alias pages', () => {
    const result = unbuiltRebuildPages([page('about'), page('contact')])
    expect(result.map(p => p.slug)).toEqual(['about', 'contact'])
  })

  it('drops built pages', () => {
    const result = unbuiltRebuildPages([page('about', true), page('contact', false)])
    expect(result.map(p => p.slug)).toEqual(['contact'])
  })

  it('drops the home and index homepage aliases', () => {
    const result = unbuiltRebuildPages([page('home'), page('index'), page('about')])
    expect(result.map(p => p.slug)).toEqual(['about'])
  })

  it('returns empty when every unbuilt page is an alias', () => {
    expect(unbuiltRebuildPages([page('home'), page('index')])).toEqual([])
  })

  // The filter is a deliberately narrow, case-sensitive exact-slug heuristic. These
  // near-misses are NOT dropped — pinned so a future "fix" can't silently widen it
  // (broader source-side dedup is tracked in AIROBUILD-2255/2257).
  it('does not drop near-alias variants (case-sensitive, exact-slug only)', () => {
    const slugs = ['home-1', 'index.html', 'Home', 'en/home']
    const result = unbuiltRebuildPages(slugs.map(s => page(s)))
    expect(result.map(p => p.slug)).toEqual(slugs)
  })

  it('exposes the alias set it filters on', () => {
    expect([...HOMEPAGE_ALIAS_SLUGS].sort()).toEqual(['home', 'index'])
  })
})
