/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { useCommanderStore } from '@/stores/useCommanderStore'
import { renderWithProviders } from '@/tests/test-utils'
import { CanvasMenu } from './CanvasMenu'
import { CANVAS_MENU_ORDER, CanvasId, DEFAULT_OPEN_CANVAS_IDS, PINNED_CANVAS_ID } from './registry'

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

  it('offers Automations in the menu when its flag is on and it is not currently open', async () => {
    switchboardValues['appbuilder-automations'] = true
    resetCommanderStore([CanvasId.Preview])

    await openMenu()

    expect(screen.getByTestId(`commander-canvas-tabs-menu-${CanvasId.Automations}`))
      .toBeInTheDocument()
  })

  it('renders the open-canvas label on the add-canvas trigger', () => {
    renderWithProviders(<CanvasMenu />)

    expect(screen.getByTestId('commander-canvas-tabs-menu-trigger'))
      .toHaveTextContent('builder_commander_open_canvas')
  })

  it('marks the trigger as expanded while the menu is open', async () => {
    await openMenu()

    expect(screen.getByTestId('commander-canvas-tabs-menu-trigger')).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('hides the menu trigger on desktop when all available canvases are already open', () => {
    resetCommanderStore([...CANVAS_MENU_ORDER])

    renderWithProviders(<CanvasMenu />)

    expect(screen.queryByTestId('commander-canvas-tabs-menu-trigger'))
      .not.toBeInTheDocument()
  })
})
