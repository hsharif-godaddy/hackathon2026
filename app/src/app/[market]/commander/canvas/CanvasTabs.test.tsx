/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { forwardRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { useCommanderStore } from '@/stores/useCommanderStore'
import { renderWithProviders } from '@/tests/test-utils'
import { CanvasTabs } from './CanvasTabs'
import { CanvasId, PINNED_CANVAS_ID } from './registry'

vi.mock('@ux/tooltip', () => ({
  default: ({ children, id }: { children: ReactNode; id?: string }) => (
    <div data-testid="tooltip" id={id} role="tooltip">{children}</div>
  ),
}))

vi.mock('@ux/button', () => ({
  default: forwardRef(function MockButton(
    {
      icon,
      onClick,
      onMouseEnter,
      onMouseLeave,
      ...rest
    }: {
      icon?: ReactNode
      onClick?: () => void
      onMouseEnter?: () => void
      onMouseLeave?: () => void
      [key: string]: unknown
    },
    ref: React.Ref<HTMLButtonElement>,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...rest}
      >
        {icon}
      </button>
    )
  }),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => true,
}))

const { logClickEventSpy } = vi.hoisted(() => ({ logClickEventSpy: vi.fn(() => vi.fn()) }))

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: logClickEventSpy,
}))

const resetCommanderStore = (openCanvasIds: CanvasId[], activeCanvasId: CanvasId = PINNED_CANVAS_ID) => {
  useCommanderStore.setState({
    openCanvasIds,
    activeCanvasId,
    isCanvasSettingsOpen: false,
  })
}

afterEach(() => {
  resetCommanderStore([CanvasId.Preview, CanvasId.Brand, CanvasId.Domain])
})

describe('CanvasTabs', () => {
  describe('close label', () => {
    it('uses builder_common_close when tab labels are expanded', function expandedCloseLabel() {
      resetCommanderStore([CanvasId.Preview, CanvasId.Brand, CanvasId.Domain], CanvasId.Brand)

      renderWithProviders(<CanvasTabs />)

      expect(screen.getByRole('button', { name: 'builder_common_close' })).toBeInTheDocument()
    })

    it('uses builder_commander_canvas_tab_close_named when tab labels are collapsed', function collapsedCloseLabel() {
      resetCommanderStore(
        [CanvasId.Preview, CanvasId.Brand, CanvasId.Domain, CanvasId.Code, CanvasId.Inbox],
        CanvasId.Brand,
      )

      renderWithProviders(<CanvasTabs />)

      expect(
        screen.getByRole('button', { name: 'builder_commander_canvas_tab_close_named' }),
      ).toBeInTheDocument()
    })
  })

  describe('click tracking eids', () => {
    // parseEID drops any eid whose dot-count !== 2, so the canvasId must ride in
    // customProperties, not as a fourth eid segment. These lock that contract in
    // (the mock is a no-op at runtime, so only the call shape is asserted here).
    it('tracks activation with a static 3-segment eid and canvasId in customProperties', async () => {
      resetCommanderStore([CanvasId.Preview, CanvasId.Brand, CanvasId.Domain], CanvasId.Preview)
      const { user } = renderWithProviders(<CanvasTabs />)
      logClickEventSpy.mockClear()

      await user.click(screen.getByRole('tab', { name: 'Brand' }))

      expect(logClickEventSpy).toHaveBeenCalledWith(
        'commander.canvas_tab.activate',
        expect.objectContaining({ canvasId: CanvasId.Brand }),
      )
    })

    it('tracks close with a static 3-segment eid and canvasId in customProperties', async () => {
      resetCommanderStore([CanvasId.Preview, CanvasId.Brand, CanvasId.Domain], CanvasId.Brand)
      const { user } = renderWithProviders(<CanvasTabs />)
      logClickEventSpy.mockClear()

      await user.click(screen.getByRole('button', { name: 'builder_common_close' }))

      expect(logClickEventSpy).toHaveBeenCalledWith(
        'commander.canvas_tab.close',
        expect.objectContaining({ canvasId: CanvasId.Brand }),
      )
    })
  })
})
