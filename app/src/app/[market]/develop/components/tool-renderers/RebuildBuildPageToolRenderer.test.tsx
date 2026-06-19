/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'
import { renderWithProviders } from '@/tests/test-utils'
import { getToolRenderer } from './index'
import RebuildBuildPageToolRenderer from './RebuildBuildPageToolRenderer'

// Key-aware translation mock so each rendered string is predictable.
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string, values?: Record<string, unknown>) => {
    if (id === 'builder_rebuild_building_page') {
      return `Building ${values?.pageTitle ?? ''} page...`
    }
    if (id === 'builder_rebuild_inner_confirmation_title') {
      return `Rebuilt your ${values?.pageTitle ?? ''} page from your site`
    }
    if (id === 'builder_rebuild_inner_confirmation_detail') {
      return `${values?.count ?? 0} images carried over`
    }
    if (id === 'builder_rebuild_view_source') return 'View source'
    if (id === 'builder_rebuild_source_modal_title') return `What we used for ${values?.pageTitle ?? ''}`
    if (id === 'builder_rebuild_view_original_page') return 'View original page'
    if (id === 'builder_rebuild_count_images') return `${values?.count ?? 0} images`
    if (id === 'builder_rebuild_navigation_label') return `Navigation (${values?.count ?? 0})`
    if (id === 'builder_rebuild_no_snapshot_available') return 'No snapshot available'
    if (id === 'builder_status_error') return 'Something went wrong'
    return id
  },
}))

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (s: { currentAppId: string }) => unknown) =>
    selector({ currentAppId: 'app123' }),
}))

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({ tokenAuthType: undefined }),
}))

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('@/services/AppService', () => ({
  appService: { readFile: vi.fn() },
}))

const streamingState = { isStreaming: false, isLoading: false }
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => streamingState.isStreaming,
  useIsLoading: () => streamingState.isLoading,
}))

// Design-system pieces used only inside the modal — stub to passthrough so the
// test exercises the renderer's data/branch logic, not UXCore internals.
vi.mock('@ux/spinner', () => ({ default: () => <div data-testid="spinner" /> }))
vi.mock('./ToolModal', () => ({
  default: ({ isOpen, children }: { isOpen?: boolean; children?: ReactNode }) =>
    isOpen ? <div data-testid="tool-modal">{children}</div> : null,
}))

const readFileMock = appService.readFile as unknown as ReturnType<typeof vi.fn>
const warnMock = logger.warn as unknown as ReturnType<typeof vi.fn>

const OUTPUT = { pageSlug: 'about', pageTitle: 'About', sourceUrl: 'https://x.com/about', imageCount: 8 }

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`Failed to load file content: ${status}`), { status })
}

beforeEach(() => {
  readFileMock.mockReset()
  warnMock.mockReset()
  streamingState.isStreaming = false
  streamingState.isLoading = false
})

describe('RebuildBuildPageToolRenderer', () => {
  it('renders the completed confirmation when the stream has finished', () => {
    renderWithProviders(
      <RebuildBuildPageToolRenderer
        toolName="rebuildBuildPage"
        toolStatus="completed"
        isLastAssistantMessage
        result={OUTPUT}
      />
    )
    expect(screen.getByTestId('rebuild-build-page-confirmation')).toHaveAttribute('data-phase', 'completed')
    expect(screen.getByText(/Rebuilt your About page from your site/i)).toBeInTheDocument()
  })

  it('renders the in-progress card while the last assistant stream is active', () => {
    streamingState.isStreaming = true
    renderWithProviders(
      <RebuildBuildPageToolRenderer
        toolName="rebuildBuildPage"
        toolStatus="completed"
        isLastAssistantMessage
        result={OUTPUT}
      />
    )
    expect(screen.getByTestId('rebuild-build-page-confirmation')).toHaveAttribute('data-phase', 'building')
    expect(screen.getByText(/Building About page\.\.\./i)).toBeInTheDocument()
    expect(screen.queryByText(/Rebuilt your About page from your site/i)).not.toBeInTheDocument()
  })

  it('renders completed copy for historical messages even while a new stream runs', () => {
    streamingState.isStreaming = true
    renderWithProviders(
      <RebuildBuildPageToolRenderer toolName="rebuildBuildPage" toolStatus="completed" result={OUTPUT} />
    )
    expect(screen.getByTestId('rebuild-build-page-confirmation')).toHaveAttribute('data-phase', 'completed')
    expect(screen.getByText(/Rebuilt your About page from your site/i)).toBeInTheDocument()
  })

  it('shows the image-count line when imageCount > 0', () => {
    renderWithProviders(
      <RebuildBuildPageToolRenderer toolName="rebuildBuildPage" toolStatus="completed" result={OUTPUT} />
    )
    expect(screen.getByText(/8 images carried over/i)).toBeInTheDocument()
  })

  it('omits the image-count line when imageCount is 0', () => {
    renderWithProviders(
      <RebuildBuildPageToolRenderer
        toolName="rebuildBuildPage"
        toolStatus="completed"
        result={{ ...OUTPUT, imageCount: 0 }}
      />
    )
    expect(screen.queryByText(/images carried over/i)).not.toBeInTheDocument()
  })

  it('renders a View source affordance when sourceUrl is present', () => {
    renderWithProviders(
      <RebuildBuildPageToolRenderer toolName="rebuildBuildPage" toolStatus="completed" result={OUTPUT} />
    )
    expect(screen.getByText('View source')).toBeInTheDocument()
  })

  it('renders nothing before the result arrives (no pageSlug)', () => {
    const { container } = renderWithProviders(
      <RebuildBuildPageToolRenderer toolName="rebuildBuildPage" toolStatus="running" />
    )
    expect(container.innerHTML).toBe('')
  })

  // Guards the cross-package seam: the backend emits tool.name 'rebuildBuildPage'
  // (REBUILD_BUILD_PAGE_TOOL_NAME); if the registry key is renamed/removed the card
  // silently falls back to DefaultToolRenderer with no other test failing.
  it('is wired into the tool-renderer registry under the backend tool name', () => {
    expect(getToolRenderer('rebuildBuildPage')).toBe(RebuildBuildPageToolRenderer)
  })
})

describe('RebuildBuildPageToolRenderer — View source modal', () => {
  function openModal() {
    renderWithProviders(
      <RebuildBuildPageToolRenderer toolName="rebuildBuildPage" toolStatus="completed" result={OUTPUT} />
    )
    fireEvent.click(screen.getByText('View source'))
  }

  it('renders the snapshot (description, images, nav) on a successful load', async () => {
    readFileMock.mockImplementation((_appId: string, path: string) => {
      if (path.includes('/pages/')) {
        return Promise.resolve({
          truncated: false,
          content: JSON.stringify({
            metadata: { description: 'About page description' },
            structure: { navigation: [{ label: 'Home', url: '/', isExternal: false }] },
            sanitizedContent: 'About body text',
          }),
        })
      }
      return Promise.resolve({
        truncated: false,
        content: JSON.stringify({
          assets: [{ url: 'https://cdn/x.jpg', type: 'image', sourcePages: ['https://x.com/about'], altText: 'pic' }],
        }),
      })
    })

    openModal()

    expect(await screen.findByText('About page description')).toBeInTheDocument()
    expect(screen.getByText('Home')).toBeInTheDocument()
    // Modal grid heading describes what's shown ("1 image") — deliberately distinct
    // from the card's "carried over" wording so divergent counts don't read as a bug.
    const modal = screen.getByTestId('tool-modal')
    expect(within(modal).getByText('1 images')).toBeInTheDocument()
    expect(within(modal).queryByText(/carried over/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    expect(screen.queryByText('No snapshot available')).not.toBeInTheDocument()
    expect(warnMock).not.toHaveBeenCalled()
  })

  // Whole-file reads: both snapshots must bypass the supervisor's default line
  // cap, or a large manifest comes back clipped and JSON.parse throws (AIROBUILD-2670).
  it('requests both snapshots as whole-file reads (raised line cap)', async () => {
    readFileMock.mockResolvedValue({ truncated: false, content: JSON.stringify({ assets: [] }) })

    openModal()

    await screen.findByTestId('tool-modal')
    const calls = readFileMock.mock.calls
    const pageCall = calls.find(([, p]: [string, string]) => p.includes('/pages/'))
    const manifestCall = calls.find(([, p]: [string, string]) => p.includes('manifest.json'))
    expect(pageCall?.[2]?.maxLines).toBeGreaterThan(0)
    expect(manifestCall?.[2]?.maxLines).toBeGreaterThan(0)
  })

  // A truncated read (clipped JSON) must surface as a real error, never the benign
  // empty state — otherwise a half-parsed manifest reads as "no snapshot".
  it('treats a truncated read as a load failure, not the empty state', async () => {
    readFileMock.mockImplementation((_appId: string, path: string) => {
      if (path.includes('/pages/')) {
        return Promise.resolve({ truncated: false, content: JSON.stringify({ sanitizedContent: 'About body' }) })
      }
      // Manifest comes back clipped — content is no longer valid JSON.
      return Promise.resolve({ truncated: true, content: '{ "assets": [ {' })
    })

    openModal()

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.queryByText('No snapshot available')).not.toBeInTheDocument()
    expect(warnMock).toHaveBeenCalled()
  })

  it('shows an error message (not the empty state) on a real load failure', async () => {
    readFileMock.mockRejectedValue(httpError(500))

    openModal()

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.queryByText('No snapshot available')).not.toBeInTheDocument()
    // Real failures ARE logged.
    expect(warnMock).toHaveBeenCalled()
  })

  it('shows the benign empty state (and does not log) on an expected 404', async () => {
    readFileMock.mockRejectedValue(httpError(404))

    openModal()

    expect(await screen.findByText('No snapshot available')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    // A 404 is expected absence — must NOT be logged at warn.
    expect(warnMock).not.toHaveBeenCalled()
  })
})
