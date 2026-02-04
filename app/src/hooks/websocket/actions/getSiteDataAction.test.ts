/**
 * Get Site Data Action Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSiteStore } from '@/stores/useSiteStore'
import { getSiteDataAction } from './getSiteDataAction'
import type { MessageContext } from '../handlers/types'

// Mock dependencies
vi.mock('@/stores/useSiteStore', () => ({
  useSiteStore: {
    getState: vi.fn(),
  },
}))

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('getSiteDataAction', () => {
  const mockContext = {} as MessageContext

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw error if appId is missing', async () => {
    await expect(getSiteDataAction({}, mockContext)).rejects.toThrow(
      'appId is required and must be a string'
    )
  })

  it('should throw error if appId is not a string', async () => {
    await expect(getSiteDataAction({ appId: 123 }, mockContext)).rejects.toThrow(
      'appId is required and must be a string'
    )
  })

  it('should throw error if site is not found', async () => {
    const mockGetState = vi.fn(() => ({
      getSite: vi.fn(() => null),
      sites: {},
      loading: {},
      error: null,
      _pendingRequests: {},
      fetchSite: vi.fn(),
      updateSite: vi.fn(),
      clearError: vi.fn(),
      cleanup: vi.fn(),
    }))
    vi.mocked(useSiteStore.getState).mockImplementation(mockGetState as any)

    await expect(getSiteDataAction({ appId: 'test-app' }, mockContext)).rejects.toThrow(
      'Site not found'
    )
  })

  it('should return site data with published URL', async () => {
    const mockSite = {
      id: 'test-app',
      published_url: 'https://example.com',
      domains: [
        {
          id: 1,
          fqdn: 'example.com',
          domainType: 'custom',
        },
      ],
    }

    const mockGetState = vi.fn(() => ({
      getSite: vi.fn(() => mockSite),
      sites: {},
      loading: {},
      error: null,
      _pendingRequests: {},
      fetchSite: vi.fn(),
      updateSite: vi.fn(),
      clearError: vi.fn(),
      cleanup: vi.fn(),
    }))
    vi.mocked(useSiteStore.getState).mockImplementation(mockGetState as any)

    const result = await getSiteDataAction({ appId: 'test-app' }, mockContext)

    expect(result).toEqual({
      publishedUrl: 'https://example.com',
      domains: mockSite.domains,
    })
  })

  it('should return site data without published URL', async () => {
    const mockSite = {
      id: 'test-app',
      published_url: null,
      domains: [],
    }

    const mockGetState = vi.fn(() => ({
      getSite: vi.fn(() => mockSite),
      sites: {},
      loading: {},
      error: null,
      _pendingRequests: {},
      fetchSite: vi.fn(),
      updateSite: vi.fn(),
      clearError: vi.fn(),
      cleanup: vi.fn(),
    }))
    vi.mocked(useSiteStore.getState).mockImplementation(mockGetState as any)

    const result = await getSiteDataAction({ appId: 'test-app' }, mockContext)

    expect(result).toEqual({
      publishedUrl: null,
      domains: [],
    })
  })
})
