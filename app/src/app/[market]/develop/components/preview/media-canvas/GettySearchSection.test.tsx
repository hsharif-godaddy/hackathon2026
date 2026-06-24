/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'http://localhost:4000/apps/test-app' }),
  },
}))

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: vi.fn(),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

describe('useGettySearch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('initializes with empty results', async () => {
    const { useGettySearch } = await import('./GettySearchSection')
    const { result } = renderHook(() => useGettySearch({ appId: 'test-app' }))

    expect(result.current.results).toEqual([])
    expect(result.current.isSearching).toBe(false)
    expect(result.current.hasSearched).toBe(false)
    expect(result.current.searchQuery).toBe('')
    expect(result.current.formatFilter).toBe('all')
  })

  it('accepts initialQuery and defaultFormat', async () => {
    const { useGettySearch } = await import('./GettySearchSection')
    const { result } = renderHook(() =>
      useGettySearch({ appId: 'test-app', initialQuery: 'sunset', defaultFormat: 'images' })
    )

    expect(result.current.searchQuery).toBe('sunset')
    expect(result.current.formatFilter).toBe('images')
  })

  it('updates searchQuery via setter', async () => {
    const { useGettySearch } = await import('./GettySearchSection')
    const { result } = renderHook(() => useGettySearch({ appId: 'test-app' }))

    act(() => { result.current.setSearchQuery('mountains') })
    expect(result.current.searchQuery).toBe('mountains')
  })

  it('updates formatFilter via setter', async () => {
    const { useGettySearch } = await import('./GettySearchSection')
    const { result } = renderHook(() => useGettySearch({ appId: 'test-app' }))

    act(() => { result.current.setFormatFilter('videos') })
    expect(result.current.formatFilter).toBe('videos')
  })

  it('triggerSearch fetches results', async () => {
    const { agentFetch } = await import('@/lib/agent-fetch')
    const mockAgentFetch = agentFetch as ReturnType<typeof vi.fn>

    const { dynamicApiConfigService } = await import('@/config/dynamic-api')
    ;(dynamicApiConfigService.getConfigForSite as ReturnType<typeof vi.fn>).mockResolvedValue({ agentUrl: 'http://localhost:4000/apps/test-app' })

    mockAgentFetch.mockImplementation((url: string) => {
      if (url.includes('/search?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ images: ['img1.jpg', 'img2.jpg'], gettyIds: ['g1', 'g2'] }),
        })
      }
      if (url.includes('/video-search?')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ thumbnails: ['thumb1.jpg'], videos: ['vid1.mp4'] }),
        })
      }
      return Promise.resolve({ ok: false })
    })

    const { useGettySearch } = await import('./GettySearchSection')
    const { result } = renderHook(() => useGettySearch({ appId: 'test-app' }))

    act(() => { result.current.setSearchQuery('nature') })
    await act(async () => { await result.current.triggerSearch() })

    await waitFor(() => expect(result.current.isSearching).toBe(false))
    expect(result.current.hasSearched).toBe(true)
    expect(result.current.results.length).toBeGreaterThan(0)
  })
})
