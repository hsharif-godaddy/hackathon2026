/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'

import { REBUILD_BATCH_CAP, useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import type { PageInfo } from '@/app/[market]/develop/hooks/useRebuildPages'
import { useUpfrontRebuildBuildQueueStore } from '@/stores/useUpfrontRebuildBuildQueueStore'
import { renderWithProviders } from '@/tests/test-utils'
import RebuildPageSelectorToolRenderer, { resolvePageDevelopStatus } from './RebuildPageSelectorToolRenderer'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string, values?: Record<string, unknown>) => {
    if (id === 'builder_rebuild_build_n_pages') return `Build ${values?.count ?? 0} pages`
    if (id === 'builder_rebuild_select_pages_cta') return 'Select pages'
    if (id === 'builder_rebuild_select_all') return 'Select all'
    if (id === 'builder_common_deselect_all') return 'Deselect all'
    if (id === 'builder_rebuild_show_more') return `Show ${values?.count ?? 0} more`
    if (id === 'builder_rebuild_show_fewer') return 'Show fewer'
    if (id === 'builder_rebuild_all_pages_built') return 'All pages built'
    return id
  },
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}))

// Switchboard flags drive `panelOwnsSelector`. Default OFF → the stream card is the
// sole host and renders the full selector (the common test path).
const switchboardFlags: Record<string, boolean> = {}
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => switchboardFlags[flag] ?? false,
}))

function pages(n: number): PageInfo[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `p${i}`, title: `Page ${i}`, url: `/p${i}`, isBuilt: false }))
}

function renderSelector(availablePages: PageInfo[], size: 'regular' | 'small' = 'small') {
  return renderWithProviders(
    <RebuildPageSelectorToolRenderer
      toolName="rebuildPageSelector"
      toolStatus="completed"
      isLastAssistantMessage
      size={size}
      result={{ widget: { widgetType: 'rebuild-page-selector', widgetData: { appId: 'a', sourceUrl: 's', availablePages, totalPages: availablePages.length, builtPages: 0 } } }}
    />
  )
}

describe('resolvePageDevelopStatus', function resolveStatus() {
  const planSlugs = ['homepage', 'about', 'contact']

  it('returns complete when slug is in developCompletedSlugs', function complete() {
    expect(resolvePageDevelopStatus('about', planSlugs, ['about'], null, false)).toBe('complete')
  })

  it('returns building when processing current slug', function currentBuilding() {
    expect(resolvePageDevelopStatus('contact', planSlugs, ['homepage'], 'contact', true)).toBe('building')
  })

  it('returns building for first plan slug during homepage handoff', function homepageHandoff() {
    expect(resolvePageDevelopStatus('homepage', planSlugs, [], null, true)).toBe('building')
  })

  it('returns pending for untouched slugs', function pending() {
    expect(resolvePageDevelopStatus('contact', planSlugs, ['homepage'], null, false)).toBe('pending')
  })
})

describe('RebuildPageSelectorToolRenderer multi-select', () => {
  beforeEach(() => {
    useRebuildBuildQueue.getState().stop()
    useUpfrontRebuildBuildQueueStore.setState({ queues: {} })
    for (const k of Object.keys(switchboardFlags)) delete switchboardFlags[k]
  })

  it('enqueues exactly the checked pages on Build', () => {
    renderSelector(pages(3))
    fireEvent.click(screen.getByLabelText('Page 0'))
    fireEvent.click(screen.getByLabelText('Page 2'))
    fireEvent.click(screen.getByText(/Build 2 pages/))
    expect(useRebuildBuildQueue.getState().slugs).toEqual(['p0', 'p2'])
    expect(useRebuildBuildQueue.getState().status).toBe('running')
  })

  it('prevents selecting more than the cap', () => {
    renderSelector(pages(REBUILD_BATCH_CAP)) // exactly the cap, all visible (INITIAL_VISIBLE === cap)
    for (let i = 0; i < REBUILD_BATCH_CAP; i++) fireEvent.click(screen.getByLabelText(`Page ${i}`))
    fireEvent.click(screen.getByText(new RegExp(`Build ${REBUILD_BATCH_CAP} pages`)))
    expect(useRebuildBuildQueue.getState().slugs).toHaveLength(REBUILD_BATCH_CAP)
  })

  it('disables unchecked checkboxes once the cap is selected (UI cap, independent of store slice)', () => {
    renderSelector(pages(REBUILD_BATCH_CAP + 2))
    fireEvent.click(screen.getByText(/Show \d+ more/)) // expand so the tail rows are interactive (not inert)
    for (let i = 0; i < REBUILD_BATCH_CAP; i++) fireEvent.click(screen.getByLabelText(`Page ${i}`))
    // Pages beyond the cap are unchecked AND disabled by the renderer (not just store-truncated).
    expect((screen.getByLabelText(`Page ${REBUILD_BATCH_CAP}`) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(`Page ${REBUILD_BATCH_CAP + 1}`) as HTMLInputElement).disabled).toBe(true)
    // An already-selected page stays enabled so it can be deselected.
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).disabled).toBe(false)
  })

  it('collapses the tail past INITIAL_VISIBLE and animates open via show more / show fewer', () => {
    renderSelector(pages(REBUILD_BATCH_CAP + 2))
    // Tail rows stay mounted (the grid 0fr→1fr trick animates height); collapse is
    // expressed via the grid-rows class, not by unmounting.
    const tail = screen.getByTestId('rebuild-page-tail')
    expect(screen.getByLabelText(`Page ${REBUILD_BATCH_CAP}`)).toBeInTheDocument()
    expect(tail).toHaveClass('grid-rows-[0fr]')
    fireEvent.click(screen.getByText(/Show 2 more/))
    expect(tail).toHaveClass('grid-rows-[1fr]')
    fireEvent.click(screen.getByText('Show fewer'))
    expect(tail).toHaveClass('grid-rows-[0fr]')
  })

  it('renders the build CTA above the page list', () => {
    renderSelector(pages(3))
    const cta = screen.getByText(/Select pages|Build \d+ pages/)
    const firstCheckbox = screen.getByLabelText('Page 0')
    // DOCUMENT_POSITION_FOLLOWING (4) → firstCheckbox comes after the CTA in DOM order.
    expect(cta.compareDocumentPosition(firstCheckbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('select-all checks every unbuilt page; the same control then deselects all', () => {
    renderSelector(pages(3)) // > 1 and <= cap → select-all is offered
    fireEvent.click(screen.getByText('Select all'))
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Page 2') as HTMLInputElement).checked).toBe(true)
    // Control flips to "Deselect all" once everything is selected.
    fireEvent.click(screen.getByText('Deselect all'))
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).checked).toBe(false)
  })

  it('excludes homepage-alias slugs (home/index) from the list', () => {
    renderSelector([
      { slug: 'home', title: 'Home alias', url: '/home', isBuilt: false },
      { slug: 'index', title: 'Index alias', url: '/index', isBuilt: false },
      { slug: 'about', title: 'About', url: '/about', isBuilt: false },
    ])
    expect(screen.getByLabelText('About')).toBeInTheDocument()
    expect(screen.queryByLabelText('Home alias')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Index alias')).not.toBeInTheDocument()
  })

  it('renders nothing when every unbuilt page is a homepage alias (no dead card)', () => {
    const { container } = renderSelector([
      { slug: 'home', title: 'Home alias', url: '/home', isBuilt: false },
    ])
    expect(container).toBeEmptyDOMElement()
  })

  it('disables checkboxes and the CTA while a batch is running', () => {
    useRebuildBuildQueue.getState().enqueue(['p0', 'p1'])
    renderSelector(pages(3))
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Select pages|Build \d+ pages/).closest('button')).toBeDisabled()
  })

  it('re-enables the selection UI once the batch stops', () => {
    useRebuildBuildQueue.getState().enqueue(['p0', 'p1'])
    renderSelector(pages(3))
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).disabled).toBe(true)
    act(() => useRebuildBuildQueue.getState().stop())
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).disabled).toBe(false)
  })

  it('suppresses the stream card when the panel owns the selector', () => {
    switchboardFlags['airo-builder-chat-plans'] = true
    switchboardFlags['airo-builder-theme-selection-chat'] = true
    const { container } = renderSelector(pages(3), 'regular')
    // Panel owns it → stream renders nothing to avoid a duplicate selector.
    expect(container).toBeEmptyDOMElement()
  })

  it('suppresses the stream card on the font-only panel branch too', () => {
    // panelOwnsSelector = chat-plans && (theme || font) — font-only must also count.
    switchboardFlags['airo-builder-chat-plans'] = true
    switchboardFlags['airo-builder-font-selection-chat'] = true
    const { container } = renderSelector(pages(3), 'regular')
    expect(container).toBeEmptyDOMElement()
  })

  it('still renders the stream card when the panel does NOT own the selector', () => {
    // chat-plans off → panel absent → stream card is the sole host.
    const { container } = renderSelector(pages(3), 'regular')
    expect(container).not.toBeEmptyDOMElement()
    expect(screen.getByLabelText('Page 0')).toBeInTheDocument()
  })
})

describe('RebuildPageSelectorToolRenderer upfront plan progress', function planProgress() {
  beforeEach(function reset() {
    useUpfrontRebuildBuildQueueStore.setState({ queues: {} })
  })

  it('renders plan progress with status attributes during upfront build', function progressList() {
    const appId = 'plan-app'
    useUpfrontRebuildBuildQueueStore.getState().setPlan(appId, ['homepage', 'about', 'contact'], ['about', 'contact'])
    useUpfrontRebuildBuildQueueStore.getState().markDevelopComplete(appId, 'homepage')
    useUpfrontRebuildBuildQueueStore.getState().setCurrentBuild(appId, 'about')

    renderWithProviders(
      <RebuildPageSelectorToolRenderer
        toolName="rebuildPageSelector"
        toolStatus="completed"
        isLastAssistantMessage
        size="small"
        result={{
          widget: {
            widgetType: 'rebuild-page-selector',
            widgetData: {
              appId,
              sourceUrl: 's',
              availablePages: [
                { slug: 'homepage', title: 'Home', url: '/', isBuilt: true },
                { slug: 'about', title: 'About', url: '/about', isBuilt: false },
                { slug: 'contact', title: 'Contact', url: '/contact', isBuilt: false },
              ],
              totalPages: 3,
              builtPages: 1,
            },
          },
        }}
      />,
    )

    expect(screen.getByTestId('rebuild-plan-page-homepage')).toHaveAttribute('data-status', 'complete')
    expect(screen.getByTestId('rebuild-plan-page-about')).toHaveAttribute('data-status', 'pending')
    expect(screen.getByTestId('rebuild-plan-page-contact')).toHaveAttribute('data-status', 'pending')
  })
})
