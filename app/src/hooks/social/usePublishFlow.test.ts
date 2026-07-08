/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useConnectionById, useSiteAssociations } from '@/hooks/useSocial'
import { socialV2Client } from '@/lib/social'
import { SocialPlatform } from '@/types/social'
import { type PendingPublish, PublishFlowState } from '@/types/social-posts'
import { publishToPlatform, storePostResult } from './api'
import { usePublishFlow } from './usePublishFlow'

vi.mock('@/hooks/useSocial', () => ({
  useSiteAssociations: vi.fn(),
  useConnectionById: vi.fn()
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) => {
    if (vars?.platform) return `${key}:${vars.platform}`
    return key
  }
}))

vi.mock('@/lib/social', () => ({
  socialV2Client: {
    getConnectionById: vi.fn()
  }
}))

vi.mock('./api', () => ({
  publishToPlatform: vi.fn(),
  storePostResult: vi.fn()
}))

const mockUseSiteAssociations = vi.mocked(useSiteAssociations)
const mockUseConnectionById = vi.mocked(useConnectionById)
const mockGetConnectionById = vi.mocked(socialV2Client.getConnectionById)
const mockPublishToPlatform = vi.mocked(publishToPlatform)
const mockStorePostResult = vi.mocked(storePostResult)

describe('usePublishFlow', () => {
  const mockCallbacks = {
    onPlatformStatusChange: vi.fn(),
    onPlatformResultChange: vi.fn(),
    onOverallStatusChange: vi.fn()
  }

  const pendingPublish: PendingPublish = {
    platforms: [SocialPlatform.FACEBOOK],
    message: 'Test post',
    imageUrls: [],
    platformData: [{ platform: SocialPlatform.FACEBOOK, message: 'Test post', imageUrls: [] }]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConnectionById.mockReturnValue({
      data: undefined,
      isError: false
    } as any)
    mockGetConnectionById.mockResolvedValue({ id: 'social-default' } as any)
    mockPublishToPlatform.mockResolvedValue({ platformUrl: 'https://example.com/post/1' } as any)
    mockStorePostResult.mockResolvedValue(undefined)
  })

  it('fires error when no associations exist for requested platforms', async () => {
    mockUseSiteAssociations.mockReturnValue({
      data: { associations: [] },
      isLoading: false
    } as any)

    renderHook(() =>
      usePublishFlow('app-1', 'pub-1', pendingPublish, true, mockCallbacks)
    )

    await waitFor(() => {
      expect(mockCallbacks.onOverallStatusChange).toHaveBeenCalledWith(PublishFlowState.Error)
    })

    expect(mockCallbacks.onPlatformStatusChange).toHaveBeenCalledWith('facebook', PublishFlowState.Error)
    expect(mockCallbacks.onPlatformResultChange).toHaveBeenCalledWith('facebook', {
      error: 'builder_social_error_no_connection_found:facebook'
    })
  })

  it('does not fire error when associations loading', () => {
    mockUseSiteAssociations.mockReturnValue({
      data: undefined,
      isLoading: true
    } as any)

    renderHook(() =>
      usePublishFlow('app-1', 'pub-1', pendingPublish, true, mockCallbacks)
    )

    expect(mockCallbacks.onOverallStatusChange).not.toHaveBeenCalled()
    expect(mockCallbacks.onPlatformStatusChange).not.toHaveBeenCalled()
  })

  it('does not fire when not active flow', () => {
    mockUseSiteAssociations.mockReturnValue({
      data: { associations: [] },
      isLoading: false
    } as any)

    renderHook(() =>
      usePublishFlow('app-1', 'pub-1', pendingPublish, false, mockCallbacks)
    )

    expect(mockCallbacks.onOverallStatusChange).not.toHaveBeenCalled()
  })

  it('fires generic error when associations fetch fails', async () => {
    mockUseSiteAssociations.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true
    } as any)

    renderHook(() =>
      usePublishFlow('app-1', 'pub-1', pendingPublish, true, mockCallbacks)
    )

    await waitFor(() => {
      expect(mockCallbacks.onOverallStatusChange).toHaveBeenCalledWith(PublishFlowState.Error)
    })

    expect(mockCallbacks.onPlatformStatusChange).toHaveBeenCalledWith('facebook', PublishFlowState.Error)
    expect(mockCallbacks.onPlatformResultChange).toHaveBeenCalledWith('facebook', {
      error: 'builder_common_unknown_error'
    })
  })

  it('replays terminal snapshot to remounted flow without republishing', async () => {
    const pendingPublishWithId = {
      ...pendingPublish,
      publishId: 'pub-snapshot-replay'
    }

    mockUseSiteAssociations.mockReturnValue({
      data: {
        associations: [
          { id: 'assoc-1', socialId: 'social-1', platform: 'facebook' }
        ]
      },
      isLoading: false,
      isError: false
    } as any)

    mockUseConnectionById.mockReturnValue({
      data: { socialId: 'social-1' },
      isError: false
    } as any)

    mockGetConnectionById.mockResolvedValue({ id: 'social-1' } as any)

    const firstCallbacks = {
      onPlatformStatusChange: vi.fn(),
      onPlatformResultChange: vi.fn(),
      onOverallStatusChange: vi.fn()
    }

    const { unmount } = renderHook(() =>
      usePublishFlow('app-1', 'pub-snapshot-replay', pendingPublishWithId as any, true, firstCallbacks)
    )

    await waitFor(() => {
      expect(firstCallbacks.onOverallStatusChange).toHaveBeenCalledWith(PublishFlowState.Success)
    })

    unmount()

    const remountCallbacks = {
      onPlatformStatusChange: vi.fn(),
      onPlatformResultChange: vi.fn(),
      onOverallStatusChange: vi.fn()
    }

    renderHook(() =>
      usePublishFlow('app-1', 'pub-snapshot-replay', pendingPublishWithId as any, true, remountCallbacks)
    )

    await waitFor(() => {
      expect(remountCallbacks.onOverallStatusChange).toHaveBeenCalledWith(PublishFlowState.Success)
    })

    expect(mockPublishToPlatform).toHaveBeenCalledTimes(1)
  })

  it('replays completion to in-flight remount subscriber without duplicate publish', async () => {
    const pendingPublishWithId = {
      ...pendingPublish,
      publishId: 'pub-inflight-replay'
    }

    mockUseSiteAssociations.mockReturnValue({
      data: {
        associations: [
          { id: 'assoc-2', socialId: 'social-2', platform: 'facebook' }
        ]
      },
      isLoading: false,
      isError: false
    } as any)

    mockUseConnectionById.mockReturnValue({
      data: { socialId: 'social-2' },
      isError: false
    } as any)

    mockGetConnectionById.mockResolvedValue({ id: 'social-2' } as any)

    let resolvePublish: ((value: unknown) => void) | undefined
    mockPublishToPlatform.mockImplementation(() => new Promise((resolve) => {
      resolvePublish = resolve
    }) as any)

    const firstCallbacks = {
      onPlatformStatusChange: vi.fn(),
      onPlatformResultChange: vi.fn(),
      onOverallStatusChange: vi.fn()
    }

    renderHook(() =>
      usePublishFlow('app-1', 'pub-inflight-replay', pendingPublishWithId as any, true, firstCallbacks)
    )

    await waitFor(() => {
      expect(mockPublishToPlatform).toHaveBeenCalledTimes(1)
    })

    const secondCallbacks = {
      onPlatformStatusChange: vi.fn(),
      onPlatformResultChange: vi.fn(),
      onOverallStatusChange: vi.fn()
    }

    renderHook(() =>
      usePublishFlow('app-1', 'pub-inflight-replay', pendingPublishWithId as any, true, secondCallbacks)
    )

    resolvePublish?.({ platformUrl: 'https://example.com/post/2' })

    await waitFor(() => {
      expect(secondCallbacks.onOverallStatusChange).toHaveBeenCalledWith(PublishFlowState.Success)
    })

    expect(mockPublishToPlatform).toHaveBeenCalledTimes(1)
  })
})
