/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { PreviewViewMode, ViewMode } from '@/app/[market]/develop/components/types'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import {
  type CanvasActionButton,
  type CanvasActionItem,
  CanvasActionItemType,
  type CanvasActionMenu,
} from './actions'
import { usePreviewCanvasActions } from './usePreviewCanvasActions'

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => true,
}))

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[market]/develop/components/utils', async (importActual) => ({
  ...(await importActual<object>()),
  useAppIdFromParams: () => 'app-1',
}))

const triggerUndo = vi.fn()
const triggerRedo = vi.fn()

vi.mock('@/hooks/useUndoAction', () => ({
  useUndoAction: () => ({ isLocked: true, isPending: false, error: null, clearError: vi.fn(), triggerUndo }),
}))

vi.mock('@/hooks/useRedoAction', () => ({
  useRedoAction: () => ({ isLocked: false, isPending: false, error: null, clearError: vi.fn(), triggerRedo }),
}))

const READY_SERVER_STATE = { url: 'https://preview.example', isReady: true }
let mockServerState: { url: string | null; isReady: boolean } | null = READY_SERVER_STATE

vi.mock('@/stores/useServerPollingStore', () => ({
  useServerPollingStore: (selector: (state: unknown) => unknown) =>
    selector({ getServerState: () => mockServerState }),
}))

const mockOnPreviewRefreshFn = vi.fn()
let mockOnPreviewRefresh: (() => void) | undefined = mockOnPreviewRefreshFn

vi.mock('@/app/[market]/commander/canvas/CommanderCanvasActionContext', () => ({
  useCommanderCanvasActionContext: () => ({ onPreviewRefresh: mockOnPreviewRefresh }),
}))

const handleViewModeChange = vi.fn()
const toggleAnnotationMode = vi.fn()
const setPreviewViewMode = vi.fn()

function setDevelopState(overrides: Record<string, unknown>): void {
  act(() => {
    useDevelopPageStore.setState({
      viewMode: ViewMode.PREVIEW,
      isAnnotationModeEnabled: false,
      hasUnsavedChanges: false,
      isVersionHistoryOpen: false,
      previewViewMode: PreviewViewMode.DESKTOP,
      handleViewModeChange,
      toggleAnnotationMode,
      setPreviewViewMode,
      ...overrides,
    } as Partial<ReturnType<typeof useDevelopPageStore.getState>> as ReturnType<
      typeof useDevelopPageStore.getState
    >)
  })
}

function idsOf(items: CanvasActionItem[]): string[] {
  return items.map((item) => (item.type === CanvasActionItemType.Separator ? 'separator' : item.id))
}

function buttonById(items: CanvasActionItem[], id: string): CanvasActionButton {
  const found = items.find(
    (item): item is CanvasActionButton =>
      item.type === CanvasActionItemType.Button && item.id === id,
  )
  if (!found) throw new Error(`button ${id} not found`)
  return found
}

function menuById(items: CanvasActionItem[], id: string): CanvasActionMenu {
  const found = items.find(
    (item): item is CanvasActionMenu => item.type === CanvasActionItemType.Menu && item.id === id,
  )
  if (!found) throw new Error(`menu ${id} not found`)
  return found
}

describe('usePreviewCanvasActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockServerState = READY_SERVER_STATE
    mockOnPreviewRefresh = mockOnPreviewRefreshFn
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the preview action set when not editing', () => {
    setDevelopState({ viewMode: ViewMode.PREVIEW })
    const { result } = renderHook(() => usePreviewCanvasActions())
    expect(idsOf(result.current)).toEqual(['edit', 'separator', 'refresh', 'device', 'open-external'])
    expect(buttonById(result.current, 'edit').active).toBe(false)
  })

  it('returns the edit action set when editing', () => {
    setDevelopState({ viewMode: ViewMode.EDIT })
    const { result } = renderHook(() => usePreviewCanvasActions())
    expect(idsOf(result.current)).toEqual(['edit', 'select', 'separator', 'undo', 'redo'])
    expect(buttonById(result.current, 'edit').active).toBe(true)
    expect(buttonById(result.current, 'undo').disabled).toBe(true)
    expect(buttonById(result.current, 'redo').disabled).toBe(false)
  })

  it('keeps the edit action set while annotating (annotation is a sub-mode of edit)', () => {
    setDevelopState({ viewMode: ViewMode.EDIT, isAnnotationModeEnabled: true })
    const { result } = renderHook(() => usePreviewCanvasActions())
    expect(idsOf(result.current)).toEqual(['edit', 'select', 'separator', 'undo', 'redo'])
    expect(buttonById(result.current, 'edit').active).toBe(false)
    expect(buttonById(result.current, 'select').active).toBe(true)
  })

  it('toggles edit mode from the edit action', () => {
    setDevelopState({ viewMode: ViewMode.PREVIEW })
    const { result } = renderHook(() => usePreviewCanvasActions())
    buttonById(result.current, 'edit').onTrigger()
    expect(handleViewModeChange).toHaveBeenCalledWith(ViewMode.EDIT, false)
  })

  it('toggles annotation mode from the select action', () => {
    setDevelopState({ viewMode: ViewMode.EDIT })
    const { result } = renderHook(() => usePreviewCanvasActions())
    buttonById(result.current, 'select').onTrigger()
    expect(toggleAnnotationMode).toHaveBeenCalledTimes(1)
  })

  it('wires undo and redo to their own handlers (no cross-wiring)', () => {
    setDevelopState({ viewMode: ViewMode.EDIT })
    const { result } = renderHook(() => usePreviewCanvasActions())

    buttonById(result.current, 'undo').onTrigger()
    expect(triggerUndo).toHaveBeenCalledTimes(1)
    expect(triggerRedo).not.toHaveBeenCalled()

    buttonById(result.current, 'redo').onTrigger()
    expect(triggerRedo).toHaveBeenCalledTimes(1)
  })

  it('selects a viewport from the device menu', () => {
    setDevelopState({ viewMode: ViewMode.PREVIEW })
    const { result } = renderHook(() => usePreviewCanvasActions())
    const device = menuById(result.current, 'device')
    const mobile = device.options.find((option) => option.id === PreviewViewMode.MOBILE)
    mobile?.onSelect()
    expect(setPreviewViewMode).toHaveBeenCalledWith(PreviewViewMode.MOBILE)
  })

  it('opens the preview url in a new tab from open-external', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    setDevelopState({ viewMode: ViewMode.PREVIEW })
    const { result } = renderHook(() => usePreviewCanvasActions())
    buttonById(result.current, 'open-external').onTrigger()
    expect(openSpy).toHaveBeenCalledWith('https://preview.example', '_blank', 'noopener,noreferrer')
  })

  it('omits refresh when no preview-refresh handler is available', () => {
    mockOnPreviewRefresh = undefined
    setDevelopState({ viewMode: ViewMode.PREVIEW })
    const { result } = renderHook(() => usePreviewCanvasActions())
    expect(idsOf(result.current)).toEqual(['edit', 'separator', 'device', 'open-external'])
  })

  it('omits open-external when there is no preview url', () => {
    mockServerState = { url: null, isReady: true }
    setDevelopState({ viewMode: ViewMode.PREVIEW })
    const { result } = renderHook(() => usePreviewCanvasActions())
    expect(idsOf(result.current)).toEqual(['edit', 'separator', 'refresh', 'device'])
  })
})
