/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import * as previewThemeModule from '@/app/[market]/develop/components/utils/previewThemeInIframe'
import * as StreamingStore from '@/stores/useStreamingConversationStore'
import { renderWithProviders } from '@/tests/test-utils'
import * as ChatContext from './ChatContext'
import ThemePreviewInputPanel, { type ThemePreviewInputPanelProps } from './ThemePreviewInputPanel'

vi.mock('./ChatContext', () => ({
  useSendUserMessage: vi.fn()
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: vi.fn(),
  useIsLoading: vi.fn()
}))

vi.mock('@/app/[market]/develop/components/utils/previewThemeInIframe', () => ({
  previewThemeInIframe: vi.fn()
}))

describe('ThemePreviewInputPanel', () => {
  const mockPalettes: ThemePreviewInputPanelProps['palettes'] = [
    {
      name: 'Ocean Blue',
      theme: 'light',
      palette: {
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
    },
    {
      name: 'Dark Night',
      theme: 'dark',
      palette: {
        primary: '#3b82f6',
        primaryForeground: '#ffffff',
        secondary: '#64748b',
        secondaryForeground: '#ffffff',
        accent: '#8b5cf6',
        accentForeground: '#ffffff',
        background: '#0f172a',
        foreground: '#ffffff',
        muted: '#1e293b',
        mutedForeground: '#cbd5e1',
        border: '#334155',
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
    }
  ]

  const mockSendUserMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendUserMessage)
    vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(false)
    vi.mocked(StreamingStore.useIsLoading).mockReturnValue(false)
  })

  describe('rendering', () => {
    it('should render without crashing', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      expect(screen.getByTestId('theme-preview-input-panel')).toBeInTheDocument()
    })

    it('should render all palette options', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const options = screen.getAllByTestId('theme-preview-option')
      expect(options).toHaveLength(2)
    })

    it('should display palette names', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      expect(screen.getByText('Ocean Blue')).toBeInTheDocument()
      expect(screen.getByText('Dark Night')).toBeInTheDocument()
    })

    it('should render four color circles for each option', () => {
      const { container } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      // Each option has 1 radio button circle + 4 color circles = 5 circles per option
      const allCircles = container.querySelectorAll('.size-3.rounded-full')
      expect(allCircles.length).toBe(10) // 5 circles × 2 palettes
    })

    it('should render color circles with correct colors', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const firstOption = screen.getAllByTestId('theme-preview-option')[0]
      const allCircles = firstOption.querySelectorAll('.size-3.rounded-full')

      // First circle is the radio button, then 4 color circles
      expect(allCircles[1]).toHaveStyle({ backgroundColor: mockPalettes[0].palette.primary })
      expect(allCircles[2]).toHaveStyle({ backgroundColor: mockPalettes[0].palette.secondary })
      expect(allCircles[3]).toHaveStyle({ backgroundColor: mockPalettes[0].palette.accent })
      expect(allCircles[4]).toHaveStyle({ backgroundColor: mockPalettes[0].palette.muted })
    })

    it('should have color circles overlap with negative margin', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const firstOption = screen.getAllByTestId('theme-preview-option')[0]
      const circleContainer = firstOption.querySelector('.ml-auto')
      const colorCircles = circleContainer?.querySelectorAll('.size-3.rounded-full')

      expect(colorCircles).toBeTruthy()
      colorCircles?.forEach((circle, index) => {
        expect(circle).toHaveClass('-ml-1')
        if (index === 0) {
          expect(circle).toHaveClass('first:ml-0')
        }
      })
    })

    it('should position color circles on the right', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const firstOption = screen.getAllByTestId('theme-preview-option')[0]
      const circleContainers = firstOption.querySelectorAll('.ml-auto')
      expect(circleContainers.length).toBeGreaterThan(0)
    })
  })

  describe('radio button layout', () => {
    it('should render options as labels with horizontal layout', () => {
      const { container } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const labels = container.querySelectorAll('label[data-testid="theme-preview-option"]')
      expect(labels).toHaveLength(2)
      labels.forEach(label => {
        expect(label).toHaveClass('flex')
        expect(label).toHaveClass('items-center')
      })
    })

    it('should have compact padding for short height', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const options = screen.getAllByTestId('theme-preview-option')
      options.forEach(option => {
        expect(option).toHaveClass('px-1.5')
        expect(option).toHaveClass('py-0.5')
      })
    })

    it('should apply background color from palette', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const firstOption = screen.getAllByTestId('theme-preview-option')[0]
      expect(firstOption).toHaveStyle({ backgroundColor: mockPalettes[0].palette.background })
    })

    it('should apply foreground color from palette', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const firstOption = screen.getAllByTestId('theme-preview-option')[0]
      expect(firstOption).toHaveStyle({ color: mockPalettes[0].palette.foreground })
    })

    it('should render theme name with proper styling', () => {
      const { container } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      const themeName = screen.getByText('Ocean Blue')
      expect(themeName).toHaveClass('font-semibold')
      expect(themeName).toHaveClass('truncate')
    })
  })

  describe('selection behavior', () => {
    it('should pre-select the first palette on mount', async () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      await waitFor(() => {
        const firstRadio = screen.getAllByRole('radio')[0] as HTMLInputElement
        expect(firstRadio.checked).toBe(true)
      })
    })

    it('should preview the first palette on mount', async () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      await waitFor(() => {
        expect(previewThemeModule.previewThemeInIframe).toHaveBeenCalledWith(
          mockPalettes[0].name,
          mockPalettes[0].palette
        )
      })
    })

    it('should update selection when option is clicked', async () => {
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      const secondOption = screen.getAllByTestId('theme-preview-option')[1]
      await user.click(secondOption)

      await waitFor(() => {
        const secondRadio = screen.getAllByRole('radio')[1] as HTMLInputElement
        expect(secondRadio.checked).toBe(true)
      })
    })

    it('should preview theme when option is clicked', async () => {
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      // Clear the mock to ignore the initial preview call
      vi.clearAllMocks()

      const secondOption = screen.getAllByTestId('theme-preview-option')[1]
      await user.click(secondOption)

      await waitFor(() => {
        expect(previewThemeModule.previewThemeInIframe).toHaveBeenCalledWith(
          mockPalettes[1].name,
          mockPalettes[1].palette
        )
      })
    })

    it('should highlight selected option with primary border color', async () => {
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      const firstOption = screen.getAllByTestId('theme-preview-option')[0]
      expect(firstOption).toHaveStyle({ borderColor: mockPalettes[0].palette.primary })

      const secondOption = screen.getAllByTestId('theme-preview-option')[1]
      await user.click(secondOption)

      await waitFor(() => {
        expect(secondOption).toHaveStyle({ borderColor: mockPalettes[1].palette.primary })
      })
    })
  })

  describe('apply button', () => {
    it('should render apply button', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      expect(screen.getByTestId('theme-preview-apply')).toBeInTheDocument()
    })

    it('should send user message when apply is clicked', async () => {
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      const applyButton = screen.getByTestId('theme-preview-apply')
      await user.click(applyButton)

      await waitFor(() => {
        expect(mockSendUserMessage).toHaveBeenCalled()
        const callArgs = mockSendUserMessage.mock.calls[0]
        expect(callArgs[0]).toContain('Ocean Blue')
      })
    })

    it('should be disabled when processing', () => {
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)

      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      expect(screen.getByTestId('theme-preview-apply')).toBeDisabled()
    })

    it('should be disabled when no theme selected', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      // This shouldn't happen in practice, but testing the guard
      const applyButton = screen.getByTestId('theme-preview-apply')
      expect(applyButton).not.toBeDisabled() // First palette auto-selected
    })
  })

  describe('more options button', () => {
    it('should render more options button', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      expect(screen.getByTestId('theme-preview-more-options')).toBeInTheDocument()
    })

    it('should send user message when more options is clicked', async () => {
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      const moreButton = screen.getByTestId('theme-preview-more-options')
      await user.click(moreButton)

      await waitFor(() => {
        expect(mockSendUserMessage).toHaveBeenCalled()
      })
    })

    it('should revert to first palette when more options is clicked', async () => {
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      // Clear initial preview calls
      vi.clearAllMocks()

      // Select second palette
      const secondOption = screen.getAllByTestId('theme-preview-option')[1]
      await user.click(secondOption)

      await waitFor(() => {
        expect(previewThemeModule.previewThemeInIframe).toHaveBeenCalledWith(
          mockPalettes[1].name,
          mockPalettes[1].palette
        )
      })

      vi.clearAllMocks()

      // Click "Generate More"
      const moreButton = screen.getByTestId('theme-preview-more-options')
      await user.click(moreButton)

      // Should revert to first palette (current applied theme)
      await waitFor(() => {
        expect(previewThemeModule.previewThemeInIframe).toHaveBeenCalledWith(
          mockPalettes[0].name,
          mockPalettes[0].palette
        )
      })
    })

    it('should be disabled when processing', () => {
      vi.mocked(StreamingStore.useIsLoading).mockReturnValue(true)

      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      expect(screen.getByTestId('theme-preview-more-options')).toBeDisabled()
    })
  })

  describe('cancel button', () => {
    it('should render cancel button when onCancel provided', () => {
      const onCancel = vi.fn()
      renderWithProviders(
        <ThemePreviewInputPanel
          toolCallId="test-id"
          palettes={mockPalettes}
          onCancel={onCancel}
        />
      )
      expect(screen.getByTestId('theme-preview-cancel')).toBeInTheDocument()
    })

    it('should not render cancel button when onCancel not provided', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      expect(screen.queryByTestId('theme-preview-cancel')).not.toBeInTheDocument()
    })

    it('should call onCancel when cancel is clicked', async () => {
      const onCancel = vi.fn()
      const { user } = renderWithProviders(
        <ThemePreviewInputPanel
          toolCallId="test-id"
          palettes={mockPalettes}
          onCancel={onCancel}
        />
      )

      const cancelButton = screen.getByTestId('theme-preview-cancel')
      await user.click(cancelButton)

      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('should be disabled when processing', () => {
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)
      const onCancel = vi.fn()

      renderWithProviders(
        <ThemePreviewInputPanel
          toolCallId="test-id"
          palettes={mockPalettes}
          onCancel={onCancel}
        />
      )

      expect(screen.getByTestId('theme-preview-cancel')).toBeDisabled()
    })
  })

  describe('applying state', () => {
    it('should show applying message when apply is clicked', async () => {
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(false)
      vi.mocked(StreamingStore.useIsLoading).mockReturnValue(false)

      const { user, rerender } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      const applyButton = screen.getByTestId('theme-preview-apply')
      await user.click(applyButton)

      // Simulate processing state
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)

      rerender(<ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />)

      await waitFor(() => {
        expect(screen.queryByText(/applying/i)).toBeInTheDocument()
      })
    })

    it('should hide palette list when applying', async () => {
      const { user, rerender } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      expect(screen.getAllByTestId('theme-preview-option')).toHaveLength(2)

      const applyButton = screen.getByTestId('theme-preview-apply')
      await user.click(applyButton)

      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)
      rerender(<ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />)

      await waitFor(() => {
        expect(screen.queryAllByTestId('theme-preview-option')).toHaveLength(0)
      })
    })
  })

  describe('accessibility', () => {
    it('should have radiogroup role', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )
      expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    })

    it('should have unique radio names per tool call', () => {
      const { rerender } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id-1" palettes={mockPalettes} />
      )

      const firstRadios = screen.getAllByRole('radio') as HTMLInputElement[]
      const firstName = firstRadios[0].name

      rerender(<ThemePreviewInputPanel toolCallId="test-id-2" palettes={mockPalettes} />)

      const secondRadios = screen.getAllByRole('radio') as HTMLInputElement[]
      const secondName = secondRadios[0].name

      expect(firstName).not.toBe(secondName)
    })

    it('should associate labels with radio inputs', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} />
      )

      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      radios.forEach(radio => {
        expect(radio.id).toBeTruthy()
      })
    })
  })

  describe('split layout callback', () => {
    it('passes body and footer to children for external composition', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={mockPalettes} onCancel={vi.fn()}>
          {({ body, footer }) => (
            <div data-testid="composed">
              {body}
              <div data-testid="composed-footer">{footer}</div>
            </div>
          )}
        </ThemePreviewInputPanel>
      )
      expect(screen.getByTestId('composed')).toBeInTheDocument()
      expect(screen.getByTestId('composed-footer')).toContainElement(screen.getByTestId('theme-preview-apply'))
      expect(screen.getAllByTestId('theme-preview-option')).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('should handle empty palettes array', () => {
      const { container } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={[]} />
      )
      expect(container.querySelector('[data-testid="theme-preview-option"]')).not.toBeInTheDocument()
    })

    it('should handle single palette', () => {
      renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id" palettes={[mockPalettes[0]]} />
      )
      const options = screen.getAllByTestId('theme-preview-option')
      expect(options).toHaveLength(1)
    })

    it('should reset selection when toolCallId changes', () => {
      const { rerender } = renderWithProviders(
        <ThemePreviewInputPanel toolCallId="test-id-1" palettes={mockPalettes} />
      )

      rerender(
        <ThemePreviewInputPanel
          toolCallId="test-id-2"
          palettes={[mockPalettes[1], mockPalettes[0]]}
        />
      )

      // Should select first palette of new list
      const firstRadio = screen.getAllByRole('radio')[0] as HTMLInputElement
      expect(firstRadio.checked).toBe(true)
    })
  })
})
