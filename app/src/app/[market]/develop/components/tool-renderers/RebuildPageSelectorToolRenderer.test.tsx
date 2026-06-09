/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { REBUILD_BATCH_CAP, useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import { renderWithProviders } from '@/tests/test-utils'
import RebuildPageSelectorToolRenderer from './RebuildPageSelectorToolRenderer'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string, values?: Record<string, unknown>) => {
    if (id === 'builder_rebuild_build_n_pages') return `Build ${values?.count ?? 0} pages`
    if (id === 'builder_rebuild_building_progress') return `Building ${values?.current} of ${values?.total}…`
    if (id === 'builder_rebuild_stop') return 'Stop'
    if (id === 'builder_rebuild_select_all') return 'Select all'
    return id
  },
}))
vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
  useIsLoading: () => false,
}))

function pages(n: number) {
  return Array.from({ length: n }, (_, i) => ({ slug: `p${i}`, title: `Page ${i}`, url: `/p${i}`, isBuilt: false }))
}
function renderSelector(availablePages: ReturnType<typeof pages>) {
  return renderWithProviders(
    <RebuildPageSelectorToolRenderer
      toolName="rebuildPageSelector"
      toolStatus="completed"
      isLastAssistantMessage
      result={{ widget: { widgetType: 'rebuild-page-selector', widgetData: { appId: 'a', sourceUrl: 's', availablePages, totalPages: availablePages.length, builtPages: 0 } } }}
    />
  )
}

describe('RebuildPageSelectorToolRenderer multi-select', () => {
  beforeEach(() => useRebuildBuildQueue.getState().stop())

  it('enqueues exactly the checked pages on Build', () => {
    renderSelector(pages(3))
    fireEvent.click(screen.getByLabelText('Page 0'))
    fireEvent.click(screen.getByLabelText('Page 2'))
    fireEvent.click(screen.getByText(/Build 2 pages/))
    expect(useRebuildBuildQueue.getState().slugs).toEqual(['p0', 'p2'])
    expect(useRebuildBuildQueue.getState().status).toBe('running')
  })

  it('prevents selecting more than the cap', () => {
    renderSelector(pages(REBUILD_BATCH_CAP + 2))
    for (let i = 0; i < REBUILD_BATCH_CAP + 2; i++) {
      const box = screen.getByLabelText(`Page ${i}`) as HTMLInputElement
      if (!box.disabled) fireEvent.click(box)
    }
    fireEvent.click(screen.getByText(new RegExp(`Build ${REBUILD_BATCH_CAP} pages`)))
    expect(useRebuildBuildQueue.getState().slugs).toHaveLength(REBUILD_BATCH_CAP)
  })

  it('disables unchecked checkboxes once the cap is selected (UI cap, independent of store slice)', () => {
    renderSelector(pages(REBUILD_BATCH_CAP + 2))
    for (let i = 0; i < REBUILD_BATCH_CAP; i++) {
      fireEvent.click(screen.getByLabelText(`Page ${i}`))
    }
    // The pages beyond the cap are unchecked AND disabled by the renderer itself
    // (not just truncated by the store on enqueue).
    expect((screen.getByLabelText(`Page ${REBUILD_BATCH_CAP}`) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(`Page ${REBUILD_BATCH_CAP + 1}`) as HTMLInputElement).disabled).toBe(true)
    // An already-selected page stays enabled so it can be deselected.
    expect((screen.getByLabelText('Page 0') as HTMLInputElement).disabled).toBe(false)
  })

  it('shows "Building X of Y…" progress and hides the selection UI while a batch runs', () => {
    useRebuildBuildQueue.getState().enqueue(['p0', 'p1']) // running, cursor 0, total 2
    renderSelector(pages(3))
    expect(screen.getByText('Building 1 of 2…')).toBeInTheDocument()
    expect(screen.getByText('Stop')).toBeInTheDocument()
    // The checkbox/Build UI is replaced by the progress row while running.
    expect(screen.queryByLabelText('Page 0')).not.toBeInTheDocument()
  })

  it('clicking Stop clears the running batch and restores the selection UI', () => {
    useRebuildBuildQueue.getState().enqueue(['p0', 'p1'])
    renderSelector(pages(3))
    fireEvent.click(screen.getByText('Stop'))
    expect(useRebuildBuildQueue.getState().status).toBe('idle')
    // Selection UI comes back once the queue is idle.
    expect(screen.getByLabelText('Page 0')).toBeInTheDocument()
  })
})
