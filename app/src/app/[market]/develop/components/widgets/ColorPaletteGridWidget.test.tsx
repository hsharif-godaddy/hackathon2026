/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import * as ChatContext from '@/app/[market]/develop/components/chat/ChatContext'
import type { PaletteData } from '@/app/[market]/develop/components/types/colorScheme'
import * as StreamingStore from '@/stores/useStreamingConversationStore'
import { renderWithProviders } from '@/tests/test-utils'
import * as postMessageModule from '@/utils/postMessage'
import ColorPaletteGridWidget from './ColorPaletteGridWidget'

vi.mock('@/app/[market]/develop/components/chat/ChatContext', () => ({
  useSendUserMessage: vi.fn()
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: vi.fn(),
  useIsLoading: vi.fn()
}))

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: vi.fn()
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn((flag: string) => {
    if (flag === 'airo-builder-theme-selection-chat') {
      return { data: true, isLoading: false, error: null }
    }
    return { data: false, isLoading: false, error: null }
  }),
}))

describe('ColorPaletteGridWidget', () => {
  const mockPalettes: PaletteData[] = [
    {
      name: 'Ocean Blue',
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
  let mockIframe: HTMLIFrameElement

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendUserMessage)
    vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(false)
    vi.mocked(StreamingStore.useIsLoading).mockReturnValue(false)

    // Create mock iframe
    mockIframe = document.createElement('iframe')
    mockIframe.id = 'preview-iframe'
    document.body.appendChild(mockIframe)
  })

  afterEach(() => {
    // Clean up mock iframe
    document.body.removeChild(mockIframe)
  })

  describe('more options button', () => {
    it('should render more options button', () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)
      expect(screen.getByTestId('color-palette-more-options')).toBeInTheDocument()
    })

    it('should send user message when more options is clicked', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteGridWidget palettes={mockPalettes} />
      )

      const moreButton = screen.getByTestId('color-palette-more-options')
      await user.click(moreButton)

      await waitFor(() => {
        expect(mockSendUserMessage).toHaveBeenCalled()
      })
    })

    it('should revert preview when more options is clicked', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteGridWidget palettes={mockPalettes} />
      )

      // Simulate selecting a palette by dispatching palette-preview event
      const previewEvent = new CustomEvent('palette-preview', {
        detail: { name: 'Ocean Blue', ...mockPalettes[0].palette }
      })
      window.dispatchEvent(previewEvent)

      // Clear any previous calls
      vi.clearAllMocks()

      // Click "More Options"
      const moreButton = screen.getByTestId('color-palette-more-options')
      await user.click(moreButton)

      // Should send REVERT_THEME message to iframe
      await waitFor(() => {
        expect(postMessageModule.postMessageToIframe).toHaveBeenCalledWith(
          mockIframe,
          { type: 'REVERT_THEME' }
        )
      })
    })

    it('should be disabled when processing', () => {
      vi.mocked(StreamingStore.useIsLoading).mockReturnValue(true)

      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)

      expect(screen.getByTestId('color-palette-more-options')).toBeDisabled()
    })
  })

  describe('revert button', () => {
    it('should render revert button', () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)
      expect(screen.getByTestId('color-palette-revert')).toBeInTheDocument()
    })

    it('should send REVERT_THEME message when clicked', async () => {
      const { user } = renderWithProviders(
        <ColorPaletteGridWidget palettes={mockPalettes} />
      )

      const revertButton = screen.getByTestId('color-palette-revert')
      await user.click(revertButton)

      await waitFor(() => {
        expect(postMessageModule.postMessageToIframe).toHaveBeenCalledWith(
          mockIframe,
          { type: 'REVERT_THEME' }
        )
      })
    })
  })

  describe('save button', () => {
    it('should render save button', () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)
      expect(screen.getByTestId('color-palette-save')).toBeInTheDocument()
    })

    it('should be disabled when no palette is previewed', () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)
      expect(screen.getByTestId('color-palette-save')).toBeDisabled()
    })

    it('should be enabled when a palette is previewed', async () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)

      // Simulate selecting a palette
      const previewEvent = new CustomEvent('palette-preview', {
        detail: { name: 'Ocean Blue', ...mockPalettes[0].palette }
      })
      window.dispatchEvent(previewEvent)

      await waitFor(() => {
        expect(screen.getByTestId('color-palette-save')).not.toBeDisabled()
      })
    })

    it('should be disabled when processing', async () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)

      // Simulate selecting a palette
      const previewEvent = new CustomEvent('palette-preview', {
        detail: { name: 'Ocean Blue', ...mockPalettes[0].palette }
      })
      window.dispatchEvent(previewEvent)

      // Now enable processing
      vi.mocked(StreamingStore.useIsLoading).mockReturnValue(true)

      await waitFor(() => {
        expect(screen.getByTestId('color-palette-save')).toBeDisabled()
      })
    })
  })

  describe('rendering', () => {
    it('should render palette grid', () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)
      expect(screen.getByTestId('color-palette-grid')).toBeInTheDocument()
    })

    it('should render all palettes', () => {
      renderWithProviders(<ColorPaletteGridWidget palettes={mockPalettes} />)
      const options = screen.getAllByTestId('color-palette-option')
      expect(options).toHaveLength(2)
    })

    it('should not render when palettes is empty', () => {
      const { container } = renderWithProviders(<ColorPaletteGridWidget palettes={[]} />)
      expect(container.firstChild).toBeNull()
    })

    it('should not render when palettes lack complete format', () => {
      const incompletePalettes = [
        {
          name: 'Incomplete',
          palette: {
            primary: '#3b82f6'
            // Missing required background and foreground
          }
        }
      ] as PaletteData[]

      const { container } = renderWithProviders(
        <ColorPaletteGridWidget palettes={incompletePalettes} />
      )
      expect(container.firstChild).toBeNull()
    })
  })
})
