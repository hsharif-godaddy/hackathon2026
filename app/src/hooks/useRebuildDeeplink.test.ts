/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const searchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => searchParams.value.get(k) }),
}))

import { useRebuildDeeplink } from './useRebuildDeeplink'

function setParams(qs: string) {
  searchParams.value = new URLSearchParams(qs)
}

describe('useRebuildDeeplink', () => {
  it('returns null when rebuildUrl is absent', () => {
    setParams('')
    expect(renderHook(() => useRebuildDeeplink()).result.current).toBeNull()
  })

  it('normalizes a bare domain to https and returns the config', () => {
    setParams('rebuildUrl=example.com')
    expect(renderHook(() => useRebuildDeeplink()).result.current).toEqual({
      url: 'https://example.com',
      designDirection: undefined,
    })
  })

  it('preserves an explicit https URL', () => {
    setParams('rebuildUrl=https://www.example.com/')
    expect(renderHook(() => useRebuildDeeplink()).result.current?.url).toBe('https://www.example.com/')
  })

  it('returns a valid designDirection and drops an invalid one', () => {
    setParams('rebuildUrl=example.com&designDirection=modernize')
    expect(renderHook(() => useRebuildDeeplink()).result.current?.designDirection).toBe('modernize')
    setParams('rebuildUrl=example.com&designDirection=nonsense')
    expect(renderHook(() => useRebuildDeeplink()).result.current?.designDirection).toBeUndefined()
  })

  it('returns null for a junk rebuildUrl', () => {
    setParams('rebuildUrl=not a domain')
    expect(renderHook(() => useRebuildDeeplink()).result.current).toBeNull()
  })
})
