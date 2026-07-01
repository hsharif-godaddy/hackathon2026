/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import { CommanderPosition } from '@/app/[market]/commander/types'
import { useCollapseActionsPanelOnCommanderFloat } from '@/app/[market]/develop/components/chat/useCollapseActionsPanelOnCommanderFloat'

const mockUseCommanderLayout = vi.fn()
const mockUseEffectiveCommanderPosition = vi.fn()

vi.mock('@/app/[market]/commander/components/CommanderLayoutContext', () => ({
  useCommanderLayout: () => mockUseCommanderLayout(),
}))

vi.mock('@/stores/useCommanderStore', () => ({
  useEffectiveCommanderPosition: () => mockUseEffectiveCommanderPosition(),
}))

describe('useCollapseActionsPanelOnCommanderFloat', () => {
  const setContinueBuildingExpanded = vi.fn()
  const setFullPlanExpanded = vi.fn()
  const clearAutoExpanded = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCommanderLayout.mockReturnValue({ reportNonMessagesHeight: vi.fn() })
    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.LeftDock)
  })

  function renderCollapseHook(overrides: Partial<Parameters<typeof useCollapseActionsPanelOnCommanderFloat>[0]> = {}) {
    return renderHook(
      (props) => useCollapseActionsPanelOnCommanderFloat(props),
      {
        initialProps: {
          isAskQuestionActive: false,
          isProcessing: false,
          continueBuildingExpanded: true,
          setContinueBuildingExpanded,
          setFullPlanExpanded,
          clearAutoExpanded,
          ...overrides,
        },
      },
    )
  }

  it('collapsesContinueBuilding', () => {
    const { rerender } = renderCollapseHook()

    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    rerender({
      isAskQuestionActive: false,
      isProcessing: false,
      continueBuildingExpanded: true,
      setContinueBuildingExpanded,
      setFullPlanExpanded,
      clearAutoExpanded,
    })

    expect(setContinueBuildingExpanded).toHaveBeenCalledWith(false)
    expect(setFullPlanExpanded).not.toHaveBeenCalled()
  })

  it('skipsAskQuestion', () => {
    const { rerender } = renderCollapseHook({ isAskQuestionActive: true })

    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    rerender({
      isAskQuestionActive: true,
      isProcessing: false,
      continueBuildingExpanded: true,
      setContinueBuildingExpanded,
      setFullPlanExpanded,
      clearAutoExpanded,
    })

    expect(setContinueBuildingExpanded).not.toHaveBeenCalled()
    expect(setFullPlanExpanded).not.toHaveBeenCalled()
  })

  it('collapsesThinkingPlan', () => {
    const { rerender } = renderCollapseHook({ isProcessing: true })

    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    rerender({
      isAskQuestionActive: false,
      isProcessing: true,
      continueBuildingExpanded: true,
      setContinueBuildingExpanded,
      setFullPlanExpanded,
      clearAutoExpanded,
    })

    expect(setFullPlanExpanded).toHaveBeenCalledWith(false)
    expect(clearAutoExpanded).toHaveBeenCalled()
    expect(setContinueBuildingExpanded).not.toHaveBeenCalled()
  })

  it('skipsOutsideCommander', () => {
    mockUseCommanderLayout.mockReturnValue(null)
    const { rerender } = renderCollapseHook()

    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    rerender({
      isAskQuestionActive: false,
      isProcessing: false,
      continueBuildingExpanded: true,
      setContinueBuildingExpanded,
      setFullPlanExpanded,
      clearAutoExpanded,
    })

    expect(setContinueBuildingExpanded).not.toHaveBeenCalled()
    expect(setFullPlanExpanded).not.toHaveBeenCalled()
  })

  it('skipsAlreadyFloating', () => {
    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    renderCollapseHook()

    expect(setContinueBuildingExpanded).not.toHaveBeenCalled()
    expect(setFullPlanExpanded).not.toHaveBeenCalled()
  })

  it('expandsContinueBuildingWhenReturningToSidebar', () => {
    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    const { rerender } = renderCollapseHook({ continueBuildingExpanded: false })

    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.LeftDock)
    rerender({
      isAskQuestionActive: false,
      isProcessing: false,
      continueBuildingExpanded: false,
      setContinueBuildingExpanded,
      setFullPlanExpanded,
      clearAutoExpanded,
    })

    expect(setContinueBuildingExpanded).toHaveBeenCalledWith(true)
  })

  it('skipsExpandWhenReturningToSidebarDuringAskQuestion', () => {
    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.Floating)
    const { rerender } = renderCollapseHook({ isAskQuestionActive: true, continueBuildingExpanded: false })

    mockUseEffectiveCommanderPosition.mockReturnValue(CommanderPosition.LeftDock)
    rerender({
      isAskQuestionActive: true,
      isProcessing: false,
      continueBuildingExpanded: false,
      setContinueBuildingExpanded,
      setFullPlanExpanded,
      clearAutoExpanded,
    })

    expect(setContinueBuildingExpanded).not.toHaveBeenCalled()
  })
})
