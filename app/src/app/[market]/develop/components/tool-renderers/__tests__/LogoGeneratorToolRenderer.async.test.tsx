// @vitest-environment jsdom
import { beforeEach,describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useStreamingConversationStore: (sel: (s: unknown) => unknown) => sel({ currentAppId: 'app-1' }),
}))
// logoJobResults is keyed appId -> jobId -> result (see useDevelopPageStore).
let storeState: { logoJobResults: Record<string, Record<string, unknown>> } = { logoJobResults: {} }
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (sel: (s: unknown) => unknown) => sel(storeState),
}))
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string) => id,
}))

import LogoGeneratorToolRenderer from '../LogoGeneratorToolRenderer'

const startedResult = { structuredContent: { started: true, jobId: 'job-1', slots: ['logo/horizontal'] } }
const startedResult2 = { structuredContent: { started: true, jobId: 'job-2', slots: ['logo/horizontal'] } }

beforeEach(() => { vi.clearAllMocks(); storeState = { logoJobResults: {} } })

describe('LogoGeneratorToolRenderer (async)', () => {
  it('shows the generating placeholder while pending (no img)', () => {
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input={{}} result={startedResult as never} />)
    const placeholder = screen.getByTestId('logo-generating-placeholder')
    expect(placeholder).toBeInTheDocument()
    expect(within(placeholder).queryByRole('img')).toBeNull()
  })

  it('shows the real hosted logo when the store reports completion for this jobId', () => {
    storeState = {
      logoJobResults: {
        'app-1': {
          'job-1': {
            jobId: 'job-1',
            status: 'completed',
            slots: ['logo/horizontal'],
            logo: {
              id: 'l',
              urls: {
                horizontal: {
                  transparent: 'https://cdn.example/h-transparent.png',
                  solid: 'https://cdn.example/h-solid.png',
                },
              },
            },
          },
        },
      },
    }
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input={{}} result={startedResult as never} />)
    const img = screen.getByTestId('logo-result-image') as HTMLImageElement
    // Solid variant preferred over transparent (matches the Brand Book light panel).
    expect(img.getAttribute('src')).toBe('https://cdn.example/h-solid.png')
    expect(screen.queryByTestId('logo-generating-placeholder')).not.toBeInTheDocument()
  })

  it('shows an error when the store reports failure', () => {
    storeState = { logoJobResults: { 'app-1': { 'job-1': { jobId: 'job-1', status: 'failed', slots: [], error: 'boom' } } } }
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input={{}} result={startedResult as never} />)
    expect(screen.getByTestId('logo-error')).toBeInTheDocument()
  })

  it('each card reads its OWN jobId — an older card is not stuck on the placeholder when a second job arrives', () => {
    // Both jobs have completed; the store holds a result for each jobId.
    storeState = {
      logoJobResults: {
        'app-1': {
          'job-1': {
            jobId: 'job-1',
            status: 'completed',
            slots: ['logo/horizontal'],
            logo: { id: 'l1', urls: { horizontal: { solid: 'https://cdn.example/j1-solid.png' } } },
          },
          'job-2': {
            jobId: 'job-2',
            status: 'completed',
            slots: ['logo/horizontal'],
            logo: { id: 'l2', urls: { horizontal: { solid: 'https://cdn.example/j2-solid.png' } } },
          },
        },
      },
    }

    // Older card (job-1) — must show its own completed logo, NOT the generating placeholder.
    const { unmount } = render(
      <LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input={{}} result={startedResult as never} />,
    )
    expect(screen.queryByTestId('logo-generating-placeholder')).not.toBeInTheDocument()
    expect((screen.getByTestId('logo-result-image') as HTMLImageElement).getAttribute('src')).toBe('https://cdn.example/j1-solid.png')
    unmount()

    // Newer card (job-2) — shows its own logo.
    render(
      <LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t2" input={{}} result={startedResult2 as never} />,
    )
    expect(screen.queryByTestId('logo-generating-placeholder')).not.toBeInTheDocument()
    expect((screen.getByTestId('logo-result-image') as HTMLImageElement).getAttribute('src')).toBe('https://cdn.example/j2-solid.png')
  })

  it('renders a warning caption listing failed layouts when slotSaveFailed is set, while still showing the logo', () => {
    storeState = {
      logoJobResults: {
        'app-1': {
          'job-1': {
            jobId: 'job-1',
            status: 'completed',
            slots: ['logo/horizontal'],
            slotSaveFailed: true,
            failedLayouts: ['vertical'],
            logo: { id: 'l', urls: { horizontal: { solid: 'https://cdn.example/h-solid.png' } } },
          },
        },
      },
    }
    render(<LogoGeneratorToolRenderer toolName="media-logo__generate_logo" toolStatus="completed" toolId="t1" input={{}} result={startedResult as never} />)
    expect(screen.getByTestId('logo-result-warning')).toBeInTheDocument()
    // Logo is still shown — the saved slots are valid.
    expect(screen.getByTestId('logo-result-image')).toBeInTheDocument()
  })
})
