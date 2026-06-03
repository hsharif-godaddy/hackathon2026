/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'

import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { renderWithProviders } from '@/tests/test-utils'
import { fetchAsDataUrl } from '@/utils/image'
import { logImpressionEvent } from '@/utils/instrumentation'
import SetVentureLogoToolRenderer from './SetVentureLogoToolRenderer'

vi.mock('@/hooks/useIsEmbedded', () => ({
  useIsEmbedded: vi.fn().mockReturnValue(true),
}))

vi.mock('@/components/security/allowed-frame-ancestors', () => ({
  getParentOrigin: vi.fn().mockReturnValue('https://dashboard.godaddy.com'),
}))

vi.mock('@/utils/image', () => ({
  fetchAsDataUrl: vi.fn(),
}))

vi.mock('@/utils/instrumentation', () => {
  const fired = vi.fn()
  return {
    logImpressionEvent: vi.fn(function () { return fired; }),
    __fired: fired,
  }
})

const completedResult = {
  structuredContent: {
    horizontalUrl: 'https://cdn/h.png',
    squareUrl: 'https://cdn/s.png',
  },
}

describe('SetVentureLogoToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    vi.mocked(getParentOrigin).mockReturnValue('https://dashboard.godaddy.com')
    vi.mocked(fetchAsDataUrl).mockImplementation(async function (url: string) { return `data:image/png;base64,${url}`; })
  })

  it('returns null when not embedded', () => {
    vi.mocked(useIsEmbedded).mockReturnValue(false)

    const { container } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('returns null when getParentOrigin is null', () => {
    vi.mocked(getParentOrigin).mockReturnValue(null)

    const { container } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('returns null when status is not completed', () => {
    const { container } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="running"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  describe('malformed result', () => {
    const cases: Array<{ name: string; result: unknown }> = [
      { name: 'null', result: null },
      { name: 'string', result: 'not-an-object' },
      { name: 'missing structuredContent', result: {} },
      { name: 'structuredContent is null', result: { structuredContent: null } },
      {
        name: 'horizontalUrl is not a string',
        result: { structuredContent: { horizontalUrl: 42, squareUrl: 'https://cdn/s.png' } },
      },
      {
        name: 'squareUrl is not a string',
        result: { structuredContent: { horizontalUrl: 'https://cdn/h.png', squareUrl: undefined } },
      },
      {
        name: 'horizontalUrl is empty string',
        result: { structuredContent: { horizontalUrl: '', squareUrl: 'https://cdn/s.png' } },
      },
      {
        name: 'squareUrl is empty string',
        result: { structuredContent: { horizontalUrl: 'https://cdn/h.png', squareUrl: '' } },
      },
    ]

    it.each(cases)('returns null and posts nothing when result is $name', async ({ result }) => {
      const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

      const { container } = renderWithProviders(
        <SetVentureLogoToolRenderer
          toolName="media-logo__set_venture_logo"
          toolStatus="completed"
          result={result}
        />
      )

      expect(container.innerHTML).toBe('')
      // Nothing should fire even after the microtask queue drains.
      await new Promise((r) => setTimeout(r, 0))
      expect(postMessageSpy).not.toHaveBeenCalled()
      postMessageSpy.mockRestore()
    })
  })

  it('fires a single add-to-library postMessage with both data URLs when embedded', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1)
    })

    expect(postMessageSpy.mock.calls[0]).toEqual([
      {
        action: 'add-to-library',
        sender: 'airo-hq',
        data: [
          { key: 'square', dataUrl: 'data:image/png;base64,https://cdn/s.png' },
          { key: 'horizontal', dataUrl: 'data:image/png;base64,https://cdn/h.png' },
        ],
      },
      'https://dashboard.godaddy.com',
    ])

    postMessageSpy.mockRestore()
  })

  it('fires postMessage exactly once across re-renders', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { rerender } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1)
    })

    rerender(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    // Still only 1 call — no re-fire
    expect(postMessageSpy).toHaveBeenCalledTimes(1)
    postMessageSpy.mockRestore()
  })

  it('fires postMessage exactly once when transitioning from running to completed', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { rerender } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="running"
        result={completedResult}
      />
    )

    // Running phase — nothing should have fired.
    await new Promise((r) => setTimeout(r, 10))
    expect(postMessageSpy).not.toHaveBeenCalled()

    rerender(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1)
    })

    postMessageSpy.mockRestore()
  })

  it('fires the impression event exactly once across re-renders', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { rerender } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1)
    })

    expect(vi.mocked(logImpressionEvent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logImpressionEvent)).toHaveBeenCalledWith(
      'develop.brand.logo_set_to_venture',
      { flow: 'logo-designer' }
    )

    rerender(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(vi.mocked(logImpressionEvent)).toHaveBeenCalledTimes(1)
    postMessageSpy.mockRestore()
  })

  it('drops the variant whose fetchAsDataUrl rejects but still fires the other and reports done', async () => {
    vi.mocked(fetchAsDataUrl).mockImplementation(async function (url: string) {
      if (url === 'https://cdn/s.png') throw new Error('fetch failed')
      return `data:image/png;base64,${url}`
    })
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1)
    })

    expect(postMessageSpy.mock.calls[0]).toEqual([
      {
        action: 'add-to-library',
        sender: 'airo-hq',
        data: [
          null,
          { key: 'horizontal', dataUrl: 'data:image/png;base64,https://cdn/h.png' },
        ],
      },
      'https://dashboard.godaddy.com',
    ])

    // Partial success still surfaces the success copy — at least one variant reached the dashboard.
    await waitFor(() => {
      expect(screen.getByText('Logo saved to your dashboard.')).toBeInTheDocument()
    })

    postMessageSpy.mockRestore()
  })

  it('reports an error and posts nothing when both fetchAsDataUrl calls reject', async () => {
    vi.mocked(fetchAsDataUrl).mockRejectedValue(new Error('fetch failed'))
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText("We couldn't sync your logo to your dashboard. Please try again.")
      ).toBeInTheDocument()
    })

    expect(postMessageSpy).not.toHaveBeenCalled()
    postMessageSpy.mockRestore()
  })
})
