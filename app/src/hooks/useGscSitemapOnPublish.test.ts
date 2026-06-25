/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

import type { GoogleSearchConsoleConnection, SiteAssociation } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

const mockSubmitGscSitemap = vi.hoisted(() => vi.fn())
const mockGetSocialConnections = vi.hoisted(() => vi.fn())
const mockBuildDynamicApiUrl = vi.hoisted(() => vi.fn())
const mockAgentFetch = vi.hoisted(() => vi.fn())
const mockGetSite = vi.hoisted(() => vi.fn())
const mockFetchQuery = vi.hoisted(() => vi.fn())

vi.mock('@/lib/request-context', () => ({ logger: mockLogger }))
vi.mock('@/lib/social-gsc', () => ({ gscClient: { submitGscSitemap: mockSubmitGscSitemap } }))
vi.mock('@/lib/social', () => ({ socialV2Client: { getSocialConnections: mockGetSocialConnections } }))
vi.mock('@/config/dynamic-api', () => ({ buildDynamicApiUrl: mockBuildDynamicApiUrl }))
vi.mock('@/lib/agent-fetch', () => ({ agentFetch: mockAgentFetch }))
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: vi.fn((selector: (state: { getSite: typeof mockGetSite }) => unknown) =>
    selector({ getSite: mockGetSite })
  ),
}))
vi.mock('@/utils/domain', () => ({
  resolveSiteFqdn: vi.fn((site: unknown) => (site ? 'https://example.godaddysites.com' : null)),
}))
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({ fetchQuery: mockFetchQuery }) as unknown as QueryClient,
  }
})

import { useGscSitemapOnPublish } from './useGscSitemapOnPublish'

const APP_ID = 'testapp01'
const SITE_URL = 'https://example.godaddysites.com'
const TOKEN_ID = 'Platform#GOOGLE#TokenType#USER#123'

const GSC_ASSOCIATION: SiteAssociation = {
  id: 'assoc-1',
  appId: APP_ID,
  socialId: 'gsc-social-id',
  platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE,
  createdAt: new Date().toISOString(),
}

const GSC_CONNECTION: GoogleSearchConsoleConnection = {
  socialId: 'gsc-social-id',
  userTokenId: TOKEN_ID,
  platform: SocialPlatformKey.GOOGLE_SEARCH_CONSOLE,
  userId: 'user-1',
}

function dispatchPublishEvent(appId: string): void {
  window.dispatchEvent(new CustomEvent('publish-snapshot-request', { detail: { appId } }))
}

describe('useGscSitemapOnPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSite.mockReturnValue({ id: APP_ID })
    mockBuildDynamicApiUrl.mockResolvedValue('https://agents.local/apps/testapp01/social/associations')
    mockAgentFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ associations: [GSC_ASSOCIATION] }),
    })
    mockFetchQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'site-associations') {
        return Promise.resolve({ associations: [GSC_ASSOCIATION] })
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'social-connections') {
        return Promise.resolve([GSC_CONNECTION])
      }
      return Promise.resolve([])
    })
    mockSubmitGscSitemap.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('submits sitemap when GSC is connected and publish event fires', async () => {
    renderHook(() => useGscSitemapOnPublish(APP_ID, true))

    dispatchPublishEvent(APP_ID)

    await waitFor(() => {
      expect(mockSubmitGscSitemap).toHaveBeenCalledWith(SITE_URL, TOKEN_ID)
    })
    expect(mockLogger.info).toHaveBeenCalledWith('gsc.sitemap-submit.success', { appId: APP_ID, publishedUrl: SITE_URL })
  })

  it('does nothing when disabled', async () => {
    renderHook(() => useGscSitemapOnPublish(APP_ID, false))

    dispatchPublishEvent(APP_ID)

    await vi.waitFor(() => new Promise(r => setTimeout(r, 50)))
    expect(mockSubmitGscSitemap).not.toHaveBeenCalled()
  })

  it('does nothing when appId is null', async () => {
    renderHook(() => useGscSitemapOnPublish(null, true))

    dispatchPublishEvent(APP_ID)

    await vi.waitFor(() => new Promise(r => setTimeout(r, 50)))
    expect(mockSubmitGscSitemap).not.toHaveBeenCalled()
  })

  it('ignores publish events for other appIds', async () => {
    renderHook(() => useGscSitemapOnPublish(APP_ID, true))

    dispatchPublishEvent('other-app-id')

    await vi.waitFor(() => new Promise(r => setTimeout(r, 50)))
    expect(mockSubmitGscSitemap).not.toHaveBeenCalled()
  })

  it('skips sitemap submit when no GSC association exists', async () => {
    mockFetchQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'site-associations') {
        return Promise.resolve({ associations: [] })
      }
      return Promise.resolve([])
    })

    renderHook(() => useGscSitemapOnPublish(APP_ID, true))
    dispatchPublishEvent(APP_ID)

    await vi.waitFor(() => new Promise(r => setTimeout(r, 50)))
    expect(mockSubmitGscSitemap).not.toHaveBeenCalled()
  })

  it('skips sitemap submit when no matching GSC connection is found', async () => {
    mockFetchQuery.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'site-associations') {
        return Promise.resolve({ associations: [GSC_ASSOCIATION] })
      }
      return Promise.resolve([])
    })

    renderHook(() => useGscSitemapOnPublish(APP_ID, true))
    dispatchPublishEvent(APP_ID)

    await vi.waitFor(() => new Promise(r => setTimeout(r, 50)))
    expect(mockSubmitGscSitemap).not.toHaveBeenCalled()
  })

  it('logs a warning when submitGscSitemap throws', async () => {
    mockSubmitGscSitemap.mockRejectedValue(new Error('network error'))

    renderHook(() => useGscSitemapOnPublish(APP_ID, true))
    dispatchPublishEvent(APP_ID)

    await waitFor(() => {
      expect(mockLogger.warn).toHaveBeenCalledWith('gsc.sitemap-submit.error', {
        appId: APP_ID,
        error: 'network error',
      })
    })
  })

  it('removes event listener on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useGscSitemapOnPublish(APP_ID, true))
    expect(addSpy).toHaveBeenCalledWith('publish-snapshot-request', expect.any(Function))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('publish-snapshot-request', expect.any(Function))
  })
})
