/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { useRebuildBuildQueue } from '@/app/[market]/develop/hooks/useRebuildBuildQueue'
import { renderWithProviders } from '@/tests/test-utils'
import RebuildQueueProgress from './RebuildQueueProgress'

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (id: string, values?: Record<string, unknown>) => {
    if (id === 'builder_rebuild_building_progress') return `Building ${values?.current} of ${values?.total}`
    if (id === 'builder_rebuild_stop') return 'Stop'
    return id
  },
}))
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

describe('RebuildQueueProgress', () => {
  beforeEach(() => useRebuildBuildQueue.getState().stop())

  it('renders nothing when no batch is running', () => {
    const { container } = renderWithProviders(<RebuildQueueProgress />)
    expect(container.innerHTML).toBe('')
  })

  it('shows "Building X of Y" and a Stop button while a batch runs', () => {
    useRebuildBuildQueue.getState().enqueue(['a', 'b', 'c']) // cursor 0 of 3
    renderWithProviders(<RebuildQueueProgress />)
    expect(screen.getByText('Building 1 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Stop'))
    expect(useRebuildBuildQueue.getState().status).toBe('idle')
  })

  it('tracks the cursor as the batch advances (renders cursor + 1)', () => {
    const s = useRebuildBuildQueue.getState()
    s.enqueue(['a', 'b', 'c'])
    // Advance one page: send → turn starts → turn ends ⇒ cursor 0 → 1.
    s.markSent()
    s.onProcessingChange(true)
    s.onProcessingChange(false)
    renderWithProviders(<RebuildQueueProgress />)
    expect(screen.getByText('Building 2 of 3')).toBeInTheDocument()
  })
})
