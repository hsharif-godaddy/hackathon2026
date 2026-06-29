/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'

import { CanvasActionsVariant } from '@/app/[market]/commander/canvas/actions'
import { CanvasId } from '@/app/[market]/commander/canvas/registry'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { renderWithProviders } from '@/tests/test-utils'
import CanvasActionsHost from './CanvasActionsHost'

// Mock the provider registry so the test never pulls in the real Preview hook;
// only the Preview canvas has a provider here.
vi.mock('@/app/[market]/commander/canvas/actionProviders', () => ({
  CANVAS_ACTION_PROVIDERS: {
    preview: () => [
      {
        type: 'button',
        id: 'fake',
        icon: null,
        label: 'Fake Action',
        onTrigger: vi.fn(),
      },
    ],
  },
}))

describe('CanvasActionsHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.Preview })
    })
  })

  it('renders the active canvas bar when a provider exists', () => {
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.Preview })
    })
    renderWithProviders(<CanvasActionsHost variant={CanvasActionsVariant.Inline} />)
    expect(screen.getByRole('button', { name: 'Fake Action' })).toBeInTheDocument()
  })

  it('renders nothing when the active canvas has no provider', () => {
    act(() => {
      useCommanderStore.setState({ activeCanvasId: CanvasId.Code })
    })
    renderWithProviders(<CanvasActionsHost variant={CanvasActionsVariant.Inline} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
