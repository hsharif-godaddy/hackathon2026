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

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: () => () => {},
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
})
