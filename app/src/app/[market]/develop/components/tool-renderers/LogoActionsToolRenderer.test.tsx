/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'

import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { renderWithProviders } from '@/tests/test-utils'
import { fetchAsDataUrl } from '@/utils/image'
import LogoActionsToolRenderer from './LogoActionsToolRenderer'

vi.mock('@/hooks/useIsEmbedded', () => ({
  useIsEmbedded: vi.fn().mockReturnValue(false),
}))

vi.mock('@/components/security/allowed-frame-ancestors', () => ({
  getParentOrigin: vi.fn().mockReturnValue('https://dashboard.godaddy.com'),
}))

vi.mock('@/utils/image', () => ({
  fetchAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
}))

const completedResult = {
  structuredContent: { imageUrl: 'https://example.com/logo.png' },
}

describe('LogoActionsToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useIsEmbedded).mockReturnValue(false)
    vi.mocked(getParentOrigin).mockReturnValue('https://dashboard.godaddy.com')
    vi.mocked(fetchAsDataUrl).mockResolvedValue('data:image/png;base64,abc')
  })

  it('returns null when tool is not completed', () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)

    const { container } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="running"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('returns null when not embedded', () => {
    vi.mocked(useIsEmbedded).mockReturnValue(false)

    const { container } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders two buttons when embedded and completed', () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)

    renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(screen.getByText('builder_mediaslot_add_to_library')).toBeInTheDocument()
    expect(screen.getByText('builder_mediaslot_set_as_logo')).toBeInTheDocument()
  })

  it('sends postMessage with base64 data URL on click', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await user.click(screen.getByText('builder_mediaslot_add_to_library'))

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { action: 'add-to-library', sender: 'airo-hq', imageUrl: 'data:image/png;base64,abc' },
        'https://dashboard.godaddy.com'
      )
    })
    postMessageSpy.mockRestore()
  })

  it('shows confirmation text after action', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await user.click(screen.getByText('builder_mediaslot_set_as_logo'))

    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_logo_set')).toBeInTheDocument()
    })
    postMessageSpy.mockRestore()
  })

  it('add-to-library only disables itself, not set-as-logo', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await user.click(screen.getByText('builder_mediaslot_add_to_library'))

    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_added')).toBeInTheDocument()
    })

    // set-as-logo should still be enabled
    const logoButton = screen.getByText('builder_mediaslot_set_as_logo')
    expect(logoButton.closest('button')).not.toBeDisabled()

    postMessageSpy.mockRestore()
  })

  it('set-as-logo disables both buttons (implies add-to-library)', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await user.click(screen.getByText('builder_mediaslot_set_as_logo'))

    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_logo_set')).toBeInTheDocument()
    })

    // add-to-library should also be disabled since set-as-logo implies it
    expect(screen.getByText('builder_mediaslot_added').closest('button')).toBeDisabled()

    postMessageSpy.mockRestore()
  })

  it('resets buttons when imageUrl changes', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user, rerender } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await user.click(screen.getByText('builder_mediaslot_add_to_library'))

    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_added')).toBeInTheDocument()
    })

    // Re-render with a different imageUrl
    rerender(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={{
          structuredContent: { imageUrl: 'https://example.com/new-logo.png' },
        }}
      />
    )

    // Button should be reset
    expect(screen.getByText('builder_mediaslot_add_to_library')).toBeInTheDocument()
    expect(screen.getByText('builder_mediaslot_add_to_library').closest('button')).not.toBeDisabled()

    postMessageSpy.mockRestore()
  })

  it('falls back to raw URL when fetchAsDataUrl fails', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    vi.mocked(fetchAsDataUrl).mockRejectedValueOnce(new Error('Network error'))
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await user.click(screen.getByText('builder_mediaslot_add_to_library'))

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        { action: 'add-to-library', sender: 'airo-hq', imageUrl: 'https://example.com/logo.png' },
        'https://dashboard.godaddy.com'
      )
    })
    postMessageSpy.mockRestore()
  })

  it('resets buttons when logo-select event fires with a different logo', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    // Click a button so it shows confirmation state
    await user.click(screen.getByText('builder_mediaslot_set_as_logo'))
    await waitFor(() => {
      expect(screen.getByText('builder_mediaslot_logo_set')).toBeInTheDocument()
    })

    // Simulate selecting a different logo from the grid
    act(() => {
      window.dispatchEvent(
        new CustomEvent('logo-select', {
          detail: { transparentUrl: 'https://example.com/different-logo.png' },
        })
      )
    })

    // Buttons should reset
    expect(screen.getByText('builder_mediaslot_set_as_logo')).toBeInTheDocument()
    expect(screen.getByText('builder_mediaslot_set_as_logo').closest('button')).not.toBeDisabled()
    expect(screen.getByText('builder_mediaslot_add_to_library')).toBeInTheDocument()
    expect(screen.getByText('builder_mediaslot_add_to_library').closest('button')).not.toBeDisabled()

    postMessageSpy.mockRestore()
  })

  it('sends the selected logo URL after logo-select event', async () => {
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    vi.mocked(fetchAsDataUrl).mockResolvedValue('data:image/png;base64,newlogo')
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { user } = renderWithProviders(
      <LogoActionsToolRenderer
        toolName="media-logo__offer_logo_actions"
        toolStatus="completed"
        result={completedResult}
      />
    )

    // Select a different logo from the grid
    act(() => {
      window.dispatchEvent(
        new CustomEvent('logo-select', {
          detail: { transparentUrl: 'https://example.com/selected-logo.png' },
        })
      )
    })

    await user.click(screen.getByText('builder_mediaslot_set_as_logo'))

    await waitFor(() => {
      expect(fetchAsDataUrl).toHaveBeenCalledWith('https://example.com/selected-logo.png')
      expect(postMessageSpy).toHaveBeenCalledWith(
        { action: 'set-as-logo', sender: 'airo-hq', imageUrl: 'data:image/png;base64,newlogo' },
        'https://dashboard.godaddy.com'
      )
    })

    postMessageSpy.mockRestore()
  })
})
