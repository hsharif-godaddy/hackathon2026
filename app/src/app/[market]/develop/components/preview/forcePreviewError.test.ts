import { afterEach, describe, expect, it, vi } from 'vitest'

import { getForcedPreviewError } from './forcePreviewError'

describe('forcePreviewError', function forcePreviewErrorTests() {
  afterEach(function resetLocation() {
    vi.unstubAllGlobals()
  })

  it('returns null outside local dev', function notLocalDev() {
    vi.stubGlobal('window', { location: { hostname: 'airobuilder.godaddy.com' } })

    const params = new URLSearchParams('forcePreviewError=server')
    expect(getForcedPreviewError(params)).toBeNull()
  })

  it('returns server when forcePreviewError=server on local dev', function serverForced() {
    vi.stubGlobal('window', { location: { hostname: 'local.gasket.dev-godaddy.com' } })

    const params = new URLSearchParams('forcePreviewError=server')
    expect(getForcedPreviewError(params)).toBe('server')
  })

  it('returns iframe when forcePreviewError=iframe on local dev', function iframeForced() {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })

    const params = new URLSearchParams('forcePreviewError=iframe')
    expect(getForcedPreviewError(params)).toBe('iframe')
  })

  it('returns null for unknown values', function unknownValue() {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })

    const params = new URLSearchParams('forcePreviewError=crash')
    expect(getForcedPreviewError(params)).toBeNull()
  })

  it('falls back to window.location.search when router params are null', function windowFallback() {
    vi.stubGlobal('window', {
      location: {
        hostname: 'localhost',
        search: '?forcePreviewError=server',
      },
    })

    expect(getForcedPreviewError(null)).toBe('server')
  })
})
