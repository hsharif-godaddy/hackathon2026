/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readBuilderLayoutDevOverride } from './builderLayoutDevOverride'

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`)
}

describe('readBuilderLayoutDevOverride', () => {
  beforeEach(() => {
    setUrl('')
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns undefined outside development even with a query param', () => {
    vi.stubEnv('NODE_ENV', 'production')
    setUrl('?builderLayout=immersive')
    expect(readBuilderLayoutDevOverride()).toBeUndefined()
  })

  it('parses ?builderLayout=immersive into an immersive descriptor (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    setUrl('?builderLayout=immersive')
    expect(readBuilderLayoutDevOverride()).toEqual({ version: 1, layout: 'immersive' })
  })

  it('rejects design-kit phase names (brand/website) — those are not layout tokens (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    setUrl('?builderLayout=brand')
    expect(readBuilderLayoutDevOverride()).toBeUndefined()
    setUrl('?builderLayout=website')
    expect(readBuilderLayoutDevOverride()).toBeUndefined()
  })

  it('parses ?builderLayout=commander / default / develop (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    setUrl('?builderLayout=commander')
    expect(readBuilderLayoutDevOverride()).toEqual({ version: 1, layout: 'commander' })
    setUrl('?builderLayout=default')
    expect(readBuilderLayoutDevOverride()).toEqual({ version: 1, layout: 'default' })
    setUrl('?builderLayout=develop')
    expect(readBuilderLayoutDevOverride()).toEqual({ version: 1, layout: 'develop' })
  })

  it('falls back to localStorage when no query param is present (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    localStorage.setItem('builderLayout', 'commander')
    expect(readBuilderLayoutDevOverride()).toEqual({ version: 1, layout: 'commander' })
  })

  it('prefers the query param over localStorage (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    localStorage.setItem('builderLayout', 'commander')
    setUrl('?builderLayout=develop')
    expect(readBuilderLayoutDevOverride()).toEqual({ version: 1, layout: 'develop' })
  })

  it('returns undefined for an unknown override value (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    setUrl('?builderLayout=nonsense')
    expect(readBuilderLayoutDevOverride()).toBeUndefined()
  })

  it('returns undefined when neither source is set (dev)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(readBuilderLayoutDevOverride()).toBeUndefined()
  })
})
