/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { DESIGN_KIT_BASE_URL } from '@/lib/design-kits'
import { _resetCatalogCacheForTest, useDesignKitCatalog } from './useDesignKitCatalog'

const CATALOG = {
  version: 1,
  kits: [{ slug: 'golden-hour', thumbnail: 'thumbnails/golden-hour-abc.png' }],
}

describe('useDesignKitCatalog', () => {
  beforeEach(() => { _resetCatalogCacheForTest() })
  afterEach(() => { vi.restoreAllMocks() })

  it('does not fetch while disabled', () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    renderHook(() => useDesignKitCatalog(false))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches and normalizes when enabled', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(CATALOG), { status: 200 }),
    )
    const { result } = renderHook(() => useDesignKitCatalog(true))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.kits).toHaveLength(1)
    expect(result.current.kits[0].thumbnailUrl).toBe(`${DESIGN_KIT_BASE_URL}/thumbnails/golden-hour-abc.png`)
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error on non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    const { result } = renderHook(() => useDesignKitCatalog(true))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).not.toBeNull()
    expect(result.current.kits).toEqual([])
  })

  it('caches across hook instances (single fetch, second instance sees data)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(CATALOG), { status: 200 }),
    )
    const a = renderHook(() => useDesignKitCatalog(true))
    await waitFor(() => expect(a.result.current.isLoading).toBe(false))
    const b = renderHook(() => useDesignKitCatalog(true))
    await waitFor(() => expect(b.result.current.kits).toHaveLength(1))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reload() re-fetches after an initial failure', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(CATALOG), { status: 200 }))
    const { result } = renderHook(() => useDesignKitCatalog(true))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    act(() => { result.current.reload() })
    await waitFor(() => expect(result.current.kits).toHaveLength(1))
    expect(result.current.error).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent loads into a single fetch', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    const fetchSpy = vi.spyOn(global, 'fetch').mockReturnValue(
      new Promise<Response>((res) => { resolveFetch = res }),
    )
    const a = renderHook(() => useDesignKitCatalog(true))
    const b = renderHook(() => useDesignKitCatalog(true))
    resolveFetch(new Response(JSON.stringify(CATALOG), { status: 200 }))
    await waitFor(() => expect(a.result.current.kits).toHaveLength(1))
    await waitFor(() => expect(b.result.current.kits).toHaveLength(1))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('surfaces cached kits when enabled flips on after the cache is warm', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(CATALOG), { status: 200 }),
    )
    // Warm the cache via a first enabled instance.
    const warm = renderHook(() => useDesignKitCatalog(true))
    await waitFor(() => expect(warm.result.current.kits).toHaveLength(1))
    // Second instance starts disabled, then enables.
    const { result, rerender } = renderHook(({ enabled }) => useDesignKitCatalog(enabled), {
      initialProps: { enabled: false },
    })
    expect(result.current.kits).toEqual([])
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.kits).toHaveLength(1))
  })
})
