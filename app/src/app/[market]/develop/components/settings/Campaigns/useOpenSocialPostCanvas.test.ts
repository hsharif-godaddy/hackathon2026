/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import Growl from '@ux/growl'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { useOpenSocialPostCanvas } from '@/app/[market]/develop/components/settings/Campaigns/useOpenSocialPostCanvas'
import type { MarketingSocialOrigin } from '@/app/[market]/develop/components/types'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import type { SocialPostData } from '@/types/social-posts'

vi.mock('@ux/growl', () => ({
  default: { addGrowlMessage: vi.fn() },
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(),
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, fallback?: string) => fallback || key,
}))

vi.mock('@/stores/useCommanderStore', () => ({
  useCommanderCanvasTabsEnabled: vi.fn(),
  useCommanderStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({ activeCanvasId: CanvasId.Preview }),
    { getState: vi.fn() },
  ),
}))

const mockOpenCanvas: () => void = vi.fn()
const mockShowMarketingSocialPost: (post: SocialPostData, origin: MarketingSocialOrigin) => void = vi.fn()
const mockOpenMarketingSocialPost: (post: SocialPostData, origin: MarketingSocialOrigin) => void = vi.fn()

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({
      openMarketingSocialPost: mockOpenMarketingSocialPost,
    }),
    {
      getState: () => ({
        showMarketingSocialPost: mockShowMarketingSocialPost,
      }),
    },
  ),
}))

const post: SocialPostData = { id: 'post-1' } as SocialPostData

describe('useOpenSocialPostCanvas', () => {
  beforeEach(function reset() {
    vi.clearAllMocks()
    vi.mocked(useSwitchboard).mockReturnValue(true)
    vi.mocked(useCommanderStore.getState).mockReturnValue({ openCanvas: mockOpenCanvas } as unknown as ReturnType<typeof useCommanderStore.getState>)
  })

  it('opens the canvas for a campaign-sourced post when canvas tabs are enabled', function opensFromCampaign() {
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(true)
    const { result } = renderHook(() => useOpenSocialPostCanvas())

    act(function openFromCampaign() {
      result.current.openFromCampaign(post, 'campaign-1')
    })

    expect(mockOpenCanvas).toHaveBeenCalledWith(CanvasId.SettingsCampaigns)
    expect(mockShowMarketingSocialPost).toHaveBeenCalledWith(post, { source: 'campaign', campaignId: 'campaign-1' })
    expect(mockOpenMarketingSocialPost).not.toHaveBeenCalled()
  })

  it('opens the canvas for a chat-sourced post and records the previous canvas when canvas tabs are enabled', function opensFromChat() {
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(true)
    const { result } = renderHook(() => useOpenSocialPostCanvas())

    act(function openFromChat() {
      result.current.openFromChat(post)
    })

    expect(mockOpenCanvas).toHaveBeenCalledWith(CanvasId.SettingsCampaigns)
    expect(mockShowMarketingSocialPost).toHaveBeenCalledWith(post, { source: 'chat', previousCanvasId: CanvasId.Preview })
    expect(mockOpenMarketingSocialPost).not.toHaveBeenCalled()
  })

  it('falls back to legacy viewMode behavior when canvas tabs are disabled', function legacyWhenDisabled() {
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(false)
    const { result } = renderHook(() => useOpenSocialPostCanvas())

    act(function openFromCampaign() {
      result.current.openFromCampaign(post, 'campaign-1')
    })

    expect(mockOpenCanvas).not.toHaveBeenCalled()
    expect(mockOpenMarketingSocialPost).toHaveBeenCalledWith(post, { source: 'campaign', campaignId: 'campaign-1' })
  })

  it('notifies instead of opening when the feature is disabled', function notifiesWhenDisabled() {
    vi.mocked(useSwitchboard).mockReturnValue(false)
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(true)
    const { result } = renderHook(() => useOpenSocialPostCanvas())

    act(function openFromChat() {
      result.current.openFromChat(post)
    })

    expect(Growl.addGrowlMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'marketing-campaigns-disabled' }))
    expect(mockOpenCanvas).not.toHaveBeenCalled()
    expect(mockOpenMarketingSocialPost).not.toHaveBeenCalled()
  })
})
