/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { CommanderPosition } from '@/app/[market]/commander/types'
import { PreviewViewMode, ViewMode } from '@/app/[market]/develop/components/types'
import {
  COMMANDER_FLOATMODES_FLAG,
  useCommanderStore,
} from '@/stores/useCommanderStore'
import { mockInstrumentation } from '@/tests/mocks'
import { renderWithProviders } from '@/tests/test-utils'
import { logClickEvent } from '@/utils/instrumentation'
import CommanderChatRow from './CommanderChatRow'

const mockSwitchboardResults: Record<string, boolean> = {}

const mockDevelopStore = {
  viewMode: ViewMode.CHAT,
  isMobile: false,
  isVersionHistoryOpen: false,
  previewViewMode: PreviewViewMode.DESKTOP,
  setPreviewViewMode: vi.fn(),
  site: { name: 'Test App' },
}

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => mockSwitchboardResults[feature] ?? false,
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: typeof mockDevelopStore) => unknown) => selector(mockDevelopStore),
}))

vi.mock('@/stores/useSitesStore', () => ({
  useSites: () => ({
    sites: [],
    isLoading: false,
    error: null,
    requiresAuth: false,
  }),
}))

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveChatTab: vi.fn(),
  }),
}))

vi.mock('@/app/[market]/develop/components/chat/DebugStatsDrawer', () => ({
  DebugStatsToggleButton: () => null,
}))

vi.mock('@ux/icon/async-icon.js', () => ({
  default: function AsyncIcon({ icon, className }: { icon: string; className?: string }) {
    return <span data-testid={`async-icon-${icon}`} className={className} />
  },
}))

vi.mock('@/utils/instrumentation', () => mockInstrumentation())

function renderRow(): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<CommanderChatRow appId="app-123" />)
}

describe('CommanderChatRow', () => {
  beforeEach(function reset(): void {
    vi.clearAllMocks()
    mockSwitchboardResults[COMMANDER_FLOATMODES_FLAG] = true
    mockDevelopStore.isMobile = false
    useCommanderStore.setState({
      position: CommanderPosition.LeftDock,
      isCanvasSettingsOpen: false,
    })
  })

  describe('position toggle', () => {
    it('hides the toggle when float modes are disabled', function floatModesOff(): void {
      mockSwitchboardResults[COMMANDER_FLOATMODES_FLAG] = false

      renderRow()

      expect(screen.queryByTestId('commander-chat-row-position-toggle')).not.toBeInTheDocument()
    })

    it('shows the toggle when float modes are enabled', function floatModesOn(): void {
      renderRow()

      expect(screen.getByTestId('commander-chat-row-position-toggle')).toBeInTheDocument()
    })

    it('shows the float label while docked', function dockedLabel(): void {
      renderRow()

      expect(screen.getByRole('button', {
        name: 'builder_commander_chat_row_position_change_to_float',
      })).toBeInTheDocument()
    })

    it('cycles position and updates the label on each click', async function cyclePosition(): Promise<void> {
      const { user } = renderRow()
      const toggle = screen.getByTestId('commander-chat-row-position-toggle')

      await user.click(toggle)
      expect(useCommanderStore.getState().position).toBe(CommanderPosition.Floating)
      expect(screen.getByRole('button', {
        name: 'builder_commander_chat_row_position_change_to_dock',
      })).toBeInTheDocument()

      await user.click(toggle)
      expect(useCommanderStore.getState().position).toBe(CommanderPosition.LeftDock)
      expect(screen.getByRole('button', {
        name: 'builder_commander_chat_row_position_change_to_float',
      })).toBeInTheDocument()
    })

    it('logs position instrumentation on toggle', async function positionInstrumentation(): Promise<void> {
      const floatingLogger = vi.fn()
      const dockLogger = vi.fn()
      vi.mocked(logClickEvent)
        .mockReturnValueOnce(floatingLogger)
        .mockReturnValueOnce(dockLogger)

      const { user } = renderRow()
      const toggle = screen.getByTestId('commander-chat-row-position-toggle')

      await user.click(toggle)
      const afterFirstClick = useCommanderStore.getState().position
      expect(logClickEvent).toHaveBeenNthCalledWith(
        1,
        `commander.chat_row.position_${afterFirstClick}`,
        { appId: 'app-123' },
      )
      expect(floatingLogger).toHaveBeenCalledOnce()

      await user.click(toggle)
      const afterSecondClick = useCommanderStore.getState().position
      expect(logClickEvent).toHaveBeenNthCalledWith(
        2,
        `commander.chat_row.position_${afterSecondClick}`,
        { appId: 'app-123' },
      )
      expect(dockLogger).toHaveBeenCalledOnce()
    })
  })

  it('returns null on mobile', function mobileHidden(): void {
    mockDevelopStore.isMobile = true

    renderRow()

    expect(screen.queryByTestId('commander-chat-row')).not.toBeInTheDocument()
  })
})
