/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { CanvasId, DEFAULT_OPEN_CANVAS_IDS, PINNED_CANVAS_ID } from './registry'
import { useCanvasSync } from './useCanvasSync'

// Switchboard values consumed by useCanvasSync (via useCanvasFlagFilter) and
// useCommanderCanvasTabsEnabled. Every flag the test exercises must be enabled here,
// otherwise useCanvasSync will treat the active canvas as flag-gated-off and reset to PINNED.
const SWITCHBOARD_TRUE: ReadonlySet<string> = new Set([
  'appbuilder-commander-canvas-tabs',
  'appbuilder-settings-security',
])

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => (SWITCHBOARD_TRUE.has(flag) ? true : undefined),
}))

const handleViewModeChange = vi.fn()
const setActiveSettingsSection = vi.fn()
const openCanvasSettings = vi.fn(() => {
  useCommanderStore.setState({ isCanvasSettingsOpen: true })
})
const closeCanvasSettings = vi.fn(() => {
  useCommanderStore.setState({ isCanvasSettingsOpen: false })
})

describe('useCanvasSync', () => {
  beforeEach(() => {
    handleViewModeChange.mockReset()
    setActiveSettingsSection.mockReset()
    openCanvasSettings.mockClear()
    closeCanvasSettings.mockClear()

    act(() => {
      useDevelopPageStore.setState({
        viewMode: ViewMode.PREVIEW,
        hasUnsavedChanges: false,
        handleViewModeChange,
        setActiveSettingsSection,
      } as Partial<ReturnType<typeof useDevelopPageStore.getState>> as ReturnType<typeof useDevelopPageStore.getState>)

      useCommanderStore.setState({
        openCanvasIds: [...DEFAULT_OPEN_CANVAS_IDS, CanvasId.Code, CanvasId.SettingsSecurity],
        activeCanvasId: PINNED_CANVAS_ID,
        isCanvasSettingsOpen: false,
        openCanvasSettings,
        closeCanvasSettings,
      })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('drives viewMode = CODE when the Code canvas becomes active', () => {
    const { rerender } = renderHook(() => useCanvasSync())
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.Code })
    })
    rerender()
    expect(handleViewModeChange).toHaveBeenCalledWith(ViewMode.CODE, false)
  })

  it('does not clobber EDIT when re-activating the Preview canvas', () => {
    act(() => {
      useDevelopPageStore.setState({ viewMode: ViewMode.EDIT } as ReturnType<
        typeof useDevelopPageStore.getState
      >)
    })
    const { rerender } = renderHook(() => useCanvasSync())
    // Force the sync to recompute by switching to Code first, then back to Preview.
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.Code })
    })
    rerender()
    handleViewModeChange.mockClear()
    act(() => {
      useDevelopPageStore.setState({ viewMode: ViewMode.EDIT } as ReturnType<
        typeof useDevelopPageStore.getState
      >)
      useCommanderStore.setState({ activeCanvasId: CanvasId.Preview })
    })
    rerender()
    expect(handleViewModeChange).not.toHaveBeenCalled()
  })

  it('opens settings overlay and applies the section when a settings canvas activates', () => {
    const { rerender } = renderHook(() => useCanvasSync())
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.SettingsSecurity })
    })
    rerender()
    expect(setActiveSettingsSection).toHaveBeenCalled()
    expect(openCanvasSettings).toHaveBeenCalled()
  })

  it('resets activeCanvasId to PINNED when the active canvas is flag-gated-off', () => {
    // Media requires appbuilder-media-library (off in this test). Persisted/active
    // Media should be force-reset to PINNED so useCanvasSync never drives the
    // develop store into a viewMode whose tab is filtered out of the strip.
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.Media })
    })
    renderHook(() => useCanvasSync())
    expect(useCommanderStore.getState().activeCanvasId).toBe(PINNED_CANVAS_ID)
    expect(handleViewModeChange).not.toHaveBeenCalled()
  })

  it('rolls back to PINNED on first-activation cancel of an unsaved-changes confirm', () => {
    // First activation has no previously-applied canvas. If handleViewModeChange
    // is cancelled (viewMode unchanged), the optimistic activeCanvasId must roll
    // back to PINNED rather than leaving the tab strip out of sync.
    handleViewModeChange.mockImplementation(() => {
      // Simulate user cancelling the unsaved-changes confirm: viewMode stays put.
    })
    act(() => {
      useDevelopPageStore.setState({
        viewMode: ViewMode.PREVIEW,
        hasUnsavedChanges: true,
      } as ReturnType<typeof useDevelopPageStore.getState>)
      useCommanderStore.setState({ activeCanvasId: CanvasId.Code })
    })
    renderHook(() => useCanvasSync())
    expect(useCommanderStore.getState().activeCanvasId).toBe(PINNED_CANVAS_ID)
  })
})
