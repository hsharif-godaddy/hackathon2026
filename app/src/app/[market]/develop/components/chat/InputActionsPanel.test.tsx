/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import { ViewMode } from '@/app/[market]/develop/components/types'
import type { ColorSchemePaletteOption } from '@/app/[market]/develop/components/utils/findLatestColorSchemeSuggest'
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import * as useNextActionsModule from '@/app/[market]/develop/hooks/useNextActions'
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
  useActiveStream: vi.fn(function () { return null; }),
  useActiveRunningToolName: vi.fn(function () { return null; })
}))

vi.mock('@/app/[market]/develop/hooks/useRebuildPages', async function importRebuildPages() {
  const actual = await vi.importActual<typeof import('@/app/[market]/develop/hooks/useRebuildPages')>(
    '@/app/[market]/develop/hooks/useRebuildPages',
  )
  return {
    ...actual,
    useRebuildPages: vi.fn(function () { return { data: null, isLoading: false }; }),
  }
})

vi.mock('@/stores/useTodoListStore', () => ({
  useCurrentList: vi.fn(),
  useViewState: vi.fn(),
  useTodoListStore: {
    getState: vi.fn(function () { return {
      currentList: null,
      setCurrentList: vi.fn()
    }; })
  }
}))

vi.mock('./useLatestNBAs', () => ({
  useLatestNBAs: vi.fn()
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(function (flag: string) {
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
  useAppIdFromParams: vi.fn(function () { return 'test-app-id'; })
}))

vi.mock('@/app/[market]/develop/hooks/useNextActions', () => ({
  useNextActions: vi.fn(function () { return { data: null, isLoading: false, isError: false }; })
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
    vi.mocked(Switchboard.useSwitchboard).mockImplementation(function (flag: string) {
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
    vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.PREVIEW, isMobile: false }); }
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
      vi.mocked(Switchboard.useSwitchboard).mockImplementation(function (flag: string) {
        if (flag === 'airo-builder-theme-selection-chat') return false
        return false
      })

      renderWithProviders(<InputActionsPanel />)

      expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      expect(screen.queryByText('Full menu page')).not.toBeInTheDocument()
      expect(screen.queryByText('Location & hours page')).not.toBeInTheDocument()
    })

    describe('choicelist prompt swap (choiceSwapEnabled)', () => {
      // NBA suggestions with no askQuestion source/toolResult → the surface is
      // an ordinary "continue building" list, hoisted via `defaultCollapsible`
      // (the `nba:` branch) rather than the askQuestion renderer.
      const nbaSuggestions = {
        question: 'What next?',
        suggestions: [{ text: 'Add a contact page' }, { text: 'Add a gallery' }],
      }

      it('hoists the choicelist surface up and does not render it inline', async () => {
        const onChoiceSurfaceChange = vi.fn()
        renderWithProviders(
          <InputActionsPanel
            choiceSwapEnabled
            onChoiceSurfaceChange={onChoiceSurfaceChange}
          />,
        )

        await waitFor(() => expect(onChoiceSurfaceChange).toHaveBeenCalled())
        const lastCall = onChoiceSurfaceChange.mock.calls.at(-1)!
        expect(lastCall[0]).not.toBeNull() // a non-null surface node
        expect(lastCall[1]).toContain('askq:') // per-turn key
        // The choicelist is rendered by ChatInput's swap slot, not inline here.
        expect(screen.queryByText('Change the color scheme')).not.toBeInTheDocument()
      })

      it('hoists the NBA/next-action default collapsible with an nba: key and a dismiss-X', async () => {
        vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(nbaSuggestions)
        const onChoiceSurfaceChange = vi.fn()
        renderWithProviders(
          <InputActionsPanel choiceSwapEnabled onChoiceSurfaceChange={onChoiceSurfaceChange} />,
        )

        await waitFor(() => expect(onChoiceSurfaceChange).toHaveBeenCalled())
        const hoisted = onChoiceSurfaceChange.mock.calls.at(-1)!
        expect(hoisted[0]).not.toBeNull()
        expect(hoisted[1]).toContain('nba:')

        // Render the hoisted surface the way ChatInput's PromptStage slot would:
        // the default collapsible carries the NBA options and a header dismiss-X.
        renderWithProviders(hoisted[0])
        expect(screen.getByText('Add a contact page')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
      })

      it('un-hoists the surface (reports null) when the hoisted dismiss-X is clicked', async () => {
        vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(nbaSuggestions)
        const onChoiceSurfaceChange = vi.fn()
        const { user } = renderWithProviders(
          <InputActionsPanel choiceSwapEnabled onChoiceSurfaceChange={onChoiceSurfaceChange} />,
        )

        await waitFor(() => expect(onChoiceSurfaceChange).toHaveBeenCalled())
        const hoisted = onChoiceSurfaceChange.mock.calls.at(-1)![0]
        expect(hoisted).not.toBeNull()

        // Mount the hoisted node and click its header X. That is wired to
        // collapseChoiceFromSlot → setContinueBuildingExpanded(false), which
        // un-hoists the surface so the panel re-reports null (PromptBox returns).
        renderWithProviders(hoisted)
        onChoiceSurfaceChange.mockClear()
        await user.click(screen.getByRole('button', { name: 'Close' }))
        await waitFor(() => expect(onChoiceSurfaceChange).toHaveBeenLastCalledWith(null, null))
      })

      it('re-publishes the hoisted node when suggestion text changes at the same count', async () => {
        vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(nbaSuggestions)
        const onChoiceSurfaceChange = vi.fn()
        const { rerender } = renderWithProviders(
          <InputActionsPanel choiceSwapEnabled onChoiceSurfaceChange={onChoiceSurfaceChange} />,
        )
        await waitFor(() => expect(onChoiceSurfaceChange).toHaveBeenCalled())
        const before = onChoiceSurfaceChange.mock.calls.length

        // Same option count (2), different text → the signature must change so
        // the slot re-publishes the fresh node (guards the JSON.stringify term).
        vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue({
          question: 'What next?',
          suggestions: [{ text: 'Add a blog' }, { text: 'Add a store' }],
        })
        rerender(<InputActionsPanel choiceSwapEnabled onChoiceSurfaceChange={onChoiceSurfaceChange} />)

        await waitFor(() =>
          expect(onChoiceSurfaceChange.mock.calls.length).toBeGreaterThan(before),
        )
        expect(onChoiceSurfaceChange.mock.calls.at(-1)![0]).not.toBeNull()
      })

      it('hoists the next-action surface with a next: key', async () => {
        // No askQuestion, no NBAs, no pending plan items → the "continue
        // building" next-action branch is the active surface.
        vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(null)
        vi.mocked(TodoListStore.useCurrentList).mockReturnValue(null)
        vi.mocked(useNextActionsModule.useNextActions).mockReturnValue({
          data: { suggestions: [{ text: 'Publish the site' }, { text: 'Add analytics' }] },
          isLoading: false,
          isError: false,
        } as unknown as ReturnType<typeof useNextActionsModule.useNextActions>)

        const onChoiceSurfaceChange = vi.fn()
        renderWithProviders(
          <InputActionsPanel choiceSwapEnabled onChoiceSurfaceChange={onChoiceSurfaceChange} />,
        )

        await waitFor(() => expect(onChoiceSurfaceChange).toHaveBeenCalled())
        const hoisted = onChoiceSurfaceChange.mock.calls.at(-1)!
        expect(hoisted[0]).not.toBeNull()
        expect(hoisted[1]).toContain('next:')
      })

      it('does not hoist (renders inline) when the flag is off', () => {
        const onChoiceSurfaceChange = vi.fn()
        renderWithProviders(
          <InputActionsPanel onChoiceSurfaceChange={onChoiceSurfaceChange} />,
        )

        expect(onChoiceSurfaceChange).not.toHaveBeenCalled()
        expect(screen.getByText('Change the color scheme')).toBeInTheDocument()
      })
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
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.PREVIEW }); }
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
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.EDIT }); }
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
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.CODE }); }
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
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.BRAND }); }
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

      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.BRAND }); }
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

      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.CODE }); }
      )
      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.PREVIEW }); }
      )
      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      expect(vi.mocked(previewThemeInIframe)).toHaveBeenCalledWith(
        'Sunset Orange',
        expect.objectContaining({ primary: '#ff6b35' })
      )
    })

    it('should preserve selection when switching between PREVIEW and EDIT modes', async () => {
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.PREVIEW }); }
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
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.EDIT }); }
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
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.CODE }); }
      )

      rerender(<InputActionsPanel activeColorSchemeSuggest={activeColorSchemeSuggest} />)

      // Selection should still be at index 0, just disabled
      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radios[0].checked).toBe(true)
      expect(radios[0]).toBeDisabled()
    })
  })

  describe('theme selection PlanOptionsList mobile layout', () => {
    const mockTodoListPlanOnly = {
      id: 'list-1',
      appId: 'test-app-id',
      name: 'Build Website',
      items: [
        { id: 'item-1', listId: 'list-1', title: 'Task A', completed: false },
        { id: 'item-2', listId: 'list-1', title: 'Task B', completed: false },
      ],
    }

    beforeEach(() => {
      vi.mocked(TodoListStore.useCurrentList).mockReturnValue(mockTodoListPlanOnly)
      vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
      vi.mocked(StreamingStore.useMessages).mockReturnValue([
        { id: 'msg-1', role: 'user', content: 'test', timestamp: new Date() },
      ])
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(null)
      vi.mocked(DevelopPageStore.useDevelopPageStore).mockImplementation(function (selector: any) { return selector({ viewMode: ViewMode.PREVIEW, isMobile: true }); },
      )
    })

    it('wraps plan ChoiceList in horizontal scroll container when isMobile is true', () => {
      renderWithProviders(<InputActionsPanel />)

      const listbox = screen.getByRole('listbox', { name: 'builder_todo_continue_building' })
      let scrollWrapper: HTMLElement | null = null
      for (let node: HTMLElement | null = listbox; node; node = node.parentElement) {
        if (node.classList.contains('overflow-x-auto')) {
          scrollWrapper = node
          break
        }
      }
      expect(scrollWrapper).not.toBeNull()
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
      Element.prototype.scrollIntoView = vi.fn()
    })

    /** Mirrors ChatInput chrome so digit shortcuts match production (empty prompt + card). */
    function renderInputActionsPanelAsInComposer() {
      const view = renderWithProviders(
        <div data-chat-composer-card data-testid="chat-input-card">
          <div contentEditable id="chat-input-textarea" suppressContentEditableWarning tabIndex={0} />
          <InputActionsPanel />
        </div>
      )
      document.getElementById('chat-input-textarea')?.focus()
      return view
    }

    it('focuses plan item option on number key 1; Enter sends the plan action', async function focusPlanOneEnter() {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      const { user } = renderInputActionsPanelAsInComposer()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))

      const options = screen.getAllByRole('option')
      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: 'builder_todo_continue_building' })).toHaveFocus()
        expect(options[0]).toHaveAttribute('data-visually-focused')
      })

      await user.keyboard('{Enter}')

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

    it('focuses plan item option on number key 2; Enter sends the plan action', async function focusPlanTwoEnter() {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      const { user } = renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))

      const options = screen.getAllByRole('option')
      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: 'builder_todo_continue_building' })).toHaveFocus()
        expect(options[1]).toHaveAttribute('data-visually-focused')
      })

      await user.keyboard('{Enter}')

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

    it('focuses plan item option on number key 3; Enter sends the plan action', async function focusPlanThreeEnter() {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      const { user } = renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))

      const options = screen.getAllByRole('option')
      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: 'builder_todo_continue_building' })).toHaveFocus()
        expect(options[2]).toHaveAttribute('data-visually-focused')
      })

      await user.keyboard('{Enter}')

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

    it('focuses plan item option on number key 4; Enter sends the plan action', async function focusPlanFourEnter() {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      const { user } = renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }))

      const options = screen.getAllByRole('option')
      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: 'builder_todo_continue_building' })).toHaveFocus()
        expect(options[3]).toHaveAttribute('data-visually-focused')
      })

      await user.keyboard('{Enter}')

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

      renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5' }))

      expect(mockSendMessage).not.toHaveBeenCalled()
    })

    it('should not trigger selection when agent is processing', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)

      renderInputActionsPanelAsInComposer()

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

  describe('keyboard shortcuts for next-action suggestions', () => {
    // "Continue building" mode: no askQuestion is active, no plan items are
    // pending, but the agent has surfaced next-action suggestions. Earlier
    // versions of the inline composer keyboard handler only branched on NBAs
    // and plan items; nextActionSuggestions silently no-op'd, leaving this
    // mode without keyboard nav even though the same ChoiceList row was
    // visible.
    beforeEach(() => {
      vi.mocked(TodoListStore.useCurrentList).mockReturnValue(null)
      vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
      vi.mocked(StreamingStore.useMessages).mockReturnValue([
        { id: 'msg-1', role: 'user', content: 'test', timestamp: new Date() },
      ])
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(null)
      vi.mocked(useNextActionsModule.useNextActions).mockReturnValue({
        data: {
          suggestions: [
            { text: 'Add a hero section' },
            { text: 'Add a footer' },
            { text: 'Tweak the color palette' },
          ],
        },
        isLoading: false,
        isError: false,
      } as ReturnType<typeof useNextActionsModule.useNextActions>)
      Element.prototype.scrollIntoView = vi.fn()
    })

    function renderInputActionsPanelAsInComposer() {
      const view = renderWithProviders(
        <div data-chat-composer-card data-testid="chat-input-card">
          <div contentEditable id="chat-input-textarea" suppressContentEditableWarning tabIndex={0} />
          <InputActionsPanel />
        </div>
      )
      document.getElementById('chat-input-textarea')?.focus()
      return view
    }

    it('focuses the matching next-action option on number key 1', async () => {
      renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }))

      const options = screen.getAllByRole('option')
      await waitFor(() => {
        expect(screen.getByRole('listbox', { name: 'builder_todo_continue_building' })).toHaveFocus()
        expect(options[0]).toHaveAttribute('data-visually-focused')
      })
    })

    it('focuses the matching next-action option on number key 2; Enter sends the suggestion', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      const { user } = renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }))

      const options = screen.getAllByRole('option')
      await waitFor(() => {
        expect(options[1]).toHaveAttribute('data-visually-focused')
      })

      await user.keyboard('{Enter}')

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Add a footer',
        expect.objectContaining({ isActionRequest: true }),
      )
    })

    it('does not trigger when number is out of range', async () => {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      renderInputActionsPanelAsInComposer()

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '9' }))

      expect(mockSendMessage).not.toHaveBeenCalled()
    })
  })

  describe('shouldCollapse rising-edge logic', () => {
    const mockTodoList = {
      id: 'list-1',
      appId: 'test-app-id',
      name: 'Build Website',
      items: [
        { id: 'item-1', listId: 'list-1', title: 'Full menu page', completed: false, order: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: 'item-2', listId: 'list-1', title: 'Location & hours page', completed: false, order: 1, createdAt: new Date(), updatedAt: new Date() },
      ],
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    }

    beforeEach(() => {
      // Setup mocks to render the CollapsibleChatInputSection
      vi.mocked(TodoListStore.useCurrentList).mockReturnValue(mockTodoList)
      vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(null)
    })

    it('should collapse the panel when shouldCollapse transitions from false to true', () => {
      const { rerender } = renderWithProviders(
        <InputActionsPanel shouldCollapse={false} />
      )

      // Initially, the collapsible section should be expanded (continueBuildingExpanded=true)
      const collapsibleSection = screen.getByTestId('collapsible-section-continue-building')
      const chevronButton = collapsibleSection.querySelector('button[aria-expanded]') as HTMLButtonElement
      expect(chevronButton).toBeInTheDocument()
      expect(chevronButton.getAttribute('aria-expanded')).toBe('true')

      // Trigger rising edge: false → true
      rerender(<InputActionsPanel shouldCollapse={true} />)

      // Should collapse (continueBuildingExpanded flipped to false)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')
    })

    it('should not collapse when shouldCollapse stays true (no rising edge)', () => {
      const { rerender } = renderWithProviders(
        <InputActionsPanel shouldCollapse={true} />
      )

      const collapsibleSection = screen.getByTestId('collapsible-section-continue-building')

      // Initially expanded (prevRef starts as true, so no rising edge: true → true)
      const chevronButton = collapsibleSection.querySelector('button[aria-expanded]') as HTMLButtonElement
      expect(chevronButton).toBeInTheDocument()
      expect(chevronButton.getAttribute('aria-expanded')).toBe('true')

      // User manually collapses
      fireEvent.click(chevronButton)

      // Should now be collapsed
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')

      // shouldCollapse stays true (no rising edge: true → true)
      rerender(<InputActionsPanel shouldCollapse={true} />)

      // Should remain collapsed (no auto-expand because no effect on falling edge or steady state)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')
    })

    it('should allow re-collapse on subsequent rising edge after user re-expands', () => {
      const { rerender } = renderWithProviders(
        <InputActionsPanel shouldCollapse={false} />
      )

      const collapsibleSection = screen.getByTestId('collapsible-section-continue-building')
      const chevronButton = collapsibleSection.querySelector('button[aria-expanded]') as HTMLButtonElement
      expect(chevronButton).toBeInTheDocument()

      // Initially expanded
      expect(chevronButton.getAttribute('aria-expanded')).toBe('true')

      // First rising edge: false → true
      rerender(<InputActionsPanel shouldCollapse={true} />)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')

      // User manually re-expands
      fireEvent.click(chevronButton)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('true')

      // Reset: true → false
      rerender(<InputActionsPanel shouldCollapse={false} />)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('true')

      // Second rising edge: false → true
      rerender(<InputActionsPanel shouldCollapse={true} />)

      // Should collapse again (new rising edge detected)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')
    })

    it('should not affect collapse state when shouldCollapse transitions from true to false', () => {
      const { rerender } = renderWithProviders(
        <InputActionsPanel shouldCollapse={true} />
      )

      const collapsibleSection = screen.getByTestId('collapsible-section-continue-building')

      // Initially expanded (prevRef starts as true, so no rising edge: true → true)
      const chevronButton = collapsibleSection.querySelector('button[aria-expanded]') as HTMLButtonElement
      expect(chevronButton).toBeInTheDocument()
      expect(chevronButton.getAttribute('aria-expanded')).toBe('true')

      // User manually collapses
      fireEvent.click(chevronButton)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')

      // Falling edge: true → false (no effect on collapse state)
      rerender(<InputActionsPanel shouldCollapse={false} />)

      // Should remain collapsed (falling edge doesn't expand)
      expect(chevronButton.getAttribute('aria-expanded')).toBe('false')
    })
  })

  describe('plan modal', () => {
    const mockTodoList = {
      id: 'list-1',
      appId: 'test-app-id',
      name: 'Build Website',
      items: [
        { id: 'item-1', listId: 'list-1', title: 'Create homepage', completed: true },
        { id: 'item-2', listId: 'list-1', title: 'Add contact page', completed: false, description: 'Contact form and map' },
      ],
    }

    beforeEach(() => {
      vi.mocked(TodoListStore.useCurrentList).mockReturnValue(mockTodoList)
      vi.mocked(TodoListStore.useViewState).mockReturnValue(null)
      vi.mocked(StreamingStore.useMessages).mockReturnValue([
        { id: 'msg-1', role: 'user', content: 'test', timestamp: new Date() },
      ])
      vi.mocked(useLatestNBAsModule.useLatestNBAs).mockReturnValue(null)
    })

    it('executes an uncompleted plan item from the progress modal and closes it', async function modalPlanItemClick() {
      const mockSendMessage = vi.fn()
      vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendMessage)

      const { user } = renderWithProviders(<InputActionsPanel />)

      await user.click(screen.getByRole('button', { name: 'builder_todo_view_plan' }))

      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: /Add contact page/i }))

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Add contact page',
        expect.objectContaining({
          isActionRequest: true,
          customContext: expect.objectContaining({ type: 'plan_item', source: 'plan-item' }),
        }),
      )
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })

    it('does not render completed plan items as buttons in the modal', async function modalCompletedReadOnly() {
      renderWithProviders(<InputActionsPanel />)

      await fireEvent.click(screen.getByRole('button', { name: 'builder_todo_view_plan' }))

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).queryByRole('button', { name: /Create homepage/i })).not.toBeInTheDocument()
      expect(within(dialog).getByText('Create homepage')).toBeInTheDocument()
    })
  })
})
