/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { PublishFlowState } from '@/types/social-posts'
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
  socialV2Client: {}
}))

vi.mock('./api', () => ({
  publishToPlatform: vi.fn(),
  storePostResult: vi.fn()
}))

import { useConnectionById,useSiteAssociations } from '@/hooks/useSocial'

const mockUseSiteAssociations = vi.mocked(useSiteAssociations)
const mockUseConnectionById = vi.mocked(useConnectionById)

describe('usePublishFlow', () => {
  const mockCallbacks = {
    onPlatformStatusChange: vi.fn(),
    onPlatformResultChange: vi.fn(),
    onOverallStatusChange: vi.fn()
  }

  const pendingPublish = {
    platforms: ['facebook' as const],
    message: 'Test post',
    imageUrls: [] as string[],
    platformData: [{ platform: 'facebook' as const, message: 'Test post', imageUrls: [] as string[] }]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConnectionById.mockReturnValue({
      data: undefined,
      isError: false
    } as any)
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
})
