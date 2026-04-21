/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatTab } from '@/app/[market]/develop/components/types'
import { renderWithProviders } from '@/tests/test-utils'
import MediaSlotToolRenderer from './MediaSlotToolRenderer'

const mockPostMessageToIframe = vi.fn()
const mockNavigateToSlot = vi.fn()
const mockSetActiveChatTab = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  usePathname: () => '/test-app-id/develop',
  useParams: () => ({ id: 'test-app-id' }),
}))

vi.mock('@/utils/postMessage', () => ({
  postMessageToIframe: (...args: unknown[]) => mockPostMessageToIframe(...args),
}))

vi.mock('@/stores/useMediaSlotDialogStore', () => ({
  useMediaSlotDialogStore: (selector: unknown) => (selector as (state: unknown) => unknown)({
    navigateToSlot: mockNavigateToSlot,
  }),
}))

vi.mock('@/hooks/useChatTabs', () => ({
  useChatTabs: () => ({
    setActiveChatTab: mockSetActiveChatTab,
  }),
}))

const successResult = JSON.stringify({
  success: true,
  slot: 'pages/home/hero',
  slotUrl: '/airo-assets/images/pages/home/hero',
  mediaType: 'image',
  searchQuery: 'modern office',
  resolvedUrl: 'https://media.gettyimages.com/test.jpg',
  alternatives: ['https://media.gettyimages.com/alt1.jpg'],
  alternativeCount: 1,
})

describe('MediaSlotToolRenderer', () => {
  let mockIframe: HTMLIFrameElement

  beforeEach(() => {
    vi.clearAllMocks()
    // Create a mock iframe in the DOM
    mockIframe = document.createElement('iframe')
    mockIframe.id = 'preview-iframe'
    document.body.appendChild(mockIframe)
  })

  afterEach(() => {
    mockIframe.remove()
  })

  it('sends RELOAD_MEDIA_SLOT postMessage when tool completes', async () => {
    renderWithProviders(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="completed"
        result={successResult}
      />
    )

    await waitFor(() => {
      expect(mockPostMessageToIframe).toHaveBeenCalledWith(
        mockIframe,
        { type: 'RELOAD_MEDIA_SLOT', slotPath: 'pages/home/hero' }
      )
    })
  })

  it('does not send postMessage when tool is still running', async () => {
    renderWithProviders(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="running"
        result={successResult}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Selecting media...')).toBeInTheDocument()
    })

    expect(mockPostMessageToIframe).not.toHaveBeenCalled()
  })

  it('does not send postMessage when no iframe is present', async () => {
    mockIframe.remove()

    renderWithProviders(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="completed"
        result={successResult}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Home Hero')).toBeInTheDocument()
    })

    expect(mockPostMessageToIframe).not.toHaveBeenCalled()
  })

  it('sends postMessage once when transitioning from running to completed', async () => {
    const { rerender } = renderWithProviders(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="running"
        result={successResult}
      />
    )

    expect(mockPostMessageToIframe).not.toHaveBeenCalled()

    rerender(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="completed"
        result={successResult}
      />
    )

    await waitFor(() => {
      expect(mockPostMessageToIframe).toHaveBeenCalledTimes(1)
    })

    // Re-render again with same completed state — should not fire again
    rerender(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="completed"
        result={successResult}
      />
    )

    expect(mockPostMessageToIframe).toHaveBeenCalledTimes(1)
  })

  it('navigates to media tab and slot when clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <MediaSlotToolRenderer
        toolName="media"
        toolStatus="completed"
        result={successResult}
      />
    )

    const button = screen.getByRole('button')
    await user.click(button)

    expect(mockNavigateToSlot).toHaveBeenCalledWith('pages/home/hero')
    expect(mockSetActiveChatTab).toHaveBeenCalledWith(ChatTab.MEDIAS)
  })
})
