/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import type { SuggestedDesignKitOption } from '@/app/[market]/develop/components/utils/findLatestDesignKitSuggest'
import * as StreamingStore from '@/stores/useStreamingConversationStore'
import { renderWithProviders } from '@/tests/test-utils'
import * as ChatContext from './ChatContext'
import DesignKitSelectorPanel from './DesignKitSelectorPanel'

vi.mock('./ChatContext', () => ({
  useSendUserMessage: vi.fn(),
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: vi.fn(),
  useIsLoading: vi.fn(),
}))

const mockKits: SuggestedDesignKitOption[] = [
  {
    slug: 'bold-studio',
    displayName: 'Bold Studio',
    thumbnailUrl: 'https://cdn.example/bold.webp',
    tags: ['bold'],
    palette: { primary: '#111111', background: '#ffffff', foreground: '#000000', accent: '#ff0000', muted: '#eeeeee' },
    displayFont: 'Inter',
  },
  {
    slug: 'soft-serif',
    displayName: 'Soft Serif',
    thumbnailUrl: null,
    tags: ['elegant'],
    palette: { primary: '#223344', background: '#fafafa', foreground: '#111111' },
    displayFont: 'Lora',
  },
  {
    slug: 'mono-minimal',
    displayName: 'Mono Minimal',
    thumbnailUrl: 'https://cdn.example/mono.webp',
    tags: [],
    palette: { primary: '#000000' },
    displayFont: null,
  },
  {
    slug: 'extra-kit',
    displayName: 'Extra Kit',
    thumbnailUrl: null,
    tags: [],
    palette: {},
    displayFont: null,
  },
]

const mockSendUserMessage = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(ChatContext.useSendUserMessage).mockReturnValue(mockSendUserMessage)
  vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(false)
  vi.mocked(StreamingStore.useIsLoading).mockReturnValue(false)
})

describe('DesignKitSelectorPanel', () => {
  describe('rendering', () => {
    it('renders the panel', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      expect(screen.getByTestId('design-kit-selector-panel')).toBeInTheDocument()
    })

    it('shows the "you can change it later" subtitle under the title', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      expect(screen.getByText(/change it later/i)).toBeInTheDocument()
    })

    it('renders only the first 3 kits even when more are returned', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      const options = screen.getAllByTestId('design-kit-option')
      expect(options).toHaveLength(3)
      expect(screen.queryByText('Extra Kit')).not.toBeInTheDocument()
    })

    it('respects a custom limit', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} limit={2} />)
      expect(screen.getAllByTestId('design-kit-option')).toHaveLength(2)
    })

    it('displays the kit names', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      expect(screen.getByText('Bold Studio')).toBeInTheDocument()
      expect(screen.getByText('Soft Serif')).toBeInTheDocument()
      expect(screen.getByText('Mono Minimal')).toBeInTheDocument()
    })

    it('renders a thumbnail img only when thumbnailUrl is present', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      const imgs = screen.getAllByRole('img')
      // Bold Studio + Mono Minimal have thumbnails; Soft Serif (null) does not.
      expect(imgs).toHaveLength(2)
      expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['Bold Studio', 'Mono Minimal'])
    })

    it('does not render a per-card font caption or palette swatches (they live in the thumbnail)', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      // Font caption removed — the kit's display font is baked into the thumbnail image.
      expect(screen.queryByText(/Inter/)).not.toBeInTheDocument()
      expect(screen.queryByText(/Lora/)).not.toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('pre-selects the first kit', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      const firstRadio = screen.getAllByRole('radio')[0] as HTMLInputElement
      expect(firstRadio.checked).toBe(true)
    })

    it('updates the selection when another option is clicked', async () => {
      const { user } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      await user.click(screen.getAllByTestId('design-kit-option')[1])
      await waitFor(() => {
        const secondRadio = screen.getAllByRole('radio')[1] as HTMLInputElement
        expect(secondRadio.checked).toBe(true)
      })
    })

    it('uses a unique radio group name per tool call', () => {
      const { rerender } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      const firstName = (screen.getAllByRole('radio')[0] as HTMLInputElement).name
      rerender(<DesignKitSelectorPanel toolCallId="tc2" kits={mockKits} />)
      const secondName = (screen.getAllByRole('radio')[0] as HTMLInputElement).name
      expect(firstName).not.toBe(secondName)
    })

    it('resets the highlight to the first kit when a re-suggest changes toolCallId', async () => {
      const { user, rerender } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      await user.click(screen.getAllByTestId('design-kit-option')[1])
      await waitFor(() => expect((screen.getAllByRole('radio')[1] as HTMLInputElement).checked).toBe(true))

      // A fresh suggestion reuses this mounted panel (static composer-takeover key);
      // the selection must reset rather than carry the prior highlight over.
      rerender(<DesignKitSelectorPanel toolCallId="tc2" kits={mockKits} />)
      await waitFor(() => {
        const radios = screen.getAllByRole('radio') as HTMLInputElement[]
        expect(radios[0].checked).toBe(true)
        expect(radios[1].checked).toBe(false)
      })
    })
  })

  describe('choose / skip', () => {
    it('sends the chosen kit name as an action request', async () => {
      const { user } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      await user.click(screen.getByTestId('design-kit-apply'))
      await waitFor(() => {
        expect(mockSendUserMessage).toHaveBeenCalledTimes(1)
      })
      const [message, options] = mockSendUserMessage.mock.calls[0]
      expect(message).toContain('Bold Studio')
      // AIROBUILD-3229: customer-facing copy is "vibe", not "design kit".
      expect(message).toMatch(/\bvibe\b/i)
      expect(message).not.toMatch(/design kit/i)
      expect(options).toEqual({ isActionRequest: true })
    })

    it('sends the selected kit after the user changes selection', async () => {
      const { user } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      await user.click(screen.getAllByTestId('design-kit-option')[1])
      await user.click(screen.getByTestId('design-kit-apply'))
      await waitFor(() => {
        expect(mockSendUserMessage.mock.calls[0][0]).toContain('Soft Serif')
      })
    })

    it('sends the skip action request when Skip is clicked', async () => {
      const { user } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      await user.click(screen.getByTestId('design-kit-skip'))
      await waitFor(() => {
        expect(mockSendUserMessage).toHaveBeenCalledTimes(1)
      })
      const [message, options] = mockSendUserMessage.mock.calls[0]
      expect(message).toMatch(/skip/i)
      expect(options).toEqual({ isActionRequest: true })
    })
  })

  describe('processing state', () => {
    it('disables both buttons while the agent is streaming', () => {
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      expect(screen.getByTestId('design-kit-apply')).toBeDisabled()
      expect(screen.getByTestId('design-kit-skip')).toBeDisabled()
    })

    it('shows the applying state and hides the cards after a choice', async () => {
      const { user, rerender } = renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      expect(screen.getAllByTestId('design-kit-option')).toHaveLength(3)

      await user.click(screen.getByTestId('design-kit-apply'))
      vi.mocked(StreamingStore.useIsActivelyStreaming).mockReturnValue(true)
      rerender(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)

      await waitFor(() => {
        expect(screen.queryAllByTestId('design-kit-option')).toHaveLength(0)
        expect(screen.getByText(/setting up your kit/i)).toBeInTheDocument()
      })
    })
  })

  describe('accessibility', () => {
    it('exposes a radiogroup', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={mockKits} />)
      expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    })
  })

  describe('edge cases', () => {
    it('renders nothing selectable for an empty kit list but still mounts', () => {
      renderWithProviders(<DesignKitSelectorPanel toolCallId="tc1" kits={[]} />)
      expect(screen.getByTestId('design-kit-selector-panel')).toBeInTheDocument()
      expect(screen.queryAllByTestId('design-kit-option')).toHaveLength(0)
      expect(screen.getByTestId('design-kit-apply')).toBeDisabled()
    })
  })
})
