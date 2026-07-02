import { describe, expect, it } from 'vitest'

import { getModeParam } from './mode-param'

describe('getModeParam', () => {
  it('prefers mode over the legacy template param', () => {
    const params: URLSearchParams = new URLSearchParams('mode=logo-designer&template=business-plan')
    expect(getModeParam(params)).toBe('logo-designer')
  })

  it('falls back to the legacy template param when mode is absent', () => {
    const params: URLSearchParams = new URLSearchParams('template=logo-designer')
    expect(getModeParam(params)).toBe('logo-designer')
  })

  it('returns null when neither param is present', () => {
    const params: URLSearchParams = new URLSearchParams('foo=bar')
    expect(getModeParam(params)).toBeNull()
  })
})
