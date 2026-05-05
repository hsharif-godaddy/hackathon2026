/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import type { ColorSchemePaletteOption } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import * as Switchboard from '@/hooks/useSwitchboard'
import * as DevelopPageStore from '@/stores/useDevelopPageStore'
import * as StreamingStore from '@/stores/useStreamingConversationStore'
import * as TodoListStore from '@/stores/useTodoListStore'
import { renderWithProviders } from '@/tests/test-utils'
import * as ChatContext from './ChatContext'
import InputActionsPanel from './InputActionsPanel'
import * as useLatestNBAsModule from './useLatestNBAs'

vi.mock('./ChatContext', () => ({
  useSendUserMessage: vi.fn()
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: vi.fn(),
  useIsLoading: vi.fn(),
  useMessages: vi.fn(),
  useActiveStream: vi.fn(() => null)
}))

vi.mock('@/app/[market]/develop/hooks/useRebuildPages', () => ({
  useRebuildPages: vi.fn(() => ({ data: null, isLoading: false }))
}))

vi.mock('@/stores/useTodoListStore', () => ({
  useCurrentList: vi.fn(),
  useViewState: vi.fn(),
  useTodoListStore: {
    getState: vi.fn(() => ({
      currentList: null,
      setCurrentList: vi.fn()
    }))
  }
}))

vi.mock('./useLatestNBAs', () => ({
  useLatestNBAs: vi.fn()
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((flag: string) => {
    if (flag === 'airo-builder-theme-selection-chat') {
      return true
    }
    return false
  }),
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn()
}))

vi.mock('@/app/[market]/develop/components/utils/previewThemeInIframe', () => ({
  previewThemeInIframe: vi.fn()
}))

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-id')
}))

vi.mock('@/app/[market]/develop/hooks/useNextActions', () => ({
  useNextActions: vi.fn(() => ({ data: null, isLoading: false, isError: false }))
}))

describe('InputActionsPanel', () => {
  const mockPalette: ColorSchemePaletteOption['palette'] = {
    primary: '#3b82f6',
    primaryForeground: '#ffffff',
    secondary: '#64748b',
    secondaryForeground: '#ffffff',
    accent: '#8b5cf6',
    accentForeground: '#ffffff',
    background: '#ffffff',
    foreground: '#0f172a',
    muted: '#f1f5f9',
    mutedForeground: '#64748b',
    border: '#e2e8f0',
    destructive: '#ef4444',
    destructiveForeground: '#ffffff',
    success: '#10b981',
    successForeground: '#ffffff',
    warning: '#f59e0b',
    warningForeground: '#ffffff',
    chart1: '#3b82f6',
    chart2: '#8b5cf6',
    chart3: '#10b981',
    chart4: '#f59e0b',
    chart5: '#ef4444'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(Switchboard.useSwitchboard).mockImplementation((flag: string) => {
      if (flag === 'airo-builder-theme-selection-chat') {
        return true
      }
      return false
    })
    vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(vi.fn())
    vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(false)
    vi.mocked(StreamingStore.useIsLoading).mockReturnValue(false)
    vi.mocked(StreamingStore.useMessages).mockReturnValue([])
    vi.mocked(TodoListStore.useCurrentList).mockReturnValue(null)
    vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
    vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(null)
    vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
      selector({ viewMode: ViewMode.PREVIEW })
    )
  })

  describe('askQuestion with plan items', () => {
    const mockTodoList = {
      id: 'list-1',
      appId: 'test-app-id',
      name: 'Build Website',
      items: [
        { id: 'item-1', listId: 'list-1', title: 'Full menu page', completed: false },
        { id: 'item-2', listId: 'list-1', title: 'Location & hours page', completed: false },
      ]
    }

    const askQuestionResult = {
      output: {
        widgetType: 'ask-question',
        widgetData: {
          type: 'ask-question',
          currentQuestionIndex: 0,
          answers: [],
          questions: [{
            question: 'What do you think of the design?',
            suggestions: [
              { text: 'Change the color scheme' },
              { text: 'Adjust the fonts or layout' },
            ],
            allowOther: false,
          }],
        },
      },
    }

    beforeEach(() => {
      vi.mocked(TodoListStore.useCurrentList).mockReturnValue(mockTodoList)
      vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue({
        question: 'What do you think of the design?',
        suggestions: [
          { text: 'Change the color scheme' },
          { text: 'Adjust the fonts or layout' },
        ],
        source: 'askQuestion',
        toolResult: askQuestionResult,
      })
    })

    it('hides plan preview items while askQuestion is active in the input panel variant', () => {
      renderWithProviders(<InputActionsPanel />)

      expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      expect(screen.getByText('Adjust the fonts or layout')).toBeInTheDocument()
      expect(screen.queryByText('Full menu page')).not.toBeInTheDocument()
      expect(screen.queryByText('Location & hours page')).not.toBeInTheDocument()
    })

    it('hides plan preview items for askQuestion-shaped results even if source is missing', () => {
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue({
        question: 'What do you think of the design?',
        suggestions: [
          { text: 'Change the color scheme' },
          { text: 'Adjust the fonts or layout' },
        ],
        toolResult: askQuestionResult,
      })

      renderWithProviders(<InputActionsPanel />)

      expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      expect(screen.queryByText('Full menu page')).not.toBeInTheDocument()
    })

    it('hides plan preview items when suggestions are active even for empty askQuestion-shaped results', () => {
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue({
        question: 'What do you think of the design?',
        suggestions: [
          { text: 'Change the color scheme' },
          { text: 'Adjust the fonts or layout' },
        ],
        toolResult: {
          output: {
            widgetData: {
              currentQuestionIndex: 0,
              answers: [],
              questions: [],
            },
          },
        },
      })

      renderWithProviders(<InputActionsPanel />)

      expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      expect(screen.queryByText('Full menu page')).not.toBeInTheDocument()
      expect(screen.queryByText('Location & hours page')).not.toBeInTheDocument()
    })

    it('hides plan preview items while suggestions are active', async () => {
      renderWithProviders(<InputActionsPanel />)

      expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      expect(screen.queryByText('Full menu page')).not.toBeInTheDocument()
      expect(screen.queryByText('Location & hours page')).not.toBeInTheDocument()
    })

    it('hides plan preview items while askQuestion is active in the legacy variant', () => {
      vi.mocked(Switchboard.useSwitchboard).mockImplementation((flag: string) => {
        if (flag === 'airo-builder-theme-selection-chat') return false
        return false
      })

      renderWithProviders(<InputActionsPanel />)

      expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      expect(screen.queryByText('Full menu page')).not.toBeInTheDocument()
      expect(screen.queryByText('Location & hours page')).not.toBeInTheDocument()
    })
  })

  describe('color scheme suggestions with duplicate filtering', () => {
    it('should not show duplicate themes when current applied theme is in suggestions', () => {
      const oceanBlue: ColorSchemePaletteOption = {
        name: 'Ocean Blue',
        theme: 'light',
        palette: mockPalette
      }

      const sunsetOrange: ColorSchemePaletteOption = {
        name: 'Sunset Orange',
        theme: 'light',
        palette: { ...mockPalette, primary: '#ff6b35' }
      }

      const activeColorSchemeSuggest = {
        toolCallId: 'test-tool-call',
        messageId: 'test-message',
        palettes: [
          oceanBlue, // Duplicate of current applied theme
          sunsetOrange
        ]
      }

      // Mock that Ocean Blue is the currently applied theme
      vi.mocked(StreamingStore.useMessages).mockReturnValue([
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Applied theme',
          timestamp: new Date(),
          toolCalls: [{
            id: 'apply-1',
            name: 'colorScheme',
            status: 'completed',
            input: { mode: 'apply', paletteName: 'Ocean Blue' },
            result: { palette: mockPalette, paletteName: 'Ocean Blue' }
          }]
        }
      ])

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      // Should only have 2 theme options, not 3 (Ocean Blue should appear once)
      const themeOptions = screen.getAllByTestId('theme-preview-option')
      expect(themeOptions).toHaveLength(2)

      // Should have Ocean Blue (current) and Sunset Orange
      expect(screen.getByText('Ocean Blue')).toBeInTheDocument()
      expect(screen.getByText('Sunset Orange')).toBeInTheDocument()
    })

    it('should show all themes when no duplicates exist', () => {
      const oceanBlue: ColorSchemePaletteOption = {
        name: 'Ocean Blue',
        theme: 'light',
        palette: mockPalette
      }

      const sunsetOrange: ColorSchemePaletteOption = {
        name: 'Sunset Orange',
        theme: 'light',
        palette: { ...mockPalette, primary: '#ff6b35' }
      }

      const forestGreen: ColorSchemePaletteOption = {
        name: 'Forest Green',
        theme: 'dark',
        palette: { ...mockPalette, primary: '#10b981' }
      }

      const activeColorSchemeSuggest = {
        toolCallId: 'test-tool-call',
        messageId: 'test-message',
        palettes: [sunsetOrange, forestGreen]
      }

      // Mock that Ocean Blue is the currently applied theme (not in suggestions)
      vi.mocked(StreamingStore.useMessages).mockReturnValue([
        {
          id: 'msg-1',
          role: 'assistant',
          content: 'Applied theme',
          timestamp: new Date(),
          toolCalls: [{
            id: 'apply-1',
            name: 'colorScheme',
            status: 'completed',
            input: { mode: 'apply', paletteName: 'Ocean Blue' },
            result: { palette: mockPalette, paletteName: 'Ocean Blue' }
          }]
        }
      ])

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      // Should have 3 theme options (Ocean Blue + 2 suggestions)
      const themeOptions = screen.getAllByTestId('theme-preview-option')
      expect(themeOptions).toHaveLength(3)

      // Should have all three themes
      expect(screen.getByText('Ocean Blue')).toBeInTheDocument()
      expect(screen.getByText('Sunset Orange')).toBeInTheDocument()
      expect(screen.getByText('Forest Green')).toBeInTheDocument()
    })

    it('should show themes when no current applied theme exists', () => {
      const sunsetOrange: ColorSchemePaletteOption = {
        name: 'Sunset Orange',
        theme: 'light',
        palette: { ...mockPalette, primary: '#ff6b35' }
      }

      const forestGreen: ColorSchemePaletteOption = {
        name: 'Forest Green',
        theme: 'dark',
        palette: { ...mockPalette, primary: '#10b981' }
      }

      const activeColorSchemeSuggest = {
        toolCallId: 'test-tool-call',
        messageId: 'test-message',
        palettes: [sunsetOrange, forestGreen]
      }

      // No applied theme in messages
      vi.mocked(StreamingStore.useMessages).mockReturnValue([])

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      // Should have 2 theme options (just the suggestions)
      const themeOptions = screen.getAllByTestId('theme-preview-option')
      expect(themeOptions).toHaveLength(2)

      expect(screen.getByText('Sunset Orange')).toBeInTheDocument()
      expect(screen.getByText('Forest Green')).toBeInTheDocument()
    })

    it('wraps theme suggest in CollapsibleChatInputSection when theme-selection-chat is on', () => {
      const sunsetOrange: ColorSchemePaletteOption = {
        name: 'Sunset Orange',
        theme: 'light',
        palette: { ...mockPalette, primary: '#ff6b35' }
      }

      const forestGreen: ColorSchemePaletteOption = {
        name: 'Forest Green',
        theme: 'dark',
        palette: { ...mockPalette, primary: '#10b981' }
      }

      const activeColorSchemeSuggest = {
        toolCallId: 'test-tool-call',
        messageId: 'test-message',
        palettes: [sunsetOrange, forestGreen]
      }

      vi.mocked(StreamingStore.useMessages).mockReturnValue([])

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      expect(screen.getAllByTestId('theme-preview-option')).toHaveLength(2)
      expect(screen.getByTestId('theme-preview-apply')).toBeInTheDocument()
      expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
    })
  })

  describe('view mode integration', () => {
    const mockPalettes: ColorSchemePaletteOption[] = [
      {
        name: 'Ocean Blue',
        theme: 'light',
        palette: mockPalette
      },
      {
        name: 'Sunset Orange',
        theme: 'light',
        palette: { ...mockPalette, primary: '#ff6b35' }
      }
    ]

    const activeColorSchemeSuggest = {
      toolCallId: 'test-tool-call',
      messageId: 'test-message',
      palettes: mockPalettes
    }

    beforeEach(() => {
      vi.mocked(StreamingStore.useMessages).mockReturnValue([])
    })

    it('should pass disabled=false when in PREVIEW mode', () => {
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.PREVIEW })
      )

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      radios.forEach(radio => {
        expect(radio).not.toBeDisabled()
      })
    })

    it('should pass disabled=false when in EDIT mode', () => {
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.EDIT })
      )

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      radios.forEach(radio => {
        expect(radio).not.toBeDisabled()
      })
    })

    it('should pass disabled=true when in CODE mode', () => {
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.CODE })
      )

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      radios.forEach(radio => {
        expect(radio).toBeDisabled()
      })
    })

    it('should pass disabled=true when in BRAND mode', () => {
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.BRAND })
      )

      renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      radios.forEach(radio => {
        expect(radio).toBeDisabled()
      })
    })

    it('should reset selection to 0 when switching to BRAND mode', async () => {
      const { rerender, user } = renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      await user.click(radios[1])
      expect(radios[1].checked).toBe(true)
      expect(radios[0].checked).toBe(false)

      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.BRAND })
      )

      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      const radiosAfterBrand = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radiosAfterBrand[0].checked).toBe(true)
    })

    it('should re-apply preview for non-zero theme selection when returning to preview or edit mode', async () => {
      const { rerender, user } = renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      await user.click(radios[1])

      vi.mocked(previewThemeInIframe).mockClear()

      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.CODE })
      )
      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.PREVIEW })
      )
      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      expect(vi.mocked(previewThemeInIframe)).toHaveBeenCalledWith(
        'Sunset Orange',
        expect.objectContaining({ primary: '#ff6b35' })
      )
    })

    it('should preserve selection when switching between PREVIEW and EDIT modes', async () => {
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.PREVIEW })
      )

      const { rerender, user } = renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      // Select theme at index 1 to establish a non-zero selection
      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      await user.click(radios[1])
      expect(radios[1].checked).toBe(true)
      expect(radios[0].checked).toBe(false)

      // Switch to EDIT mode
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.EDIT })
      )

      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      // Selection should still be at index 1 (preserved between PREVIEW/EDIT)
      const radiosAfterSwitch = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radiosAfterSwitch[1].checked).toBe(true)
      expect(radiosAfterSwitch[0].checked).toBe(false)
    })

    it('should NOT reset selection when switching to CODE mode', () => {
      const { rerender } = renderWithProviders(
        <InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />
      )

      // Switch to CODE mode
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation((selector: any) =>
        selector({ viewMode: ViewMode.CODE })
      )

      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      // Selection should still be at index 0, just disabled
      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radios[0].checked).toBe(true)
      expect(radios[0]).toBeDisabled()
    })
  })

  describe('keyboard shortcuts for plan items', () => {
    const mockTodoList = {
      id: 'list-1',
      appId: 'test-app-id',
      name: 'Build Website',
      items: [
        { id: 'item-1', listId: 'list-1', title: 'Create homepage', completed: false },
        { id: 'item-2', listId: 'list-1', title: 'Add contact page', completed: false },
        { id: 'item-3', listId: 'list-1', title: 'Build about section', completed: false },
        { id: 'item-4', listId: 'list-1', title: 'Add footer', completed: false },
        { id: 'item-5', listId: 'list-1', title: 'Add navigation', completed: false },
      ]
    }

    beforeEach(() => {
      vi.mocked(TodoListStore.useCurrentList).mockReturnValue(mockTodoList)
      vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
      vi.mocked(StreamingStore.useMessages).mockReturnValue([{ id: 'msg-1', role: 'user', content: 'test', timestamp: new Date() }])
    })

    it('should trigger plan item selection when pressing number key 1', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(<InputActionsPanel />)

      // Simulate pressing '1' key
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Create homepage',
        expect.objectContaining({
          isActionRequest: true,
          customContext: expect.objectContaining({
            type: 'plan_item',
            data: expect.objectContaining({
              itemId: 'item-1',
              title: 'Create homepage'
            })
          })
        })
      )
    })

    it('should trigger plan item selection when pressing number key 2', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(<InputActionsPanel />)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Add contact page',
        expect.objectContaining({
          isActionRequest: true,
          customContext: expect.objectContaining({
            type: 'plan_item',
            data: expect.objectContaining({
              itemId: 'item-2',
              title: 'Add contact page'
            })
          })
        })
      )
    })

    it('should trigger plan item selection when pressing number key 3', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(<InputActionsPanel />)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Build about section',
        expect.objectContaining({
          isActionRequest: true,
          customContext: expect.objectContaining({
            type: 'plan_item',
            data: expect.objectContaining({
              itemId: 'item-3',
              title: 'Build about section'
            })
          })
        })
      )
    })

    it('should trigger plan item selection when pressing number key 4', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(<InputActionsPanel />)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }))

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Add footer',
        expect.objectContaining({
          isActionRequest: true,
          customContext: expect.objectContaining({
            type: 'plan_item',
            data: expect.objectContaining({
              itemId: 'item-4',
              title: 'Add footer'
            })
          })
        })
      )
    })

    it('should not trigger selection for key 5 (exceeds max shortcuts)', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(<InputActionsPanel />)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }))

      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should not trigger selection when agent is processing', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)

      renderWithProviders(<InputActionsPanel />)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))

      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should not trigger selection when focused on an input element', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(
        <div>
          <input data-testid="test-input" />
          <InputActionsPanel />
        </div>
      )

      const input = screen.getByTestId('test-input')
      input.focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should not trigger selection when focused on a textarea element', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderWithProviders(
        <div>
          <textarea data-testid="test-textarea" />
          <InputActionsPanel />
        </div>
      )

      const textarea = screen.getByTestId('test-textarea')
      textarea.focus()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))

      expect(mockSendMessage).not.toHaveBeenCalled()
    })
  })
})
