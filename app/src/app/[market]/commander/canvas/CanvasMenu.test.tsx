/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { forwardRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'

import { useCommanderStore } from '@/stores/useCommanderStore'
import { renderWithProviders } from '@/tests/test-utils'
import { CanvasMenu } from './CanvasMenu'
import { CanvasId, DEFAULT_OPEN_CANVAS_IDS, PINNED_CANVAS_ID } from './registry'

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

const switchboardValues: Record<string, unknown> = {}

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => switchboardValues[flag],
}))

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: () => () => {},
}))

const resetCommanderStore = (openCanvasIds: CanvasId[] = [...DEFAULT_OPEN_CANVAS_IDS]) => {
  useCommanderStore.setState({
    openCanvasIds,
    activeCanvasId: PINNED_CANVAS_ID,
    isCanvasSettingsOpen: false,
  })
}

afterEach(() => {
  for (const key of Object.keys(switchboardValues)) {
    delete switchboardValues[key]
  }
  resetCommanderStore()
})

const openMenu = async () => {
  const { user, ...rest } = renderWithProviders(<CanvasMenu />)
  await user.click(screen.getByTestId('commander-canvas-tabs-menu-trigger'))
  return { user, ...rest }
}

describe('CanvasMenu', () => {
  it('hides any canvas already open in the tab strip', async () => {
    resetCommanderStore([CanvasId.Preview, CanvasId.Brand])

    await openMenu()

    expect(screen.queryByTestId(`commander-canvas-tabs-menu-${CanvasId.Brand}`))
      .not.toBeInTheDocument()
  })

  it('offers the top-level Domain canvas in the menu when its flag is on and it is not currently open', async () => {
    switchboardValues['appbuilder-domain-top-level'] = true
    resetCommanderStore([CanvasId.Preview])

    await openMenu()

    expect(screen.getByTestId(`commander-canvas-tabs-menu-${CanvasId.Domain}`))
      .toBeInTheDocument()
  })

  describe('tooltip', () => {
    it('shows tooltip on mouse enter when the menu is closed', function showTooltip() {
      renderWithProviders(<CanvasMenu />)

      const trigger = screen.getByTestId('commander-canvas-tabs-menu-trigger')
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      fireEvent.mouseEnter(trigger)
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('hides tooltip on mouse leave', function hideTooltip() {
      renderWithProviders(<CanvasMenu />)

      const trigger = screen.getByTestId('commander-canvas-tabs-menu-trigger')
      fireEvent.mouseEnter(trigger)
      fireEvent.mouseLeave(trigger)

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('does not show tooltip while the popover is open', async function hideTooltipWhenOpen() {
      await openMenu()

      const trigger = screen.getByTestId('commander-canvas-tabs-menu-trigger')
      fireEvent.mouseEnter(trigger)

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })
})
