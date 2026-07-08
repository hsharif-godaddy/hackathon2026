/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import Growl from '@ux/growl'

import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { useOpenMarketingCampaign } from '@/app/[market]/develop/components/settings/Campaigns/useOpenMarketingCampaign'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useCommanderCanvasTabsEnabled, useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'

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
  useCommanderStore: { getState: vi.fn() },
}))

const mockOpenCanvas: () => void = vi.fn()
const mockShowMarketingList: () => void = vi.fn()
const mockShowMarketingDetail: (campaignId: string) => void = vi.fn()
const mockOpenMarketingList: () => void = vi.fn()
const mockOpenMarketingDetail: (campaignId: string) => void = vi.fn()

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({
      openMarketingList: mockOpenMarketingList,
      openMarketingDetail: mockOpenMarketingDetail,
    }),
    {
      getState: () => ({
        showMarketingList: mockShowMarketingList,
        showMarketingDetail: mockShowMarketingDetail,
      }),
    },
  ),
}))

describe('useOpenMarketingCampaign', () => {
  beforeEach(function reset() {
    vi.clearAllMocks()
    vi.mocked(useSwitchboard).mockReturnValue(true)
    vi.mocked(useCommanderStore.getState).mockReturnValue({ openCanvas: mockOpenCanvas } as unknown as ReturnType<typeof useCommanderStore.getState>)
  })

  it('opens the marketing list canvas when canvas tabs are enabled', function opensOnDevelopRoute() {
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(true)
    const { result } = renderHook(() => useOpenMarketingCampaign())

    act(function openList() {
      result.current.openList()
    })

    expect(mockOpenCanvas).toHaveBeenCalledWith(CanvasId.SettingsCampaigns)
    expect(mockShowMarketingList).toHaveBeenCalled()
    expect(mockOpenMarketingList).not.toHaveBeenCalled()
  })

  it('opens the campaign detail canvas when canvas tabs are enabled', function opensDetailOnDevelopRoute() {
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(true)
    const { result } = renderHook(() => useOpenMarketingCampaign())

    act(function openDetail() {
      result.current.openDetail('campaign-1')
    })

    expect(mockOpenCanvas).toHaveBeenCalledWith(CanvasId.SettingsCampaigns)
    expect(mockShowMarketingDetail).toHaveBeenCalledWith('campaign-1')
    expect(mockOpenMarketingDetail).not.toHaveBeenCalled()
  })

  it('falls back to legacy viewMode behavior when canvas tabs are disabled', function legacyWhenDisabled() {
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(false)
    const { result } = renderHook(() => useOpenMarketingCampaign())

    act(function openList() {
      result.current.openList()
    })

    expect(mockOpenCanvas).not.toHaveBeenCalled()
    expect(mockOpenMarketingList).toHaveBeenCalled()
  })

  it('notifies instead of opening when the feature is disabled', function notifiesWhenDisabled() {
    vi.mocked(useSwitchboard).mockReturnValue(false)
    vi.mocked(useCommanderCanvasTabsEnabled).mockReturnValue(true)
    const { result } = renderHook(() => useOpenMarketingCampaign())

    act(function openList() {
      result.current.openList()
    })

    expect(Growl.addGrowlMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'marketing-campaigns-disabled' }))
    expect(mockOpenCanvas).not.toHaveBeenCalled()
    expect(mockOpenMarketingList).not.toHaveBeenCalled()
  })
})
